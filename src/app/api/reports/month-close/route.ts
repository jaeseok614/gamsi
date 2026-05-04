import { Prisma, WorkThreadStatus, WorkThreadTargetType } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canViewReports } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import {
  applyMonthClosePayroll,
  buildMonthCloseDiff,
  closeMonth,
  getMonthCloseRecord,
  markMonthClosePayrollPending,
  reopenMonth,
  requestMonthReopen,
  reviewMonthReopenRequest
} from "@/lib/month-close";
import { notifyMonthCloseStatus } from "@/lib/notifications";
import { getPayrollReport } from "@/lib/payroll";
import { closeWorkThreadForTarget, ensureWorkThreadForMonthClose, updateWorkThread } from "@/lib/workbox";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canViewReports(user.role)) {
    return jsonError("이 기능은 인사 담당 또는 관리자만 사용할 수 있습니다.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as {
    month?: string;
    action?: "close" | "reopen" | "requestReopen" | "approveReopen" | "rejectReopen" | "applyPayroll" | "markPayrollPending";
    reason?: string;
    requestId?: string;
  };

  const month = body.month?.trim();
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return jsonError("마감할 월 형식을 확인하세요.");
  }

  try {
    if (body.action === "requestReopen") {
      const current = await getMonthCloseRecord(user.companyId, month);
      if (!current || current.status !== "CLOSED") {
        return jsonError("이미 마감된 월만 재오픈 요청할 수 있습니다.");
      }

      const payrollReport = await getPayrollReport(user, month);
      const request = await requestMonthReopen(user, {
        month,
        reason: body.reason ?? "",
        diffFromLockedSnapshot: payrollReport.liveDiffFromClosedSnapshot ?? undefined
      });

      await writeAuditLog({
        companyId: user.companyId,
        actorUserId: user.id,
        action: "month_close.reopen_requested.audit",
        targetType: "month_close",
        targetId: current.id,
        payload: {
          month,
          requestId: request.requestId,
          reason: request.reason
        }
      });
      const thread = await ensureWorkThreadForMonthClose({
        companyId: user.companyId,
        month,
        actorUserId: user.id,
        title: `${month} 월마감 재오픈 요청`
      });
      if (thread) {
        await updateWorkThread(user, {
          threadId: thread.id,
          status: WorkThreadStatus.OPEN
        });
      }

      return NextResponse.json(request);
    }

    if (body.action === "approveReopen" || body.action === "rejectReopen") {
      if (user.role !== "ADMIN") {
        return jsonError("재오픈 승인과 반려는 관리자만 할 수 있습니다.", 403);
      }

      const requestId = body.requestId?.trim();
      if (!requestId) {
        return jsonError("재오픈 요청 ID가 필요합니다.");
      }

      const result = await reviewMonthReopenRequest(user, {
        requestId,
        decision: body.action === "approveReopen" ? "APPROVED" : "REJECTED",
        reviewNote: body.reason ?? ""
      });

      return NextResponse.json(result);
    }

    if (body.action === "reopen") {
      if (user.role !== "ADMIN") {
        return jsonError("바로 재오픈은 관리자만 할 수 있습니다.", 403);
      }
      const current = await getMonthCloseRecord(user.companyId, month);
      if (!current || current.status !== "CLOSED") {
        return jsonError("이미 마감된 월만 재오픈할 수 있습니다.");
      }

      const reopened = await reopenMonth(user, {
        month,
        reason: body.reason ?? "",
        detail: {
          previousStatus: current.status,
          previousPayrollSyncStatus: current.payrollSyncStatus,
          diffFromLockedSnapshot: buildMonthCloseDiff(
            current.summary ?? null,
            (await getPayrollReport(user, month)).monthCloseLiveSummary
          )
        } satisfies Prisma.JsonObject
      });

      await writeAuditLog({
        companyId: user.companyId,
        actorUserId: user.id,
        action: "month_close.reopened",
        targetType: "month_close",
        targetId: reopened.id,
        payload: {
          month,
          reason: reopened.reopenReason
        }
      });

      await notifyMonthCloseStatus({
        companyId: user.companyId,
        month,
        actorName: user.name,
        status: "OPEN",
        reason: reopened.reopenReason ?? undefined
      });
      const thread = await ensureWorkThreadForMonthClose({
        companyId: user.companyId,
        month,
        actorUserId: user.id,
        title: `${month} 월마감 재오픈`
      });
      if (thread) {
        await updateWorkThread(user, {
          threadId: thread.id,
          status: WorkThreadStatus.OPEN
        });
      }

      return NextResponse.json(reopened);
    }

    if (body.action === "applyPayroll") {
      const applied = await applyMonthClosePayroll(user, {
        month,
        detail: {
          appliedAt: new Date().toISOString()
        } satisfies Prisma.JsonObject
      });

      await writeAuditLog({
        companyId: user.companyId,
        actorUserId: user.id,
        action: "month_close.payroll_applied",
        targetType: "month_close",
        targetId: applied.id,
        payload: {
          month
        }
      });

      return NextResponse.json(applied);
    }

    if (body.action === "markPayrollPending") {
      const pending = await markMonthClosePayrollPending(user, {
        month,
        detail: {
          reason: body.reason ?? "급여 반영 상태 해제"
        } satisfies Prisma.JsonObject
      });

      await writeAuditLog({
        companyId: user.companyId,
        actorUserId: user.id,
        action: "month_close.payroll_pending",
        targetType: "month_close",
        targetId: pending.id,
        payload: {
          month,
          reason: body.reason ?? null
        }
      });

      return NextResponse.json(pending);
    }

    const payrollReport = await getPayrollReport(user, month);
    if (payrollReport.monthClose?.status === "CLOSED") {
      return NextResponse.json(payrollReport.monthClose);
    }

    if (!payrollReport.canClose) {
      return jsonError("조치가 필요한 항목이 남아 있어 월 마감을 확정할 수 없습니다.");
    }

    const summary = {
      blockingSummary: payrollReport.blockingSummary,
      totals: payrollReport.totals,
      policySnapshot: {
        standardDailyMinutes: payrollReport.policy.standardDailyMinutes,
        weeklyLimitMinutes: payrollReport.policy.weeklyLimitMinutes,
        overtimeThresholdMinutes: payrollReport.policy.overtimeThresholdMinutes,
        annualLeaveGrantDays: payrollReport.policy.annualLeaveGrantDays,
        annualLeaveCarryoverDays: payrollReport.policy.annualLeaveCarryoverDays,
        overtimePremiumRate: payrollReport.policy.overtimePremiumRate,
        nightPremiumRate: payrollReport.policy.nightPremiumRate,
        holidayPremiumRate: payrollReport.policy.holidayPremiumRate,
        holidayIncludesWeekends: payrollReport.policy.holidayIncludesWeekends,
        nightWorkStart: payrollReport.policy.nightWorkStart,
        nightWorkEnd: payrollReport.policy.nightWorkEnd,
        version: payrollReport.policy.version,
        annualLeaveBasis: payrollReport.policy.annualLeaveBasis,
        firstYearMonthlyAccrualEnabled: payrollReport.policy.firstYearMonthlyAccrualEnabled,
        carryoverExpiryMonth: payrollReport.policy.carryoverExpiryMonth,
        carryoverExpiryDay: payrollReport.policy.carryoverExpiryDay,
        allowHalfDayLeave: payrollReport.policy.allowHalfDayLeave,
        allowHourlyLeave: payrollReport.policy.allowHourlyLeave,
        hourlyLeaveUnitMinutes: payrollReport.policy.hourlyLeaveUnitMinutes
      },
      holidaySnapshot: payrollReport.holidays.map((holiday) => ({
        date: holiday.date.toISOString().slice(0, 10),
        name: holiday.name,
        isPaidHoliday: holiday.isPaidHoliday
      })),
      generatedAt: new Date().toISOString(),
      generatedBy: user.name,
      lockReason: body.reason?.trim() || null,
      payrollStatus: payrollReport.monthClose?.payrollSyncStatus ?? "PENDING",
      recentEvents: payrollReport.monthCloseEvents.slice(0, 5).map((event) => ({
        type: event.type,
        createdAt: event.createdAt.toISOString(),
        actor: event.actor?.name ?? null
      }))
    } satisfies Prisma.JsonObject;

    const closed = await closeMonth(user, {
      month,
      summary
    });

    await writeAuditLog({
      companyId: user.companyId,
      actorUserId: user.id,
      action: "month_close.closed",
      targetType: "month_close",
      targetId: closed.id,
      payload: {
        month,
        blockingSummary: payrollReport.blockingSummary
      }
    });

    await notifyMonthCloseStatus({
      companyId: user.companyId,
      month,
      actorName: user.name,
      status: "CLOSED"
    });
    await closeWorkThreadForTarget({
      companyId: user.companyId,
      targetType: WorkThreadTargetType.MONTH_CLOSE,
      targetId: month,
      actorUserId: user.id,
      reason: "월 마감 확정"
    });

    return NextResponse.json(closed);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "월 마감 처리에 실패했습니다.");
  }
}

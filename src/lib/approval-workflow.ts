import {
  AdjustmentType,
  ApprovalStatus,
  ApprovalType,
  EventType,
  LeaveType,
  RiskType,
  WorkThreadTargetType,
  WorkStatus,
  type User
} from "@/generated/prisma";

import { recalculateSession } from "@/lib/attendance";
import { writeAuditLog } from "@/lib/audit";
import { canManage } from "@/lib/auth";
import { getAnnualLeaveRequestDays, getAnnualLeaveSummaryForUser, splitAnnualLeaveRangeByCycle } from "@/lib/leave";
import { getManagedUsers } from "@/lib/manager";
import { assertDateMonthOpen, assertMonthRangeOpen } from "@/lib/month-close";
import { notifyApprovalReviewed } from "@/lib/notifications";
import { buildHolidayDateSet, getCompanyHolidays, getCurrentWorkPolicy } from "@/lib/policy-engine";
import { prisma } from "@/lib/prisma";
import { refreshRiskSignalsForUserIds, resolveRiskSignalsForAction } from "@/lib/risks";
import { getKstDateString, kstDayBounds } from "@/lib/time";
import { closeWorkThreadForTarget } from "@/lib/workbox";

type Actor = Pick<User, "id" | "companyId" | "role" | "name" | "teamId">;

export type ApprovalReviewResult = {
  approvalId: string;
  status: ApprovalStatus;
  requesterId: string;
  resolvedRiskCount: number;
};

async function getManagedApproval(actor: Actor, approvalId: string) {
  if (!canManage(actor.role)) {
    throw new Error("관리자 권한이 필요합니다.");
  }

  const managedUsers = await getManagedUsers(actor);
  const managedUserIds = new Set(managedUsers.map((managedUser) => managedUser.id));
  const approval = await prisma.approvalRequest.findUnique({
    where: {
      id: approvalId
    },
    include: {
      session: true,
      requester: {
        select: {
          id: true,
          joinedAt: true
        }
      }
    }
  });

  if (!approval || approval.companyId !== actor.companyId || !managedUserIds.has(approval.requesterId)) {
    throw new Error("승인 요청을 찾을 수 없습니다.");
  }

  return approval;
}

async function assertApprovalMonthOpen(actor: Actor, approval: Awaited<ReturnType<typeof getManagedApproval>>) {
  if (approval.type === ApprovalType.LEAVE && approval.leaveStartDate && approval.leaveEndDate) {
    await assertMonthRangeOpen(
      actor.companyId,
      approval.leaveStartDate.toISOString().slice(0, 10),
      approval.leaveEndDate.toISOString().slice(0, 10),
      "마감이 확정된 월의 휴가 요청은 처리할 수 없습니다."
    );
    return;
  }

  if (approval.targetDate) {
    await assertDateMonthOpen(actor.companyId, approval.targetDate, "마감이 확정된 월의 근태 요청은 처리할 수 없습니다.");
    return;
  }

  if (approval.session?.workDate) {
    await assertDateMonthOpen(actor.companyId, approval.session.workDate, "마감이 확정된 월의 초과근로 요청은 처리할 수 없습니다.");
  }
}

async function assertAnnualLeaveCapacity(actor: Actor, approval: Awaited<ReturnType<typeof getManagedApproval>>) {
  if (
    approval.type !== ApprovalType.LEAVE ||
    approval.leaveType !== LeaveType.ANNUAL ||
    !approval.leaveStartDate ||
    !approval.leaveEndDate
  ) {
    return;
  }

  const startDate = approval.leaveStartDate.toISOString().slice(0, 10);
  const endDate = approval.leaveEndDate.toISOString().slice(0, 10);
  const policy = await getCurrentWorkPolicy(actor.companyId, endDate);
  const joinedAt = approval.requester.joinedAt.toISOString().slice(0, 10);
  const holidays = await getCompanyHolidays(actor.companyId, startDate, endDate);
  const holidayDateSet = buildHolidayDateSet(holidays);
  const requestSegments =
    approval.leaveDuration === "FULL_DAY"
      ? splitAnnualLeaveRangeByCycle({
          joinedAt,
          annualLeaveBasis: policy.annualLeaveBasis,
          startDate,
          endDate
        })
      : [
          {
            startDate,
            endDate,
            cycleStart: startDate,
            cycleEnd: endDate
          }
        ];

  const segmentRequests = requestSegments
    .map((segment) => ({
      ...segment,
      requestedDays: getAnnualLeaveRequestDays(
        {
          leaveType: approval.leaveType,
          leaveDuration: approval.leaveDuration,
          leaveStartDate: approval.leaveStartDate,
          leaveEndDate: approval.leaveEndDate,
          requestedLeaveMinutes: approval.requestedLeaveMinutes
        },
        policy,
        holidayDateSet,
        {
          startDate: segment.startDate,
          endDate: segment.endDate
        }
      )
    }))
    .filter((segment) => segment.requestedDays > 0);

  if (segmentRequests.length === 0) {
    throw new Error("연차 차감 대상 근무일이 없어 승인할 수 없습니다.");
  }

  for (const segment of segmentRequests) {
    const { summary } = await getAnnualLeaveSummaryForUser({
      companyId: actor.companyId,
      user: approval.requester,
      asOfDate: segment.endDate,
      excludePendingRequestIds: [approval.id]
    });

    if (segment.requestedDays > summary.remainingDays + 0.001) {
      throw new Error(
        segmentRequests.length > 1
          ? `연차 잔액이 부족해 승인할 수 없습니다. ${segment.startDate} ~ ${segment.endDate} 구간의 승인 가능 잔여는 ${summary.remainingDays.toFixed(1)}일입니다.`
          : `연차 잔액이 부족해 승인할 수 없습니다. 현재 승인 가능 잔여는 ${summary.remainingDays.toFixed(1)}일입니다.`
      );
    }
  }
}

async function resolveApprovalRisks(input: {
  actor: Actor;
  approval: Awaited<ReturnType<typeof getManagedApproval>>;
}) {
  const { actor, approval } = input;

  if (approval.type === ApprovalType.OVERTIME && approval.session?.workDate) {
    return resolveRiskSignalsForAction({
      companyId: actor.companyId,
      userId: approval.requesterId,
      actorUserId: actor.id,
      targetDate: approval.session.workDate.toISOString().slice(0, 10),
      types: [RiskType.UNAPPROVED_OVERTIME, RiskType.MISSING_EVIDENCE],
      resolutionType: "APPROVAL",
      resolutionReferenceId: approval.id,
      resolutionReferenceLabel: "초과근로 승인",
      resolutionNote: `승인 요청 ${approval.id} 처리로 해소`
    });
  }

  if (
    approval.type === ApprovalType.ADJUSTMENT &&
    approval.targetDate &&
    approval.adjustmentType &&
    approval.adjustmentType !== AdjustmentType.GENERAL
  ) {
    return resolveRiskSignalsForAction({
      companyId: actor.companyId,
      userId: approval.requesterId,
      actorUserId: actor.id,
      targetDate: approval.targetDate.toISOString().slice(0, 10),
      types: [RiskType.MISSING_CHECK_IN_OUT],
      resolutionType: "ADJUSTMENT",
      resolutionReferenceId: approval.id,
      resolutionReferenceLabel: "정정 승인",
      resolutionNote: `정정 승인 ${approval.id} 처리로 누락 리스크를 정리했습니다.`
    });
  }

  return 0;
}

export async function reviewApproval(input: {
  actor: Actor;
  approvalId: string;
  action: "approve" | "reject";
  reviewNote?: string;
}) {
  const approval = await getManagedApproval(input.actor, input.approvalId);

  if (approval.status !== ApprovalStatus.PENDING) {
    throw new Error("이미 처리된 승인 요청입니다.");
  }

  await assertApprovalMonthOpen(input.actor, approval);

  if (input.action === "approve") {
    await assertAnnualLeaveCapacity(input.actor, approval);
  }

  const updated = await prisma.approvalRequest.update({
    where: {
      id: approval.id
    },
    data: {
      status: input.action === "approve" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
      reviewerId: input.actor.id,
      reviewedAt: new Date(),
      reviewNote: input.reviewNote?.trim() || undefined
    }
  });

  let resolvedRiskCount = 0;

  if (input.action === "approve") {
    if (approval.type === ApprovalType.OVERTIME && approval.sessionId && approval.requestedMinutes) {
      await prisma.workSession.update({
        where: {
          id: approval.sessionId
        },
        data: {
          approvedOvertimeMinutes: approval.requestedMinutes
        }
      });
    }

    if (
      approval.type === ApprovalType.ADJUSTMENT &&
      approval.requestedAt &&
      approval.targetDate &&
      approval.adjustmentType &&
      approval.adjustmentType !== AdjustmentType.GENERAL
    ) {
      const { start, end } = kstDayBounds(approval.targetDate.toISOString().slice(0, 10));
      const existingEvents = await prisma.attendanceEvent.findMany({
        where: {
          userId: approval.requesterId,
          occurredAt: {
            gte: start,
            lt: end
          }
        }
      });
      const effectiveEvents = approval.targetDate.toISOString().slice(0, 10) === getKstDateString()
        ? existingEvents.filter((event) => event.occurredAt <= new Date())
        : existingEvents;
      const isCheckIn = approval.adjustmentType === AdjustmentType.MISSING_CHECK_IN;
      const duplicate = effectiveEvents.some(
        (event) => event.eventType === (isCheckIn ? EventType.CHECK_IN : EventType.CHECK_OUT)
      );

      if (!duplicate) {
        await prisma.attendanceEvent.create({
          data: {
            companyId: approval.companyId,
            userId: approval.requesterId,
            eventType: isCheckIn ? EventType.CHECK_IN : EventType.CHECK_OUT,
            status: isCheckIn ? WorkStatus.WORKING : null,
            occurredAt: approval.requestedAt,
            source: "correction_request",
            reason: `정정 승인: ${approval.reason}`
          }
        });
        await recalculateSession(approval.requesterId, approval.targetDate.toISOString().slice(0, 10));
      }
    }

    resolvedRiskCount = await resolveApprovalRisks({
      actor: input.actor,
      approval
    });
  }

  await writeAuditLog({
    companyId: input.actor.companyId,
    actorUserId: input.actor.id,
    action: input.action === "approve" ? "approval.approved" : "approval.rejected",
    targetType: "approval_request",
    targetId: approval.id,
    payload: {
      reviewNote: input.reviewNote?.trim() || null,
      resolvedRiskCount
    }
  });

  await refreshRiskSignalsForUserIds({
    companyId: input.actor.companyId,
    userIds: [approval.requesterId],
    actorUserId: input.actor.id,
    writeAudit: true
  });

  await notifyApprovalReviewed(
    approval.id,
    input.action === "approve" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED
  );
  await closeWorkThreadForTarget({
    companyId: input.actor.companyId,
    targetType: WorkThreadTargetType.APPROVAL_REQUEST,
    targetId: approval.id,
    actorUserId: input.actor.id,
    reason: input.action === "approve" ? "승인 처리 완료" : "반려 처리 완료"
  });

  return {
    approvalId: updated.id,
    status: updated.status,
    requesterId: updated.requesterId,
    resolvedRiskCount
  } satisfies ApprovalReviewResult;
}

export async function bulkReviewApprovals(input: {
  actor: Actor;
  approvalIds: string[];
  action: "approve" | "reject";
  reviewNote?: string;
}) {
  const uniqueApprovalIds = [...new Set(input.approvalIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueApprovalIds.length === 0) {
    throw new Error("처리할 승인 요청을 선택하세요.");
  }

  const results: ApprovalReviewResult[] = [];
  const failures: Array<{ approvalId: string; reason: string }> = [];

  for (const approvalId of uniqueApprovalIds) {
    try {
      results.push(
        await reviewApproval({
          actor: input.actor,
          approvalId,
          action: input.action,
          reviewNote: input.reviewNote
        })
      );
    } catch (error) {
      failures.push({
        approvalId,
        reason: error instanceof Error ? error.message : "요청 처리에 실패했습니다."
      });
    }
  }

  return {
    processed: results.length,
    failed: failures.length,
    resolvedRiskCount: results.reduce((sum, result) => sum + result.resolvedRiskCount, 0),
    failures
  };
}

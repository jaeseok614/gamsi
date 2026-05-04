import { ApprovalType, LeaveDuration, LeaveType } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { jsonError, requireApiUser } from "@/lib/api";
import { getAnnualLeaveRequestDays, getAnnualLeaveSummaryForUser, splitAnnualLeaveRangeByCycle } from "@/lib/leave";
import { assertMonthRangeOpen } from "@/lib/month-close";
import { notifyApprovalPending } from "@/lib/notifications";
import { buildHolidayDateSet, getCompanyHolidays, getCurrentWorkPolicy } from "@/lib/policy-engine";
import { prisma } from "@/lib/prisma";
import { dateOnly } from "@/lib/time";
import { saveApprovalAttachments } from "@/lib/uploads";
import { ensureWorkThreadForApproval } from "@/lib/workbox";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const leaveTypes = new Set(Object.values(LeaveType));
const leaveDurations = new Set(Object.values(LeaveDuration));

async function parsePayload(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return {
      leaveType: formData.get("leaveType"),
      startDate: String(formData.get("startDate") ?? "").trim(),
      endDate: String(formData.get("endDate") ?? "").trim(),
      duration: formData.get("duration"),
      requestedLeaveMinutes: Number(formData.get("requestedLeaveMinutes") ?? 0),
      reason: String(formData.get("reason") ?? "").trim(),
      attachments: formData.getAll("attachments").filter((value): value is File => value instanceof File)
    };
  }

  const body = (await request.json().catch(() => ({}))) as {
    leaveType?: LeaveType;
    startDate?: string;
    endDate?: string;
    duration?: LeaveDuration;
    requestedLeaveMinutes?: number;
    reason?: string;
  };
  return {
    leaveType: body.leaveType ?? null,
    startDate: body.startDate?.trim() ?? "",
    endDate: body.endDate?.trim() ?? "",
    duration: body.duration ?? null,
    requestedLeaveMinutes: Number(body.requestedLeaveMinutes ?? 0),
    reason: body.reason?.trim() ?? "",
    attachments: [] as File[]
  };
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const payload = await parsePayload(request);
  const leaveType =
    payload.leaveType && leaveTypes.has(payload.leaveType as LeaveType) ? (payload.leaveType as LeaveType) : null;
  const duration =
    payload.duration && leaveDurations.has(payload.duration as LeaveDuration)
      ? (payload.duration as LeaveDuration)
      : LeaveDuration.FULL_DAY;
  const startDate = payload.startDate;
  const endDate = payload.endDate;
  const requestedLeaveMinutes = Math.max(0, Math.round(payload.requestedLeaveMinutes));
  const reason = payload.reason;
  const policy = await getCurrentWorkPolicy(user.companyId, startDate || new Date());

  if (!leaveType || !startDate || !endDate || !DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
    return jsonError("휴가 종류와 기간을 확인하세요.");
  }

  if (!reason) {
    return jsonError("휴가 사유를 입력하세요.");
  }

  if (endDate < startDate) {
    return jsonError("휴가 종료일은 시작일보다 빠를 수 없습니다.");
  }

  if (duration !== LeaveDuration.FULL_DAY && startDate !== endDate) {
    return jsonError("반차는 하루 일정으로만 신청할 수 있습니다.");
  }

  if ((duration === LeaveDuration.HALF_DAY_AM || duration === LeaveDuration.HALF_DAY_PM) && !policy.allowHalfDayLeave) {
    return jsonError("현재 정책에서는 반차를 사용할 수 없습니다.");
  }

  if (duration === LeaveDuration.HOURLY) {
    if (!policy.allowHourlyLeave) {
      return jsonError("현재 정책에서는 시간차를 사용할 수 없습니다.");
    }

    if (startDate !== endDate) {
      return jsonError("시간차는 하루 일정으로만 신청할 수 있습니다.");
    }

    if (requestedLeaveMinutes <= 0 || requestedLeaveMinutes % policy.hourlyLeaveUnitMinutes !== 0) {
      return jsonError(`시간차는 ${policy.hourlyLeaveUnitMinutes}분 단위로 신청하세요.`);
    }
  }

  await assertMonthRangeOpen(user.companyId, startDate, endDate, "마감이 확정된 월의 휴가는 새로 신청할 수 없습니다.");

  const joinedAt = user.joinedAt.toISOString().slice(0, 10);
  const requestSegments =
    leaveType === LeaveType.ANNUAL && duration === LeaveDuration.FULL_DAY
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
  let creationSegments = requestSegments;

  if (leaveType === LeaveType.ANNUAL) {
    const holidays = await getCompanyHolidays(user.companyId, startDate, endDate);
    const holidayDateSet = buildHolidayDateSet(holidays);
    const segmentRequests = requestSegments
      .map((segment) => {
        const annualLeaveDays = getAnnualLeaveRequestDays(
          {
            leaveType,
            leaveDuration: duration,
            leaveStartDate: dateOnly(segment.startDate),
            leaveEndDate: dateOnly(segment.endDate),
            requestedLeaveMinutes: duration === LeaveDuration.HOURLY ? requestedLeaveMinutes : null
          },
          policy,
          holidayDateSet
        );

        return {
          ...segment,
          annualLeaveDays
        };
      })
      .filter((segment) => segment.annualLeaveDays > 0);

    if (segmentRequests.length === 0) {
      return jsonError("연차 차감 대상 근무일이 없습니다. 주말이나 휴일만 포함된 일정은 신청할 수 없습니다.");
    }

    creationSegments = segmentRequests.map(({ annualLeaveDays: _annualLeaveDays, ...segment }) => segment);

    for (const segment of segmentRequests) {
      const { summary } = await getAnnualLeaveSummaryForUser({
        companyId: user.companyId,
        user,
        asOfDate: segment.endDate
      });

      if (segment.annualLeaveDays > summary.availableToRequestDays + 0.001) {
        const isSplitRequest = requestSegments.length > 1;
        return jsonError(
          isSplitRequest
            ? `연차 잔액이 부족합니다. ${segment.startDate} ~ ${segment.endDate} 구간은 신청 가능 ${summary.availableToRequestDays.toFixed(1)}일입니다.`
            : `연차 잔액이 부족합니다. 신청 가능 ${summary.availableToRequestDays.toFixed(1)}일, 승인 차감 ${summary.approvedDays.toFixed(1)}일, 대기 ${summary.pendingDays.toFixed(1)}일입니다.`
        );
      }
    }
  }

  const splitCount = creationSegments.length;
  const requestRecords = [];

  for (const [index, segment] of creationSegments.entries()) {
    const requestRecord = await prisma.approvalRequest.create({
      data: {
        companyId: user.companyId,
        requesterId: user.id,
        type: ApprovalType.LEAVE,
        leaveType,
        leaveStartDate: dateOnly(segment.startDate),
        leaveEndDate: dateOnly(segment.endDate),
        leaveDuration: duration,
        requestedLeaveMinutes: duration === LeaveDuration.HOURLY ? requestedLeaveMinutes : null,
        reason
      }
    });

    const attachments = await saveApprovalAttachments({
      companyId: user.companyId,
      approvalRequestId: requestRecord.id,
      uploadedById: user.id,
      files: payload.attachments
    });

    await writeAuditLog({
      companyId: user.companyId,
      actorUserId: user.id,
      action: "approval.leave.requested",
      targetType: "approval_request",
      targetId: requestRecord.id,
      payload: {
        leaveType,
        startDate: segment.startDate,
        endDate: segment.endDate,
        duration,
        requestedLeaveMinutes: duration === LeaveDuration.HOURLY ? requestedLeaveMinutes : null,
        attachmentCount: attachments.length,
        originalStartDate: startDate,
        originalEndDate: endDate,
        splitIndex: index + 1,
        splitCount
      }
    });

    await notifyApprovalPending(requestRecord.id);
    await ensureWorkThreadForApproval(requestRecord.id);

    requestRecords.push({
      ...requestRecord,
      attachmentCount: attachments.length
    });
  }

  return NextResponse.json({
    ...requestRecords[0],
    splitCount,
    requestIds: requestRecords.map((record) => record.id),
    segments: requestRecords.map((record) => ({
      id: record.id,
      startDate: record.leaveStartDate?.toISOString().slice(0, 10) ?? "",
      endDate: record.leaveEndDate?.toISOString().slice(0, 10) ?? ""
    }))
  });
}

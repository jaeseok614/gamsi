import { AdjustmentType, ApprovalType, EventType } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { jsonError, requireApiUser } from "@/lib/api";
import { getAttendanceSnapshot } from "@/lib/attendance";
import { assertDateMonthOpen } from "@/lib/month-close";
import { notifyApprovalPending } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { dateOnly, getKstDateString, kstDateTimeFromTimeString, kstDayBounds } from "@/lib/time";
import { saveApprovalAttachments, validateApprovalAttachmentFiles } from "@/lib/uploads";
import { ensureWorkThreadForApproval } from "@/lib/workbox";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const adjustmentTypes = new Set(Object.values(AdjustmentType));

async function parsePayload(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return {
      reason: String(formData.get("reason") ?? "").trim(),
      adjustmentType: formData.get("adjustmentType"),
      targetDate: String(formData.get("targetDate") ?? "").trim(),
      requestedTime: String(formData.get("requestedTime") ?? "").trim(),
      attachments: formData.getAll("attachments").filter((value): value is File => value instanceof File)
    };
  }

  const body = (await request.json().catch(() => ({}))) as {
    reason?: string;
    adjustmentType?: AdjustmentType;
    targetDate?: string;
    requestedTime?: string;
  };
  return {
    reason: body.reason?.trim() ?? "",
    adjustmentType: body.adjustmentType ?? null,
    targetDate: body.targetDate?.trim() ?? "",
    requestedTime: body.requestedTime?.trim() ?? "",
    attachments: [] as File[]
  };
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const payload = await parsePayload(request);
  const reason = payload.reason;
  if (!reason) {
    return jsonError("정정 사유를 입력하세요.");
  }

  const adjustmentType =
    payload.adjustmentType && adjustmentTypes.has(payload.adjustmentType as AdjustmentType)
      ? (payload.adjustmentType as AdjustmentType)
      : AdjustmentType.GENERAL;
  const targetDate =
    adjustmentType === AdjustmentType.GENERAL ? getKstDateString() : payload.targetDate || getKstDateString();
  if (!DATE_PATTERN.test(targetDate)) {
    return jsonError("정정 대상 날짜를 확인하세요.");
  }

  await assertDateMonthOpen(user.companyId, targetDate, "마감이 확정된 월은 근태 정정 요청을 추가할 수 없습니다.");

  const requestedAt =
    adjustmentType === AdjustmentType.GENERAL
      ? null
      : payload.requestedTime
        ? kstDateTimeFromTimeString(targetDate, payload.requestedTime)
        : null;

  if (adjustmentType !== AdjustmentType.GENERAL && !requestedAt) {
    return jsonError("누락 시간을 입력하세요.");
  }

  const snapshot = await getAttendanceSnapshot(user.id);
  const targetSession =
    targetDate === getKstDateString()
      ? snapshot.session
      : await prisma.workSession.findUnique({
          where: {
            userId_workDate: {
              userId: user.id,
              workDate: dateOnly(targetDate)
            }
          }
        });

  try {
    validateApprovalAttachmentFiles(payload.attachments);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "첨부 파일을 확인하세요.");
  }

  if (adjustmentType !== AdjustmentType.GENERAL) {
    const { start, end } = kstDayBounds(targetDate);
    const events = await prisma.attendanceEvent.findMany({
      where: {
        userId: user.id,
        occurredAt: {
          gte: start,
          lt: end
        }
      }
    });
    const effectiveEvents = targetDate === getKstDateString()
      ? events.filter((event) => event.occurredAt <= new Date())
      : events;

    const hasCheckIn = effectiveEvents.some((event) => event.eventType === EventType.CHECK_IN);
    const hasCheckOut = effectiveEvents.some((event) => event.eventType === EventType.CHECK_OUT);

    if (adjustmentType === AdjustmentType.MISSING_CHECK_IN) {
      if (hasCheckIn) {
        return jsonError("이미 출근 기록이 있습니다.");
      }

      if (!hasCheckOut) {
        return jsonError("퇴근 기록이 있는 날짜에만 출근 누락 수정을 요청할 수 있습니다.");
      }
    }

    if (adjustmentType === AdjustmentType.MISSING_CHECK_OUT) {
      if (hasCheckOut) {
        return jsonError("이미 퇴근 기록이 있습니다.");
      }

      if (!hasCheckIn) {
        return jsonError("출근 기록이 있는 날짜에만 퇴근 누락 수정을 요청할 수 있습니다.");
      }
    }
  }

  const requestRecord = await prisma.approvalRequest.create({
    data: {
      companyId: user.companyId,
      requesterId: user.id,
      sessionId: targetSession?.id,
      type: ApprovalType.ADJUSTMENT,
      adjustmentType,
      targetDate: dateOnly(targetDate),
      requestedAt,
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
    action: "approval.adjustment.requested",
    targetType: "approval_request",
    targetId: requestRecord.id,
    payload: {
      reason,
      adjustmentType,
      targetDate,
      requestedAt: requestedAt?.toISOString() ?? null,
      attachmentCount: attachments.length
    }
  });

  await notifyApprovalPending(requestRecord.id);
  await ensureWorkThreadForApproval(requestRecord.id);

  return NextResponse.json({
    ...requestRecord,
    attachmentCount: attachments.length
  });
}

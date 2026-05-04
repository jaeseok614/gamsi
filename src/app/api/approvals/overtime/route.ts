import { ApprovalType } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { jsonError, requireApiUser } from "@/lib/api";
import { getAttendanceSnapshot } from "@/lib/attendance";
import { assertDateMonthOpen } from "@/lib/month-close";
import { notifyApprovalPending } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { saveApprovalAttachments, validateApprovalAttachmentFiles } from "@/lib/uploads";
import { ensureWorkThreadForApproval } from "@/lib/workbox";

async function parsePayload(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return {
      reason: String(formData.get("reason") ?? "").trim(),
      requestedMinutes: Number(formData.get("requestedMinutes") ?? 0),
      attachments: formData.getAll("attachments").filter((value): value is File => value instanceof File)
    };
  }

  const body = (await request.json().catch(() => ({}))) as { reason?: string; requestedMinutes?: number };
  return {
    reason: body.reason?.trim() ?? "",
    requestedMinutes: Number(body.requestedMinutes ?? 0),
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
    return jsonError("초과근로 사유를 입력하세요.");
  }

  const snapshot = await getAttendanceSnapshot(user.id);
  if (!snapshot.session) {
    return jsonError("근무 세션이 없습니다.");
  }

  await assertDateMonthOpen(user.companyId, snapshot.session.workDate, "마감이 확정된 월은 초과근로 요청을 추가할 수 없습니다.");

  const requestedMinutes = Math.max(
    0,
    Math.round(Number.isFinite(payload.requestedMinutes) && payload.requestedMinutes > 0
      ? payload.requestedMinutes
      : snapshot.session.overtimeMinutes)
  );
  if (requestedMinutes <= 0) {
    return jsonError("요청할 초과근로 시간이 없습니다.");
  }

  try {
    validateApprovalAttachmentFiles(payload.attachments);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "첨부 파일을 확인하세요.");
  }

  const requestRecord = await prisma.approvalRequest.create({
    data: {
      companyId: user.companyId,
      requesterId: user.id,
      sessionId: snapshot.session.id,
      type: ApprovalType.OVERTIME,
      requestedMinutes,
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
    action: "approval.overtime.requested",
    targetType: "approval_request",
    targetId: requestRecord.id,
    payload: {
      requestedMinutes,
      reason,
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

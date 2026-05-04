import { ApprovalStatus, ApprovalType } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { jsonError, requireApiUser } from "@/lib/api";
import { assertMonthRangeOpen } from "@/lib/month-close";
import { prisma } from "@/lib/prisma";
import { refreshRiskSignalsForUserIds } from "@/lib/risks";
import { getKstDateString } from "@/lib/time";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const approval = await prisma.approvalRequest.findUnique({
    where: {
      id: params.id
    }
  });

  if (!approval || approval.companyId !== user.companyId || approval.type !== ApprovalType.LEAVE) {
    return jsonError("휴가 요청을 찾을 수 없습니다.", 404);
  }

  if (approval.requesterId !== user.id) {
    return jsonError("본인 휴가 요청만 변경할 수 있습니다.", 403);
  }

  if (!approval.leaveStartDate || !approval.leaveEndDate) {
    return jsonError("휴가 기간 정보가 올바르지 않습니다.");
  }

  const startDate = approval.leaveStartDate.toISOString().slice(0, 10);
  const endDate = approval.leaveEndDate.toISOString().slice(0, 10);
  await assertMonthRangeOpen(user.companyId, startDate, endDate, "마감이 확정된 월의 휴가 요청은 변경할 수 없습니다.");

  const today = getKstDateString();
  const isPending = approval.status === ApprovalStatus.PENDING;
  const isApprovedFutureLeave = approval.status === ApprovalStatus.APPROVED && startDate > today;

  if (!isPending && !isApprovedFutureLeave) {
    return jsonError("승인 전 요청 또는 오늘 이후 시작하는 승인 휴가만 철회/취소할 수 있습니다.");
  }

  const lifecycle = isPending ? "withdrawn" : "cancelled";
  const reviewNote = isPending
    ? "[철회] 직원이 승인 전 휴가 요청을 철회했습니다."
    : "[취소] 직원이 승인된 미래 휴가를 취소했습니다.";

  const updated = await prisma.approvalRequest.update({
    where: {
      id: approval.id
    },
    data: {
      status: ApprovalStatus.REJECTED,
      reviewerId: user.id,
      reviewedAt: new Date(),
      reviewNote
    }
  });

  await writeAuditLog({
    companyId: user.companyId,
    actorUserId: user.id,
    action: lifecycle === "withdrawn" ? "approval.leave.withdrawn" : "approval.leave.cancelled",
    targetType: "approval_request",
    targetId: approval.id,
    payload: {
      previousStatus: approval.status,
      nextStatus: ApprovalStatus.REJECTED,
      leaveStartDate: startDate,
      leaveEndDate: endDate
    }
  });

  await refreshRiskSignalsForUserIds({
    companyId: user.companyId,
    userIds: [user.id],
    actorUserId: user.id,
    writeAudit: true
  });

  return NextResponse.json({
    ...updated,
    lifecycle
  });
}

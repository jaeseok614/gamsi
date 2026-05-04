import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { canViewReports } from "@/lib/auth";
import { jsonError, requireApiUser } from "@/lib/api";
import { getAnnualLeaveSummaryForUser, getLeaveBalanceAdjustments } from "@/lib/leave";
import { assertDateMonthOpen } from "@/lib/month-close";
import { prisma } from "@/lib/prisma";

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

  if (!canViewReports(user.role)) {
    return jsonError("연차 잔액 조정 취소 권한이 필요합니다.", 403);
  }

  const adjustment = (
    await getLeaveBalanceAdjustments({
      companyId: user.companyId
    })
  ).find((entry) => entry.auditLogId === params.id);

  if (!adjustment) {
    return jsonError("연차 잔액 조정 이력을 찾을 수 없습니다.", 404);
  }

  if (adjustment.kind === "REVERSAL") {
    return jsonError("되돌림으로 생성된 조정은 다시 취소할 수 없습니다.");
  }

  if (adjustment.status !== "ACTIVE") {
    return jsonError("이미 취소된 연차 잔액 조정입니다.");
  }

  await assertDateMonthOpen(
    user.companyId,
    adjustment.effectiveDate,
    "마감이 확정된 월의 연차 잔액 조정은 취소할 수 없습니다."
  );

  const targetUser = await prisma.user.findFirst({
    where: {
      id: adjustment.userId,
      companyId: user.companyId,
      isActive: true
    },
    select: {
      id: true,
      name: true,
      joinedAt: true
    }
  });

  if (!targetUser) {
    return jsonError("대상 직원을 찾을 수 없습니다.", 404);
  }

  await writeAuditLog({
    companyId: user.companyId,
    actorUserId: user.id,
    action: "leave.balance.adjusted",
    targetType: "user",
    targetId: targetUser.id,
    payload: {
      userId: targetUser.id,
      leaveType: "ANNUAL",
      effectiveDate: adjustment.effectiveDate,
      deltaDays: adjustment.deltaDays * -1,
      reason: `[조정 취소] ${adjustment.reason}`,
      reversalOfAuditLogId: adjustment.auditLogId
    }
  });

  const { summary } = await getAnnualLeaveSummaryForUser({
    companyId: user.companyId,
    user: targetUser,
    asOfDate: adjustment.effectiveDate
  });

  return NextResponse.json({
    userId: targetUser.id,
    userName: targetUser.name,
    reversedAuditLogId: adjustment.auditLogId,
    summary
  });
}

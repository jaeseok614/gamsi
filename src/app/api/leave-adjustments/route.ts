import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { canViewReports } from "@/lib/auth";
import { jsonError, requireApiUser } from "@/lib/api";
import { getAnnualLeaveSummaryForUser } from "@/lib/leave";
import { assertDateMonthOpen } from "@/lib/month-close";
import { prisma } from "@/lib/prisma";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canViewReports(user.role)) {
    return jsonError("연차 잔액 조정 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as {
    userId?: string;
    effectiveDate?: string;
    deltaDays?: number;
    reason?: string;
  };

  const userId = body.userId?.trim();
  const effectiveDate = body.effectiveDate?.trim() ?? "";
  const deltaDays = Number(body.deltaDays);
  const reason = body.reason?.trim() ?? "";

  if (!userId || !DATE_PATTERN.test(effectiveDate)) {
    return jsonError("대상 직원과 적용일을 확인하세요.");
  }

  if (!Number.isFinite(deltaDays) || deltaDays === 0) {
    return jsonError("조정 일수는 0이 아닌 숫자여야 합니다.");
  }

  if (Math.abs(deltaDays) > 30) {
    return jsonError("한 번에 조정할 수 있는 일수는 절대값 30일 이하여야 합니다.");
  }

  if (!reason) {
    return jsonError("조정 사유를 입력하세요.");
  }

  await assertDateMonthOpen(user.companyId, effectiveDate, "마감이 확정된 월의 연차 잔액은 직접 조정할 수 없습니다.");

  const targetUser = await prisma.user.findFirst({
    where: {
      id: userId,
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
      effectiveDate,
      deltaDays,
      reason
    }
  });

  const { summary } = await getAnnualLeaveSummaryForUser({
    companyId: user.companyId,
    user: targetUser,
    asOfDate: effectiveDate
  });

  return NextResponse.json({
    userId: targetUser.id,
    userName: targetUser.name,
    summary
  });
}

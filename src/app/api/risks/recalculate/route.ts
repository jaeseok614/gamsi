import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canManage } from "@/lib/auth";
import { getRiskDashboard, refreshManagedRiskSignals } from "@/lib/risks";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("관리자 권한이 필요합니다.", 403);
  }

  await refreshManagedRiskSignals(user, { writeAudit: true });
  return NextResponse.json(await getRiskDashboard(user));
}

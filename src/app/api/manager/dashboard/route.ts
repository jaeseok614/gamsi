import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { canManage } from "@/lib/auth";
import { jsonError, requireApiUser } from "@/lib/api";
import { getManagerDashboard } from "@/lib/manager";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("관리자 권한이 필요합니다.", 403);
  }

  return NextResponse.json(await getManagerDashboard(user));
}

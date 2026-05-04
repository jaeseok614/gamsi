import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";
import { getOnboardingSummary } from "@/lib/onboarding";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("온보딩 설정 권한이 필요합니다.", 403);
  }

  return NextResponse.json(await getOnboardingSummary(user.companyId));
}

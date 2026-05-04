import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";
import { removeOnboardingSampleData, seedOnboardingSampleData } from "@/lib/onboarding";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("온보딩 샘플 데이터 권한이 필요합니다.", 403);
  }

  try {
    return NextResponse.json(await seedOnboardingSampleData(user));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "샘플 데이터 주입에 실패했습니다.");
  }
}

export async function DELETE(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("온보딩 샘플 데이터 권한이 필요합니다.", 403);
  }

  try {
    return NextResponse.json(await removeOnboardingSampleData(user));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "샘플 데이터 제거에 실패했습니다.");
  }
}

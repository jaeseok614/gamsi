import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateCompanySettings } from "@/lib/admin";
import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("회사 설정 권한이 필요합니다.", 403);
  }

  const body = (await request.json()) as {
    name?: string;
    weeklyLimitHours?: number;
    defaultBreakMinutes?: number;
  };

  const name = body.name?.trim();
  const weeklyLimitHours = Number(body.weeklyLimitHours);
  const defaultBreakMinutes = Number(body.defaultBreakMinutes);

  if (!name || !Number.isFinite(weeklyLimitHours) || !Number.isFinite(defaultBreakMinutes)) {
    return jsonError("회사명, 주간 한도, 기본 휴게시간을 확인하세요.");
  }

  try {
    return NextResponse.json(
      await updateCompanySettings(user, {
        name,
        weeklyLimitHours,
        defaultBreakMinutes
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "회사 설정 저장에 실패했습니다.");
  }
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createTeam } from "@/lib/admin";
import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("팀 설정 권한이 필요합니다.", 403);
  }

  const body = (await request.json()) as { name?: string; managerUserId?: string };

  try {
    return NextResponse.json(
      await createTeam(user, {
        name: body.name ?? "",
        managerUserId: body.managerUserId || null
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "팀 생성에 실패했습니다.");
  }
}

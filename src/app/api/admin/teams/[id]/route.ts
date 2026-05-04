import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateTeam } from "@/lib/admin";
import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";

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

  if (!canAdminSettings(user.role)) {
    return jsonError("팀 설정 권한이 필요합니다.", 403);
  }

  const body = (await request.json()) as {
    name?: string;
    managerUserId?: string | null;
    isActive?: boolean;
  };

  try {
    return NextResponse.json(
      await updateTeam(user, {
        teamId: params.id,
        name: body.name ?? "",
        managerUserId: body.managerUserId || null,
        isActive: Boolean(body.isActive)
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "팀 수정에 실패했습니다.");
  }
}

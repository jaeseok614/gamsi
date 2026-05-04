import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateInvitationStatus } from "@/lib/admin";
import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const allowedActions = new Set(["cancel", "resend", "reissue"]);

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("초대 관리 권한이 필요합니다.", 403);
  }

  const params = await context.params;
  const body = (await request.json()) as {
    action?: "cancel" | "resend" | "reissue";
  };

  if (!body.action || !allowedActions.has(body.action)) {
    return jsonError("초대 작업을 확인하세요.");
  }

  try {
    return NextResponse.json(
      await updateInvitationStatus(user, {
        invitationId: params.id,
        action: body.action
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "초대 변경에 실패했습니다.");
  }
}

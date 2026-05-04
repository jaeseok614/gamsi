import { Role } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createInvitation } from "@/lib/admin";
import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";
import { buildInviteUrl } from "@/lib/email";

const allowedRoles = new Set<Role>([Role.EMPLOYEE, Role.MANAGER, Role.HR, Role.ADMIN]);

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("직원 초대 권한이 필요합니다.", 403);
  }

  const body = (await request.json()) as {
    name?: string;
    email?: string;
    role?: Role;
    teamId?: string;
  };

  if (!body.role || !allowedRoles.has(body.role)) {
    return jsonError("역할을 확인하세요.");
  }

  try {
    const invitation = await createInvitation(user, {
      name: body.name ?? "",
      email: body.email ?? "",
      role: body.role,
      teamId: body.teamId || null
    });

    return NextResponse.json({
      ...invitation,
      inviteUrl: buildInviteUrl(invitation.token)
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "초대 생성에 실패했습니다.");
  }
}

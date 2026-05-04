import { Role } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateUser } from "@/lib/admin";
import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";

const allowedRoles = new Set<Role>([Role.EMPLOYEE, Role.MANAGER, Role.HR, Role.ADMIN]);

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
    return jsonError("직원 설정 권한이 필요합니다.", 403);
  }

  const body = (await request.json()) as {
    name?: string;
    email?: string;
    role?: Role;
    teamId?: string | null;
    jobTitle?: string | null;
    phoneNumber?: string | null;
    extensionNumber?: string | null;
    isActive?: boolean;
  };

  if (!body.role || !allowedRoles.has(body.role)) {
    return jsonError("역할을 확인하세요.");
  }

  try {
    return NextResponse.json(
      await updateUser(user, {
        userId: params.id,
        name: body.name ?? "",
        email: body.email ?? "",
        role: body.role,
        teamId: body.teamId || null,
        jobTitle: body.jobTitle || null,
        phoneNumber: body.phoneNumber || null,
        extensionNumber: body.extensionNumber || null,
        isActive: Boolean(body.isActive)
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "직원 수정에 실패했습니다.");
  }
}

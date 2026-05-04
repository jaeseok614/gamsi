import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";
import { updateWorkLocation } from "@/lib/verification";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("근무지 설정 권한이 필요합니다.", 403);
  }

  const params = await context.params;
  const body = (await request.json()) as {
    name?: string;
    description?: string | null;
    isActive?: boolean;
  };

  try {
    return NextResponse.json(
      await updateWorkLocation(user, {
        locationId: params.id,
        name: body.name ?? "",
        description: body.description ?? null,
        isActive: body.isActive ?? true
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "근무지 수정에 실패했습니다.");
  }
}

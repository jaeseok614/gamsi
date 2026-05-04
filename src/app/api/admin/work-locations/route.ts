import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";
import { createWorkLocation, getFieldVerificationSummary } from "@/lib/verification";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("근무지 조회 권한이 필요합니다.", 403);
  }

  return NextResponse.json(await getFieldVerificationSummary(user.companyId));
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("근무지 설정 권한이 필요합니다.", 403);
  }

  const body = (await request.json()) as {
    name?: string;
    description?: string | null;
  };

  try {
    return NextResponse.json(
      await createWorkLocation(user, {
        name: body.name ?? "",
        description: body.description ?? null
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "근무지 생성에 실패했습니다.");
  }
}

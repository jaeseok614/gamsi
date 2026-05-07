import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { updateDocumentLibraryVersionVisibility } from "@/lib/groupware";

type RouteContext = {
  params: Promise<{
    id: string;
    versionId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const params = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    isHidden?: boolean | null;
  };

  try {
    return NextResponse.json(
      await updateDocumentLibraryVersionVisibility(user, {
        itemId: params.id,
        versionId: params.versionId,
        isHidden: Boolean(body.isHidden)
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "자료 버전 공개 상태를 변경하지 못했습니다.");
  }
}

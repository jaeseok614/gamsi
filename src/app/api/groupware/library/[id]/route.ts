import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { updateDocumentLibraryItem } from "@/lib/groupware";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const params = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string | null;
    category?: string | null;
    accessScope?: string | null;
    teamId?: string | null;
    description?: string | null;
    isPinned?: boolean | null;
    isArchived?: boolean | null;
  };

  try {
    return NextResponse.json(
      await updateDocumentLibraryItem(user, {
        itemId: params.id,
        title: body.title,
        category: body.category,
        accessScope: body.accessScope,
        teamId: body.teamId,
        description: body.description,
        isPinned: body.isPinned,
        isArchived: body.isArchived
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "자료를 수정하지 못했습니다.");
  }
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { deleteAnnouncement, updateAnnouncement } from "@/lib/groupware";

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
    body?: string | null;
    allowComments?: boolean | null;
    isPinned?: boolean | null;
    expiresAt?: string | null;
  };

  try {
    return NextResponse.json(
      await updateAnnouncement(user, {
        announcementId: params.id,
        title: body.title,
        body: body.body,
        allowComments: body.allowComments,
        isPinned: body.isPinned,
        expiresAt: body.expiresAt
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "게시물을 수정하지 못했습니다.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const params = await context.params;
  try {
    return NextResponse.json(await deleteAnnouncement(user, params.id));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "게시물을 삭제하지 못했습니다.");
  }
}

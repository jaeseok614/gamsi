import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { deleteAnnouncementComment } from "@/lib/groupware";

type RouteContext = {
  params: Promise<{
    id: string;
    commentId: string;
  }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const params = await context.params;
  try {
    return NextResponse.json(
      await deleteAnnouncementComment(user, {
        announcementId: params.id,
        commentId: params.commentId
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "댓글을 삭제하지 못했습니다.");
  }
}

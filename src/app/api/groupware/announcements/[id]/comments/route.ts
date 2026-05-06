import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { createAnnouncementComment } from "@/lib/groupware";

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

  const params = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    body?: string;
  };

  try {
    return NextResponse.json(
      await createAnnouncementComment(user, {
        announcementId: params.id,
        body: body.body ?? ""
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "공지 댓글을 저장하지 못했습니다.");
  }
}

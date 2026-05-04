import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { addWorkComment } from "@/lib/workbox";

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
    mentionUserIds?: string[];
  };

  try {
    return NextResponse.json(
      await addWorkComment(user, {
        threadId: params.id,
        body: body.body ?? "",
        mentionUserIds: Array.isArray(body.mentionUserIds) ? body.mentionUserIds : []
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "댓글을 저장하지 못했습니다.");
  }
}

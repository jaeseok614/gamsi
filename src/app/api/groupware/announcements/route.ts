import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { createAnnouncement } from "@/lib/groupware";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    audience?: string;
    teamId?: string | null;
    isPinned?: boolean;
  };

  try {
    return NextResponse.json(
      await createAnnouncement(user, {
        title: body.title ?? "",
        body: body.body ?? "",
        audience: body.audience,
        teamId: body.teamId,
        isPinned: body.isPinned
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "공지사항을 저장하지 못했습니다.");
  }
}

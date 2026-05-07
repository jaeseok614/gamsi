import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { remindAnnouncementUnread } from "@/lib/groupware";

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
  try {
    return NextResponse.json(await remindAnnouncementUnread(user, params.id));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "미확인 재알림을 보내지 못했습니다.");
  }
}

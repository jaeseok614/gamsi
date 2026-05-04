import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { markAnnouncementRead } from "@/lib/groupware";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(_request);
  if (response) {
    return response;
  }

  const params = await context.params;
  try {
    return NextResponse.json(await markAnnouncementRead(user, params.id));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "공지 읽음 처리에 실패했습니다.");
  }
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { getNotificationCenter } from "@/lib/notifications";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!user.isActive) {
    return jsonError("비활성 사용자입니다.", 403);
  }

  return NextResponse.json(await getNotificationCenter(user));
}

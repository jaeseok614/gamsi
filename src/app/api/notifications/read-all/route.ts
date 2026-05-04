import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { markAllNotificationsRead } from "@/lib/notifications";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!user.isActive) {
    return jsonError("비활성 사용자입니다.", 403);
  }

  await markAllNotificationsRead({
    companyId: user.companyId,
    userId: user.id
  });

  return NextResponse.json({ ok: true });
}

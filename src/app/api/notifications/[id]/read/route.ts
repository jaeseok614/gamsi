import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { markNotificationRead } from "@/lib/notifications";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!user.isActive) {
    return jsonError("비활성 사용자입니다.", 403);
  }

  await markNotificationRead({
    companyId: user.companyId,
    userId: user.id,
    notificationId: params.id
  });

  return NextResponse.json({ ok: true });
}

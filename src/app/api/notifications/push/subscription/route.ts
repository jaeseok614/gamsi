import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { deleteWebPushSubscription, saveWebPushSubscription } from "@/lib/push";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => null)) as
    | {
        endpoint?: string;
        expirationTime?: number | null;
        keys?: {
          p256dh?: string | null;
          auth?: string | null;
        } | null;
      }
    | null;

  try {
    await saveWebPushSubscription({
      userId: user.id,
      subscription: body ?? {},
      userAgent: request.headers.get("user-agent")
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "브라우저 푸시 구독 저장에 실패했습니다.");
  }
}

export async function DELETE(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;
  const endpoint = body?.endpoint?.trim();
  if (!endpoint) {
    return jsonError("삭제할 브라우저 구독 endpoint가 필요합니다.");
  }

  await deleteWebPushSubscription({
    userId: user.id,
    endpoint
  });

  return NextResponse.json({ ok: true });
}

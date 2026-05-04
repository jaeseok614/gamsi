import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { revokeSession } from "@/lib/account-security";
import { jsonError, requireApiUser } from "@/lib/api";
import { getRequestAuthSession } from "@/lib/auth";

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
    const currentSession = await getRequestAuthSession(request);
    await revokeSession({
      actor: user,
      sessionId: params.id,
      currentSessionId: currentSession?.id ?? null
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "세션 종료에 실패했습니다.");
  }
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { revokeOtherSessions } from "@/lib/account-security";
import { jsonError, requireApiUser } from "@/lib/api";
import { getRequestAuthSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  try {
    const currentSession = await getRequestAuthSession(request);
    await revokeOtherSessions({
      actor: user,
      currentSessionId: currentSession?.id ?? null
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "다른 세션 로그아웃에 실패했습니다.");
  }
}

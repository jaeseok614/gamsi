import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { changePassword } from "@/lib/account-security";
import { jsonError, requireApiUser } from "@/lib/api";
import { getRequestAuthSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    currentPassword?: string;
    nextPassword?: string;
  };

  try {
    const currentSession = await getRequestAuthSession(request);
    await changePassword({
      actor: user,
      currentPassword: body.currentPassword ?? "",
      nextPassword: body.nextPassword ?? "",
      currentSessionId: currentSession?.id ?? null
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "비밀번호 변경에 실패했습니다.");
  }
}

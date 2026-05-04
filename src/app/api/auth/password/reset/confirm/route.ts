import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { completePasswordReset } from "@/lib/account-security";
import { jsonError } from "@/lib/api";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    nextPassword?: string;
  };

  try {
    await completePasswordReset({
      token: body.token ?? "",
      nextPassword: body.nextPassword ?? ""
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "비밀번호 재설정에 실패했습니다.");
  }
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createPasswordResetRequest } from "@/lib/account-security";
import { clientIpFromRequest } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
  };

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "이메일을 확인하세요." }, { status: 400 });
  }

  const result = await createPasswordResetRequest({
    email,
    ipAddress: clientIpFromRequest(request),
    userAgent: request.headers.get("user-agent")
  });

  return NextResponse.json({
    ok: true,
    message: "가입된 계정이 있으면 비밀번호 재설정 안내를 이메일로 보냈습니다.",
    ...(result.debugToken ? { debugToken: result.debugToken } : {})
  });
}

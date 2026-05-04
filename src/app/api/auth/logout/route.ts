import { NextResponse, type NextRequest } from "next/server";

import { clearSessionCookie, revokeSessionToken } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/security";

export async function POST(request: NextRequest) {
  await revokeSessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}

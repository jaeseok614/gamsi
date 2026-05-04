import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireApiUser(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return {
      user: null,
      response: jsonError("로그인이 필요합니다.", 401)
    };
  }

  return {
    user,
    response: null
  };
}

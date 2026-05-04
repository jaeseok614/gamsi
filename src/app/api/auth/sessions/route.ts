import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { listActiveSessions } from "@/lib/account-security";
import { requireApiUser } from "@/lib/api";
import { getRequestAuthSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const currentSession = await getRequestAuthSession(request);
  const sessions = await listActiveSessions(user.id, currentSession?.id ?? null);

  return NextResponse.json({
    sessions
  });
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { resolveClientError } from "@/lib/ops";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    key?: string;
  };

  try {
    await resolveClientError(user, body.key ?? "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "오류 해결 처리에 실패했습니다.", 403);
  }
}

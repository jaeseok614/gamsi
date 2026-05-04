import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canViewReports } from "@/lib/auth";
import { runOperationsAutomation } from "@/lib/automation";

function hasCronAccess(request: NextRequest) {
  const secret = process.env.NOTIFICATION_CRON_SECRET;
  if (!secret) {
    return false;
  }

  const header = request.headers.get("x-workguard-cron-secret");
  const query = request.nextUrl.searchParams.get("token");
  return header === secret || query === secret;
}

export async function POST(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get("companyId") ?? undefined;

  if (hasCronAccess(request)) {
    return NextResponse.json(
      await runOperationsAutomation({
        companyId,
        trigger: "cron"
      })
    );
  }

  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canViewReports(user.role)) {
    return jsonError("알림 스케줄러 실행 권한이 필요합니다.", 403);
  }

  return NextResponse.json(
    await runOperationsAutomation({
      actor: user,
      companyId: user.companyId,
      trigger: "manual"
    })
  );
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canManage } from "@/lib/auth";
import { buildCalendarIcs, getIntegrationSettings } from "@/lib/integrations";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const scope = request.nextUrl.searchParams.get("scope") === "company" ? "company" : "my";
  if (scope === "company" && !canManage(user.role)) {
    return jsonError("회사 캘린더 내보내기 권한이 필요합니다.", 403);
  }

  const settings = await getIntegrationSettings(user.companyId);
  const ics = await buildCalendarIcs({
    companyId: user.companyId,
    userId: scope === "my" ? user.id : undefined,
    from: request.nextUrl.searchParams.get("from") ?? undefined,
    to: request.nextUrl.searchParams.get("to") ?? undefined,
    settings
  });

  return new NextResponse(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="workguard-${scope}-calendar.ics"`
    }
  });
}

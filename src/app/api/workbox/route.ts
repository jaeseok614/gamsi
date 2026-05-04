import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { getWorkboxDashboard } from "@/lib/workbox";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  try {
    return NextResponse.json(
      await getWorkboxDashboard(user, {
        filter: request.nextUrl.searchParams.get("filter"),
        threadId: request.nextUrl.searchParams.get("threadId")
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "업무함을 불러오지 못했습니다.");
  }
}

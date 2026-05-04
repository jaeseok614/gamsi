import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { getOrganizationDashboard } from "@/lib/organization";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  try {
    return NextResponse.json(
      await getOrganizationDashboard(user, {
        selectedUserId: request.nextUrl.searchParams.get("userId"),
        teamId: request.nextUrl.searchParams.get("teamId"),
        status: request.nextUrl.searchParams.get("status"),
        search: request.nextUrl.searchParams.get("search")
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "조직도를 불러오지 못했습니다.");
  }
}

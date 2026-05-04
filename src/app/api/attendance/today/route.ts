import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api";
import { getAttendanceSnapshot } from "@/lib/attendance";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const snapshot = await getAttendanceSnapshot(user.id);
  return NextResponse.json(snapshot);
}

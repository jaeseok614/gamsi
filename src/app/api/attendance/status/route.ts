import { EventType, WorkStatus } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { createAttendanceEvent, getAttendanceSnapshot } from "@/lib/attendance";

const allowedStatuses = new Set<WorkStatus>([
  WorkStatus.WORKING,
  WorkStatus.MEETING,
  WorkStatus.OUTSIDE,
  WorkStatus.BUSINESS_TRIP,
  WorkStatus.TRAINING,
  WorkStatus.BREAK,
  WorkStatus.OTHER
]);

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json()) as { status?: WorkStatus; reason?: string };
  if (!body.status || !allowedStatuses.has(body.status)) {
    return jsonError("상태값이 올바르지 않습니다.");
  }

  try {
    await createAttendanceEvent({
      actorUserId: user.id,
      companyId: user.companyId,
      eventType: EventType.STATUS_CHANGE,
      status: body.status,
      reason: body.reason?.trim() || undefined
    });

    return NextResponse.json(await getAttendanceSnapshot(user.id));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "상태 변경에 실패했습니다.");
  }
}

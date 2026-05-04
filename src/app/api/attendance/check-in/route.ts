import { EventType, WorkStatus } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { createAttendanceEvent, getAttendanceSnapshot } from "@/lib/attendance";
import { consumeQrClockToken } from "@/lib/verification";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      verification?: {
        method?: string;
        token?: string;
      };
    };
    const qrMetadata =
      body.verification?.method === "qr" && body.verification.token
        ? await consumeQrClockToken({
            companyId: user.companyId,
            actorUserId: user.id,
            eventType: EventType.CHECK_IN,
            token: body.verification.token
          })
        : null;

    await createAttendanceEvent({
      actorUserId: user.id,
      companyId: user.companyId,
      eventType: EventType.CHECK_IN,
      status: WorkStatus.WORKING,
      reason: qrMetadata ? `QR 출근 · ${qrMetadata.locationName}` : "웹 출근",
      source: qrMetadata ? "qr" : "web",
      metadata: qrMetadata ?? undefined
    });

    return NextResponse.json(await getAttendanceSnapshot(user.id));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "출근 처리에 실패했습니다.");
  }
}

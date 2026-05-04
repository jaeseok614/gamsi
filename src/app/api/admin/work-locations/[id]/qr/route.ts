import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canManage } from "@/lib/auth";
import { issueQrClockToken, type QrTokenPurpose } from "@/lib/verification";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const allowedPurposes = new Set<QrTokenPurpose>([
  "CHECK_IN",
  "CHECK_OUT",
  "BOTH"
]);

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("QR 발급 권한이 필요합니다.", 403);
  }

  const params = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    purpose?: QrTokenPurpose;
    ttlSeconds?: number;
  };
  const purpose = body.purpose && allowedPurposes.has(body.purpose) ? body.purpose : "BOTH";

  try {
    return NextResponse.json(
      await issueQrClockToken(user, {
        locationId: params.id,
        purpose,
        ttlSeconds: body.ttlSeconds
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "QR 발급에 실패했습니다.");
  }
}

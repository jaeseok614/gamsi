import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { archiveReadNotifications } from "@/lib/notifications";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  try {
    return NextResponse.json(
      await archiveReadNotifications({
        companyId: user.companyId,
        userId: user.id
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "읽은 알림 보관에 실패했습니다.");
  }
}

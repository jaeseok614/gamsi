import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { getIntegrationSettings, sendSlackTestMessage } from "@/lib/integrations";
import { sendTestWebPushNotification } from "@/lib/push";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("연동 테스트 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as {
    channel?: "slack" | "web_push";
    userId?: string;
  };

  try {
    let result:
      | {
          channel: "slack";
          status: "sent" | "failed" | "skipped";
          detail: string;
        }
      | {
          channel: "web_push";
          status: "sent" | "failed" | "skipped";
          detail: string;
        };

    if (body.channel === "web_push") {
      result = await sendTestWebPushNotification({
        companyId: user.companyId,
        actorName: user.name,
        targetUserId: body.userId ?? ""
      });
    } else {
      const settings = await getIntegrationSettings(user.companyId);
      result = await sendSlackTestMessage({
        companyId: user.companyId,
        actorUserId: user.id,
        companyName: user.company.name,
        settings
      });
    }

    await writeAuditLog({
      companyId: user.companyId,
      actorUserId: user.id,
      action: "ops.integration.tested",
      targetType: result.channel,
      targetId: body.userId ?? result.channel,
      payload: result
    });

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "연동 테스트에 실패했습니다.");
  }
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";
import {
  getOperationsAutomationSummary,
  runOperationsAutomation,
  saveOperationsAutomationSettings
} from "@/lib/automation";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("운영 자동화 설정 권한이 필요합니다.", 403);
  }

  return NextResponse.json(await getOperationsAutomationSummary(user.companyId));
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("운영 자동화 설정 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => null)) as
    | {
        action?: "save" | "run";
        dailyDigestEnabled?: boolean;
        failureAlertThreshold?: number;
        autoPruneEnabled?: boolean;
        deadSubscriptionFailureCount?: number;
      }
    | null;

  try {
    if (body?.action === "run") {
      return NextResponse.json(
        await runOperationsAutomation({
          actor: user,
          companyId: user.companyId,
          trigger: "manual"
        })
      );
    }

    return NextResponse.json(
      await saveOperationsAutomationSettings(user, {
        dailyDigestEnabled: body?.dailyDigestEnabled ?? true,
        failureAlertThreshold: body?.failureAlertThreshold ?? 3,
        autoPruneEnabled: body?.autoPruneEnabled ?? true,
        deadSubscriptionFailureCount: body?.deadSubscriptionFailureCount ?? 3
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "운영 자동화 저장에 실패했습니다.");
  }
}

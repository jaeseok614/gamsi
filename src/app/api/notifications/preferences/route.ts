import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import {
  getEffectiveNotificationPreference,
  getOrCreateNotificationPreference,
  updateNotificationPreference
} from "@/lib/notifications";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  return NextResponse.json(
    await getEffectiveNotificationPreference({
      companyId: user.companyId,
      userId: user.id,
      basePreference: await getOrCreateNotificationPreference({
        companyId: user.companyId,
        userId: user.id
      })
    })
  );
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    emailEnabled?: boolean;
    webPushEnabled?: boolean;
    approvalPendingEmail?: boolean;
    approvalReviewedEmail?: boolean;
    leaveReminderEmail?: boolean;
    missingRecordEmail?: boolean;
    monthCloseEmail?: boolean;
    schedulerDigestEnabled?: boolean;
    managerDailyDigestEnabled?: boolean;
    approvalMuted?: boolean;
    leaveMuted?: boolean;
    missingRecordMuted?: boolean;
    monthCloseMuted?: boolean;
    dailyDigestMuted?: boolean;
    approvalSnoozeUntil?: string | null;
    leaveSnoozeUntil?: string | null;
    missingRecordSnoozeUntil?: string | null;
    monthCloseSnoozeUntil?: string | null;
    dailyDigestSnoozeUntil?: string | null;
    browserPermission?: string;
  };

  try {
    return NextResponse.json(
      await updateNotificationPreference(user, {
        emailEnabled: Boolean(body.emailEnabled),
        webPushEnabled: Boolean(body.webPushEnabled),
        approvalPendingEmail: Boolean(body.approvalPendingEmail),
        approvalReviewedEmail: Boolean(body.approvalReviewedEmail),
        leaveReminderEmail: Boolean(body.leaveReminderEmail),
        missingRecordEmail: Boolean(body.missingRecordEmail),
        monthCloseEmail: Boolean(body.monthCloseEmail),
        schedulerDigestEnabled: Boolean(body.schedulerDigestEnabled),
        managerDailyDigestEnabled:
          typeof body.managerDailyDigestEnabled === "boolean" ? body.managerDailyDigestEnabled : true,
        approvalMuted: Boolean(body.approvalMuted),
        leaveMuted: Boolean(body.leaveMuted),
        missingRecordMuted: Boolean(body.missingRecordMuted),
        monthCloseMuted: Boolean(body.monthCloseMuted),
        dailyDigestMuted: Boolean(body.dailyDigestMuted),
        approvalSnoozeUntil: body.approvalSnoozeUntil ?? null,
        leaveSnoozeUntil: body.leaveSnoozeUntil ?? null,
        missingRecordSnoozeUntil: body.missingRecordSnoozeUntil ?? null,
        monthCloseSnoozeUntil: body.monthCloseSnoozeUntil ?? null,
        dailyDigestSnoozeUntil: body.dailyDigestSnoozeUntil ?? null,
        browserPermission: String(body.browserPermission ?? "default")
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "알림 설정 저장에 실패했습니다.");
  }
}

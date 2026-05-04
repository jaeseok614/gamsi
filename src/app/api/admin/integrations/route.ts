import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";
import {
  defaultIntegrationSettings,
  getIntegrationSettings,
  saveIntegrationSettings
} from "@/lib/integrations";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("연동 설정 권한이 필요합니다.", 403);
  }

  return NextResponse.json(await getIntegrationSettings(user.companyId));
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("연동 설정 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => null)) as Partial<ReturnType<typeof defaultIntegrationSettings>> | null;
  const defaults = defaultIntegrationSettings();

  try {
    return NextResponse.json(
      await saveIntegrationSettings(user, {
        payrollDelimiter:
          body?.payrollDelimiter === ";" || body?.payrollDelimiter === "TAB"
            ? body.payrollDelimiter
            : defaults.payrollDelimiter,
        payrollHeaders: {
          employeeName:
            typeof body?.payrollHeaders?.employeeName === "string"
              ? body.payrollHeaders.employeeName
              : defaults.payrollHeaders.employeeName,
          employeeEmail:
            typeof body?.payrollHeaders?.employeeEmail === "string"
              ? body.payrollHeaders.employeeEmail
              : defaults.payrollHeaders.employeeEmail,
          regularMinutes:
            typeof body?.payrollHeaders?.regularMinutes === "string"
              ? body.payrollHeaders.regularMinutes
              : defaults.payrollHeaders.regularMinutes,
          overtimeMinutes:
            typeof body?.payrollHeaders?.overtimeMinutes === "string"
              ? body.payrollHeaders.overtimeMinutes
              : defaults.payrollHeaders.overtimeMinutes,
          approvedOvertimeMinutes:
            typeof body?.payrollHeaders?.approvedOvertimeMinutes === "string"
              ? body.payrollHeaders.approvedOvertimeMinutes
              : defaults.payrollHeaders.approvedOvertimeMinutes,
          annualLeaveRemainingDays:
            typeof body?.payrollHeaders?.annualLeaveRemainingDays === "string"
              ? body.payrollHeaders.annualLeaveRemainingDays
              : defaults.payrollHeaders.annualLeaveRemainingDays,
          closeStatus:
            typeof body?.payrollHeaders?.closeStatus === "string"
              ? body.payrollHeaders.closeStatus
              : defaults.payrollHeaders.closeStatus
        },
        calendarDefaultScope: body?.calendarDefaultScope === "COMPANY" ? "COMPANY" : defaults.calendarDefaultScope,
        calendarIncludeSchedules:
          typeof body?.calendarIncludeSchedules === "boolean"
            ? body.calendarIncludeSchedules
            : defaults.calendarIncludeSchedules,
        calendarIncludeLeaves:
          typeof body?.calendarIncludeLeaves === "boolean"
            ? body.calendarIncludeLeaves
            : defaults.calendarIncludeLeaves,
        slackDigestEnabled:
          typeof body?.slackDigestEnabled === "boolean" ? body.slackDigestEnabled : defaults.slackDigestEnabled,
        slackWebhookUrl:
          typeof body?.slackWebhookUrl === "string" ? body.slackWebhookUrl : defaults.slackWebhookUrl,
        emailDigestRecipients:
          typeof body?.emailDigestRecipients === "string"
            ? body.emailDigestRecipients
            : defaults.emailDigestRecipients,
        digestEmailSubject:
          typeof body?.digestEmailSubject === "string"
            ? body.digestEmailSubject
            : defaults.digestEmailSubject,
        digestEmailIntro:
          typeof body?.digestEmailIntro === "string"
            ? body.digestEmailIntro
            : defaults.digestEmailIntro,
        slackDigestTitle:
          typeof body?.slackDigestTitle === "string"
            ? body.slackDigestTitle
            : defaults.slackDigestTitle,
        slackDigestFooter:
          typeof body?.slackDigestFooter === "string"
            ? body.slackDigestFooter
            : defaults.slackDigestFooter,
        erpAdapter:
          body?.erpAdapter === "DOUZONE" || body?.erpAdapter === "GROUPWARE"
            ? body.erpAdapter
            : defaults.erpAdapter,
        erpExportFormat: body?.erpExportFormat === "JSON" ? "JSON" : defaults.erpExportFormat,
        erpFilePrefix:
          typeof body?.erpFilePrefix === "string" ? body.erpFilePrefix : defaults.erpFilePrefix,
        calendarEventPrefix:
          typeof body?.calendarEventPrefix === "string"
            ? body.calendarEventPrefix
            : defaults.calendarEventPrefix
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "연동 설정 저장에 실패했습니다.");
  }
}

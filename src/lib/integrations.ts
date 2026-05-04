import { ApprovalStatus, ApprovalType, NotificationType, type User } from "@/generated/prisma";

import { sendNotificationEmail, smtpConfigured } from "@/lib/email";
import { getWebPushOperationsSummary, webPushConfigured } from "@/lib/push";
import { getAuditPayloadRecord, getLatestAuditSnapshot, writeAuditSnapshot } from "@/lib/settings-store";
import { prisma } from "@/lib/prisma";
import { authSecret } from "@/lib/security";
import { dateOnly, getKstDateString } from "@/lib/time";

type Actor = Pick<User, "id" | "companyId" | "role">;
type PayrollReport = Awaited<ReturnType<typeof import("@/lib/payroll")["getPayrollReport"]>>;

export type IntegrationSettings = {
  payrollDelimiter: "," | ";" | "TAB";
  payrollHeaders: {
    employeeName: string;
    employeeEmail: string;
    regularMinutes: string;
    overtimeMinutes: string;
    approvedOvertimeMinutes: string;
    annualLeaveRemainingDays: string;
    closeStatus: string;
  };
  calendarDefaultScope: "MY" | "COMPANY";
  calendarIncludeSchedules: boolean;
  calendarIncludeLeaves: boolean;
  slackDigestEnabled: boolean;
  slackWebhookUrl: string;
  emailDigestRecipients: string;
  digestEmailSubject: string;
  digestEmailIntro: string;
  slackDigestTitle: string;
  slackDigestFooter: string;
  erpAdapter: "GENERIC" | "DOUZONE" | "GROUPWARE";
  erpExportFormat: "CSV" | "JSON";
  erpFilePrefix: string;
  calendarEventPrefix: string;
};

export type IntegrationDispatchLog = {
  id: string;
  type: NotificationType;
  channel: string;
  status: string;
  detail: string | null;
  dedupeKey: string;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
  };
};

export type IntegrationOpsSummary = {
  checks: Array<{
    key: string;
    label: string;
    status: "ready" | "warning" | "critical";
    detail: string;
  }>;
  metrics: {
    activePushSubscriptions: number;
    subscribedUsers: number;
    failingPushSubscriptions: number;
    recentFailedDispatches: number;
    recentPrunedSubscriptions: number;
  };
  recentFailures: IntegrationDispatchLog[];
};

export function defaultIntegrationSettings(): IntegrationSettings {
  return {
    payrollDelimiter: ",",
    payrollHeaders: {
      employeeName: "name",
      employeeEmail: "email",
      regularMinutes: "regular_minutes",
      overtimeMinutes: "overtime_minutes",
      approvedOvertimeMinutes: "approved_overtime_minutes",
      annualLeaveRemainingDays: "annual_leave_remaining_days",
      closeStatus: "close_status"
    },
    calendarDefaultScope: "MY",
    calendarIncludeSchedules: true,
    calendarIncludeLeaves: true,
    slackDigestEnabled: false,
    slackWebhookUrl: "",
    emailDigestRecipients: "",
    digestEmailSubject: "[워크가드] {{companyName}} 오늘 운영 요약",
    digestEmailIntro: "{{companyName}} 운영 요약 알림입니다.",
    slackDigestTitle: "{{companyName}} 오늘 운영 요약",
    slackDigestFooter: "워크가드 자동 요약",
    erpAdapter: "GENERIC",
    erpExportFormat: "CSV",
    erpFilePrefix: "workguard",
    calendarEventPrefix: "워크가드"
  };
}

function delimiterValue(delimiter: IntegrationSettings["payrollDelimiter"]) {
  if (delimiter === "TAB") {
    return "\t";
  }
  return delimiter;
}

function parseIntegrationSettings(payload: unknown): IntegrationSettings {
  const record = getAuditPayloadRecord(payload);
  const defaults = defaultIntegrationSettings();
  const headers = getAuditPayloadRecord(record?.payrollHeaders);

  return {
    payrollDelimiter:
      record?.payrollDelimiter === ";" || record?.payrollDelimiter === "TAB" ? record.payrollDelimiter : ",",
    payrollHeaders: {
      employeeName: typeof headers?.employeeName === "string" ? headers.employeeName : defaults.payrollHeaders.employeeName,
      employeeEmail: typeof headers?.employeeEmail === "string" ? headers.employeeEmail : defaults.payrollHeaders.employeeEmail,
      regularMinutes: typeof headers?.regularMinutes === "string" ? headers.regularMinutes : defaults.payrollHeaders.regularMinutes,
      overtimeMinutes: typeof headers?.overtimeMinutes === "string" ? headers.overtimeMinutes : defaults.payrollHeaders.overtimeMinutes,
      approvedOvertimeMinutes:
        typeof headers?.approvedOvertimeMinutes === "string"
          ? headers.approvedOvertimeMinutes
          : defaults.payrollHeaders.approvedOvertimeMinutes,
      annualLeaveRemainingDays:
        typeof headers?.annualLeaveRemainingDays === "string"
          ? headers.annualLeaveRemainingDays
          : defaults.payrollHeaders.annualLeaveRemainingDays,
      closeStatus: typeof headers?.closeStatus === "string" ? headers.closeStatus : defaults.payrollHeaders.closeStatus
    },
    calendarDefaultScope:
      record?.calendarDefaultScope === "COMPANY" ? "COMPANY" : defaults.calendarDefaultScope,
    calendarIncludeSchedules:
      typeof record?.calendarIncludeSchedules === "boolean"
        ? record.calendarIncludeSchedules
        : defaults.calendarIncludeSchedules,
    calendarIncludeLeaves:
      typeof record?.calendarIncludeLeaves === "boolean" ? record.calendarIncludeLeaves : defaults.calendarIncludeLeaves,
    slackDigestEnabled:
      typeof record?.slackDigestEnabled === "boolean" ? record.slackDigestEnabled : defaults.slackDigestEnabled,
    slackWebhookUrl: typeof record?.slackWebhookUrl === "string" ? record.slackWebhookUrl : defaults.slackWebhookUrl,
    emailDigestRecipients:
      typeof record?.emailDigestRecipients === "string"
        ? record.emailDigestRecipients
        : defaults.emailDigestRecipients,
    digestEmailSubject:
      typeof record?.digestEmailSubject === "string"
        ? record.digestEmailSubject
        : defaults.digestEmailSubject,
    digestEmailIntro:
      typeof record?.digestEmailIntro === "string"
        ? record.digestEmailIntro
        : defaults.digestEmailIntro,
    slackDigestTitle:
      typeof record?.slackDigestTitle === "string"
        ? record.slackDigestTitle
        : defaults.slackDigestTitle,
    slackDigestFooter:
      typeof record?.slackDigestFooter === "string"
        ? record.slackDigestFooter
        : defaults.slackDigestFooter,
    erpAdapter:
      record?.erpAdapter === "DOUZONE" || record?.erpAdapter === "GROUPWARE"
        ? record.erpAdapter
        : defaults.erpAdapter,
    erpExportFormat: record?.erpExportFormat === "JSON" ? "JSON" : defaults.erpExportFormat,
    erpFilePrefix:
      typeof record?.erpFilePrefix === "string" ? record.erpFilePrefix : defaults.erpFilePrefix,
    calendarEventPrefix:
      typeof record?.calendarEventPrefix === "string"
        ? record.calendarEventPrefix
        : defaults.calendarEventPrefix
  };
}

export async function getIntegrationSettings(companyId: string) {
  const latest = await getLatestAuditSnapshot({
    companyId,
    action: "integrations.settings.saved",
    targetType: "integration_settings",
    targetId: companyId
  });

  return parseIntegrationSettings(latest?.payload);
}

export async function saveIntegrationSettings(actor: Actor, input: IntegrationSettings) {
  await writeAuditSnapshot({
    actor,
    action: "integrations.settings.saved",
    targetType: "integration_settings",
    targetId: actor.companyId,
    payload: input
  });

  return input;
}

function sanitizeFileToken(value: string, fallback: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return normalized || fallback;
}

function renderTemplate(template: string, variables: Record<string, string>) {
  return Object.entries(variables).reduce(
    (message, [key, value]) => message.replaceAll(`{{${key}}}`, value),
    template
  );
}

function buildDigestTemplateContext(companyName: string) {
  return {
    companyName,
    today: getKstDateString()
  };
}

function csvLine(values: string[], delimiter: string) {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(delimiter);
}

export function buildMappedPayrollExport(
  report: PayrollReport,
  settings: IntegrationSettings
) {
  const delimiter = delimiterValue(settings.payrollDelimiter);
  const header = [
    settings.payrollHeaders.employeeName,
    settings.payrollHeaders.employeeEmail,
    settings.payrollHeaders.regularMinutes,
    settings.payrollHeaders.overtimeMinutes,
    settings.payrollHeaders.approvedOvertimeMinutes,
    settings.payrollHeaders.annualLeaveRemainingDays,
    settings.payrollHeaders.closeStatus
  ];

  const rows = report.payrollRows.map((row) => [
    row.user.name,
    row.user.email,
    String(row.calculatedWorkMinutes),
    String(row.overtimeMinutes),
    String(row.approvedOvertimeMinutes),
    String(row.annualLeaveRemainingDays),
    row.closeStatus
  ]);

  return [csvLine(header, delimiter), ...rows.map((row) => csvLine(row, delimiter))].join("\n");
}

function toIcsDateTime(value: Date) {
  return value.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
}

export async function buildCalendarIcs(input: {
  companyId: string;
  userId?: string;
  from?: string;
  to?: string;
  settings: IntegrationSettings;
}) {
  const from = input.from ?? getKstDateString();
  const to = input.to ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const scheduleWhere = {
    companyId: input.companyId,
    userId: input.userId,
    workDate: {
      gte: dateOnly(from),
      lte: dateOnly(to)
    }
  };
  const leaveWhere = {
    companyId: input.companyId,
    requesterId: input.userId,
    type: ApprovalType.LEAVE,
    status: ApprovalStatus.APPROVED,
    leaveStartDate: {
      lte: dateOnly(to)
    },
    leaveEndDate: {
      gte: dateOnly(from)
    }
  };

  const [schedules, leaveRequests] = await Promise.all([
    input.settings.calendarIncludeSchedules
      ? prisma.workSchedule.findMany({
          where: scheduleWhere,
          include: {
            user: true
          },
          orderBy: [{ workDate: "asc" }, { scheduledStartAt: "asc" }]
        })
      : Promise.resolve([]),
    input.settings.calendarIncludeLeaves
      ? prisma.approvalRequest.findMany({
          where: leaveWhere,
          include: {
            requester: true
          },
          orderBy: {
            leaveStartDate: "asc"
          }
        })
      : Promise.resolve([])
  ]);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WorkGuard//Calendar Export//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];
  const eventPrefix = input.settings.calendarEventPrefix.trim() || "워크가드";

  for (const schedule of schedules) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:work-schedule-${schedule.id}@workguard.local`);
    lines.push(`DTSTAMP:${toIcsDateTime(new Date())}`);
    lines.push(`DTSTART:${toIcsDateTime(schedule.scheduledStartAt)}`);
    lines.push(`DTEND:${toIcsDateTime(schedule.scheduledEndAt)}`);
    lines.push(`SUMMARY:${escapeIcsText(`${eventPrefix} 근무 · ${schedule.user.name} · ${schedule.shiftName}`)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(schedule.note ?? `${eventPrefix} 근무 스케줄`)}`);
    lines.push("END:VEVENT");
  }

  for (const leave of leaveRequests) {
    if (!leave.leaveStartDate || !leave.leaveEndDate) {
      continue;
    }
    const endExclusive = new Date(leave.leaveEndDate);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:leave-${leave.id}@workguard.local`);
    lines.push(`DTSTAMP:${toIcsDateTime(new Date())}`);
    lines.push(`DTSTART;VALUE=DATE:${leave.leaveStartDate.toISOString().slice(0, 10).replaceAll("-", "")}`);
    lines.push(`DTEND;VALUE=DATE:${endExclusive.toISOString().slice(0, 10).replaceAll("-", "")}`);
    lines.push(`SUMMARY:${escapeIcsText(`${eventPrefix} 휴가 · ${leave.requester.name}`)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(leave.reason || `${eventPrefix} 승인 휴가`)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function buildErpExportBundle(input: {
  report: PayrollReport;
  settings: IntegrationSettings;
}) {
  const filePrefix = sanitizeFileToken(input.settings.erpFilePrefix, "workguard");
  if (input.settings.erpExportFormat === "JSON") {
    const payload = input.report.payrollRows.map((row) => ({
      adapter: input.settings.erpAdapter,
      month: input.report.month,
      team: row.user.team?.name ?? "",
      name: row.user.name,
      email: row.user.email,
      joinedAt: row.user.joinedAt.toISOString().slice(0, 10),
      regularMinutes: row.calculatedWorkMinutes,
      overtimeMinutes: row.overtimeMinutes,
      approvedOvertimeMinutes: row.approvedOvertimeMinutes,
      annualLeaveRemainingDays: row.annualLeaveRemainingDays,
      closeStatus: row.closeStatus
    }));
    return {
      content: JSON.stringify(payload, null, 2),
      contentType: "application/json; charset=utf-8",
      filename: `${filePrefix}-${input.settings.erpAdapter.toLowerCase()}-${input.report.month}.json`
    };
  }

  return {
    content: buildMappedPayrollExport(input.report, input.settings),
    contentType: "text/csv; charset=utf-8",
    filename: `${filePrefix}-${input.settings.erpAdapter.toLowerCase()}-${input.report.month}.csv`
  };
}

export function buildDigestPreview(input: {
  companyName: string;
  approvalPending: number;
  unresolvedRisks: number;
  monthCloseBlockers: number;
  settings: IntegrationSettings;
}) {
  const context = buildDigestTemplateContext(input.companyName);
  const emailSubject = renderTemplate(input.settings.digestEmailSubject, context);
  const emailIntro = renderTemplate(input.settings.digestEmailIntro, context);
  const slackTitle = renderTemplate(input.settings.slackDigestTitle, context);
  const slackFooter = renderTemplate(input.settings.slackDigestFooter, context);

  return {
    channel: input.settings.slackDigestEnabled ? "slack" : "email",
    recipients: input.settings.emailDigestRecipients,
    slackWebhookConfigured: input.settings.slackWebhookUrl.trim().length > 0,
    title: slackTitle,
    emailSubject,
    emailIntro,
    slackTitle,
    slackFooter,
    lines: [
      `승인 대기 ${input.approvalPending}건`,
      `미해결 리스크 ${input.unresolvedRisks}건`,
      `월 마감 전 확인 항목 ${input.monthCloseBlockers}건`
    ]
  };
}

function parseDigestRecipients(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes("@"));
}

async function sendSlackDigestWebhook(input: {
  webhookUrl: string;
  title: string;
  lines: string[];
  footer: string;
}) {
  const url = input.webhookUrl.trim();
  if (!url) {
    throw new Error("Slack webhook URL이 비어 있습니다.");
  }

  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();

  if (host.endsWith(".example") || host === "example.com") {
    return;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      text: [input.title, ...input.lines, input.footer].filter(Boolean).join("\n"),
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: input.title
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: input.lines.map((line) => `• ${line}`).join("\n")
          }
        },
        ...(input.footer
          ? [
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: input.footer
                  }
                ]
              }
            ]
          : [])
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Slack webhook 응답이 비정상적입니다. (${response.status})`);
  }
}

async function appendIntegrationDispatchLog(input: {
  companyId: string;
  actorUserId: string;
  type: NotificationType;
  channel: "email" | "slack";
  status: "sent" | "skipped" | "failed" | "queued";
  detail: string;
  retryOfLogId?: string | null;
}) {
  await prisma.notificationDispatchLog.create({
    data: {
      companyId: input.companyId,
      userId: input.actorUserId,
      type: input.type,
      channel: input.channel,
      dedupeKey: `${input.channel}:${input.type}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
      status: input.status,
      detail: input.retryOfLogId ? `[재시도 ${input.retryOfLogId}] ${input.detail}` : input.detail
    }
  });
}

export async function sendDigestPreview(input: {
  companyId: string;
  actorUserId: string;
  companyName: string;
  approvalPending: number;
  unresolvedRisks: number;
  monthCloseBlockers: number;
  settings: IntegrationSettings;
  retryOfLogId?: string | null;
}) {
  const preview = buildDigestPreview(input);
  const recipients = parseDigestRecipients(input.settings.emailDigestRecipients);
  const results: Array<{ channel: "email" | "slack"; status: "sent" | "skipped" | "failed"; detail: string }> = [];

  if (recipients.length > 0 && smtpConfigured()) {
    try {
      await Promise.all(
        recipients.map(async (recipient) => {
          await sendNotificationEmail({
            to: recipient,
            subject: preview.emailSubject,
            intro: preview.emailIntro,
            lines: preview.lines
          });
        })
      );
      const detail = `${recipients.length}명에게 요약 알림 메일을 전송했습니다.`;
      await appendIntegrationDispatchLog({
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        type: NotificationType.DAILY_DIGEST,
        channel: "email",
        status: "sent",
        detail,
        retryOfLogId: input.retryOfLogId
      });
      results.push({
        channel: "email",
        status: "sent",
        detail
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "메일 전송에 실패했습니다.";
      await appendIntegrationDispatchLog({
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        type: NotificationType.DAILY_DIGEST,
        channel: "email",
        status: "failed",
        detail,
        retryOfLogId: input.retryOfLogId
      });
      results.push({
        channel: "email",
        status: "skipped",
        detail: `메일 전송 실패: ${detail}`
      });
    }
  } else {
    const detail = recipients.length === 0 ? "수신 이메일이 설정되지 않았습니다." : "SMTP가 설정되지 않았습니다.";
    await appendIntegrationDispatchLog({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      type: NotificationType.DAILY_DIGEST,
      channel: "email",
      status: "skipped",
      detail,
      retryOfLogId: input.retryOfLogId
    });
    results.push({
      channel: "email",
      status: "skipped",
      detail
    });
  }

  if (input.settings.slackDigestEnabled && input.settings.slackWebhookUrl.trim()) {
    try {
      await sendSlackDigestWebhook({
        webhookUrl: input.settings.slackWebhookUrl.trim(),
        title: preview.slackTitle,
        lines: preview.lines,
        footer: preview.slackFooter
      });
      const detail = `Slack webhook으로 '${preview.slackTitle}' 요약 알림을 전송했습니다.`;
      await appendIntegrationDispatchLog({
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        type: NotificationType.DAILY_DIGEST,
        channel: "slack",
        status: "sent",
        detail,
        retryOfLogId: input.retryOfLogId
      });
      results.push({
        channel: "slack",
        status: "sent",
        detail
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Slack 전송에 실패했습니다.";
      await appendIntegrationDispatchLog({
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        type: NotificationType.DAILY_DIGEST,
        channel: "slack",
        status: "failed",
        detail,
        retryOfLogId: input.retryOfLogId
      });
      results.push({
        channel: "slack",
        status: "failed",
        detail: `Slack 전송 실패: ${detail}`
      });
    }
  } else {
    const detail = input.settings.slackDigestEnabled
      ? "Slack webhook URL이 설정되지 않았습니다."
      : "Slack 요약 알림이 비활성화되어 있습니다.";
    await appendIntegrationDispatchLog({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      type: NotificationType.DAILY_DIGEST,
      channel: "slack",
      status: "skipped",
      detail,
      retryOfLogId: input.retryOfLogId
    });
    results.push({
      channel: "slack",
      status: "skipped",
      detail
    });
  }

  return {
    preview,
    results
  };
}

export async function sendSlackTestMessage(input: {
  companyId: string;
  actorUserId: string;
  companyName: string;
  settings: IntegrationSettings;
}) {
  const webhookUrl = input.settings.slackWebhookUrl.trim();
  const detailPrefix = "[테스트] Slack 연결 점검";

  if (!input.settings.slackDigestEnabled) {
    const detail = `${detailPrefix}을 건너뛰었습니다. Slack 요약 알림이 비활성화되어 있습니다.`;
    await appendIntegrationDispatchLog({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      type: NotificationType.DAILY_DIGEST,
      channel: "slack",
      status: "skipped",
      detail
    });
    return {
      channel: "slack" as const,
      status: "skipped" as const,
      detail
    };
  }

  if (!webhookUrl) {
    const detail = `${detailPrefix}을 건너뛰었습니다. Slack webhook URL이 없습니다.`;
    await appendIntegrationDispatchLog({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      type: NotificationType.DAILY_DIGEST,
      channel: "slack",
      status: "skipped",
      detail
    });
    return {
      channel: "slack" as const,
      status: "skipped" as const,
      detail
    };
  }

  try {
    await sendSlackDigestWebhook({
      webhookUrl,
      title: `${input.companyName} Slack 테스트`,
      lines: [
        "Slack webhook 연결 확인",
        "실패 로그와 전송 상태를 관리자 설정에서 바로 확인할 수 있습니다."
      ],
      footer: "워크가드 테스트 메시지"
    });
    const detail = `${detailPrefix}을 전송했습니다.`;
    await appendIntegrationDispatchLog({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      type: NotificationType.DAILY_DIGEST,
      channel: "slack",
      status: "sent",
      detail
    });
    return {
      channel: "slack" as const,
      status: "sent" as const,
      detail
    };
  } catch (error) {
    const detail = `${detailPrefix} 실패: ${error instanceof Error ? error.message : "Slack 전송 실패"}`;
    await appendIntegrationDispatchLog({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      type: NotificationType.DAILY_DIGEST,
      channel: "slack",
      status: "failed",
      detail
    });
    return {
      channel: "slack" as const,
      status: "failed" as const,
      detail
    };
  }
}

export async function getRecentIntegrationDispatchLogs(
  companyId: string,
  take = 20,
  options?: {
    includeAll?: boolean;
  }
): Promise<IntegrationDispatchLog[]> {
  return prisma.notificationDispatchLog.findMany({
    where: {
      companyId,
      ...(options?.includeAll ? {} : { type: NotificationType.DAILY_DIGEST })
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take
  });
}

export async function getIntegrationOpsSummary(companyId: string): Promise<IntegrationOpsSummary> {
  const settings = await getIntegrationSettings(companyId);
  const pushSummary = await getWebPushOperationsSummary(companyId);
  const recentFailures = await prisma.notificationDispatchLog.findMany({
    where: {
      companyId,
      status: "failed"
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 12
  });

  const authSecretValue = authSecret();
  const checks: IntegrationOpsSummary["checks"] = [
    {
      key: "smtp",
      label: "SMTP",
      status: smtpConfigured() ? "ready" : "warning",
      detail: smtpConfigured() ? "메일 전송 설정이 준비되었습니다." : "SMTP_HOST / SMTP_FROM 설정이 필요합니다."
    },
    {
      key: "web_push",
      label: "웹푸시",
      status: webPushConfigured() ? "ready" : "warning",
      detail: webPushConfigured()
        ? "VAPID 키와 subject가 설정되어 있습니다."
        : "WEB_PUSH_VAPID_PUBLIC_KEY / PRIVATE_KEY / SUBJECT 설정이 필요합니다."
    },
    {
      key: "slack",
      label: "Slack",
      status: settings.slackDigestEnabled && settings.slackWebhookUrl.trim() ? "ready" : "warning",
      detail:
        settings.slackDigestEnabled && settings.slackWebhookUrl.trim()
          ? "Slack digest와 webhook URL이 준비되었습니다."
          : settings.slackDigestEnabled
            ? "Slack webhook URL이 비어 있습니다."
            : "Slack digest가 비활성화되어 있습니다."
    },
    {
      key: "app_base_url",
      label: "앱 주소",
      status: process.env.APP_BASE_URL ? "ready" : "warning",
      detail: process.env.APP_BASE_URL
        ? `APP_BASE_URL=${process.env.APP_BASE_URL}`
        : "APP_BASE_URL이 비어 있어 메일/링크가 로컬 주소로 생성될 수 있습니다."
    },
    {
      key: "auth_secret",
      label: "인증 비밀키",
      status:
        authSecretValue === "local-dev-secret-change-before-production" || authSecretValue.length < 24
          ? "critical"
          : "ready",
      detail:
        authSecretValue === "local-dev-secret-change-before-production" || authSecretValue.length < 24
          ? "운영 전 AUTH_SECRET을 충분히 긴 값으로 교체해야 합니다."
          : "AUTH_SECRET 길이가 운영 기준을 만족합니다."
    }
  ];

  return {
    checks,
    metrics: {
      activePushSubscriptions: pushSummary.totalSubscriptions,
      subscribedUsers: pushSummary.subscribedUsers,
      failingPushSubscriptions: pushSummary.failingSubscriptions,
      recentFailedDispatches: recentFailures.length,
      recentPrunedSubscriptions: pushSummary.recentPruned
    },
    recentFailures
  };
}

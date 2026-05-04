import { NotificationType, type User } from "@/generated/prisma";

import { writeAuditLog } from "@/lib/audit";
import {
  getIntegrationOpsSummary,
  getIntegrationSettings,
  sendDigestPreview,
  type IntegrationDispatchLog
} from "@/lib/integrations";
import { createNotifications, runNotificationScheduler } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { pruneStaleWebPushSubscriptions } from "@/lib/push";
import { getAuditPayloadRecord, getLatestAuditSnapshot } from "@/lib/settings-store";
import { getKstDateString, kstMonthBounds } from "@/lib/time";

type Actor = Pick<User, "id" | "companyId" | "role" | "name">;

export type OperationsAutomationSettings = {
  dailyDigestEnabled: boolean;
  failureAlertThreshold: number;
  autoPruneEnabled: boolean;
  deadSubscriptionFailureCount: number;
};

export type OperationsAutomationRun = {
  id: string;
  createdAt: Date;
  actor: {
    name: string;
    email: string;
  } | null;
  trigger: "manual" | "cron";
  today: string;
  scheduler: {
    approvalPending: number;
    leaveStarting: number;
    missingRecord: number;
    monthClose: number;
    riskEscalation: number;
  };
  digest: {
    sent: number;
    skipped: number;
    failed: number;
    details: string[];
  };
  failureAlert: {
    triggered: boolean;
    detail: string;
  };
  prune: {
    pruned: number;
  };
  metrics: {
    pendingApprovals: number;
    unresolvedRisks: number;
    monthCloseBlockers: number;
    failingPushSubscriptions: number;
    recentFailedDispatches: number;
  };
};

function defaultOperationsAutomationSettings(): OperationsAutomationSettings {
  return {
    dailyDigestEnabled: true,
    failureAlertThreshold: 3,
    autoPruneEnabled: true,
    deadSubscriptionFailureCount: 3
  };
}

function normalizeSettings(payload: unknown): OperationsAutomationSettings {
  const record = getAuditPayloadRecord(payload);
  const defaults = defaultOperationsAutomationSettings();

  return {
    dailyDigestEnabled:
      typeof record?.dailyDigestEnabled === "boolean" ? record.dailyDigestEnabled : defaults.dailyDigestEnabled,
    failureAlertThreshold:
      typeof record?.failureAlertThreshold === "number" && Number.isFinite(record.failureAlertThreshold)
        ? Math.max(1, Math.min(20, Math.round(record.failureAlertThreshold)))
        : defaults.failureAlertThreshold,
    autoPruneEnabled:
      typeof record?.autoPruneEnabled === "boolean" ? record.autoPruneEnabled : defaults.autoPruneEnabled,
    deadSubscriptionFailureCount:
      typeof record?.deadSubscriptionFailureCount === "number" && Number.isFinite(record.deadSubscriptionFailureCount)
        ? Math.max(1, Math.min(10, Math.round(record.deadSubscriptionFailureCount)))
        : defaults.deadSubscriptionFailureCount
  };
}

export async function getOperationsAutomationSettings(companyId: string) {
  const latest = await getLatestAuditSnapshot({
    companyId,
    action: "ops.automation.settings.saved",
    targetType: "ops_automation_settings",
    targetId: companyId
  });

  return normalizeSettings(latest?.payload);
}

export async function saveOperationsAutomationSettings(actor: Pick<User, "id" | "companyId">, input: OperationsAutomationSettings) {
  const settings = normalizeSettings(input);
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "ops.automation.settings.saved",
    targetType: "ops_automation_settings",
    targetId: actor.companyId,
    payload: settings
  });

  return settings;
}

function parseAutomationRun(payload: unknown): Omit<OperationsAutomationRun, "id" | "createdAt" | "actor"> {
  const record = getAuditPayloadRecord(payload);
  const schedulerRecord = getAuditPayloadRecord(record?.scheduler);
  const digestRecord = getAuditPayloadRecord(record?.digest);
  const failureAlertRecord = getAuditPayloadRecord(record?.failureAlert);
  const pruneRecord = getAuditPayloadRecord(record?.prune);
  const metricsRecord = getAuditPayloadRecord(record?.metrics);

  const trigger: "manual" | "cron" = record?.trigger === "manual" ? "manual" : "cron";

  return {
    trigger,
    today: typeof record?.today === "string" ? record.today : getKstDateString(),
    scheduler: {
      approvalPending: typeof schedulerRecord?.approvalPending === "number" ? schedulerRecord.approvalPending : 0,
      leaveStarting: typeof schedulerRecord?.leaveStarting === "number" ? schedulerRecord.leaveStarting : 0,
      missingRecord: typeof schedulerRecord?.missingRecord === "number" ? schedulerRecord.missingRecord : 0,
      monthClose: typeof schedulerRecord?.monthClose === "number" ? schedulerRecord.monthClose : 0,
      riskEscalation: typeof schedulerRecord?.riskEscalation === "number" ? schedulerRecord.riskEscalation : 0
    },
    digest: {
      sent: typeof digestRecord?.sent === "number" ? digestRecord.sent : 0,
      skipped: typeof digestRecord?.skipped === "number" ? digestRecord.skipped : 0,
      failed: typeof digestRecord?.failed === "number" ? digestRecord.failed : 0,
      details: Array.isArray(digestRecord?.details)
        ? digestRecord.details.filter((value): value is string => typeof value === "string")
        : []
    },
    failureAlert: {
      triggered: Boolean(failureAlertRecord?.triggered),
      detail: typeof failureAlertRecord?.detail === "string" ? failureAlertRecord.detail : "-"
    },
    prune: {
      pruned: typeof pruneRecord?.pruned === "number" ? pruneRecord.pruned : 0
    },
    metrics: {
      pendingApprovals: typeof metricsRecord?.pendingApprovals === "number" ? metricsRecord.pendingApprovals : 0,
      unresolvedRisks: typeof metricsRecord?.unresolvedRisks === "number" ? metricsRecord.unresolvedRisks : 0,
      monthCloseBlockers: typeof metricsRecord?.monthCloseBlockers === "number" ? metricsRecord.monthCloseBlockers : 0,
      failingPushSubscriptions:
        typeof metricsRecord?.failingPushSubscriptions === "number" ? metricsRecord.failingPushSubscriptions : 0,
      recentFailedDispatches:
        typeof metricsRecord?.recentFailedDispatches === "number" ? metricsRecord.recentFailedDispatches : 0
    }
  };
}

export async function getOperationsAutomationSummary(companyId: string) {
  const [settings, recentRuns] = await Promise.all([
    getOperationsAutomationSettings(companyId),
    prisma.auditLog.findMany({
      where: {
        companyId,
        action: "ops.automation.run",
        targetType: "ops_automation"
      },
      include: {
        actor: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 12
    })
  ]);

  return {
    settings,
    recentRuns: recentRuns.map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      actor: log.actor,
      ...parseAutomationRun(log.payload)
    })) satisfies OperationsAutomationRun[]
  };
}

function countDispatchStatuses(logs: Array<Pick<IntegrationDispatchLog, "status" | "detail">>) {
  const sent = logs.filter((log) => log.status === "sent").length;
  const skipped = logs.filter((log) => log.status === "skipped").length;
  const failed = logs.filter((log) => log.status === "failed").length;
  return {
    sent,
    skipped,
    failed,
    details: logs.map((log) => log.detail ?? "-")
  };
}

export async function runOperationsAutomation(input?: {
  actor?: Actor | null;
  companyId?: string;
  today?: string;
  trigger?: "manual" | "cron";
}) {
  const trigger = input?.trigger ?? (input?.actor ? "manual" : "cron");
  const today = input?.today ?? getKstDateString();
  const { start: monthStart, end: monthEnd } = kstMonthBounds(today.slice(0, 7));
  const companies = input?.companyId
    ? await prisma.company.findMany({
        where: {
          id: input.companyId
        },
        select: {
          id: true,
          name: true
        }
      })
    : await prisma.company.findMany({
        select: {
          id: true,
          name: true
        }
      });

  const results: OperationsAutomationRun[] = [];

  for (const company of companies) {
    const [settings, integrationSettings, integrationOps, recipients, pendingApprovals, unresolvedRisks, openSessions, missingRecords] =
      await Promise.all([
        getOperationsAutomationSettings(company.id),
        getIntegrationSettings(company.id),
        getIntegrationOpsSummary(company.id),
        prisma.user.findMany({
          where: {
            companyId: company.id,
            isActive: true,
            role: {
              in: ["ADMIN", "HR"]
            }
          },
          select: {
            id: true,
            name: true,
            email: true
          },
          orderBy: [{ role: "asc" }, { name: "asc" }]
        }),
        prisma.approvalRequest.count({
          where: {
            companyId: company.id,
            status: "PENDING"
          }
        }),
        prisma.riskSignal.count({
          where: {
            companyId: company.id,
            resolvedAt: null
          }
        }),
        prisma.workSession.count({
          where: {
            companyId: company.id,
            workDate: {
              gte: monthStart,
              lt: monthEnd
            },
            status: {
              in: ["OPEN", "NEEDS_REVIEW"]
            }
          }
        }),
        prisma.riskSignal.count({
          where: {
            companyId: company.id,
            type: "MISSING_CHECK_IN_OUT",
            resolvedAt: null,
            detectedAt: {
              gte: monthStart,
              lt: monthEnd
            }
          }
        })
      ]);

    const scheduler = await runNotificationScheduler({
      companyId: company.id,
      today
    });

    const monthCloseBlockers = openSessions + missingRecords + pendingApprovals;
    const primaryRecipient = recipients[0] ?? null;
    const digest =
      settings.dailyDigestEnabled && primaryRecipient
        ? countDispatchStatuses(
            (await sendDigestPreview({
              companyId: company.id,
              actorUserId: primaryRecipient.id,
              companyName: company.name,
              approvalPending: pendingApprovals,
              unresolvedRisks,
              monthCloseBlockers,
              settings: integrationSettings
            })).results
          )
        : {
            sent: 0,
            skipped: 1,
            failed: 0,
            details: [
              settings.dailyDigestEnabled ? "자동 digest를 보낼 운영 담당자가 없습니다." : "자동 digest가 비활성화되어 있습니다."
            ]
          };

    const failureTriggered =
      integrationOps.metrics.recentFailedDispatches >= settings.failureAlertThreshold ||
      integrationOps.metrics.failingPushSubscriptions >= settings.failureAlertThreshold;
    const failureAlertDetail = failureTriggered
      ? `최근 실패 ${integrationOps.metrics.recentFailedDispatches}건, 실패 구독 ${integrationOps.metrics.failingPushSubscriptions}건`
      : "임계치 미만";

    if (failureTriggered && recipients.length > 0) {
      await createNotifications({
        companyId: company.id,
        userIds: recipients.map((recipient) => recipient.id),
        type: NotificationType.DAILY_DIGEST,
        title: "연동 실패 임계치 경보",
        message: `${failureAlertDetail}. 관리자 설정에서 실패 로그와 테스트 전송 결과를 확인하세요.`,
        actionUrl: "/dashboard?view=settings",
        metadata: {
          kind: "OPS_FAILURE_ALERT",
          today,
          threshold: settings.failureAlertThreshold
        },
        sendEmail: false
      });
    }

    const prune = settings.autoPruneEnabled
      ? await pruneStaleWebPushSubscriptions({
          companyId: company.id,
          failureCountThreshold: settings.deadSubscriptionFailureCount
        })
      : { pruned: 0, affectedUserIds: [] as string[] };

    if (prune.pruned > 0 && recipients.length > 0) {
      await createNotifications({
        companyId: company.id,
        userIds: recipients.map((recipient) => recipient.id),
        type: NotificationType.DAILY_DIGEST,
        title: "웹푸시 죽은 구독 자동 정리",
        message: `실패 ${settings.deadSubscriptionFailureCount}회 이상인 구독 ${prune.pruned}건을 자동 정리했습니다.`,
        actionUrl: "/dashboard?view=settings",
        metadata: {
          kind: "OPS_PUSH_PRUNE",
          today,
          pruned: prune.pruned
        },
        sendEmail: false
      });
    }

    const payload = {
      trigger,
      today,
      scheduler,
      digest,
      failureAlert: {
        triggered: failureTriggered,
        detail: failureAlertDetail
      },
      prune: {
        pruned: prune.pruned
      },
      metrics: {
        pendingApprovals,
        unresolvedRisks,
        monthCloseBlockers,
        failingPushSubscriptions: integrationOps.metrics.failingPushSubscriptions,
        recentFailedDispatches: integrationOps.metrics.recentFailedDispatches
      }
    };

    await writeAuditLog({
      companyId: company.id,
      actorUserId: input?.actor?.companyId === company.id ? input.actor.id : null,
      action: "ops.automation.run",
      targetType: "ops_automation",
      targetId: `${today}:${trigger}:${Date.now()}`,
      payload
    });

    results.push({
      id: `${company.id}:${today}`,
      createdAt: new Date(),
      actor: input?.actor?.companyId === company.id ? { name: input.actor.name, email: "-" } : null,
      ...parseAutomationRun(payload)
    });
  }

  return {
    today,
    trigger,
    companies: results
  };
}

import {
  ApprovalStatus,
  ApprovalType,
  NotificationType,
  Prisma,
  RiskType,
  type User
} from "@/generated/prisma";

import { canManage, canViewReports } from "@/lib/auth";
import { absoluteUrl, sendNotificationEmail, smtpConfigured } from "@/lib/email";
import { sendWebPushNotifications } from "@/lib/push";
import { prisma } from "@/lib/prisma";
import { getCompanyRiskEscalationCandidates } from "@/lib/risks";
import { dateOnly, getKstDateString, kstDayBounds, kstMonthBounds } from "@/lib/time";

type Actor = Pick<User, "id" | "companyId" | "role">;

type NotificationCategory = "APPROVAL" | "LEAVE" | "MISSING" | "MONTH_CLOSE" | "OTHER";

type NotificationPreferenceLike = Record<string, unknown> | null | undefined;

type NotificationPreferenceExtras = {
  managerDailyDigestEnabled: boolean;
  approvalMuted: boolean;
  leaveMuted: boolean;
  missingRecordMuted: boolean;
  monthCloseMuted: boolean;
  dailyDigestMuted: boolean;
  approvalSnoozeUntil: Date | null;
  leaveSnoozeUntil: Date | null;
  missingRecordSnoozeUntil: Date | null;
  monthCloseSnoozeUntil: Date | null;
  dailyDigestSnoozeUntil: Date | null;
};

type NotificationArchiveSnapshot = {
  ids: string[];
  count: number;
  items: Array<{
    id: string;
    type: string;
    title: string;
    message: string;
    actionUrl: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: string | null;
    readAt: string | null;
    archivedAt: string;
  }>;
};

function defaultNotificationPreferenceExtras(): NotificationPreferenceExtras {
  return {
    managerDailyDigestEnabled: true,
    approvalMuted: false,
    leaveMuted: false,
    missingRecordMuted: false,
    monthCloseMuted: false,
    dailyDigestMuted: false,
    approvalSnoozeUntil: null,
    leaveSnoozeUntil: null,
    missingRecordSnoozeUntil: null,
    monthCloseSnoozeUntil: null,
    dailyDigestSnoozeUntil: null
  };
}

function parseOptionalDate(value: unknown) {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNotificationPreferenceExtras(payload: unknown) {
  const record = getObjectRecord((payload ?? null) as Prisma.JsonValue | null);
  if (!record) {
    return defaultNotificationPreferenceExtras();
  }

  return {
    managerDailyDigestEnabled: typeof record.managerDailyDigestEnabled === "boolean" ? record.managerDailyDigestEnabled : true,
    approvalMuted: typeof record.approvalMuted === "boolean" ? record.approvalMuted : false,
    leaveMuted: typeof record.leaveMuted === "boolean" ? record.leaveMuted : false,
    missingRecordMuted: typeof record.missingRecordMuted === "boolean" ? record.missingRecordMuted : false,
    monthCloseMuted: typeof record.monthCloseMuted === "boolean" ? record.monthCloseMuted : false,
    dailyDigestMuted: typeof record.dailyDigestMuted === "boolean" ? record.dailyDigestMuted : false,
    approvalSnoozeUntil: parseOptionalDate(record.approvalSnoozeUntil),
    leaveSnoozeUntil: parseOptionalDate(record.leaveSnoozeUntil),
    missingRecordSnoozeUntil: parseOptionalDate(record.missingRecordSnoozeUntil),
    monthCloseSnoozeUntil: parseOptionalDate(record.monthCloseSnoozeUntil),
    dailyDigestSnoozeUntil: parseOptionalDate(record.dailyDigestSnoozeUntil)
  } satisfies NotificationPreferenceExtras;
}

function serializeNotificationPreferenceExtras(input: NotificationPreferenceExtras) {
  return {
    managerDailyDigestEnabled: input.managerDailyDigestEnabled,
    approvalMuted: input.approvalMuted,
    leaveMuted: input.leaveMuted,
    missingRecordMuted: input.missingRecordMuted,
    monthCloseMuted: input.monthCloseMuted,
    dailyDigestMuted: input.dailyDigestMuted,
    approvalSnoozeUntil: input.approvalSnoozeUntil?.toISOString() ?? null,
    leaveSnoozeUntil: input.leaveSnoozeUntil?.toISOString() ?? null,
    missingRecordSnoozeUntil: input.missingRecordSnoozeUntil?.toISOString() ?? null,
    monthCloseSnoozeUntil: input.monthCloseSnoozeUntil?.toISOString() ?? null,
    dailyDigestSnoozeUntil: input.dailyDigestSnoozeUntil?.toISOString() ?? null
  } satisfies Prisma.JsonObject;
}

async function getNotificationPreferenceExtras(companyId: string, userId: string) {
  const log = await prisma.auditLog.findFirst({
    where: {
      companyId,
      action: "notifications.preferences.extended.saved",
      targetType: "notification_preference",
      targetId: userId
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return parseNotificationPreferenceExtras(log?.payload);
}

async function getNotificationArchiveSnapshot(companyId: string, userId: string): Promise<NotificationArchiveSnapshot> {
  const log = await prisma.auditLog.findFirst({
    where: {
      companyId,
      action: "notifications.archive.saved",
      targetType: "notification_archive",
      targetId: userId
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  const record = getObjectRecord(log?.payload);
  if (!record) {
    return {
      ids: [],
      count: 0,
      items: []
    };
  }

  const ids = Array.isArray(record.ids)
    ? record.ids.filter((value): value is string => typeof value === "string")
    : [];
  const items = Array.isArray(record.items)
    ? record.items
        .map((value) => {
          const entry = getObjectRecord(value);
          if (!entry || typeof entry.id !== "string" || typeof entry.title !== "string" || typeof entry.message !== "string") {
            return null;
          }
          return {
            id: entry.id,
            type: typeof entry.type === "string" ? entry.type : "APPROVAL_PENDING",
            title: entry.title,
            message: entry.message,
            actionUrl: typeof entry.actionUrl === "string" ? entry.actionUrl : null,
            metadata: (entry.metadata as Prisma.JsonValue | undefined) ?? null,
            createdAt: typeof entry.createdAt === "string" ? entry.createdAt : null,
            readAt: typeof entry.readAt === "string" ? entry.readAt : null,
            archivedAt:
              typeof entry.archivedAt === "string" && entry.archivedAt
                ? entry.archivedAt
                : log?.createdAt.toISOString() ?? new Date().toISOString()
          };
        })
        .filter((value): value is NotificationArchiveSnapshot["items"][number] => Boolean(value))
    : [];

  return {
    ids,
    count: typeof record.count === "number" ? record.count : ids.length,
    items
  };
}

export async function getEffectiveNotificationPreference(input: {
  companyId: string;
  userId: string;
  basePreference?: Awaited<ReturnType<typeof getOrCreateNotificationPreference>>;
}) {
  const basePreference =
    input.basePreference ??
    (await getOrCreateNotificationPreference({
      companyId: input.companyId,
      userId: input.userId
    }));
  const extras = await getNotificationPreferenceExtras(input.companyId, input.userId);

  return {
    ...basePreference,
    ...extras
  };
}

function addDays(dateString: string, offset: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function approvalTypeLabel(type: ApprovalType) {
  if (type === ApprovalType.OVERTIME) {
    return "초과근로";
  }
  if (type === ApprovalType.LEAVE) {
    return "휴가";
  }
  return "근태 정정";
}

function leaveTypeLabel(type?: string | null) {
  const labels: Record<string, string> = {
    ANNUAL: "연차",
    SICK: "병가",
    OFFICIAL: "공가",
    UNPAID: "무급휴가"
  };
  return labels[type ?? ""] ?? "휴가";
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function getObjectRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function formatKstInputTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function getMissingRecordActionContext(evidence: Prisma.JsonValue | null | undefined) {
  const record = getObjectRecord(evidence);
  if (!record) {
    return null;
  }

  const workDate = typeof record.workDate === "string" ? record.workDate : null;
  const scheduledStartAt = typeof record.scheduledStartAt === "string" ? record.scheduledStartAt : null;
  const scheduledEndAt = typeof record.scheduledEndAt === "string" ? record.scheduledEndAt : null;
  const checkInAt = typeof record.checkInAt === "string" ? record.checkInAt : null;
  const checkOutAt = typeof record.checkOutAt === "string" ? record.checkOutAt : null;

  if (!workDate) {
    return null;
  }

  if (!checkInAt && checkOutAt) {
    return {
      targetDate: workDate,
      adjustmentType: "MISSING_CHECK_IN",
      requestedTime: scheduledStartAt ? formatKstInputTime(scheduledStartAt) : null
    };
  }

  if (checkInAt && !checkOutAt) {
    return {
      targetDate: workDate,
      adjustmentType: "MISSING_CHECK_OUT",
      requestedTime: scheduledEndAt ? formatKstInputTime(scheduledEndAt) : null
    };
  }

  return {
    targetDate: workDate,
    adjustmentType: null,
    requestedTime: null
  };
}

function buildMissingAdjustmentActionUrl(input: {
  targetDate?: string | null;
  adjustmentType?: string | null;
  requestedTime?: string | null;
}) {
  const params = new URLSearchParams();
  params.set("view", "employee");
  params.set("adjustmentSource", "notification");

  if (input.targetDate) {
    params.set("adjustmentDate", input.targetDate);
  }
  if (input.adjustmentType) {
    params.set("adjustmentType", input.adjustmentType);
  }
  if (input.requestedTime) {
    params.set("adjustmentTime", input.requestedTime);
  }

  return `/dashboard?${params.toString()}#missing-adjustment`;
}

function dashboardViewUrl(
  view: "employee" | "notifications" | "approvals" | "reports" | "risk",
  params?: Record<string, string | null | undefined>,
  hash?: string
) {
  const search = new URLSearchParams();
  search.set("view", view);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        search.set(key, value);
      }
    }
  }

  return `/dashboard?${search.toString()}${hash ? `#${hash}` : ""}`;
}

function emailPreferenceKey(type: NotificationType) {
  if (type === NotificationType.APPROVAL_PENDING) {
    return "approvalPendingEmail" as const;
  }
  if (type === NotificationType.APPROVAL_APPROVED || type === NotificationType.APPROVAL_REJECTED) {
    return "approvalReviewedEmail" as const;
  }
  if (type === NotificationType.LEAVE_STARTING) {
    return "leaveReminderEmail" as const;
  }
  if (type === NotificationType.MISSING_RECORD) {
    return "missingRecordEmail" as const;
  }
  if (type === NotificationType.MONTH_CLOSE) {
    return "monthCloseEmail" as const;
  }
  return null;
}

function notificationCategoryForType(type: NotificationType): NotificationCategory {
  if (
    type === NotificationType.APPROVAL_PENDING ||
    type === NotificationType.APPROVAL_APPROVED ||
    type === NotificationType.APPROVAL_REJECTED
  ) {
    return "APPROVAL";
  }
  if (type === NotificationType.LEAVE_STARTING) {
    return "LEAVE";
  }
  if (type === NotificationType.MISSING_RECORD) {
    return "MISSING";
  }
  if (type === NotificationType.MONTH_CLOSE) {
    return "MONTH_CLOSE";
  }
  return "OTHER";
}

function readBoolean(preference: NotificationPreferenceLike, key: string) {
  return Boolean(preference && typeof preference[key] === "boolean" ? preference[key] : false);
}

function readDate(preference: NotificationPreferenceLike, key: string) {
  const raw = preference?.[key];
  if (!(raw instanceof Date)) {
    return null;
  }

  return Number.isNaN(raw.getTime()) ? null : raw;
}

function categoryMuted(preference: NotificationPreferenceLike, category: NotificationCategory) {
  if (category === "APPROVAL") {
    return readBoolean(preference, "approvalMuted");
  }
  if (category === "LEAVE") {
    return readBoolean(preference, "leaveMuted");
  }
  if (category === "MISSING") {
    return readBoolean(preference, "missingRecordMuted");
  }
  if (category === "MONTH_CLOSE") {
    return readBoolean(preference, "monthCloseMuted");
  }
  return false;
}

function categorySnoozeUntil(preference: NotificationPreferenceLike, category: NotificationCategory) {
  if (category === "APPROVAL") {
    return readDate(preference, "approvalSnoozeUntil");
  }
  if (category === "LEAVE") {
    return readDate(preference, "leaveSnoozeUntil");
  }
  if (category === "MISSING") {
    return readDate(preference, "missingRecordSnoozeUntil");
  }
  if (category === "MONTH_CLOSE") {
    return readDate(preference, "monthCloseSnoozeUntil");
  }
  return null;
}

function isNotificationSuppressed(preference: NotificationPreferenceLike, type: NotificationType) {
  const category = notificationCategoryForType(type);
  if (categoryMuted(preference, category)) {
    return true;
  }

  const snoozeUntil = categorySnoozeUntil(preference, category);
  return Boolean(snoozeUntil && snoozeUntil.getTime() > Date.now());
}

export async function getOrCreateNotificationPreference(input: { companyId: string; userId: string }) {
  const existing = await prisma.notificationPreference.findUnique({
    where: {
      userId: input.userId
    }
  });

  if (existing) {
    return existing;
  }

  await prisma.notificationPreference.createMany({
    data: [
      {
        companyId: input.companyId,
        userId: input.userId
      }
    ],
    skipDuplicates: true
  });

  const current = await prisma.notificationPreference.findUnique({
    where: {
      userId: input.userId
    }
  });
  if (!current) {
    throw new Error("알림 기본 설정을 준비하지 못했습니다.");
  }

  return current;
}

async function maybeSendNotificationEmails(input: {
  companyId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string;
}) {
  if (!smtpConfigured()) {
    return;
  }

  const preferenceKey = emailPreferenceKey(input.type);
  const users = await prisma.user.findMany({
    where: {
      companyId: input.companyId,
      id: {
        in: input.userIds
      },
      isActive: true
    },
    include: {
      notificationPreference: true
    }
  });

  await Promise.all(
    users.map(async (user) => {
      const basePreference =
        user.notificationPreference ??
        (await getOrCreateNotificationPreference({
          companyId: input.companyId,
          userId: user.id
        }));
      const preference = await getEffectiveNotificationPreference({
        companyId: input.companyId,
        userId: user.id,
        basePreference
      });

      const enabled =
        preference.emailEnabled &&
        !isNotificationSuppressed(preference, input.type) &&
        (preferenceKey ? preference[preferenceKey] : true) &&
        user.email.includes("@");

      if (!enabled) {
        return;
      }

      await sendNotificationEmail({
        to: user.email,
        subject: `[워크가드] ${input.title}`,
        intro: `${user.name}님에게 도착한 알림입니다.`,
        lines: [input.message],
        actionLabel: "대시보드에서 확인",
        actionUrl: input.actionUrl ? absoluteUrl(input.actionUrl) : undefined
      });
    })
  );
}

export async function createNotifications(input: {
  companyId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string;
  metadata?: Prisma.InputJsonValue;
  sendEmail?: boolean;
}) {
  const userIds = unique(input.userIds);
  if (userIds.length === 0) {
    return;
  }

  const users = await prisma.user.findMany({
    where: {
      companyId: input.companyId,
      id: {
        in: userIds
      },
      isActive: true
    },
    include: {
      notificationPreference: true
    }
  });
  const deliverableUserIds: string[] = [];
  const webPushUserIds: string[] = [];

  for (const user of users) {
    const basePreference =
      user.notificationPreference ??
      (await getOrCreateNotificationPreference({
        companyId: input.companyId,
        userId: user.id
      }));
    const preference = await getEffectiveNotificationPreference({
      companyId: input.companyId,
      userId: user.id,
      basePreference
    });

    if (!isNotificationSuppressed(preference, input.type)) {
      deliverableUserIds.push(user.id);
      if (preference.webPushEnabled && preference.browserPermission === "granted") {
        webPushUserIds.push(user.id);
      }
    }
  }

  if (deliverableUserIds.length === 0) {
    return;
  }

  await prisma.notification.createMany({
    data: deliverableUserIds.map((userId) => ({
      companyId: input.companyId,
      userId,
      type: input.type,
      title: input.title,
      message: input.message,
      actionUrl: input.actionUrl,
      metadata: input.metadata
    }))
  });

  if (input.sendEmail !== false) {
    await maybeSendNotificationEmails({
      companyId: input.companyId,
      userIds: deliverableUserIds,
      type: input.type,
      title: input.title,
      message: input.message,
      actionUrl: input.actionUrl
    });
  }

  await sendWebPushNotifications({
    companyId: input.companyId,
    userIds: webPushUserIds,
    type: input.type,
    title: input.title,
    message: input.message,
    actionUrl: input.actionUrl
  });
}

async function getApprovalRecipientIds(companyId: string, requesterId: string) {
  const requester = await prisma.user.findUnique({
    where: {
      id: requesterId
    },
    include: {
      team: true
    }
  });

  if (!requester || requester.companyId !== companyId) {
    return [];
  }

  const companyRecipients = await prisma.user.findMany({
    where: {
      companyId,
      isActive: true,
      OR: [
        {
          role: "ADMIN"
        },
        {
          role: "HR"
        },
        requester.teamId
          ? {
              managedTeams: {
                some: {
                  id: requester.teamId
                }
              }
            }
          : {
              id: "__none__"
            }
      ]
    },
    select: {
      id: true
    }
  });

  return unique(companyRecipients.map((recipient) => recipient.id)).filter((userId) => userId !== requesterId);
}

export async function notifyApprovalPending(approvalId: string) {
  const approval = await prisma.approvalRequest.findUnique({
    where: {
      id: approvalId
    },
    include: {
      requester: {
        include: {
          team: true
        }
      }
    }
  });

  if (!approval) {
    return;
  }

  const recipientIds = await getApprovalRecipientIds(approval.companyId, approval.requesterId);
  await createNotifications({
    companyId: approval.companyId,
    userIds: recipientIds,
    type: NotificationType.APPROVAL_PENDING,
    title: `${approval.requester.name}님의 ${approvalTypeLabel(approval.type)} 요청`,
    message: `${approval.requester.team?.name ?? "소속 없음"} · 승인 대기 요청이 접수되었습니다.`,
    actionUrl: dashboardViewUrl("approvals", {
      approvalId: approval.id
    }),
    metadata: {
      approvalId: approval.id,
      approvalType: approval.type,
      requesterId: approval.requesterId
    }
  });
}

export async function notifyApprovalReviewed(approvalId: string, status: ApprovalStatus) {
  const approval = await prisma.approvalRequest.findUnique({
    where: {
      id: approvalId
    },
    include: {
      requester: true,
      reviewer: true
    }
  });

  if (!approval) {
    return;
  }

  const isApproved = status === ApprovalStatus.APPROVED;
  await createNotifications({
    companyId: approval.companyId,
    userIds: [approval.requesterId],
    type: isApproved ? NotificationType.APPROVAL_APPROVED : NotificationType.APPROVAL_REJECTED,
    title: `${approvalTypeLabel(approval.type)} 요청이 ${isApproved ? "승인" : "반려"}되었습니다`,
    message: `${approval.reviewer?.name ?? "관리자"} · ${approval.reviewNote ?? approval.reason}`,
    actionUrl: dashboardViewUrl("employee"),
    metadata: {
      approvalId: approval.id,
      approvalType: approval.type,
      status
    }
  });
}

export async function notifyScheduleUpdated(input: { scheduleId: string; actorName: string; isUpdate: boolean }) {
  const schedule = await prisma.workSchedule.findUnique({
    where: {
      id: input.scheduleId
    },
    include: {
      user: true
    }
  });

  if (!schedule) {
    return;
  }

  const workDate = schedule.workDate.toISOString().slice(0, 10);
  await createNotifications({
    companyId: schedule.companyId,
    userIds: [schedule.userId],
    type: NotificationType.SCHEDULE_UPDATED,
    title: input.isUpdate ? "스케줄이 변경되었습니다" : "새 스케줄이 등록되었습니다",
    message: `${workDate} · ${schedule.shiftName} · ${input.actorName}님이 일정을 ${input.isUpdate ? "수정" : "등록"}했습니다.`,
    actionUrl: dashboardViewUrl("employee"),
    metadata: {
      scheduleId: schedule.id,
      workDate,
      shiftName: schedule.shiftName,
      isUpdate: input.isUpdate
    },
    sendEmail: false
  });
}

export async function notifyMonthCloseStatus(input: {
  companyId: string;
  month: string;
  actorName: string;
  status: "CLOSED" | "OPEN";
  reason?: string;
}) {
  const recipients = await prisma.user.findMany({
    where: {
      companyId: input.companyId,
      isActive: true,
      role: {
        in: ["ADMIN", "HR"]
      }
    },
    select: {
      id: true
    }
  });

  await createNotifications({
    companyId: input.companyId,
    userIds: recipients.map((recipient) => recipient.id),
    type: NotificationType.MONTH_CLOSE,
    title:
      input.status === "CLOSED"
        ? `${input.month} 월 마감이 확정되었습니다`
        : `${input.month} 월 마감이 재오픈되었습니다`,
    message:
      input.status === "CLOSED"
        ? `${input.actorName}님이 월 마감을 확정했습니다.`
        : `${input.actorName}님이 월 마감을 재오픈했습니다.${input.reason ? ` · ${input.reason}` : ""}`,
    actionUrl: dashboardViewUrl("reports"),
    metadata: {
      month: input.month,
      status: input.status,
      reason: input.reason ?? null
    }
  });
}

export async function getNotificationCenter(actor: Actor) {
  const today = getKstDateString();
  const tomorrow = addDays(today, 1);
  const { start: monthStart, end: monthEnd } = kstMonthBounds(today.slice(0, 7));

  const [notifications, unreadCount, missingSignals, leaveReminders, currentMonthPendingApprovals, monthCloseStats, basePreference, archiveSnapshot] =
    await Promise.all([
      prisma.notification.findMany({
        where: {
          companyId: actor.companyId,
          userId: actor.id
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 40
      }),
      prisma.notification.count({
        where: {
          companyId: actor.companyId,
          userId: actor.id,
          isRead: false
        }
      }),
      prisma.riskSignal.findMany({
        where: {
          companyId: actor.companyId,
          userId: actor.id,
          type: RiskType.MISSING_CHECK_IN_OUT,
          resolvedAt: null
        },
        orderBy: {
          detectedAt: "desc"
        },
        take: 2
      }),
      prisma.approvalRequest.findMany({
        where: {
          companyId: actor.companyId,
          requesterId: actor.id,
          type: ApprovalType.LEAVE,
          status: ApprovalStatus.APPROVED,
          leaveStartDate: {
            gte: dateOnly(today),
            lte: dateOnly(tomorrow)
          }
        },
        orderBy: {
          leaveStartDate: "asc"
        },
        take: 2
      }),
      canManage(actor.role)
        ? prisma.approvalRequest.count({
            where: {
              companyId: actor.companyId,
              status: ApprovalStatus.PENDING,
              createdAt: {
                gte: monthStart,
                lt: monthEnd
              }
            }
          })
        : Promise.resolve(0),
      canViewReports(actor.role)
        ? Promise.all([
            prisma.workSession.count({
              where: {
                companyId: actor.companyId,
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
                companyId: actor.companyId,
                type: RiskType.MISSING_CHECK_IN_OUT,
                detectedAt: {
                  gte: monthStart,
                  lt: monthEnd
                }
              }
            })
          ])
        : Promise.resolve([0, 0] as const),
      getOrCreateNotificationPreference({
        companyId: actor.companyId,
        userId: actor.id
      }),
      getNotificationArchiveSnapshot(actor.companyId, actor.id)
    ]);
  const preference = await getEffectiveNotificationPreference({
    companyId: actor.companyId,
    userId: actor.id,
    basePreference
  });
  const archivedIds = new Set(archiveSnapshot.ids);
  const activeNotifications = notifications.filter((notification) => !archivedIds.has(notification.id));
  const archivedNotifications = [
    ...notifications
      .filter((notification) => archivedIds.has(notification.id))
      .map((notification) => ({
        ...notification,
        archivedAt:
          archiveSnapshot.items.find((item) => item.id === notification.id)?.archivedAt ??
          notification.readAt?.toISOString() ??
          notification.createdAt.toISOString()
      })),
    ...archiveSnapshot.items.filter((item) => !notifications.some((notification) => notification.id === item.id))
  ];

  const reminders: Array<{
    id: string;
    title: string;
    message: string;
    actionUrl: string;
    tone: "info" | "warning";
    category: "APPROVAL" | "LEAVE" | "MISSING" | "MONTH_CLOSE";
  }> = [
    ...missingSignals.map((signal) => {
      const actionContext = getMissingRecordActionContext(signal.evidence);
      return {
        id: `missing-${signal.id}`,
        title: signal.title,
        message: signal.message,
        actionUrl: buildMissingAdjustmentActionUrl(actionContext ?? {}),
        tone: "warning" as const,
        category: "MISSING" as const
      };
    }),
    ...leaveReminders.map((request) => ({
      id: `leave-${request.id}`,
      title: `${leaveTypeLabel(request.leaveType)} 시작 알림`,
      message: `${request.leaveStartDate?.toISOString().slice(0, 10)}부터 승인된 휴가가 시작됩니다.`,
      actionUrl: dashboardViewUrl("employee"),
      tone: "info" as const,
      category: "LEAVE" as const
    }))
  ];

  if (canManage(actor.role) && currentMonthPendingApprovals > 0) {
      reminders.unshift({
        id: `approval-pending-${today}`,
        title: "승인 대기 요청 확인",
        message: `이번 달 승인 대기 요청이 ${currentMonthPendingApprovals}건 남아 있습니다.`,
        actionUrl: dashboardViewUrl("approvals"),
        tone: "warning" as const,
        category: "APPROVAL" as const
      });
  }

  if (canViewReports(actor.role)) {
    const [openSessions, missingRecordRisks] = monthCloseStats;
    if (openSessions > 0 || missingRecordRisks > 0) {
      reminders.unshift({
        id: `month-close-${today}`,
        title: "월 마감 전 점검 필요",
        message: `미종결 세션 ${openSessions}건, 출퇴근 누락 리스크 ${missingRecordRisks}건이 남아 있습니다.`,
        actionUrl: dashboardViewUrl("reports"),
        tone: "warning" as const,
        category: "MONTH_CLOSE" as const
      });
    }
  }

  if (canManage(actor.role)) {
    reminders.unshift({
      id: `daily-digest-${today}`,
      title: "오늘 운영 요약",
      message: `승인 대기 ${currentMonthPendingApprovals}건, 누락 리마인더 ${missingSignals.length}건, 월 마감 점검 ${canViewReports(actor.role) ? "확인 가능" : "권한 없음"} 상태입니다.`,
      actionUrl: dashboardViewUrl("notifications"),
      tone: "info" as const,
      category: "APPROVAL" as const
    });
  }

  const visibleReminders = reminders.filter((reminder) => {
    const snoozeUntil = categorySnoozeUntil(preference, reminder.category);
    return !categoryMuted(preference, reminder.category) && !(snoozeUntil && snoozeUntil.getTime() > Date.now());
  });

  return {
    notifications: activeNotifications,
    archivedNotifications,
    archivedCount: archiveSnapshot.count,
    unreadCount,
    reminders: visibleReminders,
    preference
  };
}

export async function updateNotificationPreference(
  actor: Actor,
  input: {
    emailEnabled: boolean;
    webPushEnabled: boolean;
    approvalPendingEmail: boolean;
    approvalReviewedEmail: boolean;
    leaveReminderEmail: boolean;
    missingRecordEmail: boolean;
    monthCloseEmail: boolean;
    schedulerDigestEnabled: boolean;
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
    browserPermission: string;
  }
) {
  const baseInput = {
    emailEnabled: input.emailEnabled,
    webPushEnabled: input.webPushEnabled,
    approvalPendingEmail: input.approvalPendingEmail,
    approvalReviewedEmail: input.approvalReviewedEmail,
    leaveReminderEmail: input.leaveReminderEmail,
    missingRecordEmail: input.missingRecordEmail,
    monthCloseEmail: input.monthCloseEmail,
    schedulerDigestEnabled: input.schedulerDigestEnabled,
    browserPermission: input.browserPermission
  };
  const basePreference = await prisma.notificationPreference.upsert({
    where: {
      userId: actor.id
    },
    create: {
      companyId: actor.companyId,
      userId: actor.id,
      ...baseInput
    },
    update: baseInput
  });
  const extras = parseNotificationPreferenceExtras(input);
  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      actorUserId: actor.id,
      action: "notifications.preferences.extended.saved",
      targetType: "notification_preference",
      targetId: actor.id,
      payload: serializeNotificationPreferenceExtras(extras)
    }
  });

  return {
    ...basePreference,
    ...extras
  };
}

async function tryCreateSchedulerLog(input: {
  companyId: string;
  userId: string;
  type: NotificationType;
  dedupeKey: string;
}) {
  const result = await prisma.notificationDispatchLog.createMany({
    data: [
      {
        companyId: input.companyId,
        userId: input.userId,
        type: input.type,
        channel: "scheduler",
        dedupeKey: input.dedupeKey,
        status: "sent"
      }
    ],
    skipDuplicates: true
  });

  return result.count > 0;
}

async function dispatchScheduledNotification(input: {
  companyId: string;
  userId: string;
  type: NotificationType;
  dedupeKey: string;
  title: string;
  message: string;
  actionUrl?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const preference = await getOrCreateNotificationPreference({
    companyId: input.companyId,
    userId: input.userId
  });
  const effectivePreference = await getEffectiveNotificationPreference({
    companyId: input.companyId,
    userId: input.userId,
    basePreference: preference
  });

  if (!effectivePreference.schedulerDigestEnabled) {
    return false;
  }

  if (isNotificationSuppressed(effectivePreference, input.type)) {
    return false;
  }

  const created = await tryCreateSchedulerLog({
    companyId: input.companyId,
    userId: input.userId,
    type: input.type,
    dedupeKey: input.dedupeKey
  });

  if (!created) {
    return false;
  }

  await createNotifications({
    companyId: input.companyId,
    userIds: [input.userId],
    type: input.type,
    title: input.title,
    message: input.message,
    actionUrl: input.actionUrl,
    metadata: input.metadata
  });

  return true;
}

export async function runNotificationScheduler(input?: {
  actor?: Actor | null;
  today?: string;
  companyId?: string;
}) {
  const today = input?.today ?? getKstDateString();
  const tomorrow = addDays(today, 1);
  const { start: todayStart, end: todayEnd } = kstDayBounds(today);
  const { start: monthStart, end: monthEnd } = kstMonthBounds(today.slice(0, 7));
  const companies = input?.companyId
    ? [{ id: input.companyId }]
    : await prisma.company.findMany({
        select: {
          id: true
        }
      });

  const summary = {
    approvalPending: 0,
    leaveStarting: 0,
    missingRecord: 0,
    monthClose: 0,
    riskEscalation: 0
  };

  for (const company of companies) {
    const managers = await prisma.user.findMany({
      where: {
        companyId: company.id,
        isActive: true,
        role: {
          in: ["ADMIN", "HR", "MANAGER"]
        }
      },
      select: {
        id: true
      }
    });

    const hrUsers = await prisma.user.findMany({
      where: {
        companyId: company.id,
        isActive: true,
        role: {
          in: ["ADMIN", "HR"]
        }
      },
      select: {
        id: true
      }
    });

    const pendingApprovals = await prisma.approvalRequest.count({
      where: {
        companyId: company.id,
        status: ApprovalStatus.PENDING
      }
    });

    if (pendingApprovals > 0) {
      for (const recipient of managers) {
        const delivered = await dispatchScheduledNotification({
          companyId: company.id,
          userId: recipient.id,
          type: NotificationType.APPROVAL_PENDING,
          dedupeKey: `approval-pending:${company.id}:${recipient.id}:${today}`,
          title: "승인 대기 요청 리마인더",
          message: `처리되지 않은 승인 요청이 ${pendingApprovals}건 남아 있습니다.`,
          actionUrl: dashboardViewUrl("approvals"),
          metadata: {
            scheduledFor: today,
            pendingApprovals
          }
        });
        if (delivered) {
          summary.approvalPending += 1;
        }
      }
    }

    const leaveRequests = await prisma.approvalRequest.findMany({
      where: {
        companyId: company.id,
        type: ApprovalType.LEAVE,
        status: ApprovalStatus.APPROVED,
        leaveStartDate: dateOnly(tomorrow)
      },
      include: {
        requester: true
      }
    });

    for (const request of leaveRequests) {
      const delivered = await dispatchScheduledNotification({
        companyId: company.id,
        userId: request.requesterId,
        type: NotificationType.LEAVE_STARTING,
        dedupeKey: `leave-starting:${request.id}:${today}`,
        title: `${leaveTypeLabel(request.leaveType)} 시작 예정`,
        message: `${tomorrow}부터 승인된 휴가가 시작됩니다.`,
        actionUrl: dashboardViewUrl("employee"),
        metadata: {
          scheduledFor: today,
          leaveStartDate: tomorrow,
          approvalId: request.id
        }
      });
      if (delivered) {
        summary.leaveStarting += 1;
      }
    }

    const missingSignals = await prisma.riskSignal.findMany({
      where: {
        companyId: company.id,
        type: RiskType.MISSING_CHECK_IN_OUT,
        resolvedAt: null,
        detectedAt: {
          gte: todayStart,
          lt: todayEnd
        }
      },
      orderBy: [{ userId: "asc" }, { detectedAt: "desc" }]
    });

    const missingRiskByUser = new Map<
      string,
      {
        count: number;
        signal: (typeof missingSignals)[number];
      }
    >();

    for (const signal of missingSignals) {
      const current = missingRiskByUser.get(signal.userId);
      if (current) {
        current.count += 1;
        continue;
      }

      missingRiskByUser.set(signal.userId, {
        count: 1,
        signal
      });
    }

    for (const [userId, row] of missingRiskByUser) {
      const actionContext = getMissingRecordActionContext(row.signal.evidence);
      const actionUrl = buildMissingAdjustmentActionUrl(actionContext ?? {});

      const delivered = await dispatchScheduledNotification({
        companyId: company.id,
        userId,
        type: NotificationType.MISSING_RECORD,
        dedupeKey: `missing-record:${userId}:${today}`,
        title: "오늘 출퇴근 누락 확인 필요",
        message: `해결되지 않은 출퇴근 누락 리스크가 ${row.count}건 있습니다.`,
        actionUrl,
        metadata: {
          scheduledFor: today,
          count: row.count,
          targetDate: actionContext?.targetDate ?? today,
          adjustmentType: actionContext?.adjustmentType ?? null,
          requestedTime: actionContext?.requestedTime ?? null
        }
      });
      if (delivered) {
        summary.missingRecord += 1;
      }
    }

    if (Number(today.slice(8, 10)) >= 25) {
      const [openSessions, missingRecords, pendingForMonth] = await Promise.all([
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
            type: RiskType.MISSING_CHECK_IN_OUT,
            detectedAt: {
              gte: monthStart,
              lt: monthEnd
            },
            resolvedAt: null
          }
        }),
        prisma.approvalRequest.count({
          where: {
            companyId: company.id,
            status: ApprovalStatus.PENDING,
            createdAt: {
              gte: monthStart,
              lt: monthEnd
            }
          }
        })
      ]);

      if (openSessions > 0 || missingRecords > 0 || pendingForMonth > 0) {
        for (const recipient of hrUsers) {
          const delivered = await dispatchScheduledNotification({
            companyId: company.id,
            userId: recipient.id,
            type: NotificationType.MONTH_CLOSE,
            dedupeKey: `month-close-check:${company.id}:${recipient.id}:${today}`,
            title: "월 마감 점검 리마인더",
            message: `미종결 세션 ${openSessions}건, 누락 리스크 ${missingRecords}건, 승인 대기 ${pendingForMonth}건을 확인하세요.`,
            actionUrl: dashboardViewUrl("reports"),
            metadata: {
              scheduledFor: today,
              month: today.slice(0, 7),
              openSessions,
              missingRecords,
              pendingApprovals: pendingForMonth
            }
          });
          if (delivered) {
            summary.monthClose += 1;
          }
        }
      }
    }

    const escalationCandidates = await getCompanyRiskEscalationCandidates(company.id);
    for (const candidate of escalationCandidates) {
      const deliveredType =
        candidate.escalationLevel === "UNASSIGNED"
          ? "담당자 지정 필요"
          : candidate.escalationLevel === "OVERDUE"
            ? "48시간 SLA 초과"
            : "24시간 미처리";

      for (const recipientId of candidate.recipientIds) {
        const delivered = await dispatchScheduledNotification({
          companyId: company.id,
          userId: recipientId,
          type: NotificationType.APPROVAL_PENDING,
          dedupeKey: `risk-escalation:${candidate.signal.id}:${candidate.escalationLevel}:${today}:${recipientId}`,
          title: `리스크 ${deliveredType}`,
          message: `${candidate.signal.user.name} · ${candidate.signal.title} · ${candidate.signal.slaLabel}`,
          actionUrl: dashboardViewUrl("risk"),
          metadata: {
            scheduledFor: today,
            kind: "RISK_SLA",
            riskId: candidate.signal.id,
            riskType: candidate.signal.type,
            level: candidate.signal.level,
            slaStatus: candidate.signal.slaStatus
          }
        });
        if (delivered) {
          summary.riskEscalation += 1;
        }
      }
    }
  }

  if (input?.actor) {
    await prisma.auditLog.create({
      data: {
        companyId: input.actor.companyId,
        actorUserId: input.actor.id,
        action: "notifications.scheduler.run",
        targetType: "notification_scheduler",
        targetId: today,
        payload: summary
      }
    });
  }

  return summary;
}

export async function markNotificationRead(input: { companyId: string; userId: string; notificationId: string }) {
  return prisma.notification.updateMany({
    where: {
      id: input.notificationId,
      companyId: input.companyId,
      userId: input.userId
    },
    data: {
      isRead: true,
      readAt: new Date()
    }
  });
}

export async function markAllNotificationsRead(input: { companyId: string; userId: string }) {
  return prisma.notification.updateMany({
    where: {
      companyId: input.companyId,
      userId: input.userId,
      isRead: false
    },
    data: {
      isRead: true,
      readAt: new Date()
    }
  });
}

export async function archiveReadNotifications(input: { companyId: string; userId: string }) {
  const notifications = await prisma.notification.findMany({
    where: {
      companyId: input.companyId,
      userId: input.userId,
      isRead: true
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 80
  });
  await prisma.auditLog.create({
    data: {
      companyId: input.companyId,
      actorUserId: input.userId,
      action: "notifications.archive.saved",
      targetType: "notification_archive",
      targetId: input.userId,
      payload: {
        ids: notifications.map((notification) => notification.id),
        count: notifications.length,
        items: notifications.slice(0, 20).map((notification) => ({
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          actionUrl: notification.actionUrl,
          metadata: notification.metadata,
          createdAt: notification.createdAt.toISOString(),
          readAt: notification.readAt?.toISOString() ?? null,
          archivedAt: new Date().toISOString()
        }))
      } satisfies Prisma.JsonObject
    }
  });

  return {
    count: notifications.length
  };
}

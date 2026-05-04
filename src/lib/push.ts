import { randomUUID } from "node:crypto";

import { NotificationType, Prisma } from "@/generated/prisma";
import webpush from "web-push";

import { prisma } from "@/lib/prisma";

type WebPushSubscriptionInput = {
  endpoint?: string | null;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string | null;
    auth?: string | null;
  } | null;
};

type StoredSubscriptionRow = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  authSecret: string;
  expirationTime: Date | null;
};

type CountRow = {
  count: number;
};

export type WebPushOperationsSummary = {
  totalSubscriptions: number;
  subscribedUsers: number;
  failingSubscriptions: number;
  recentFailures: number;
  recentPruned: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
};

function trimOptionalValue(value?: string | null, maxLength = 2048) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function uniqueUserIds(userIds: string[]) {
  return [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))];
}

export function webPushConfigured() {
  return Boolean(
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY &&
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY &&
      process.env.WEB_PUSH_SUBJECT
  );
}

export function getWebPushPublicKey() {
  return process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? "";
}

function ensureWebPushClient() {
  if (!webPushConfigured()) {
    return false;
  }

  webpush.setVapidDetails(
    process.env.WEB_PUSH_SUBJECT ?? "mailto:admin@example.com",
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? "",
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? ""
  );

  return true;
}

function simulatedPushBehavior(endpoint: string) {
  if (endpoint.includes("/test-push/prune") || endpoint.includes("/qa-push/prune")) {
    return "prune" as const;
  }
  if (endpoint.includes("/test-push/fail") || endpoint.includes("/qa-push/fail")) {
    return "fail" as const;
  }
  if (
    endpoint.includes("/test-push/sent") ||
    endpoint.includes("/qa-push/") ||
    endpoint.includes("/playwright-push/") ||
    endpoint.includes("/ops-test-push/")
  ) {
    return "sent" as const;
  }

  return null;
}

function parseSubscription(input: WebPushSubscriptionInput) {
  const endpoint = trimOptionalValue(input.endpoint);
  const p256dh = trimOptionalValue(input.keys?.p256dh, 512);
  const authSecret = trimOptionalValue(input.keys?.auth, 512);
  if (!endpoint || !p256dh || !authSecret) {
    throw new Error("브라우저 푸시 구독 정보가 올바르지 않습니다.");
  }

  return {
    endpoint,
    p256dh,
    authSecret,
    expirationTime:
      typeof input.expirationTime === "number" && Number.isFinite(input.expirationTime)
        ? new Date(input.expirationTime)
        : null
  };
}

export async function saveWebPushSubscription(input: {
  userId: string;
  subscription: WebPushSubscriptionInput;
  userAgent?: string | null;
}) {
  const parsed = parseSubscription(input.subscription);
  const now = new Date();

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "WebPushSubscription" (
        "id",
        "userId",
        "endpoint",
        "p256dh",
        "authSecret",
        "expirationTime",
        "userAgent",
        "failureCount",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${input.userId},
        ${parsed.endpoint},
        ${parsed.p256dh},
        ${parsed.authSecret},
        ${parsed.expirationTime},
        ${trimOptionalValue(input.userAgent, 512)},
        0,
        ${now},
        ${now}
      )
      ON CONFLICT ("endpoint") DO UPDATE
      SET
        "userId" = EXCLUDED."userId",
        "p256dh" = EXCLUDED."p256dh",
        "authSecret" = EXCLUDED."authSecret",
        "expirationTime" = EXCLUDED."expirationTime",
        "userAgent" = EXCLUDED."userAgent",
        "failureCount" = 0,
        "updatedAt" = EXCLUDED."updatedAt"
    `
  );
}

export async function deleteWebPushSubscription(input: { userId: string; endpoint: string }) {
  await prisma.$executeRaw`
    DELETE FROM "WebPushSubscription"
    WHERE "userId" = ${input.userId} AND "endpoint" = ${input.endpoint}
  `;
}

async function markSubscriptionSuccess(subscriptionId: string) {
  const now = new Date();
  await prisma.$executeRaw`
    UPDATE "WebPushSubscription"
    SET
      "lastSuccessAt" = ${now},
      "lastFailureAt" = NULL,
      "failureCount" = 0,
      "updatedAt" = ${now}
    WHERE "id" = ${subscriptionId}
  `;
}

async function markSubscriptionFailure(subscriptionId: string) {
  const now = new Date();
  await prisma.$executeRaw`
    UPDATE "WebPushSubscription"
    SET
      "lastFailureAt" = ${now},
      "failureCount" = "failureCount" + 1,
      "updatedAt" = ${now}
    WHERE "id" = ${subscriptionId}
  `;
}

async function deleteSubscriptionById(subscriptionId: string) {
  await prisma.$executeRaw`
    DELETE FROM "WebPushSubscription"
    WHERE "id" = ${subscriptionId}
  `;
}

async function deliverWebPushToSubscription(subscription: StoredSubscriptionRow, payload: {
  title: string;
  body: string;
  actionUrl: string;
  type: NotificationType;
}) {
  const simulated = simulatedPushBehavior(subscription.endpoint);
  if (simulated === "sent") {
    return;
  }
  if (simulated === "prune") {
    const error = new Error("Simulated web push expiration.");
    Object.assign(error, { statusCode: 410 });
    throw error;
  }
  if (simulated === "fail") {
    throw new Error("Simulated web push delivery failure.");
  }

  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime?.getTime() ?? null,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.authSecret
      }
    },
    JSON.stringify(payload)
  );
}

function pushLogDetail(input: { delivered: number; pruned: number; failed: number }) {
  const parts = [`성공 ${input.delivered}건`];
  if (input.pruned > 0) {
    parts.push(`만료 정리 ${input.pruned}건`);
  }
  if (input.failed > 0) {
    parts.push(`실패 ${input.failed}건`);
  }
  return parts.join(" · ");
}

export async function sendWebPushNotifications(input: {
  companyId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string;
}) {
  if (!ensureWebPushClient()) {
    return;
  }

  const userIds = uniqueUserIds(input.userIds);
  if (userIds.length === 0) {
    return;
  }

  const subscriptions = await prisma.$queryRaw<StoredSubscriptionRow[]>(
    Prisma.sql`
      SELECT
        "id",
        "userId",
        "endpoint",
        "p256dh",
        "authSecret",
        "expirationTime"
      FROM "WebPushSubscription"
      WHERE "userId" IN (${Prisma.join(userIds)})
    `
  );

  if (subscriptions.length === 0) {
    return;
  }

  const summaries = new Map<
    string,
    {
      delivered: number;
      pruned: number;
      failed: number;
      lastError: string | null;
    }
  >();

  for (const subscription of subscriptions) {
    const current = summaries.get(subscription.userId) ?? {
      delivered: 0,
      pruned: 0,
      failed: 0,
      lastError: null
    };

    try {
      await deliverWebPushToSubscription(subscription, {
        title: input.title,
        body: input.message,
        actionUrl: input.actionUrl ?? "/dashboard?view=notifications",
        type: input.type
      });
      current.delivered += 1;
      await markSubscriptionSuccess(subscription.id);
    } catch (error) {
      const statusCode =
        typeof error === "object" &&
        error &&
        "statusCode" in error &&
        typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : null;

      if (statusCode === 404 || statusCode === 410) {
        current.pruned += 1;
        await deleteSubscriptionById(subscription.id);
      } else {
        current.failed += 1;
        current.lastError = error instanceof Error ? error.message : "웹 푸시 전송에 실패했습니다.";
        await markSubscriptionFailure(subscription.id);
      }
    }

    summaries.set(subscription.userId, current);
  }

  await Promise.all(
    [...summaries.entries()].map(([userId, summary]) => {
      if (summary.delivered === 0 && summary.failed === 0 && summary.pruned === 0) {
        return Promise.resolve();
      }

      const status =
        summary.delivered > 0 ? "sent" : summary.failed > 0 ? "failed" : "skipped";
      const detail =
        summary.failed > 0 && summary.lastError
          ? `${pushLogDetail(summary)} · ${summary.lastError}`
          : pushLogDetail(summary);

      return prisma.notificationDispatchLog.create({
        data: {
          companyId: input.companyId,
          userId,
          type: input.type,
          channel: "web_push",
          dedupeKey: `push:${input.type}:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          status,
          detail
        }
      });
    })
  );
}

export async function getWebPushOperationsSummary(companyId: string): Promise<WebPushOperationsSummary> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [totalRow, subscribedUsersRow, failingRow, recentFailedRow, recentPrunedRow, timestamps] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM "WebPushSubscription" s
      JOIN "User" u ON u."id" = s."userId"
      WHERE u."companyId" = ${companyId}
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(DISTINCT s."userId")::int AS count
      FROM "WebPushSubscription" s
      JOIN "User" u ON u."id" = s."userId"
      WHERE u."companyId" = ${companyId}
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM "WebPushSubscription" s
      JOIN "User" u ON u."id" = s."userId"
      WHERE u."companyId" = ${companyId} AND s."failureCount" > 0
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM "NotificationDispatchLog"
      WHERE "companyId" = ${companyId}
        AND "channel" = 'web_push'
        AND "status" = 'failed'
        AND "createdAt" >= ${since}
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM "NotificationDispatchLog"
      WHERE "companyId" = ${companyId}
        AND "channel" = 'web_push'
        AND "detail" ILIKE '%만료 정리%'
        AND "createdAt" >= ${since}
    `,
    prisma.$queryRaw<Array<{ lastSuccessAt: Date | null; lastFailureAt: Date | null }>>`
      SELECT
        MAX(s."lastSuccessAt") AS "lastSuccessAt",
        MAX(s."lastFailureAt") AS "lastFailureAt"
      FROM "WebPushSubscription" s
      JOIN "User" u ON u."id" = s."userId"
      WHERE u."companyId" = ${companyId}
    `
  ]);

  const timestampRow = timestamps[0] ?? { lastSuccessAt: null, lastFailureAt: null };

  return {
    totalSubscriptions: totalRow[0]?.count ?? 0,
    subscribedUsers: subscribedUsersRow[0]?.count ?? 0,
    failingSubscriptions: failingRow[0]?.count ?? 0,
    recentFailures: recentFailedRow[0]?.count ?? 0,
    recentPruned: recentPrunedRow[0]?.count ?? 0,
    lastSuccessAt: timestampRow.lastSuccessAt,
    lastFailureAt: timestampRow.lastFailureAt
  };
}

export async function pruneStaleWebPushSubscriptions(input: {
  companyId: string;
  failureCountThreshold?: number;
  failedBefore?: Date;
}) {
  const failureCountThreshold = Math.max(1, Math.round(input.failureCountThreshold ?? 3));
  const failedBefore = input.failedBefore ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const staleSubscriptions = await prisma.$queryRaw<Array<{ id: string; userId: string }>>`
    SELECT s."id", s."userId"
    FROM "WebPushSubscription" s
    JOIN "User" u ON u."id" = s."userId"
    WHERE u."companyId" = ${input.companyId}
      AND s."failureCount" >= ${failureCountThreshold}
      AND s."lastFailureAt" IS NOT NULL
      AND s."lastFailureAt" < ${failedBefore}
  `;

  if (staleSubscriptions.length === 0) {
    return {
      pruned: 0,
      affectedUserIds: [] as string[]
    };
  }

  await prisma.$executeRaw`
    DELETE FROM "WebPushSubscription"
    WHERE "id" IN (${Prisma.join(staleSubscriptions.map((subscription) => subscription.id))})
  `;

  return {
    pruned: staleSubscriptions.length,
    affectedUserIds: [...new Set(staleSubscriptions.map((subscription) => subscription.userId))]
  };
}

export async function sendTestWebPushNotification(input: {
  companyId: string;
  actorName: string;
  targetUserId: string;
}) {
  const [user] = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name"
    FROM "User"
    WHERE "id" = ${input.targetUserId} AND "companyId" = ${input.companyId} AND "isActive" = true
    LIMIT 1
  `;

  if (!user) {
    throw new Error("테스트 웹푸시를 보낼 직원을 찾을 수 없습니다.");
  }

  const [subscriptionCountRow] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::int AS count
    FROM "WebPushSubscription"
    WHERE "userId" = ${user.id}
  `;

  if (!subscriptionCountRow?.count) {
    await prisma.notificationDispatchLog.create({
      data: {
        companyId: input.companyId,
        userId: user.id,
        type: NotificationType.SCHEDULE_UPDATED,
        channel: "web_push",
        dedupeKey: `push:test:${user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        status: "skipped",
        detail: `[테스트] ${user.name}에게 보낼 활성 브라우저 구독이 없습니다.`
      }
    });

    return {
      channel: "web_push" as const,
      status: "skipped" as const,
      detail: `${user.name}에게 보낼 활성 브라우저 구독이 없습니다.`
    };
  }

  await sendWebPushNotifications({
    companyId: input.companyId,
    userIds: [user.id],
    type: NotificationType.SCHEDULE_UPDATED,
    title: "워크가드 테스트 푸시",
    message: `${input.actorName}님이 웹푸시 연결 점검을 실행했습니다.`,
    actionUrl: "/dashboard?view=notifications"
  });

  const log = await prisma.notificationDispatchLog.findFirst({
    where: {
      companyId: input.companyId,
      userId: user.id,
      channel: "web_push"
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return {
    channel: "web_push" as const,
    status: (log?.status ?? "sent") as "sent" | "failed" | "skipped",
    detail: log?.detail ?? `${user.name}에게 테스트 웹푸시를 전송했습니다.`
  };
}

import type { User } from "@/generated/prisma";

import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { authSecret } from "@/lib/security";
import { webPushConfigured } from "@/lib/push";
import { smtpConfigured } from "@/lib/email";

type Actor = Pick<User, "id" | "companyId">;

export type HealthCheck = {
  key: string;
  label: string;
  status: "ok" | "degraded";
  detail: string;
  severity?: "required" | "recommended";
  action?: string;
};

export type PublicHealthSnapshot = {
  status: "ok" | "degraded";
  timestamp: string;
  checks: HealthCheck[];
};

export type RecentOpsEvent = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: Date;
  actor: {
    id: string;
    name: string;
    email: string;
  } | null;
  payload: unknown;
};

export type DeploymentOpsSummary = {
  health: PublicHealthSnapshot;
  bootstrap: {
    seedCommand: string;
    adminBootstrapCommand: string;
    backupCommand: string;
    restoreCommand: string;
  };
  readiness: {
    score: number;
    readyCount: number;
    totalCount: number;
    blockingCount: number;
    warningCount: number;
  };
  sampleData: {
    seededAt: Date | null;
    cleanupAvailable: boolean;
  };
  clientErrors: Array<{
    id: string;
    pathname: string;
    message: string;
    digest: string | null;
    count: number;
    lastSeenAt: Date;
    actor: RecentOpsEvent["actor"];
  }>;
  recentOpsEvents: RecentOpsEvent[];
};

export async function getPublicHealthSnapshot() {
  const checks: HealthCheck[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({
      key: "database",
      label: "데이터베이스",
      status: "ok",
      detail: "데이터베이스 연결이 정상입니다.",
      severity: "required",
      action: "DATABASE_URL과 네트워크 접근 권한을 확인하세요."
    });
  } catch (error) {
    checks.push({
      key: "database",
      label: "데이터베이스",
      status: "degraded",
      detail: error instanceof Error ? error.message : "데이터베이스 연결에 실패했습니다.",
      severity: "required",
      action: "DATABASE_URL과 네트워크 접근 권한을 확인하세요."
    });
  }

  checks.push({
    key: "app_base_url",
    label: "앱 주소",
    status: process.env.APP_BASE_URL ? "ok" : "degraded",
    detail: process.env.APP_BASE_URL ? "앱 기본 주소가 설정되어 있습니다." : "APP_BASE_URL이 설정되지 않았습니다.",
    severity: "required",
    action: "배포 도메인을 APP_BASE_URL에 설정하세요."
  });
  checks.push({
    key: "auth_secret",
    label: "인증 비밀키",
    status:
      authSecret() === "local-dev-secret-change-before-production" || authSecret().length < 24
        ? "degraded"
        : "ok",
    detail:
      authSecret() === "local-dev-secret-change-before-production" || authSecret().length < 24
        ? "AUTH_SECRET이 기본값이거나 너무 짧습니다."
        : "AUTH_SECRET 길이가 충분합니다.",
    severity: "required",
    action: "운영에서는 32자 이상 무작위 문자열로 교체하세요."
  });
  checks.push({
    key: "node_env",
    label: "실행 모드",
    status: process.env.NODE_ENV === "production" ? "ok" : "degraded",
    detail: process.env.NODE_ENV === "production" ? "production 모드입니다." : "production 모드가 아닙니다.",
    severity: "recommended",
    action: "운영 실행은 NODE_ENV=production으로 고정하세요."
  });
  checks.push({
    key: "smtp",
    label: "SMTP",
    status: smtpConfigured() ? "ok" : "degraded",
    detail: smtpConfigured() ? "메일 발송 설정이 감지되었습니다." : "SMTP 설정이 없습니다.",
    severity: "recommended",
    action: "초대/알림 메일을 쓰려면 SMTP_* 환경변수를 설정하세요."
  });
  checks.push({
    key: "web_push",
    label: "웹푸시",
    status: webPushConfigured() ? "ok" : "degraded",
    detail: webPushConfigured() ? "VAPID 설정이 감지되었습니다." : "웹푸시 VAPID 설정이 없습니다.",
    severity: "recommended",
    action: "모바일 알림을 쓰려면 VAPID 키를 생성해 배포 환경에 반영하세요."
  });

  return {
    status: checks.every((check) => check.status === "ok") ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks
  } satisfies PublicHealthSnapshot;
}

export async function reportClientError(input: {
  actor?: Actor | null;
  message: string;
  pathname?: string | null;
  digest?: string | null;
  stack?: string | null;
}) {
  if (!input.actor) {
    return;
  }

  await writeAuditLog({
    companyId: input.actor.companyId,
    actorUserId: input.actor.id,
    action: "ops.client_error.reported",
    targetType: "client_error",
    targetId: input.digest?.trim() || input.pathname?.trim() || "unknown",
    payload: {
      pathname: input.pathname?.trim() || null,
      digest: input.digest?.trim() || null,
      message: input.message.trim(),
      stack: input.stack?.trim() || null
    }
  });
}

export async function getDeploymentOpsSummary(companyId: string): Promise<DeploymentOpsSummary> {
  const [health, recentOpsEvents, sampleDataEvent, clientErrorEvents] = await Promise.all([
    getPublicHealthSnapshot(),
    prisma.auditLog.findMany({
      where: {
        companyId,
        action: {
          startsWith: "ops."
        }
      },
      include: {
        actor: {
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
    }),
    prisma.auditLog.findFirst({
      where: {
        companyId,
        action: "onboarding.sample.seeded",
        targetType: "onboarding"
      },
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.auditLog.findMany({
      where: {
        companyId,
        action: "ops.client_error.reported"
      },
      include: {
        actor: {
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
      take: 80
    })
  ]);
  const groupedClientErrors = new Map<string, DeploymentOpsSummary["clientErrors"][number]>();
  for (const event of clientErrorEvents) {
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
    const pathname = typeof payload.pathname === "string" ? payload.pathname : "-";
    const message = typeof payload.message === "string" ? payload.message : "클라이언트 오류";
    const digest = typeof payload.digest === "string" ? payload.digest : null;
    const key = `${pathname}:${digest ?? message}`;
    const existing = groupedClientErrors.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groupedClientErrors.set(key, {
      id: event.id,
      pathname,
      message,
      digest,
      count: 1,
      lastSeenAt: event.createdAt,
      actor: event.actor
    });
  }

  const requiredChecks = health.checks.filter((check) => check.severity === "required");
  const blockingCount = requiredChecks.filter((check) => check.status === "degraded").length;
  const warningCount = health.checks.filter((check) => check.severity !== "required" && check.status === "degraded").length;
  const readyCount = health.checks.filter((check) => check.status === "ok").length;
  const totalCount = health.checks.length;

  return {
    health,
    bootstrap: {
      seedCommand: "npm run db:seed",
      adminBootstrapCommand: "node scripts/bootstrap-admin.mjs admin@gamsi.kr '새 비밀번호' '관리자 이름'",
      backupCommand: "node scripts/backup-db.mjs",
      restoreCommand: "node scripts/restore-db.mjs ./backups/workguard-latest.sql"
    },
    readiness: {
      score: Math.round((readyCount / Math.max(1, totalCount)) * 100),
      readyCount,
      totalCount,
      blockingCount,
      warningCount
    },
    sampleData: {
      seededAt: sampleDataEvent?.createdAt ?? null,
      cleanupAvailable: Boolean(sampleDataEvent)
    },
    clientErrors: Array.from(groupedClientErrors.values()).slice(0, 12),
    recentOpsEvents
  };
}

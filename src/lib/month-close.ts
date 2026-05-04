import {
  MonthCloseEventType,
  MonthCloseStatus,
  PayrollSyncStatus,
  Prisma,
  type User
} from "@/generated/prisma";

import { canViewReports } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAuditPayloadRecord, listAuditSnapshots, writeAuditSnapshot } from "@/lib/settings-store";
import { getMonthString, getMonthStringsInRange } from "@/lib/policy-engine";

type Actor = Pick<User, "id" | "companyId" | "role">;

export type MonthCloseReopenRequest = {
  requestId: string;
  month: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: Date;
  requestedById: string | null;
  requestedByName: string | null;
  reviewedAt: Date | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  diffFromLockedSnapshot: unknown;
};

function getObject(input: unknown) {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
}

function getNumberMap(input: unknown) {
  const record = getObject(input);
  if (!record) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => typeof value === "number")
      .map(([key, value]) => [key, value as number])
  );
}

function parseReopenRequestPayload(payload: unknown) {
  const record = getAuditPayloadRecord(payload);
  if (!record || typeof record.month !== "string" || typeof record.reason !== "string") {
    return null;
  }

  return {
    month: record.month,
    reason: record.reason,
    requestedById: typeof record.requestedById === "string" ? record.requestedById : null,
    requestedByName: typeof record.requestedByName === "string" ? record.requestedByName : null,
    diffFromLockedSnapshot: record.diffFromLockedSnapshot ?? null
  };
}

function parseReopenReviewPayload(payload: unknown) {
  const record = getAuditPayloadRecord(payload);
  if (!record || typeof record.requestId !== "string" || typeof record.month !== "string" || typeof record.decision !== "string") {
    return null;
  }

  if (record.decision !== "APPROVED" && record.decision !== "REJECTED") {
    return null;
  }

  return {
    requestId: record.requestId,
    month: record.month,
    decision: record.decision as "APPROVED" | "REJECTED",
    reviewNote: typeof record.reviewNote === "string" ? record.reviewNote : null,
    reviewedById: typeof record.reviewedById === "string" ? record.reviewedById : null,
    reviewedByName: typeof record.reviewedByName === "string" ? record.reviewedByName : null
  };
}

export async function getMonthCloseReopenRequests(companyId: string, month?: string, take = 24) {
  const logs = await listAuditSnapshots({
    companyId,
    actions: ["month_close.reopen_requested", "month_close.reopen_reviewed"],
    targetType: "month_close_reopen_request",
    take
  });

  const requests = new Map<string, MonthCloseReopenRequest>();
  for (const log of [...logs].reverse()) {
    if (log.action === "month_close.reopen_requested") {
      const parsed = parseReopenRequestPayload(log.payload);
      if (!parsed || (month && parsed.month !== month)) {
        continue;
      }
      requests.set(log.targetId, {
        requestId: log.targetId,
        month: parsed.month,
        reason: parsed.reason,
        status: "PENDING",
        requestedAt: log.createdAt,
        requestedById: parsed.requestedById,
        requestedByName: parsed.requestedByName,
        reviewedAt: null,
        reviewedById: null,
        reviewedByName: null,
        reviewNote: null,
        diffFromLockedSnapshot: parsed.diffFromLockedSnapshot
      });
      continue;
    }

    const parsed = parseReopenReviewPayload(log.payload);
    if (!parsed || (month && parsed.month !== month)) {
      continue;
    }
    const current = requests.get(parsed.requestId);
    if (!current) {
      continue;
    }
    current.status = parsed.decision;
    current.reviewedAt = log.createdAt;
    current.reviewedById = parsed.reviewedById;
    current.reviewedByName = parsed.reviewedByName;
    current.reviewNote = parsed.reviewNote;
  }

  return [...requests.values()].sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
}

export async function getPendingMonthCloseReopenRequest(companyId: string, month: string) {
  const requests = await getMonthCloseReopenRequests(companyId, month, 30);
  return requests.find((request) => request.status === "PENDING") ?? null;
}

export async function requestMonthReopen(
  actor: Actor & Pick<User, "name">,
  input: {
    month: string;
    reason: string;
    diffFromLockedSnapshot?: Prisma.InputJsonValue;
  }
) {
  const requestId = `${input.month}:${Date.now()}`;
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("재오픈 요청 사유를 입력하세요.");
  }

  await writeAuditSnapshot({
    actor,
    action: "month_close.reopen_requested",
    targetType: "month_close_reopen_request",
    targetId: requestId,
    payload: {
      month: input.month,
      reason,
      requestedById: actor.id,
      requestedByName: actor.name,
      diffFromLockedSnapshot: input.diffFromLockedSnapshot ?? null
    }
  });

  return {
    requestId,
    month: input.month,
    reason
  };
}

export async function reviewMonthReopenRequest(
  actor: Actor & Pick<User, "name">,
  input: {
    requestId: string;
    decision: "APPROVED" | "REJECTED";
    reviewNote?: string;
  }
) {
  const requestLog = await prisma.auditLog.findFirst({
    where: {
      companyId: actor.companyId,
      action: "month_close.reopen_requested",
      targetType: "month_close_reopen_request",
      targetId: input.requestId
    }
  });
  const requestPayload = parseReopenRequestPayload(requestLog?.payload);
  if (!requestLog || !requestPayload) {
    throw new Error("재오픈 요청을 찾을 수 없습니다.");
  }

  const pending = await getPendingMonthCloseReopenRequest(actor.companyId, requestPayload.month);
  if (!pending || pending.requestId !== input.requestId) {
    throw new Error("이미 처리된 재오픈 요청입니다.");
  }

  let reopened = null;
  if (input.decision === "APPROVED") {
    reopened = await reopenMonth(actor, {
      month: requestPayload.month,
      reason: requestPayload.reason,
      detail: {
        requestId: input.requestId,
        approvedBy: actor.name,
        reviewNote: input.reviewNote ?? null,
        diffFromLockedSnapshot: requestPayload.diffFromLockedSnapshot ?? null
      } satisfies Prisma.JsonObject
    });
  }

  await writeAuditSnapshot({
    actor,
    action: "month_close.reopen_reviewed",
    targetType: "month_close_reopen_request",
    targetId: input.requestId,
    payload: {
      requestId: input.requestId,
      month: requestPayload.month,
      decision: input.decision,
      reviewNote: input.reviewNote?.trim() || null,
      reviewedById: actor.id,
      reviewedByName: actor.name
    }
  });

  return {
    request: await getPendingMonthCloseReopenRequest(actor.companyId, requestPayload.month),
    reopened
  };
}

export function buildMonthCloseDiff(previousSummary: unknown, nextSummary: unknown) {
  const previous = getObject(previousSummary);
  const next = getObject(nextSummary);
  if (!previous || !next) {
    return null;
  }

  const previousBlocking = getNumberMap(previous.blockingSummary) ?? {};
  const nextBlocking = getNumberMap(next.blockingSummary) ?? {};
  const previousTotals = getNumberMap(previous.totals) ?? {};
  const nextTotals = getNumberMap(next.totals) ?? {};
  const keys = new Set([
    ...Object.keys(previousBlocking),
    ...Object.keys(nextBlocking),
    ...Object.keys(previousTotals),
    ...Object.keys(nextTotals)
  ]);

  const diffs = [...keys].map((key) => {
    const from = previousBlocking[key] ?? previousTotals[key] ?? 0;
    const to = nextBlocking[key] ?? nextTotals[key] ?? 0;
    return {
      key,
      from,
      to,
      delta: to - from
    };
  });

  const changed = diffs.filter((entry) => entry.delta !== 0);
  if (changed.length === 0) {
    return {
      changed: false,
      items: []
    };
  }

  return {
    changed: true,
    items: changed
  };
}

export async function getMonthCloseRecord(companyId: string, month: string) {
  return prisma.monthClose.findUnique({
    where: {
      companyId_month: {
        companyId,
        month
      }
    },
    include: {
      lockedBy: true,
      reopenedBy: true,
      payrollAppliedBy: true
    }
  });
}

export async function getRecentMonthCloses(companyId: string, take = 6) {
  return prisma.monthClose.findMany({
    where: {
      companyId
    },
    include: {
      lockedBy: true,
      reopenedBy: true,
      payrollAppliedBy: true
    },
    orderBy: {
      month: "desc"
    },
    take
  });
}

export async function getMonthCloseEventHistory(companyId: string, month: string, take = 10) {
  const monthClose = await prisma.monthClose.findUnique({
    where: {
      companyId_month: {
        companyId,
        month
      }
    },
    select: {
      id: true
    }
  });

  if (!monthClose) {
    return [];
  }

  return prisma.monthCloseEvent.findMany({
    where: {
      monthCloseId: monthClose.id
    },
    include: {
      actor: true
    },
    orderBy: {
      createdAt: "desc"
    },
    take
  });
}

export async function assertMonthOpen(companyId: string, month: string, lockedMessage = "마감이 확정된 월은 수정할 수 없습니다.") {
  const monthClose = await prisma.monthClose.findUnique({
    where: {
      companyId_month: {
        companyId,
        month
      }
    },
    select: {
      status: true
    }
  });

  if (monthClose?.status === MonthCloseStatus.CLOSED) {
    throw new Error(lockedMessage);
  }
}

export async function assertDateMonthOpen(companyId: string, date: Date | string, lockedMessage?: string) {
  return assertMonthOpen(companyId, getMonthString(date), lockedMessage);
}

export async function assertMonthRangeOpen(companyId: string, startDate: string, endDate: string, lockedMessage?: string) {
  for (const month of getMonthStringsInRange(startDate, endDate)) {
    await assertMonthOpen(companyId, month, lockedMessage);
  }
}

async function appendMonthCloseEvent(input: {
  monthCloseId: string;
  companyId: string;
  actorUserId?: string | null;
  type: MonthCloseEventType;
  detail?: Prisma.InputJsonValue;
}) {
  return prisma.monthCloseEvent.create({
    data: {
      monthCloseId: input.monthCloseId,
      companyId: input.companyId,
      actorUserId: input.actorUserId ?? null,
      type: input.type,
      detail: input.detail ?? Prisma.JsonNull
    },
    include: {
      actor: true
    }
  });
}

export async function closeMonth(
  actor: Actor,
  input: {
    month: string;
    summary: Prisma.InputJsonValue;
  }
) {
  if (!canViewReports(actor.role)) {
    throw new Error("월 마감 권한이 없습니다.");
  }

  const previous = await getMonthCloseRecord(actor.companyId, input.month);
  const diff = buildMonthCloseDiff(previous?.summary ?? null, input.summary);

  const monthClose = await prisma.monthClose.upsert({
    where: {
      companyId_month: {
        companyId: actor.companyId,
        month: input.month
      }
    },
    create: {
      companyId: actor.companyId,
      month: input.month,
      status: MonthCloseStatus.CLOSED,
      summary: input.summary,
      lockedAt: new Date(),
      lockedById: actor.id,
      payrollSyncStatus: PayrollSyncStatus.PENDING
    },
    update: {
      status: MonthCloseStatus.CLOSED,
      summary: input.summary,
      lockedAt: new Date(),
      lockedById: actor.id,
      payrollSyncStatus: PayrollSyncStatus.PENDING,
      payrollAppliedAt: null,
      payrollAppliedById: null,
      reopenedAt: null,
      reopenedById: null,
      reopenReason: null
    },
    include: {
      lockedBy: true,
      reopenedBy: true,
      payrollAppliedBy: true
    }
  });

  await appendMonthCloseEvent({
    monthCloseId: monthClose.id,
    companyId: actor.companyId,
    actorUserId: actor.id,
    type: MonthCloseEventType.CLOSED,
    detail: {
      summary: input.summary,
      diffFromPreviousClose: diff
    } as Prisma.InputJsonValue
  });

  return monthClose;
}

export async function reopenMonth(
  actor: Actor,
  input: {
    month: string;
    reason: string;
    detail?: Prisma.InputJsonValue;
  }
) {
  if (!canViewReports(actor.role)) {
    throw new Error("월 마감 권한이 없습니다.");
  }

  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("재오픈 사유를 입력하세요.");
  }

  const monthClose = await prisma.monthClose.upsert({
    where: {
      companyId_month: {
        companyId: actor.companyId,
        month: input.month
      }
    },
    create: {
      companyId: actor.companyId,
      month: input.month,
      status: MonthCloseStatus.OPEN,
      reopenedAt: new Date(),
      reopenedById: actor.id,
      reopenReason: reason,
      payrollSyncStatus: PayrollSyncStatus.PENDING
    },
    update: {
      status: MonthCloseStatus.OPEN,
      reopenedAt: new Date(),
      reopenedById: actor.id,
      reopenReason: reason,
      payrollSyncStatus: PayrollSyncStatus.PENDING,
      payrollAppliedAt: null,
      payrollAppliedById: null
    },
    include: {
      lockedBy: true,
      reopenedBy: true,
      payrollAppliedBy: true
    }
  });

  await appendMonthCloseEvent({
    monthCloseId: monthClose.id,
    companyId: actor.companyId,
    actorUserId: actor.id,
    type: MonthCloseEventType.REOPENED,
    detail: {
      reason,
      reopenContext: input.detail ?? null
    } as Prisma.InputJsonValue
  });

  return monthClose;
}

export async function applyMonthClosePayroll(
  actor: Actor,
  input: {
    month: string;
    detail?: Prisma.InputJsonValue;
  }
) {
  if (!canViewReports(actor.role)) {
    throw new Error("급여 반영 권한이 없습니다.");
  }

  const current = await prisma.monthClose.findUnique({
    where: {
      companyId_month: {
        companyId: actor.companyId,
        month: input.month
      }
    }
  });

  if (!current || current.status !== MonthCloseStatus.CLOSED) {
    throw new Error("확정된 월만 급여 반영 상태로 변경할 수 있습니다.");
  }

  const monthClose = await prisma.monthClose.update({
    where: {
      id: current.id
    },
    data: {
      payrollSyncStatus: PayrollSyncStatus.APPLIED,
      payrollAppliedAt: new Date(),
      payrollAppliedById: actor.id
    },
    include: {
      lockedBy: true,
      reopenedBy: true,
      payrollAppliedBy: true
    }
  });

  await appendMonthCloseEvent({
    monthCloseId: monthClose.id,
    companyId: actor.companyId,
    actorUserId: actor.id,
    type: MonthCloseEventType.PAYROLL_APPLIED,
    detail: input.detail
  });

  return monthClose;
}

export async function markMonthClosePayrollPending(
  actor: Actor,
  input: {
    month: string;
    detail?: Prisma.InputJsonValue;
  }
) {
  if (!canViewReports(actor.role)) {
    throw new Error("급여 반영 권한이 없습니다.");
  }

  const current = await prisma.monthClose.findUnique({
    where: {
      companyId_month: {
        companyId: actor.companyId,
        month: input.month
      }
    }
  });

  if (!current) {
    throw new Error("월 마감 기록을 찾을 수 없습니다.");
  }

  const monthClose = await prisma.monthClose.update({
    where: {
      id: current.id
    },
    data: {
      payrollSyncStatus: PayrollSyncStatus.PENDING,
      payrollAppliedAt: null,
      payrollAppliedById: null
    },
    include: {
      lockedBy: true,
      reopenedBy: true,
      payrollAppliedBy: true
    }
  });

  await appendMonthCloseEvent({
    monthCloseId: monthClose.id,
    companyId: actor.companyId,
    actorUserId: actor.id,
    type: MonthCloseEventType.PAYROLL_PENDING,
    detail: input.detail
  });

  return monthClose;
}

export async function recordMonthCloseExport(input: {
  actor: Actor;
  month: string;
  detail?: Prisma.InputJsonValue;
}) {
  const current = await prisma.monthClose.findUnique({
    where: {
      companyId_month: {
        companyId: input.actor.companyId,
        month: input.month
      }
    }
  });

  if (!current) {
    return null;
  }

  return appendMonthCloseEvent({
    monthCloseId: current.id,
    companyId: input.actor.companyId,
    actorUserId: input.actor.id,
    type: MonthCloseEventType.EXPORT,
    detail: input.detail
  });
}

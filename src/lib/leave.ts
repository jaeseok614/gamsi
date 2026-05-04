import {
  ApprovalStatus,
  ApprovalType,
  LeaveType,
  type ApprovalRequest,
  type User,
  type WorkPolicy
} from "@/generated/prisma";

import {
  buildHolidayDateSet,
  getAnnualLeaveCycleStart,
  getAnnualLeaveEntitlement,
  getCompanyHolidays,
  getCurrentWorkPolicy
} from "@/lib/policy-engine";
import { prisma } from "@/lib/prisma";
import { dateOnly, getKstDateString } from "@/lib/time";

type AnnualLeaveRequestShape = Pick<
  ApprovalRequest,
  "leaveType" | "leaveDuration" | "leaveStartDate" | "leaveEndDate" | "requestedLeaveMinutes"
>;

type LeaveBalanceAdjustment = {
  auditLogId: string;
  userId: string;
  effectiveDate: string;
  deltaDays: number;
  reason: string;
  kind: "ADJUSTMENT" | "REVERSAL";
  status: "ACTIVE" | "REVERSED" | "REVERSAL";
  reversalOfAuditLogId: string | null;
  reversedByAuditLogId: string | null;
  actorName?: string | null;
  createdAt: Date;
};

function addDays(dateString: string, offset: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function nextCycleStart(
  cycleStart: string,
  joinedAt: string,
  annualLeaveBasis: WorkPolicy["annualLeaveBasis"]
) {
  if (annualLeaveBasis === "CALENDAR_YEAR") {
    return `${String(Number(cycleStart.slice(0, 4)) + 1).padStart(4, "0")}-01-01`;
  }

  const [, month, day] = joinedAt.split("-").map(Number);
  const nextYear = Number(cycleStart.slice(0, 4)) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getCycleEnd(
  cycleStart: string,
  joinedAt: string,
  annualLeaveBasis: WorkPolicy["annualLeaveBasis"]
) {
  return addDays(nextCycleStart(cycleStart, joinedAt, annualLeaveBasis), -1);
}

function rangeOverlap(startA: string, endA: string, startB: string, endB: string) {
  const start = startA > startB ? startA : startB;
  const end = endA < endB ? endA : endB;
  if (start > end) {
    return null;
  }
  return { start, end };
}

function isWeekend(dateString: string) {
  const day = new Date(`${dateString}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function countWorkingDays(startDate: string, endDate: string, holidayDateSet: Set<string>) {
  let cursor = startDate;
  let days = 0;

  while (cursor <= endDate) {
    if (!isWeekend(cursor) && !holidayDateSet.has(cursor)) {
      days += 1;
    }
    cursor = addDays(cursor, 1);
  }

  return days;
}

function roundDays(days: number) {
  return Number(days.toFixed(2));
}

function getObjectRecord(payload: unknown) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

function parseLeaveBalanceAdjustmentPayload(payload: unknown) {
  const record = getObjectRecord(payload);
  if (!record) {
    return null;
  }

  const effectiveDate = typeof record.effectiveDate === "string" ? record.effectiveDate.trim() : "";
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  const leaveType = typeof record.leaveType === "string" ? record.leaveType : "ANNUAL";
  const reversalOfAuditLogId =
    typeof record.reversalOfAuditLogId === "string" && record.reversalOfAuditLogId.trim()
      ? record.reversalOfAuditLogId.trim()
      : null;
  const rawDeltaDays = record.deltaDays;
  const deltaDays =
    typeof rawDeltaDays === "number" ? rawDeltaDays : typeof rawDeltaDays === "string" ? Number(rawDeltaDays) : NaN;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !Number.isFinite(deltaDays) || leaveType !== "ANNUAL") {
    return null;
  }

  return {
    effectiveDate,
    deltaDays: roundDays(deltaDays),
    reason,
    reversalOfAuditLogId
  };
}

export type AnnualLeaveCycleSegment = {
  startDate: string;
  endDate: string;
  cycleStart: string;
  cycleEnd: string;
};

export function splitAnnualLeaveRangeByCycle(input: {
  joinedAt: string;
  annualLeaveBasis: WorkPolicy["annualLeaveBasis"];
  startDate: string;
  endDate: string;
}) {
  const segments: AnnualLeaveCycleSegment[] = [];
  let cursor = input.startDate;

  while (cursor <= input.endDate) {
    const cycleStart = getAnnualLeaveCycleStart({
      joinedAt: input.joinedAt,
      asOfDate: cursor,
      annualLeaveBasis: input.annualLeaveBasis
    });
    const cycleEnd = getCycleEnd(cycleStart, input.joinedAt, input.annualLeaveBasis);
    const endDate = input.endDate < cycleEnd ? input.endDate : cycleEnd;

    segments.push({
      startDate: cursor,
      endDate,
      cycleStart,
      cycleEnd
    });

    cursor = addDays(endDate, 1);
  }

  return segments;
}

export function getAnnualLeaveRequestDays(
  request: AnnualLeaveRequestShape,
  policy: Pick<WorkPolicy, "standardDailyMinutes">,
  holidayDateSet: Set<string>,
  range?: {
    startDate: string;
    endDate: string;
  }
) {
  if (request.leaveType !== LeaveType.ANNUAL || !request.leaveStartDate || !request.leaveEndDate) {
    return 0;
  }

  const requestStart = request.leaveStartDate.toISOString().slice(0, 10);
  const requestEnd = request.leaveEndDate.toISOString().slice(0, 10);
  const overlap = range ? rangeOverlap(requestStart, requestEnd, range.startDate, range.endDate) : { start: requestStart, end: requestEnd };
  if (!overlap) {
    return 0;
  }

  if (request.leaveDuration === "HOURLY") {
    if (overlap.start !== overlap.end || !request.requestedLeaveMinutes || policy.standardDailyMinutes <= 0) {
      return 0;
    }
    if (isWeekend(overlap.start) || holidayDateSet.has(overlap.start)) {
      return 0;
    }
    return roundDays(request.requestedLeaveMinutes / policy.standardDailyMinutes);
  }

  if (request.leaveDuration === "HALF_DAY_AM" || request.leaveDuration === "HALF_DAY_PM") {
    if (overlap.start !== overlap.end) {
      return 0;
    }
    if (isWeekend(overlap.start) || holidayDateSet.has(overlap.start)) {
      return 0;
    }
    return 0.5;
  }

  return countWorkingDays(overlap.start, overlap.end, holidayDateSet);
}

export type AnnualLeaveSummary = {
  userId: string;
  asOfDate: string;
  cycleStart: string;
  cycleEnd: string;
  carryoverExpiryDate: string;
  baseGrantDays: number;
  carryoverDays: number;
  grantedDays: number;
  approvedDays: number;
  pendingDays: number;
  manualAdjustmentDays: number;
  netRemainingDays: number;
  remainingDays: number;
  baseRemainingDays: number;
  carryoverRemainingDays: number;
  expiringCarryoverDays: number;
  remainingHalfDayUnits: number;
  remainingHourlyMinutes: number;
  availableToRequestDays: number;
  deficitDays: number;
  firstYearMonthlyDays: number;
};

export async function getAnnualLeaveSummaryMap(input: {
  companyId: string;
  users: Array<Pick<User, "id" | "joinedAt">>;
  asOfDate?: string;
  excludePendingRequestIds?: string[];
}) {
  const asOfDate = input.asOfDate ?? getKstDateString();
  const policy = await getCurrentWorkPolicy(input.companyId, asOfDate);
  const users = input.users.map((user) => {
    const joinedAt = user.joinedAt.toISOString().slice(0, 10);
    const cycleStart = getAnnualLeaveCycleStart({
      joinedAt,
      asOfDate,
      annualLeaveBasis: policy.annualLeaveBasis
    });
    const cycleEnd = getCycleEnd(cycleStart, joinedAt, policy.annualLeaveBasis);
    return {
      id: user.id,
      joinedAt,
      cycleStart,
      cycleEnd
    };
  });

  if (users.length === 0) {
    return {
      policy,
      summaries: new Map<string, AnnualLeaveSummary>()
    };
  }

  const userIds = users.map((user) => user.id);
  const minCycleStart = users.reduce((min, user) => (user.cycleStart < min ? user.cycleStart : min), users[0].cycleStart);
  const maxCycleEnd = users.reduce((max, user) => (user.cycleEnd > max ? user.cycleEnd : max), users[0].cycleEnd);
  const excludedPendingIds = new Set(input.excludePendingRequestIds ?? []);

  const [holidays, annualRequests, adjustmentLogs] = await Promise.all([
    getCompanyHolidays(input.companyId, minCycleStart, maxCycleEnd),
    prisma.approvalRequest.findMany({
      where: {
        companyId: input.companyId,
        requesterId: {
          in: userIds
        },
        type: ApprovalType.LEAVE,
        leaveType: LeaveType.ANNUAL,
        status: {
          in: [ApprovalStatus.APPROVED, ApprovalStatus.PENDING]
        },
        leaveStartDate: {
          lte: dateOnly(maxCycleEnd)
        },
        leaveEndDate: {
          gte: dateOnly(minCycleStart)
        }
      },
      select: {
        id: true,
        requesterId: true,
        status: true,
        leaveType: true,
        leaveDuration: true,
        leaveStartDate: true,
        leaveEndDate: true,
        requestedLeaveMinutes: true
      }
    }),
    prisma.auditLog.findMany({
      where: {
        companyId: input.companyId,
        action: "leave.balance.adjusted",
        targetType: "user",
        targetId: {
          in: userIds
        }
      },
      select: {
        targetId: true,
        payload: true
      }
    })
  ]);

  const holidayDateSet = buildHolidayDateSet(holidays);
  const requestsByUser = new Map<string, typeof annualRequests>();
  for (const request of annualRequests) {
    const rows = requestsByUser.get(request.requesterId) ?? [];
    rows.push(request);
    requestsByUser.set(request.requesterId, rows);
  }

  const adjustmentsByUser = new Map<string, Array<{ effectiveDate: string; deltaDays: number }>>();
  for (const log of adjustmentLogs) {
    const parsed = parseLeaveBalanceAdjustmentPayload(log.payload);
    if (!parsed) {
      continue;
    }
    const rows = adjustmentsByUser.get(log.targetId) ?? [];
    rows.push({
      effectiveDate: parsed.effectiveDate,
      deltaDays: parsed.deltaDays
    });
    adjustmentsByUser.set(log.targetId, rows);
  }

  const summaries = new Map<string, AnnualLeaveSummary>();
  for (const user of users) {
    const userRequests = requestsByUser.get(user.id) ?? ([] as typeof annualRequests);
    const userAdjustments = adjustmentsByUser.get(user.id) ?? [];
    const approvedDays = roundDays(
      userRequests
        .filter((request) => request.status === ApprovalStatus.APPROVED)
        .reduce(
          (sum, request) =>
            sum +
            getAnnualLeaveRequestDays(request, policy, holidayDateSet, {
              startDate: user.cycleStart,
              endDate: user.cycleEnd
            }),
          0
        )
    );

    const pendingDays = roundDays(
      userRequests
        .filter((request) => request.status === ApprovalStatus.PENDING && !excludedPendingIds.has(request.id))
        .reduce(
          (sum, request) =>
            sum +
            getAnnualLeaveRequestDays(request, policy, holidayDateSet, {
              startDate: user.cycleStart,
              endDate: user.cycleEnd
            }),
          0
        )
    );

    const manualAdjustmentDays = roundDays(
      userAdjustments
        .filter((entry) => entry.effectiveDate >= user.cycleStart && entry.effectiveDate <= user.cycleEnd)
        .reduce((sum, entry) => sum + entry.deltaDays, 0)
    );

    const entitlement = getAnnualLeaveEntitlement({
      user: {
        joinedAt: new Date(`${user.joinedAt}T00:00:00.000Z`)
      } as Pick<User, "joinedAt">,
      policy,
      asOfDate,
      usedDaysInCycle: 0
    });

    const grantedDays = roundDays(entitlement.grantedDays);
    const netRemainingDays = roundDays(grantedDays + manualAdjustmentDays - approvedDays);
    const remainingDays = Math.max(0, netRemainingDays);
    const carryoverRemainingDays = roundDays(Math.max(0, entitlement.carryoverDays - approvedDays));
    const baseConsumedDays = Math.max(0, approvedDays - entitlement.carryoverDays);
    const baseRemainingDays = roundDays(Math.max(0, entitlement.baseGrantDays + manualAdjustmentDays - baseConsumedDays));
    const expiringCarryoverDays = asOfDate <= entitlement.carryoverExpiryDate ? carryoverRemainingDays : 0;
    const availableToRequestDays = Math.max(0, roundDays(netRemainingDays - pendingDays));
    const deficitDays = Math.max(0, roundDays(-netRemainingDays));
    const remainingHalfDayUnits = Math.max(0, Math.floor(remainingDays * 2));
    const remainingHourlyMinutes = Math.max(0, Math.round(remainingDays * policy.standardDailyMinutes));

    summaries.set(user.id, {
      userId: user.id,
      asOfDate,
      cycleStart: user.cycleStart,
      cycleEnd: user.cycleEnd,
      carryoverExpiryDate: entitlement.carryoverExpiryDate,
      baseGrantDays: roundDays(entitlement.baseGrantDays),
      carryoverDays: roundDays(entitlement.carryoverDays),
      grantedDays,
      approvedDays,
      pendingDays,
      manualAdjustmentDays,
      netRemainingDays,
      remainingDays: roundDays(remainingDays),
      baseRemainingDays,
      carryoverRemainingDays,
      expiringCarryoverDays,
      remainingHalfDayUnits,
      remainingHourlyMinutes,
      availableToRequestDays,
      deficitDays,
      firstYearMonthlyDays: roundDays(entitlement.firstYearMonthlyDays)
    });
  }

  return {
    policy,
    summaries
  };
}

export async function getLeaveBalanceAdjustments(input: {
  companyId: string;
  userIds?: string[];
  startDate?: string;
  endDate?: string;
}) {
  const logs = await prisma.auditLog.findMany({
    where: {
      companyId: input.companyId,
      action: "leave.balance.adjusted",
      targetType: "user",
      targetId: input.userIds?.length ? { in: input.userIds } : undefined
    },
    include: {
      actor: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  const reversedByOriginalId = new Map<string, string>();
  const parsedLogs = logs
    .map((log) => {
      const parsed = parseLeaveBalanceAdjustmentPayload(log.payload);
      if (!parsed) {
        return null;
      }

      if (parsed.reversalOfAuditLogId) {
        reversedByOriginalId.set(parsed.reversalOfAuditLogId, log.id);
      }

      return {
        log,
        parsed
      };
    })
    .filter((entry): entry is { log: (typeof logs)[number]; parsed: NonNullable<ReturnType<typeof parseLeaveBalanceAdjustmentPayload>> } => Boolean(entry));

  const adjustments: LeaveBalanceAdjustment[] = [];
  for (const { log, parsed } of parsedLogs) {
    if (input.startDate && parsed.effectiveDate < input.startDate) {
      continue;
    }
    if (input.endDate && parsed.effectiveDate > input.endDate) {
      continue;
    }

    const kind = parsed.reversalOfAuditLogId ? "REVERSAL" : "ADJUSTMENT";
    const reversedByAuditLogId = reversedByOriginalId.get(log.id) ?? null;
    adjustments.push({
      auditLogId: log.id,
      userId: log.targetId,
      effectiveDate: parsed.effectiveDate,
      deltaDays: parsed.deltaDays,
      reason: parsed.reason,
      kind,
      status: kind === "REVERSAL" ? "REVERSAL" : reversedByAuditLogId ? "REVERSED" : "ACTIVE",
      reversalOfAuditLogId: parsed.reversalOfAuditLogId,
      reversedByAuditLogId,
      actorName: log.actor?.name ?? null,
      createdAt: log.createdAt
    });
  }

  return adjustments;
}

export async function getAnnualLeaveSummaryForUser(input: {
  companyId: string;
  user: Pick<User, "id" | "joinedAt">;
  asOfDate?: string;
  excludePendingRequestIds?: string[];
}) {
  const { policy, summaries } = await getAnnualLeaveSummaryMap({
    companyId: input.companyId,
    users: [input.user],
    asOfDate: input.asOfDate,
    excludePendingRequestIds: input.excludePendingRequestIds
  });

  return {
    policy,
    summary: summaries.get(input.user.id)!
  };
}

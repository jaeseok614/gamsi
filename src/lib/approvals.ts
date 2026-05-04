import { AdjustmentType, ApprovalStatus, ApprovalType, type User } from "@/generated/prisma";

import { getManagedUsers } from "@/lib/manager";
import { prisma } from "@/lib/prisma";
import { dateOnly, kstDayBounds } from "@/lib/time";

type Actor = Pick<User, "id" | "companyId" | "role" | "teamId">;

export type ApprovalInboxFilters = {
  type?: ApprovalType | "";
  teamId?: string;
  from?: string;
  to?: string;
};

const APPROVAL_TYPES = new Set(Object.values(ApprovalType));
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function approvalAgeHours(createdAt: Date) {
  return Math.max(1, Math.round((Date.now() - createdAt.getTime()) / (60 * 60 * 1000)));
}

function approvalAgeLabel(hours: number) {
  if (hours >= 48) {
    return `${Math.floor(hours / 24)}일 ${hours % 24}시간`;
  }
  return `${hours}시간`;
}

function approvalSlaStatus(hours: number) {
  if (hours >= 48) {
    return "OVERDUE" as const;
  }
  if (hours >= 24) {
    return "AT_RISK" as const;
  }
  return "ON_TRACK" as const;
}

export async function getApprovalInbox(actor: Actor, rawFilters: ApprovalInboxFilters = {}) {
  const managedUsers = await getManagedUsers(actor);
  const userIds = managedUsers.map((user) => user.id);
  const managedTeamMap = new Map(
    managedUsers
      .filter((user) => user.team)
      .map((user) => [user.team!.id, user.team!.name])
  );

  const filters: ApprovalInboxFilters = {
    type: rawFilters.type && APPROVAL_TYPES.has(rawFilters.type) ? rawFilters.type : "",
    teamId: rawFilters.teamId && managedTeamMap.has(rawFilters.teamId) ? rawFilters.teamId : "",
    from: rawFilters.from && DATE_PATTERN.test(rawFilters.from) ? rawFilters.from : "",
    to: rawFilters.to && DATE_PATTERN.test(rawFilters.to) ? rawFilters.to : ""
  };

  const fromStart = filters.from ? kstDayBounds(filters.from).start : undefined;
  const toEnd = filters.to ? kstDayBounds(filters.to).end : undefined;

  const [approvals, recentMissingAdjustments] = await Promise.all([
    prisma.approvalRequest.findMany({
      where: {
        companyId: actor.companyId,
        requesterId: {
          in: userIds
        },
        status: ApprovalStatus.PENDING,
        type: filters.type || undefined,
        createdAt: fromStart || toEnd ? { gte: fromStart, lt: toEnd } : undefined,
        requester: filters.teamId
          ? {
              is: {
                teamId: filters.teamId
              }
            }
          : undefined
      },
      include: {
        requester: {
          include: {
            team: true
          }
        },
        reviewer: true,
        session: true,
        attachments: {
          orderBy: {
            createdAt: "asc"
          }
        }
      },
      orderBy: [
        { createdAt: "asc" },
        { requester: { name: "asc" } }
      ]
    }),
    prisma.approvalRequest.findMany({
      where: {
        companyId: actor.companyId,
        requesterId: {
          in: userIds
        },
        type: ApprovalType.ADJUSTMENT,
        adjustmentType: {
          in: [AdjustmentType.MISSING_CHECK_IN, AdjustmentType.MISSING_CHECK_OUT]
        },
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        }
      },
      select: {
        requesterId: true
      }
    })
  ]);
  const recentMissingAdjustmentCountByUser = new Map<string, number>();
  for (const row of recentMissingAdjustments) {
    recentMissingAdjustmentCountByUser.set(
      row.requesterId,
      (recentMissingAdjustmentCountByUser.get(row.requesterId) ?? 0) + 1
    );
  }

  const decoratedApprovals = approvals.map((approval) => {
    const ageHours = approvalAgeHours(approval.createdAt);
    const repeatedMissingAdjustments = recentMissingAdjustmentCountByUser.get(approval.requesterId) ?? 0;
    return {
      ...approval,
      ageHours,
      ageLabel: approvalAgeLabel(ageHours),
      slaStatus: approvalSlaStatus(ageHours),
      repeatedMissingFlag: repeatedMissingAdjustments >= 3,
      repeatedMissingAdjustments
    };
  });

  return {
    approvals: decoratedApprovals,
    filters,
    teams: [...managedTeamMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    stats: {
      total: decoratedApprovals.length,
      leave: decoratedApprovals.filter((approval) => approval.type === ApprovalType.LEAVE).length,
      adjustment: decoratedApprovals.filter((approval) => approval.type === ApprovalType.ADJUSTMENT).length,
      overtime: decoratedApprovals.filter((approval) => approval.type === ApprovalType.OVERTIME).length,
      atRisk: decoratedApprovals.filter((approval) => approval.slaStatus === "AT_RISK").length,
      overdue: decoratedApprovals.filter((approval) => approval.slaStatus === "OVERDUE").length
    }
  };
}

export async function getApprovalRelatedSchedule(input: {
  companyId: string;
  requesterId: string;
  targetDate: Date | null;
}) {
  if (!input.targetDate) {
    return null;
  }

  return prisma.workSchedule.findUnique({
    where: {
      userId_workDate: {
        userId: input.requesterId,
        workDate: dateOnly(input.targetDate.toISOString().slice(0, 10))
      }
    }
  });
}

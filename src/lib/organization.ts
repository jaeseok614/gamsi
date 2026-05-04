import { EventType, WorkStatus, type User } from "@/generated/prisma";

import { canManage } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateOnly, getKstDateString, kstDayBounds, kstWeekBounds } from "@/lib/time";

type Actor = Pick<User, "id" | "companyId" | "role" | "teamId">;

export type OrganizationStatusFilter = "ALL" | "WORKING" | "AWAY" | "LEAVE" | "OFFLINE";

const ORGANIZATION_STATUS_FILTERS: OrganizationStatusFilter[] = ["ALL", "WORKING", "AWAY", "LEAVE", "OFFLINE"];

export function normalizeOrganizationStatusFilter(value?: string | null): OrganizationStatusFilter {
  return ORGANIZATION_STATUS_FILTERS.includes(value as OrganizationStatusFilter)
    ? (value as OrganizationStatusFilter)
    : "ALL";
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    WORKING: "근무중",
    MEETING: "회의",
    OUTSIDE: "외근",
    BUSINESS_TRIP: "출장",
    TRAINING: "교육",
    BREAK: "휴게",
    OTHER: "기타",
    OFFLINE: "오프라인",
    LEAVE: "휴가"
  };
  return labels[status] ?? status;
}

function statusCategory(status: string): OrganizationStatusFilter {
  if (status === "LEAVE") {
    return "LEAVE";
  }
  if (status === WorkStatus.OFFLINE) {
    return "OFFLINE";
  }
  if (status === WorkStatus.WORKING) {
    return "WORKING";
  }
  return "AWAY";
}

function statusTone(category: OrganizationStatusFilter) {
  if (category === "WORKING") {
    return "green";
  }
  if (category === "AWAY" || category === "LEAVE") {
    return "yellow";
  }
  return "gray";
}

function employmentTypeLabel(value?: string | null) {
  if (value === "part_time") {
    return "파트타임";
  }
  if (value === "contract") {
    return "계약직";
  }
  return "정규직";
}

async function getSensitiveUserIds(actor: Actor) {
  if (actor.role === "ADMIN" || actor.role === "HR") {
    return null;
  }

  if (!canManage(actor.role)) {
    return new Set([actor.id]);
  }

  const teams = await prisma.team.findMany({
    where: {
      companyId: actor.companyId,
      OR: [{ managerUserId: actor.id }, actor.teamId ? { id: actor.teamId } : { id: "__none__" }]
    },
    select: {
      id: true
    }
  });
  const users = await prisma.user.findMany({
    where: {
      companyId: actor.companyId,
      isActive: true,
      OR: [
        { id: actor.id },
        {
          teamId: {
            in: teams.map((team) => team.id)
          }
        }
      ]
    },
    select: {
      id: true
    }
  });

  return new Set(users.map((user) => user.id));
}

export async function getOrganizationDashboard(actor: Actor, input?: {
  selectedUserId?: string | null;
  teamId?: string | null;
  status?: string | null;
  search?: string | null;
}) {
  const today = getKstDateString();
  const todayDate = dateOnly(today);
  const statusFilter = normalizeOrganizationStatusFilter(input?.status);
  const teamId = input?.teamId?.trim() || "";
  const search = input?.search?.trim().toLowerCase() || "";
  const { start: todayStart, end: todayEnd } = kstDayBounds(today);
  const { start: weekStart, end: weekEnd } = kstWeekBounds(today);

  const [teams, users, events, sessions, schedules, weeklySessions, leaveApprovals, authSessions, sensitiveUserIds] =
    await Promise.all([
      prisma.team.findMany({
        where: {
          companyId: actor.companyId
        },
        include: {
          manager: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              jobTitle: true
            }
          }
        },
        orderBy: [{ isActive: "desc" }, { name: "asc" }]
      }),
      prisma.user.findMany({
        where: {
          companyId: actor.companyId,
          isActive: true
        },
        include: {
          team: true
        },
        orderBy: [{ team: { name: "asc" } }, { name: "asc" }]
      }),
      prisma.attendanceEvent.findMany({
        where: {
          companyId: actor.companyId,
          occurredAt: {
            gte: todayStart,
            lt: todayEnd
          }
        },
        orderBy: {
          occurredAt: "desc"
        }
      }),
      prisma.workSession.findMany({
        where: {
          companyId: actor.companyId,
          workDate: todayDate
        }
      }),
      prisma.workSchedule.findMany({
        where: {
          companyId: actor.companyId,
          workDate: todayDate
        }
      }),
      prisma.workSession.findMany({
        where: {
          companyId: actor.companyId,
          workDate: {
            gte: weekStart,
            lt: weekEnd
          }
        }
      }),
      prisma.approvalRequest.findMany({
        where: {
          companyId: actor.companyId,
          type: "LEAVE",
          status: "APPROVED",
          leaveStartDate: {
            lte: todayDate
          },
          leaveEndDate: {
            gte: todayDate
          }
        },
        select: {
          requesterId: true,
          leaveType: true,
          leaveDuration: true,
          reason: true
        }
      }),
      prisma.authSession.findMany({
        where: {
          user: {
            companyId: actor.companyId,
            isActive: true
          },
          revokedAt: null,
          expiresAt: {
            gt: new Date()
          }
        },
        select: {
          userId: true,
          lastSeenAt: true
        },
        orderBy: {
          lastSeenAt: "desc"
        },
        take: 500
      }),
      getSensitiveUserIds(actor)
    ]);

  const latestEvents = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    if (!latestEvents.has(event.userId)) {
      latestEvents.set(event.userId, event);
    }
  }
  const sessionByUser = new Map(sessions.map((session) => [session.userId, session]));
  const scheduleByUser = new Map(schedules.map((schedule) => [schedule.userId, schedule]));
  const leaveByUser = new Map(leaveApprovals.map((approval) => [approval.requesterId, approval]));
  const lastSeenByUser = new Map<string, Date>();
  for (const session of authSessions) {
    if (!lastSeenByUser.has(session.userId)) {
      lastSeenByUser.set(session.userId, session.lastSeenAt);
    }
  }
  const weeklyMinutesByUser = new Map<string, number>();
  for (const session of weeklySessions) {
    weeklyMinutesByUser.set(
      session.userId,
      (weeklyMinutesByUser.get(session.userId) ?? 0) + session.calculatedWorkMinutes
    );
  }

  const rows = users.map((user) => {
    const latestEvent = latestEvents.get(user.id);
    const session = sessionByUser.get(user.id) ?? null;
    const leave = leaveByUser.get(user.id) ?? null;
    const rawStatus = leave
      ? "LEAVE"
      : latestEvent?.eventType === EventType.CHECK_OUT || session?.checkOutAt
        ? WorkStatus.OFFLINE
        : latestEvent?.status ?? (session?.checkInAt ? WorkStatus.WORKING : WorkStatus.OFFLINE);
    const category = statusCategory(rawStatus);
    const canViewSensitive = sensitiveUserIds === null || sensitiveUserIds.has(user.id);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      teamId: user.teamId,
      team: user.team
        ? {
            id: user.team.id,
            name: user.team.name,
            managerUserId: user.team.managerUserId
          }
        : null,
      employmentType: user.employmentType,
      employmentTypeLabel: employmentTypeLabel(user.employmentType),
      jobTitle: user.jobTitle,
      phoneNumber: user.phoneNumber,
      extensionNumber: user.extensionNumber,
      joinedAt: user.joinedAt,
      latestStatus: rawStatus,
      latestStatusLabel: statusLabel(rawStatus),
      statusCategory: category,
      statusTone: statusTone(category),
      todaySchedule: scheduleByUser.get(user.id) ?? null,
      session: canViewSensitive ? session : null,
      todayMinutes: canViewSensitive ? session?.calculatedWorkMinutes ?? 0 : null,
      weeklyMinutes: canViewSensitive ? weeklyMinutesByUser.get(user.id) ?? 0 : null,
      lastSeenAt: lastSeenByUser.get(user.id) ?? null,
      leave,
      canViewSensitive
    };
  });

  const searchableRows = rows.filter((row) => {
    if (teamId && row.teamId !== teamId) {
      return false;
    }
    if (statusFilter !== "ALL" && row.statusCategory !== statusFilter) {
      return false;
    }
    if (!search) {
      return true;
    }
    const haystack = [
      row.name,
      row.email,
      row.team?.name,
      row.jobTitle,
      row.phoneNumber,
      row.extensionNumber
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });

  const rowsByTeam = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.teamId ?? "__none__";
    rowsByTeam.set(key, [...(rowsByTeam.get(key) ?? []), row]);
  }
  const teamSummaries = [
    ...teams.map((team) => {
      const members = rowsByTeam.get(team.id) ?? [];
      return {
        id: team.id,
        name: team.name,
        isActive: team.isActive,
        manager: team.manager,
        members,
        memberCount: members.length,
        workingCount: members.filter((member) => member.statusCategory === "WORKING" || member.statusCategory === "AWAY").length,
        leaveCount: members.filter((member) => member.statusCategory === "LEAVE").length,
        offlineCount: members.filter((member) => member.statusCategory === "OFFLINE").length
      };
    }),
    {
      id: "__none__",
      name: "소속 없음",
      isActive: true,
      manager: null,
      members: rowsByTeam.get("__none__") ?? [],
      memberCount: rowsByTeam.get("__none__")?.length ?? 0,
      workingCount: (rowsByTeam.get("__none__") ?? []).filter((member) => member.statusCategory === "WORKING" || member.statusCategory === "AWAY").length,
      leaveCount: (rowsByTeam.get("__none__") ?? []).filter((member) => member.statusCategory === "LEAVE").length,
      offlineCount: (rowsByTeam.get("__none__") ?? []).filter((member) => member.statusCategory === "OFFLINE").length
    }
  ].filter((team) => team.memberCount > 0 || team.id !== "__none__");

  const selectedUserId = input?.selectedUserId && rows.some((row) => row.id === input.selectedUserId)
    ? input.selectedUserId
    : rows.some((row) => row.id === actor.id)
      ? actor.id
      : searchableRows[0]?.id ?? rows[0]?.id ?? null;
  const selectedUser = selectedUserId ? rows.find((row) => row.id === selectedUserId) ?? null : null;
  const selectedTeamManager = selectedUser?.team?.managerUserId
    ? rows.find((row) => row.id === selectedUser.team?.managerUserId) ?? null
    : null;
  const visibleSelectedEventUserIds = selectedUser?.canViewSensitive ? [selectedUser.id] : [];
  const [selectedEvents, selectedApprovals] = selectedUser
    ? await Promise.all([
        visibleSelectedEventUserIds.length > 0
          ? prisma.attendanceEvent.findMany({
              where: {
                companyId: actor.companyId,
                userId: {
                  in: visibleSelectedEventUserIds
                },
                occurredAt: {
                  gte: todayStart,
                  lt: todayEnd
                }
              },
              orderBy: {
                occurredAt: "desc"
              },
              take: 8
            })
          : [],
        selectedUser.canViewSensitive
          ? prisma.approvalRequest.findMany({
              where: {
                companyId: actor.companyId,
                requesterId: selectedUser.id
              },
              orderBy: {
                createdAt: "desc"
              },
              take: 5
            })
          : []
      ])
    : [[], []];

  return {
    today,
    filters: {
      teamId,
      status: statusFilter,
      search
    },
    teams: teamSummaries,
    users: searchableRows,
    selectedUser,
    selectedTeamManager,
    selectedEvents,
    selectedApprovals,
    stats: {
      totalUsers: rows.length,
      filteredUsers: searchableRows.length,
      teamCount: teams.filter((team) => team.isActive).length,
      workingUsers: rows.filter((row) => row.statusCategory === "WORKING" || row.statusCategory === "AWAY").length,
      leaveUsers: rows.filter((row) => row.statusCategory === "LEAVE").length,
      offlineUsers: rows.filter((row) => row.statusCategory === "OFFLINE").length,
      noTeamUsers: rows.filter((row) => !row.teamId).length
    },
    selectableTeams: teams
      .filter((team) => team.isActive)
      .map((team) => ({
        id: team.id,
        name: team.name
      })),
    selectedVisibleUserIds: unique(searchableRows.map((row) => row.id))
  };
}

import type { User } from "@/generated/prisma";

import { prisma } from "@/lib/prisma";
import { dateOnly, getKstDateString, kstDayBounds, kstWeekBounds } from "@/lib/time";

type Actor = Pick<User, "id" | "companyId" | "role" | "teamId">;

export async function getManagedUsers(actor: Actor) {
  if (actor.role === "ADMIN" || actor.role === "HR") {
    return prisma.user.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true
      },
      include: {
        team: true
      },
      orderBy: [{ team: { name: "asc" } }, { name: "asc" }]
    });
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

  return prisma.user.findMany({
    where: {
      companyId: actor.companyId,
      teamId: {
        in: teams.map((team) => team.id)
      },
      isActive: true
    },
    include: {
      team: true
    },
    orderBy: [{ team: { name: "asc" } }, { name: "asc" }]
  });
}

export async function getManagerDashboard(actor: Actor) {
  const today = getKstDateString();
  const users = await getManagedUsers(actor);
  const userIds = users.map((user) => user.id);
  const { start: todayStart, end: todayEnd } = kstDayBounds(today);
  const { start: weekStart, end: weekEnd } = kstWeekBounds(today);

  const [sessions, events, pendingApprovals, weeklySessions, todaySchedules] = await Promise.all([
    prisma.workSession.findMany({
      where: {
        userId: {
          in: userIds
        },
        workDate: dateOnly(today)
      }
    }),
    prisma.attendanceEvent.findMany({
      where: {
        userId: {
          in: userIds
        },
        occurredAt: {
          gte: todayStart,
          lt: todayEnd
        }
      },
      orderBy: {
        occurredAt: "desc"
      }
    }),
    prisma.approvalRequest.findMany({
      where: {
        companyId: actor.companyId,
        requesterId: {
          in: userIds
        },
        status: "PENDING"
      },
      include: {
        requester: {
          include: {
            team: true
          }
        },
        session: true
      },
      orderBy: {
        createdAt: "asc"
      }
    }),
    prisma.workSession.findMany({
      where: {
        userId: {
          in: userIds
        },
        workDate: {
          gte: weekStart,
          lt: weekEnd
        }
      }
    }),
    prisma.workSchedule.findMany({
      where: {
        userId: {
          in: userIds
        },
        workDate: dateOnly(today)
      }
    })
  ]);

  const latestEvents = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    if (!latestEvents.has(event.userId)) {
      latestEvents.set(event.userId, event);
    }
  }

  const sessionByUser = new Map(sessions.map((session) => [session.userId, session]));
  const scheduleByUser = new Map(todaySchedules.map((schedule) => [schedule.userId, schedule]));
  const weeklyMinutesByUser = new Map<string, number>();
  for (const session of weeklySessions) {
    weeklyMinutesByUser.set(
      session.userId,
      (weeklyMinutesByUser.get(session.userId) ?? 0) + session.calculatedWorkMinutes
    );
  }

  const teamRows = users.map((user) => {
    const latestEvent = latestEvents.get(user.id);
    const session = sessionByUser.get(user.id) ?? null;
    const latestStatus =
      latestEvent?.eventType === "CHECK_OUT" ? "OFFLINE" : latestEvent?.status ?? (session ? "WORKING" : "OFFLINE");

    return {
      user,
      session,
      todaySchedule: scheduleByUser.get(user.id) ?? null,
      latestStatus,
      weeklyMinutes: weeklyMinutesByUser.get(user.id) ?? 0
    };
  });

  return {
    teamRows,
    pendingApprovals,
    stats: {
      workingUsers: teamRows.filter((row) => row.latestStatus !== "OFFLINE").length,
      scheduledUsers: teamRows.filter((row) => row.todaySchedule).length,
      pendingApprovals: pendingApprovals.length,
      nearWeeklyLimitUsers: teamRows.filter((row) => row.weeklyMinutes >= 40 * 60).length,
      overWeeklyLimitUsers: teamRows.filter((row) => row.weeklyMinutes > 52 * 60).length
    }
  };
}

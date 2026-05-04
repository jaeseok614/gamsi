import { ApprovalStatus, ApprovalType, LeaveDuration, RiskType, type User } from "@/generated/prisma";

import { getManagedUsers } from "@/lib/manager";
import { prisma } from "@/lib/prisma";
import { listScheduleTemplates } from "@/lib/schedule-operations";
import { dateOnly, formatKstDate, formatKstTime, getKstDateString, kstWeekBounds } from "@/lib/time";

type Actor = Pick<User, "id" | "companyId" | "role" | "teamId">;

function addDays(dateString: string, offset: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export async function getEmployeeScheduleBoard(userId: string) {
  const today = getKstDateString();
  const endDate = addDays(today, 8);

  const [upcomingSchedules, recentRequests] = await Promise.all([
    prisma.workSchedule.findMany({
      where: {
        userId,
        workDate: {
          gte: dateOnly(today),
          lt: dateOnly(endDate)
        }
      },
      orderBy: {
        workDate: "asc"
      }
    }),
    prisma.approvalRequest.findMany({
      where: {
        requesterId: userId,
        type: {
          in: [ApprovalType.LEAVE, ApprovalType.ADJUSTMENT]
        }
      },
      include: {
        attachments: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 8
    })
  ]);

  return {
    today,
    todaySchedule: upcomingSchedules.find((schedule) => schedule.workDate.toISOString().slice(0, 10) === today) ?? null,
    upcomingSchedules,
    recentRequests
  };
}

export async function getManagedScheduleBoard(actor: Actor) {
  const users = await getManagedUsers(actor);
  const userIds = users.map((user) => user.id);
  const today = getKstDateString();
  const endDate = addDays(today, 8);
  const { start: weekStart, end: weekEnd, mondayString } = kstWeekBounds(today);

  const [schedules, weeklySchedules, weeklyLeaves, weeklyRisks, templates] = await Promise.all([
    prisma.workSchedule.findMany({
      where: {
        companyId: actor.companyId,
        userId: {
          in: userIds
        },
        workDate: {
          gte: dateOnly(today),
          lt: dateOnly(endDate)
        }
      },
      include: {
        user: {
          include: {
            team: true
          }
        }
      },
      orderBy: [{ workDate: "asc" }, { user: { name: "asc" } }]
    }),
    prisma.workSchedule.findMany({
      where: {
        companyId: actor.companyId,
        userId: {
          in: userIds
        },
        workDate: {
          gte: weekStart,
          lt: weekEnd
        }
      },
      orderBy: [{ workDate: "asc" }, { userId: "asc" }]
    }),
    prisma.approvalRequest.findMany({
      where: {
        companyId: actor.companyId,
        requesterId: {
          in: userIds
        },
        type: ApprovalType.LEAVE,
        status: ApprovalStatus.APPROVED,
        leaveStartDate: {
          lt: weekEnd
        },
        leaveEndDate: {
          gte: weekStart
        }
      },
      select: {
        requesterId: true,
        leaveType: true,
        leaveDuration: true,
        leaveStartDate: true,
        leaveEndDate: true
      }
    }),
    prisma.riskSignal.findMany({
      where: {
        companyId: actor.companyId,
        userId: {
          in: userIds
        },
        resolvedAt: null,
        type: {
          in: [RiskType.SCHEDULE_MISMATCH, RiskType.LATE_RISK, RiskType.MISSING_CHECK_IN_OUT, RiskType.BREAK_VIOLATION]
        },
        detectedAt: {
          gte: weekStart,
          lt: weekEnd
        }
      },
      select: {
        id: true,
        userId: true,
        type: true,
        title: true,
        evidence: true
      }
    }),
    listScheduleTemplates(actor.companyId)
  ]);

  const weeklyDates = Array.from({ length: 7 }, (_, index) => addDays(mondayString, index));
  const leaveMap = new Map<
    string,
    {
      label: string;
    }
  >();
  for (const leave of weeklyLeaves) {
    if (!leave.leaveStartDate || !leave.leaveEndDate) {
      continue;
    }

    const cursor = new Date(leave.leaveStartDate);
    const end = new Date(leave.leaveEndDate);
    while (cursor <= end) {
      const workDate = cursor.toISOString().slice(0, 10);
      if (
        leave.leaveDuration === LeaveDuration.FULL_DAY ||
        workDate === leave.leaveStartDate.toISOString().slice(0, 10)
      ) {
        leaveMap.set(`${leave.requesterId}:${workDate}`, {
          label: leave.leaveDuration === LeaveDuration.HOURLY ? "시간차" : "휴가"
        });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const riskMap = new Map<string, Array<{ id: string; title: string; type: RiskType }>>();
  for (const risk of weeklyRisks) {
    const record =
      risk.evidence && typeof risk.evidence === "object" && !Array.isArray(risk.evidence)
        ? (risk.evidence as Record<string, unknown>)
        : null;
    const workDate = typeof record?.workDate === "string" ? record.workDate : null;
    if (!workDate) {
      continue;
    }

    const key = `${risk.userId}:${workDate}`;
    const current = riskMap.get(key) ?? [];
    current.push({
      id: risk.id,
      title: risk.title,
      type: risk.type
    });
    riskMap.set(key, current);
  }

  const todaySchedulesByUser = new Map(
    schedules
      .filter((schedule) => schedule.workDate.toISOString().slice(0, 10) === today)
      .map((schedule) => [schedule.userId, schedule])
  );
  const weeklyScheduleMap = new Map(
    weeklySchedules.map((schedule) => [ `${schedule.userId}:${schedule.workDate.toISOString().slice(0, 10)}`, schedule ])
  );
  const weeklyRows = users.map((user) => ({
    user: {
      id: user.id,
      name: user.name,
      teamId: user.teamId,
      teamName: user.team?.name ?? "소속 없음"
    },
    cells: weeklyDates.map((date) => {
      const schedule = weeklyScheduleMap.get(`${user.id}:${date}`) ?? null;
      const leave = leaveMap.get(`${user.id}:${date}`) ?? null;
      const risks = riskMap.get(`${user.id}:${date}`) ?? [];
      return {
        date,
        schedule: schedule
          ? {
              id: schedule.id,
              shiftName: schedule.shiftName,
              startTime: formatKstTime(schedule.scheduledStartAt),
              endTime: formatKstTime(schedule.scheduledEndAt),
              breakMinutes: schedule.breakMinutes,
              note: schedule.note
            }
          : null,
        leave,
        risks,
        hasConflict: Boolean(schedule && leave),
        isCoverageGap: !schedule && !leave
      };
    })
  }));
  const summary = weeklyDates.map((date) => {
    const cells = weeklyRows.map((row) => row.cells.find((cell) => cell.date === date)).filter(Boolean);
    const scheduledCount = cells.filter((cell) => cell?.schedule).length;
    const leaveCount = cells.filter((cell) => cell?.leave).length;
    const conflictCount = cells.filter((cell) => cell?.hasConflict).length;
    const coverageGapCount = cells.filter((cell) => cell?.isCoverageGap).length;
    return {
      date,
      label: formatKstDate(dateOnly(date)),
      scheduledCount,
      leaveCount,
      conflictCount,
      coverageGapCount,
      availableCount: users.length - leaveCount,
      coverageTone: coverageGapCount > 0 || conflictCount > 0 ? "yellow" : "green"
    };
  });

  return {
    today,
    users,
    schedules,
    todaySchedulesByUser,
    weeklyBoard: {
      weekStart: mondayString,
      weekEnd: addDays(mondayString, 6),
      days: weeklyDates.map((date) => ({
        date,
        label: formatKstDate(dateOnly(date))
      })),
      templates,
      rows: weeklyRows,
      summary
    }
  };
}

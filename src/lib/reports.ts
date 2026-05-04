import { ApprovalType, type User } from "@/generated/prisma";

import { getAnnualLeaveSummaryMap, getLeaveBalanceAdjustments } from "@/lib/leave";
import { prisma } from "@/lib/prisma";
import { formatMinutes, getKstDateString, kstMonthBounds } from "@/lib/time";

type Actor = Pick<User, "companyId" | "role">;

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(dateString: string, offset: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function requestCoversDate(
  request: {
    leaveStartDate: Date | null;
    leaveEndDate: Date | null;
  },
  targetDate: Date
) {
  if (!request.leaveStartDate || !request.leaveEndDate) {
    return false;
  }

  return request.leaveStartDate <= targetDate && request.leaveEndDate >= targetDate;
}

function mismatchMinutes(input: {
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  checkInAt: Date | null;
  checkOutAt: Date | null;
}) {
  if (!input.checkInAt) {
    return 0;
  }

  const startGap = Math.round(Math.abs(input.scheduledStartAt.getTime() - input.checkInAt.getTime()) / (60 * 1000));
  const endGap = input.checkOutAt
    ? Math.round(Math.abs(input.scheduledEndAt.getTime() - input.checkOutAt.getTime()) / (60 * 1000))
    : 0;

  return Math.max(startGap, endGap);
}

function csvLine(values: string[]) {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(",");
}

function csvSection(title: string, header: string[], rows: string[][]) {
  return [csvLine([title]), csvLine(header), ...rows.map(csvLine)];
}

export async function getMonthlyReport(actor: Actor, month = getKstDateString().slice(0, 7)) {
  if (actor.role !== "HR" && actor.role !== "ADMIN") {
    throw new Error("리포트 권한이 없습니다.");
  }

  const { start, end } = kstMonthBounds(month);
  const monthStart = month.length === 7 ? `${month}-01` : month;
  const monthEnd = addDays(end.toISOString().slice(0, 10), -1);
  const [company, sessions, schedules, approvalRequests, users] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: {
        id: actor.companyId
      }
    }),
    prisma.workSession.findMany({
      where: {
        companyId: actor.companyId,
        workDate: {
          gte: start,
          lt: end
        }
      },
      include: {
        user: {
          include: {
            team: true
          }
        },
        approvalRequests: {
          include: {
            attachments: true
          }
        }
      },
      orderBy: [{ workDate: "asc" }, { user: { name: "asc" } }]
    }),
    prisma.workSchedule.findMany({
      where: {
        companyId: actor.companyId,
        workDate: {
          gte: start,
          lt: end
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
    prisma.approvalRequest.findMany({
      where: {
        companyId: actor.companyId,
        OR: [
          {
            createdAt: {
              gte: start,
              lt: end
            }
          },
          {
            session: {
              is: {
                workDate: {
                  gte: start,
                  lt: end
                }
              }
            }
          },
          {
            leaveStartDate: {
              lt: end
            },
            leaveEndDate: {
              gte: start
            }
          },
          {
            targetDate: {
              gte: start,
              lt: end
            }
          }
        ]
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
      orderBy: {
        createdAt: "desc"
      }
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
    })
  ]);
  const { summaries: leaveSummaryMap } = await getAnnualLeaveSummaryMap({
    companyId: actor.companyId,
    users,
    asOfDate: monthEnd
  });
  const leaveAdjustmentRows = await getLeaveBalanceAdjustments({
    companyId: actor.companyId,
    userIds: users.map((user) => user.id),
    startDate: monthStart,
    endDate: monthEnd
  });

  const scheduleByUserDate = new Map(schedules.map((schedule) => [`${schedule.userId}:${dateKey(schedule.workDate)}`, schedule]));
  const leaveRequests = approvalRequests.filter((request) => request.type === ApprovalType.LEAVE);
  const adjustmentRequests = approvalRequests.filter((request) => request.type === ApprovalType.ADJUSTMENT);

  const sessionRows = sessions.map((session) => {
    const schedule = scheduleByUserDate.get(`${session.userId}:${dateKey(session.workDate)}`) ?? null;
    const scheduleMismatchMinutes = schedule
      ? mismatchMinutes({
          scheduledStartAt: schedule.scheduledStartAt,
          scheduledEndAt: schedule.scheduledEndAt,
          checkInAt: session.checkInAt,
          checkOutAt: session.checkOutAt
        })
      : 0;
    const hasBreakRisk = session.grossMinutes >= 8 * 60 && session.breakMinutes < company.defaultBreakMinutes;

    return {
      ...session,
      schedule,
      scheduleMismatchMinutes,
      hasBreakRisk,
      relatedLeaveRequests: leaveRequests.filter(
        (request) => request.requesterId === session.userId && requestCoversDate(request, session.workDate)
      ),
      relatedAdjustmentRequests: adjustmentRequests.filter(
        (request) => request.requesterId === session.userId && request.targetDate && dateKey(request.targetDate) === dateKey(session.workDate)
      )
    };
  });

  const scheduleVarianceRows = sessionRows
    .filter((session) => session.schedule && session.scheduleMismatchMinutes > 0)
    .map((session) => ({
      id: session.id,
      workDate: session.workDate,
      user: session.user,
      schedule: session.schedule!,
      checkInAt: session.checkInAt,
      checkOutAt: session.checkOutAt,
      scheduleMismatchMinutes: session.scheduleMismatchMinutes
    }));

  const breakRiskRows = sessionRows
    .filter((session) => session.hasBreakRisk)
    .map((session) => ({
      id: session.id,
      workDate: session.workDate,
      user: session.user,
      grossMinutes: session.grossMinutes,
      breakMinutes: session.breakMinutes,
      requiredBreakMinutes: company.defaultBreakMinutes
    }));

  const leaveBalanceRows = users.map((user) => ({
    user,
    ...(leaveSummaryMap.get(user.id) ?? {
      userId: user.id,
      asOfDate: monthEnd,
      cycleStart: monthEnd,
      cycleEnd: monthEnd,
      carryoverExpiryDate: monthEnd,
      baseGrantDays: 0,
      carryoverDays: 0,
      grantedDays: 0,
      approvedDays: 0,
      pendingDays: 0,
      manualAdjustmentDays: 0,
      netRemainingDays: 0,
      remainingDays: 0,
      baseRemainingDays: 0,
      carryoverRemainingDays: 0,
      expiringCarryoverDays: 0,
      remainingHalfDayUnits: 0,
      remainingHourlyMinutes: 0,
      availableToRequestDays: 0,
      deficitDays: 0,
      firstYearMonthlyDays: 0
    })
  }));
  const userMap = new Map(users.map((user) => [user.id, user]));

  const totals = sessionRows.reduce(
    (acc, session) => {
      acc.calculatedWorkMinutes += session.calculatedWorkMinutes;
      acc.overtimeMinutes += session.overtimeMinutes;
      acc.approvedOvertimeMinutes += session.approvedOvertimeMinutes;
      return acc;
    },
    {
      calculatedWorkMinutes: 0,
      overtimeMinutes: 0,
      approvedOvertimeMinutes: 0
    }
  );

  return {
    month,
    company,
    sessions: sessionRows,
    schedules,
    approvalRequests,
    leaveRequests,
    adjustmentRequests,
    leaveBalanceRows,
    leaveAdjustmentRows: leaveAdjustmentRows.map((row) => ({
      ...row,
      user: userMap.get(row.userId) ?? null
    })),
    scheduleVarianceRows,
    breakRiskRows,
    totals
  };
}

export function reportToCsv(report: Awaited<ReturnType<typeof getMonthlyReport>>) {
  const workSessionRows = report.sessions.map((session) => [
    dateKey(session.workDate),
    session.user.team?.name ?? "",
    session.user.name,
    session.schedule?.shiftName ?? "",
    session.schedule?.scheduledStartAt.toISOString() ?? "",
    session.schedule?.scheduledEndAt.toISOString() ?? "",
    session.checkInAt?.toISOString() ?? "",
    session.checkOutAt?.toISOString() ?? "",
    String(session.grossMinutes),
    String(session.breakMinutes),
    String(session.calculatedWorkMinutes),
    String(session.overtimeMinutes),
    String(session.approvedOvertimeMinutes),
    String(session.scheduleMismatchMinutes),
    session.hasBreakRisk ? "Y" : "N",
    String(session.relatedLeaveRequests.length),
    String(session.relatedAdjustmentRequests.length),
    session.status
  ]);

  const leaveRows = report.leaveRequests.map((request) => [
    request.createdAt.toISOString(),
    request.requester.team?.name ?? "",
    request.requester.name,
    request.leaveType ?? "",
    request.leaveDuration ?? "",
    String(request.requestedLeaveMinutes ?? 0),
    request.leaveStartDate?.toISOString().slice(0, 10) ?? "",
    request.leaveEndDate?.toISOString().slice(0, 10) ?? "",
    request.status,
    String(request.attachments.length),
    request.reviewNote ?? "",
    request.reason
  ]);

  const adjustmentRows = report.adjustmentRequests.map((request) => [
    request.createdAt.toISOString(),
    request.requester.team?.name ?? "",
    request.requester.name,
    request.adjustmentType ?? "",
    request.targetDate?.toISOString().slice(0, 10) ?? "",
    request.requestedAt?.toISOString() ?? "",
    request.status,
    String(request.attachments.length),
    request.reviewNote ?? "",
    request.reason
  ]);

  const leaveBalanceRows = report.leaveBalanceRows.map((row) => [
    row.user.team?.name ?? "",
    row.user.name,
    row.cycleStart,
    row.cycleEnd,
    String(row.grantedDays),
    String(row.manualAdjustmentDays),
    String(row.approvedDays),
    String(row.pendingDays),
    String(row.baseRemainingDays),
    String(row.carryoverRemainingDays),
    String(row.expiringCarryoverDays),
    String(row.remainingHalfDayUnits),
    String(row.remainingHourlyMinutes),
    String(row.remainingDays),
    String(row.deficitDays),
    row.carryoverExpiryDate
  ]);

  const leaveAdjustmentRows = report.leaveAdjustmentRows.map((row) => [
    row.createdAt.toISOString(),
    row.user?.team?.name ?? "",
    row.user?.name ?? row.userId,
    row.effectiveDate,
    String(row.deltaDays),
    row.kind,
    row.status,
    row.reversalOfAuditLogId ?? "",
    row.reversedByAuditLogId ?? "",
    row.actorName ?? "",
    row.reason
  ]);

  const scheduleVarianceRows = report.scheduleVarianceRows.map((row) => [
    dateKey(row.workDate),
    row.user.team?.name ?? "",
    row.user.name,
    row.schedule.shiftName,
    row.schedule.scheduledStartAt.toISOString(),
    row.schedule.scheduledEndAt.toISOString(),
    row.checkInAt?.toISOString() ?? "",
    row.checkOutAt?.toISOString() ?? "",
    String(row.scheduleMismatchMinutes)
  ]);

  const breakRiskRows = report.breakRiskRows.map((row) => [
    dateKey(row.workDate),
    row.user.team?.name ?? "",
    row.user.name,
    formatMinutes(row.grossMinutes),
    `${row.breakMinutes}분`,
    `${row.requiredBreakMinutes}분`
  ]);

  return [
    ...csvSection(
      "work_sessions",
      [
        "date",
        "team",
        "name",
        "shift_name",
        "scheduled_start",
        "scheduled_end",
        "check_in",
        "check_out",
        "gross_minutes",
        "break_minutes",
        "calculated_work_minutes",
        "overtime_minutes",
        "approved_overtime_minutes",
        "schedule_mismatch_minutes",
        "break_risk",
        "leave_request_count",
        "adjustment_request_count",
        "status"
      ],
      workSessionRows
    ),
    "",
    ...csvSection(
      "leave_requests",
      [
        "requested_at",
        "team",
        "name",
        "leave_type",
        "duration",
        "requested_leave_minutes",
        "start_date",
        "end_date",
        "status",
        "attachment_count",
        "review_note",
        "reason"
      ],
      leaveRows
    ),
    "",
    ...csvSection(
      "leave_balances",
      [
        "team",
        "name",
        "cycle_start",
        "cycle_end",
        "granted_days",
        "manual_adjustment_days",
        "approved_days",
        "pending_days",
        "base_remaining_days",
        "carryover_remaining_days",
        "expiring_carryover_days",
        "remaining_half_day_units",
        "remaining_hourly_minutes",
        "remaining_days",
        "deficit_days",
        "carryover_expiry_date"
      ],
      leaveBalanceRows
    ),
    "",
    ...csvSection(
      "leave_balance_adjustments",
      [
        "created_at",
        "team",
        "name",
        "effective_date",
        "delta_days",
        "kind",
        "status",
        "reversal_of_audit_log_id",
        "reversed_by_audit_log_id",
        "actor",
        "reason"
      ],
      leaveAdjustmentRows
    ),
    "",
    ...csvSection(
      "adjustment_requests",
      [
        "requested_at",
        "team",
        "name",
        "adjustment_type",
        "target_date",
        "requested_time",
        "status",
        "attachment_count",
        "review_note",
        "reason"
      ],
      adjustmentRows
    ),
    "",
    ...csvSection(
      "schedule_variance",
      [
        "work_date",
        "team",
        "name",
        "shift_name",
        "scheduled_start",
        "scheduled_end",
        "check_in",
        "check_out",
        "schedule_mismatch_minutes"
      ],
      scheduleVarianceRows
    ),
    "",
    ...csvSection(
      "break_risks",
      ["work_date", "team", "name", "gross_minutes", "break_minutes", "required_break_minutes"],
      breakRiskRows
    )
  ].join("\n");
}

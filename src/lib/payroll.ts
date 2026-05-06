import { ApprovalStatus, RiskType, type User } from "@/generated/prisma";

import { getAnnualLeaveRequestDays, getAnnualLeaveSummaryMap } from "@/lib/leave";
import {
  buildMonthCloseDiff,
  getMonthCloseEventHistory,
  getMonthCloseRecord,
  getMonthCloseReopenRequests,
  getRecentMonthCloses
} from "@/lib/month-close";
import {
  buildHolidayDateSet,
  calculateHolidayPremiumMinutes,
  calculateHolidayWorkMinutes,
  calculateNightPremiumMinutes,
  calculateNightWorkMinutes,
  calculateOvertimePremiumMinutes,
  getCompanyHolidays,
  getCurrentWorkPolicy,
  getWorkPolicyVersions
} from "@/lib/policy-engine";
import { prisma } from "@/lib/prisma";
import { getMonthlyReport } from "@/lib/reports";
import { getKstDateString, kstMonthBounds, monthDateBounds } from "@/lib/time";

type Actor = Pick<User, "id" | "companyId" | "role">;

function getLockReason(monthCloseEvents: Array<{ type: string; detail: unknown }>) {
  const closedEvent = monthCloseEvents.find((event) => event.type === "CLOSED");
  if (!closedEvent || !closedEvent.detail || typeof closedEvent.detail !== "object" || Array.isArray(closedEvent.detail)) {
    return null;
  }

  const detail = closedEvent.detail as Record<string, unknown>;
  return typeof detail.lockReason === "string" && detail.lockReason.trim() ? detail.lockReason.trim() : null;
}

function csvLine(values: string[]) {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(",");
}

function csvSection(title: string, header: string[], rows: string[][]) {
  return [csvLine([title]), csvLine(header), ...rows.map(csvLine)];
}

function closeStatusLabel(actionRequired: boolean) {
  return actionRequired ? "ACTION_REQUIRED" : "READY";
}

export async function getPayrollReport(actor: Actor, month = getKstDateString().slice(0, 7)) {
  if (actor.role !== "HR" && actor.role !== "ADMIN") {
    throw new Error("이 기능은 인사 담당 또는 관리자만 사용할 수 있습니다.");
  }

  const monthlyReport = await getMonthlyReport(actor, month);
  const dateBounds = monthDateBounds(month);
  const monthStart = dateBounds.startString;
  const { start, end } = kstMonthBounds(month);
  const monthEnd = dateBounds.endString;

  const [policy, policyVersions, holidays, monthClose, recentMonthCloses, monthCloseEvents, reopenRequests, users, missingRecordRisks] =
    await Promise.all([
      getCurrentWorkPolicy(actor.companyId, monthEnd),
      getWorkPolicyVersions(actor.companyId),
      getCompanyHolidays(actor.companyId, monthStart, monthEnd),
      getMonthCloseRecord(actor.companyId, month),
      getRecentMonthCloses(actor.companyId),
      getMonthCloseEventHistory(actor.companyId, month),
      getMonthCloseReopenRequests(actor.companyId, month),
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
      prisma.riskSignal.findMany({
        where: {
          companyId: actor.companyId,
          type: RiskType.MISSING_CHECK_IN_OUT,
          resolvedAt: null,
          detectedAt: {
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
        }
      })
    ]);
  const { summaries: leaveSummaryMap } = await getAnnualLeaveSummaryMap({
    companyId: actor.companyId,
    users,
    asOfDate: monthEnd
  });

  const holidayDateSet = buildHolidayDateSet(holidays);
  const sessionsByUser = new Map<string, typeof monthlyReport.sessions>();
  for (const session of monthlyReport.sessions) {
    const rows = sessionsByUser.get(session.userId) ?? [];
    rows.push(session);
    sessionsByUser.set(session.userId, rows);
  }

  const approvalsByUser = new Map<string, typeof monthlyReport.approvalRequests>();
  for (const approval of monthlyReport.approvalRequests) {
    const rows = approvalsByUser.get(approval.requesterId) ?? [];
    rows.push(approval);
    approvalsByUser.set(approval.requesterId, rows);
  }

  const missingRiskCountByUser = new Map<string, number>();
  for (const risk of missingRecordRisks) {
    missingRiskCountByUser.set(risk.userId, (missingRiskCountByUser.get(risk.userId) ?? 0) + 1);
  }

  const scheduleMismatchCountByUser = new Map<string, number>();
  for (const row of monthlyReport.scheduleVarianceRows) {
    scheduleMismatchCountByUser.set(row.user.id, (scheduleMismatchCountByUser.get(row.user.id) ?? 0) + 1);
  }

  const payrollRows = users.map((user) => {
    const sessions = sessionsByUser.get(user.id) ?? [];
    const approvals = approvalsByUser.get(user.id) ?? [];
    const leaveSummary = leaveSummaryMap.get(user.id);
    const annualLeaves = approvals.filter(
      (approval) => approval.type === "LEAVE" && approval.leaveType === "ANNUAL" && approval.status === ApprovalStatus.APPROVED
    );
    const annualLeaveUsedThisMonth = annualLeaves.reduce(
      (sum, request) =>
        sum +
        getAnnualLeaveRequestDays(request, policy, holidayDateSet, {
          startDate: monthStart,
          endDate: monthEnd
        }),
      0
    );
    const calculatedWorkMinutes = sessions.reduce((sum, session) => sum + session.calculatedWorkMinutes, 0);
    const overtimeMinutes = sessions.reduce((sum, session) => sum + session.overtimeMinutes, 0);
    const approvedOvertimeMinutes = sessions.reduce((sum, session) => sum + session.approvedOvertimeMinutes, 0);
    const nightWorkMinutes = sessions.reduce((sum, session) => sum + calculateNightWorkMinutes(session, policy), 0);
    const holidayWorkMinutes = sessions.reduce(
      (sum, session) => sum + calculateHolidayWorkMinutes(session, policy, holidayDateSet),
      0
    );
    const additionalOvertimePremiumMinutes = calculateOvertimePremiumMinutes(approvedOvertimeMinutes, policy);
    const additionalNightPremiumMinutes = calculateNightPremiumMinutes(nightWorkMinutes, policy);
    const additionalHolidayPremiumMinutes = calculateHolidayPremiumMinutes(holidayWorkMinutes, policy);
    const payableEquivalentMinutes =
      calculatedWorkMinutes +
      additionalOvertimePremiumMinutes +
      additionalNightPremiumMinutes +
      additionalHolidayPremiumMinutes;
    const pendingApprovalCount = approvals.filter((approval) => approval.status === ApprovalStatus.PENDING).length;
    const pendingLeaveApprovalCount = approvals.filter(
      (approval) => approval.status === ApprovalStatus.PENDING && approval.type === "LEAVE"
    ).length;
    const pendingAdjustmentApprovalCount = approvals.filter(
      (approval) => approval.status === ApprovalStatus.PENDING && approval.type === "ADJUSTMENT"
    ).length;
    const openSessionCount = sessions.filter((session) => session.status !== "CLOSED").length;
    const unresolvedOvertimeCount = sessions.filter(
      (session) => session.overtimeMinutes > 0 && session.approvedOvertimeMinutes < session.overtimeMinutes
    ).length;
    const missingRecordCount = missingRiskCountByUser.get(user.id) ?? 0;
    const scheduleMismatchCount = scheduleMismatchCountByUser.get(user.id) ?? 0;
    const leaveBalanceDeficitDays = leaveSummary?.deficitDays ?? 0;
    const actionRequired =
      pendingApprovalCount > 0 ||
      openSessionCount > 0 ||
      unresolvedOvertimeCount > 0 ||
      missingRecordCount > 0 ||
      scheduleMismatchCount > 0 ||
      leaveBalanceDeficitDays > 0;

    return {
      user,
      calculatedWorkMinutes,
      overtimeMinutes,
      approvedOvertimeMinutes,
      nightWorkMinutes,
      holidayWorkMinutes,
      additionalOvertimePremiumMinutes,
      additionalNightPremiumMinutes,
      additionalHolidayPremiumMinutes,
      payableEquivalentMinutes,
      annualLeaveCycleStart: leaveSummary?.cycleStart ?? monthStart,
      annualLeaveCarryoverExpiryDate: leaveSummary?.carryoverExpiryDate ?? monthEnd,
      annualLeaveGrantedDays: leaveSummary?.grantedDays ?? 0,
      annualLeaveUsedThisMonth,
      annualLeaveUsedInCycle: leaveSummary?.approvedDays ?? 0,
      annualLeavePendingDays: leaveSummary?.pendingDays ?? 0,
      annualLeaveRemainingDays: leaveSummary?.remainingDays ?? 0,
      annualLeaveDeficitDays: leaveBalanceDeficitDays,
      firstYearMonthlyDays: leaveSummary?.firstYearMonthlyDays ?? 0,
      pendingApprovalCount,
      pendingLeaveApprovalCount,
      pendingAdjustmentApprovalCount,
      openSessionCount,
      unresolvedOvertimeCount,
      missingRecordCount,
      scheduleMismatchCount,
      closeStatus: closeStatusLabel(actionRequired)
    };
  });

  const totals = payrollRows.reduce(
    (acc, row) => {
      acc.calculatedWorkMinutes += row.calculatedWorkMinutes;
      acc.overtimeMinutes += row.overtimeMinutes;
      acc.approvedOvertimeMinutes += row.approvedOvertimeMinutes;
      acc.nightWorkMinutes += row.nightWorkMinutes;
      acc.holidayWorkMinutes += row.holidayWorkMinutes;
      acc.additionalOvertimePremiumMinutes += row.additionalOvertimePremiumMinutes;
      acc.additionalNightPremiumMinutes += row.additionalNightPremiumMinutes;
      acc.additionalHolidayPremiumMinutes += row.additionalHolidayPremiumMinutes;
      acc.payableEquivalentMinutes += row.payableEquivalentMinutes;
      acc.annualLeaveGrantedDays += row.annualLeaveGrantedDays;
      acc.annualLeaveUsedThisMonth += row.annualLeaveUsedThisMonth;
      acc.annualLeaveUsedInCycle += row.annualLeaveUsedInCycle;
      acc.annualLeavePendingDays += row.annualLeavePendingDays;
      acc.annualLeaveRemainingDays += row.annualLeaveRemainingDays;
      acc.pendingApprovalCount += row.pendingApprovalCount;
      acc.pendingLeaveApprovalCount += row.pendingLeaveApprovalCount;
      acc.pendingAdjustmentApprovalCount += row.pendingAdjustmentApprovalCount;
      acc.openSessionCount += row.openSessionCount;
      acc.unresolvedOvertimeCount += row.unresolvedOvertimeCount;
      acc.missingRecordCount += row.missingRecordCount;
      acc.scheduleMismatchCount += row.scheduleMismatchCount;
      acc.leaveBalanceDeficitUsers += row.annualLeaveDeficitDays > 0 ? 1 : 0;
      acc.readyCount += row.closeStatus === "READY" ? 1 : 0;
      acc.actionRequiredCount += row.closeStatus === "READY" ? 0 : 1;
      return acc;
    },
    {
      calculatedWorkMinutes: 0,
      overtimeMinutes: 0,
      approvedOvertimeMinutes: 0,
      nightWorkMinutes: 0,
      holidayWorkMinutes: 0,
      additionalOvertimePremiumMinutes: 0,
      additionalNightPremiumMinutes: 0,
      additionalHolidayPremiumMinutes: 0,
      payableEquivalentMinutes: 0,
      annualLeaveGrantedDays: 0,
      annualLeaveUsedThisMonth: 0,
      annualLeaveUsedInCycle: 0,
      annualLeavePendingDays: 0,
      annualLeaveRemainingDays: 0,
      pendingApprovalCount: 0,
      pendingLeaveApprovalCount: 0,
      pendingAdjustmentApprovalCount: 0,
      openSessionCount: 0,
      unresolvedOvertimeCount: 0,
      missingRecordCount: 0,
      scheduleMismatchCount: 0,
      leaveBalanceDeficitUsers: 0,
      readyCount: 0,
      actionRequiredCount: 0
    }
  );

  const blockingSummary = {
    pendingApprovals: totals.pendingApprovalCount,
    pendingLeaveApprovals: totals.pendingLeaveApprovalCount,
    pendingAdjustmentApprovals: totals.pendingAdjustmentApprovalCount,
    openSessions: totals.openSessionCount,
    unresolvedOvertime: totals.unresolvedOvertimeCount,
    missingRecordRisks: totals.missingRecordCount,
    scheduleMismatchSessions: totals.scheduleMismatchCount,
    leaveBalanceDeficitUsers: totals.leaveBalanceDeficitUsers
  };
  const monthCloseLiveSummary = {
    blockingSummary,
    totals
  };
  const blockerDrillDown = {
    pendingApprovals: monthlyReport.approvalRequests
      .filter((approval) => approval.status === ApprovalStatus.PENDING)
      .map((approval) => ({
        id: approval.id,
        type: approval.type,
        requester: approval.requester,
        createdAt: approval.createdAt,
        reason: approval.reason
      })),
    openSessions: monthlyReport.sessions
      .filter((session) => session.status !== "CLOSED")
      .map((session) => ({
        id: session.id,
        user: session.user,
        workDate: session.workDate,
        status: session.status,
        calculatedWorkMinutes: session.calculatedWorkMinutes
      })),
    unresolvedOvertime: monthlyReport.sessions
      .filter((session) => session.overtimeMinutes > 0 && session.approvedOvertimeMinutes < session.overtimeMinutes)
      .map((session) => ({
        id: session.id,
        user: session.user,
        workDate: session.workDate,
        overtimeMinutes: session.overtimeMinutes,
        approvedOvertimeMinutes: session.approvedOvertimeMinutes
      })),
    missingRecordRisks: missingRecordRisks.map((risk) => ({
      id: risk.id,
      user: risk.user,
      title: risk.title,
      message: risk.message,
      detectedAt: risk.detectedAt,
      workDate:
        risk.sessionId && risk.evidence && typeof risk.evidence === "object" && !Array.isArray(risk.evidence)
          ? ((risk.evidence as { workDate?: unknown }).workDate as string | undefined) ?? null
          : risk.evidence && typeof risk.evidence === "object" && !Array.isArray(risk.evidence)
            ? ((risk.evidence as { workDate?: unknown }).workDate as string | undefined) ?? null
            : null
    })),
    scheduleMismatchSessions: monthlyReport.scheduleVarianceRows.map((row) => ({
      id: row.id,
      user: row.user,
      workDate: row.workDate,
      schedule: row.schedule,
      scheduleMismatchMinutes: row.scheduleMismatchMinutes
    })),
    leaveBalanceDeficitUsers: payrollRows
      .filter((row) => row.annualLeaveDeficitDays > 0)
      .map((row) => ({
        user: row.user,
        deficitDays: row.annualLeaveDeficitDays,
        remainingDays: row.annualLeaveRemainingDays,
        pendingDays: row.annualLeavePendingDays
      }))
  };
  const validationCards = [
    {
      key: "payable_equivalent",
      title: "급여 환산 검증",
      status:
        totals.payableEquivalentMinutes ===
        totals.calculatedWorkMinutes +
          totals.additionalOvertimePremiumMinutes +
          totals.additionalNightPremiumMinutes +
          totals.additionalHolidayPremiumMinutes
          ? "PASS"
          : "CHECK",
      metric: `${totals.payableEquivalentMinutes}분`,
      description: "인정 근로 + 연장/야간/휴일 가산 환산 합계"
    },
    {
      key: "policy_snapshot",
      title: "정책 스냅샷",
      status: "PASS",
      metric: `v${policy.version}`,
      description: `${policy.annualLeaveBasis === "JOIN_DATE" ? "입사일" : "캘린더 연도"} · 공휴일 ${holidays.length}일 반영`
    },
    {
      key: "blocker_summary",
      title: "월 마감 전 확인 항목",
      status: Object.values(blockingSummary).every((value) => value === 0) ? "PASS" : "CHECK",
      metric: `${Object.values(blockingSummary).reduce((sum, value) => sum + value, 0)}건`,
      description: "승인, 세션, 누락, 스케줄, 연차 부족 합산"
    }
  ];
  const liveDiffFromClosedSnapshot = monthClose?.summary
    ? buildMonthCloseDiff(monthClose.summary, monthCloseLiveSummary)
    : null;
  const pendingReopenRequest = reopenRequests.find((request) => request.status === "PENDING") ?? null;
  const lockReason = getLockReason(monthCloseEvents);

  return {
    month,
    policy,
    policyVersions,
    holidays,
    monthClose,
    monthCloseEvents,
    reopenRequests,
    pendingReopenRequest,
    lockReason,
    recentMonthCloses,
    payrollRows,
    blockingSummary,
    blockerDrillDown,
    validationCards,
    monthCloseLiveSummary,
    liveDiffFromClosedSnapshot,
    canClose:
      (monthClose?.status ?? "OPEN") !== "CLOSED" &&
      blockingSummary.pendingApprovals === 0 &&
      blockingSummary.openSessions === 0 &&
      blockingSummary.unresolvedOvertime === 0 &&
      blockingSummary.missingRecordRisks === 0 &&
      blockingSummary.scheduleMismatchSessions === 0 &&
      blockingSummary.leaveBalanceDeficitUsers === 0,
    totals
  };
}

export function payrollReportToCsv(report: Awaited<ReturnType<typeof getPayrollReport>>) {
  const policyRows = [
    ["policy_name", report.policy.name],
    ["policy_version", String(report.policy.version)],
    ["policy_effective_from", report.policy.effectiveFrom.toISOString()],
    ["annual_leave_basis", report.policy.annualLeaveBasis],
    ["standard_daily_minutes", String(report.policy.standardDailyMinutes)],
    ["weekly_limit_minutes", String(report.policy.weeklyLimitMinutes)],
    ["overtime_threshold_minutes", String(report.policy.overtimeThresholdMinutes)],
    ["annual_leave_grant_days", String(report.policy.annualLeaveGrantDays)],
    ["first_year_monthly_accrual_enabled", report.policy.firstYearMonthlyAccrualEnabled ? "Y" : "N"],
    ["annual_leave_carryover_days", String(report.policy.annualLeaveCarryoverDays)],
    ["carryover_expiry", `${report.policy.carryoverExpiryMonth}/${report.policy.carryoverExpiryDay}`],
    ["allow_half_day_leave", report.policy.allowHalfDayLeave ? "Y" : "N"],
    ["allow_hourly_leave", report.policy.allowHourlyLeave ? "Y" : "N"],
    ["hourly_leave_unit_minutes", String(report.policy.hourlyLeaveUnitMinutes)],
    ["overtime_premium_rate", String(report.policy.overtimePremiumRate)],
    ["night_premium_rate", String(report.policy.nightPremiumRate)],
    ["holiday_premium_rate", String(report.policy.holidayPremiumRate)],
    ["holiday_includes_weekends", report.policy.holidayIncludesWeekends ? "Y" : "N"],
    ["night_work_start", report.policy.nightWorkStart],
    ["night_work_end", report.policy.nightWorkEnd]
  ];

  const holidayRows = report.holidays.map((holiday) => [
    holiday.date.toISOString().slice(0, 10),
    holiday.name,
    holiday.isPaidHoliday ? "Y" : "N"
  ]);

  const closeRows = [
    ["month", report.month],
    ["status", report.monthClose?.status ?? "OPEN"],
    ["payroll_sync_status", report.monthClose?.payrollSyncStatus ?? "PENDING"],
    ["locked_at", report.monthClose?.lockedAt?.toISOString() ?? ""],
    ["locked_by", report.monthClose?.lockedBy?.name ?? ""],
    ["reopened_at", report.monthClose?.reopenedAt?.toISOString() ?? ""],
    ["reopened_by", report.monthClose?.reopenedBy?.name ?? ""],
    ["reopen_reason", report.monthClose?.reopenReason ?? ""],
    ["payroll_applied_at", report.monthClose?.payrollAppliedAt?.toISOString() ?? ""],
    ["payroll_applied_by", report.monthClose?.payrollAppliedBy?.name ?? ""]
  ];

  const eventRows = report.monthCloseEvents.map((event) => [
    event.createdAt.toISOString(),
    event.type,
    event.actor?.name ?? "",
    JSON.stringify(event.detail ?? {})
  ]);

  const payrollRows = report.payrollRows.map((row) => [
    report.month,
    row.user.team?.name ?? "",
    row.user.name,
    row.user.email,
    row.user.employmentType,
    row.user.joinedAt.toISOString().slice(0, 10),
    String(row.calculatedWorkMinutes),
    String(row.overtimeMinutes),
    String(row.approvedOvertimeMinutes),
    String(row.nightWorkMinutes),
    String(row.holidayWorkMinutes),
    String(row.additionalOvertimePremiumMinutes),
    String(row.additionalNightPremiumMinutes),
    String(row.additionalHolidayPremiumMinutes),
    String(row.payableEquivalentMinutes),
    row.annualLeaveCycleStart,
    row.annualLeaveCarryoverExpiryDate,
    String(row.annualLeaveGrantedDays),
    String(row.annualLeaveUsedThisMonth),
    String(row.annualLeaveUsedInCycle),
    String(row.annualLeavePendingDays),
    String(row.annualLeaveRemainingDays),
    String(row.annualLeaveDeficitDays),
    String(row.pendingApprovalCount),
    String(row.pendingLeaveApprovalCount),
    String(row.pendingAdjustmentApprovalCount),
    String(row.openSessionCount),
    String(row.unresolvedOvertimeCount),
    String(row.missingRecordCount),
    String(row.scheduleMismatchCount),
    row.closeStatus
  ]);

  return [
    ...csvSection("policy_table", ["key", "value"], policyRows),
    "",
    ...csvSection("holiday_calendar", ["date", "name", "paid_holiday"], holidayRows),
    "",
    ...csvSection("month_close", ["key", "value"], closeRows),
    "",
    ...csvSection("month_close_events", ["created_at", "type", "actor", "detail"], eventRows),
    "",
    ...csvSection(
      "payroll_export",
      [
        "month",
        "team",
        "name",
        "email",
        "employment_type",
        "joined_at",
        "calculated_work_minutes",
        "overtime_minutes",
        "approved_overtime_minutes",
        "night_work_minutes",
        "holiday_work_minutes",
        "additional_overtime_premium_minutes",
        "additional_night_premium_minutes",
        "additional_holiday_premium_minutes",
        "payable_equivalent_minutes",
        "annual_leave_cycle_start",
        "annual_leave_carryover_expiry_date",
        "annual_leave_granted_days",
        "annual_leave_used_this_month",
        "annual_leave_used_in_cycle",
        "annual_leave_pending_days",
        "annual_leave_remaining_days",
        "annual_leave_deficit_days",
        "pending_approval_count",
        "pending_leave_approval_count",
        "pending_adjustment_approval_count",
        "open_session_count",
        "unresolved_overtime_count",
        "missing_record_count",
        "schedule_mismatch_count",
        "close_status"
      ],
      payrollRows
    )
  ].join("\n");
}

import {
  ApprovalStatus,
  ApprovalType,
  LeaveDuration,
  Prisma,
  RiskLevel,
  RiskType,
  type User
} from "@/generated/prisma";

import { writeAuditLog } from "@/lib/audit";
import { getAuditTrailEntries } from "@/lib/audit-view";
import { getEvidenceSecuritySummary } from "@/lib/evidence";
import { getManagedUsers } from "@/lib/manager";
import {
  buildHolidayDateSet,
  calculateHolidayWorkMinutes,
  calculateNightWorkMinutes,
  getCompanyHolidays,
  getCurrentWorkPolicy
} from "@/lib/policy-engine";
import { prisma } from "@/lib/prisma";
import { getMonthlyReport } from "@/lib/reports";
import { dateOnly, formatMinutes, getKstDateString, kstMonthBounds, kstWeekBounds } from "@/lib/time";

type Actor = Pick<User, "id" | "companyId" | "role" | "teamId">;

type RiskDraft = {
  companyId: string;
  userId: string;
  sessionId?: string;
  type: RiskType;
  level: RiskLevel;
  title: string;
  message: string;
  evidence: Prisma.JsonObject;
};

type RiskWorkflowStatusValue = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "DISMISSED";
type RiskResolutionTypeValue = "NONE" | "AUTO" | "MANUAL" | "APPROVAL" | "ADJUSTMENT" | "SCHEDULE" | "MONTH_CLOSE" | "OTHER";
type WorkflowStatusInput = RiskWorkflowStatusValue;
type RiskSlaStatusValue = "ON_TRACK" | "AT_RISK" | "OVERDUE" | "UNASSIGNED";

type RiskEvidenceRecord = Record<string, Prisma.JsonValue>;

const severityRank: Record<RiskLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4
};

function daysAgoDateOnly(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return dateOnly(getKstDateString(date));
}

function riskLevelLabel(level: RiskLevel) {
  return {
    LOW: "낮음",
    MEDIUM: "주의",
    HIGH: "위험",
    CRITICAL: "긴급"
  }[level];
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(dateString: string, offset: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function absoluteMinuteDifference(a: Date, b: Date) {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / (60 * 1000));
}

function getObjectRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RiskEvidenceRecord)
    : null;
}

function getStringValue(record: RiskEvidenceRecord | null, key: string) {
  return typeof record?.[key] === "string" ? (record[key] as string) : null;
}

function getNumberValue(record: RiskEvidenceRecord | null, key: string) {
  return typeof record?.[key] === "number" ? (record[key] as number) : null;
}

function riskWorkDateFromEvidence(evidence: Prisma.JsonValue | null | undefined) {
  const record = getObjectRecord(evidence);
  return getStringValue(record, "workDate");
}

function buildRiskWorkflowKeyFromSignal(signal: {
  userId: string;
  type: RiskType;
  sessionId?: string | null;
  title: string;
  evidence: Prisma.JsonValue | null | undefined;
}) {
  const evidence = getObjectRecord(signal.evidence);
  const workDate = getStringValue(evidence, "workDate") ?? "";
  const shiftName = getStringValue(evidence, "shiftName") ?? "";
  const overtimeMinutes = getNumberValue(evidence, "overtimeMinutes");
  const approvalCount = getNumberValue(evidence, "approvalCount");
  const grossMinutes = getNumberValue(evidence, "grossMinutes");
  const breakMinutes = getNumberValue(evidence, "breakMinutes");
  const weeklyMinutes = getNumberValue(evidence, "weeklyMinutes");
  const nightWorkMinutes = getNumberValue(evidence, "nightWorkMinutes");
  const holidayWorkMinutes = getNumberValue(evidence, "holidayWorkMinutes");
  const totalOvertimeMinutes = getNumberValue(evidence, "totalOvertimeMinutes");
  const overtimeSessionCount = getNumberValue(evidence, "overtimeSessionCount");
  const unapprovedOvertimeSessionCount = getNumberValue(evidence, "unapprovedOvertimeSessionCount");

  return [
    signal.userId,
    signal.type,
    signal.sessionId ?? "",
    workDate,
    shiftName,
    overtimeMinutes ?? "",
    approvalCount ?? "",
    grossMinutes ?? "",
    breakMinutes ?? "",
    weeklyMinutes ?? "",
    nightWorkMinutes ?? "",
    holidayWorkMinutes ?? "",
    totalOvertimeMinutes ?? "",
    overtimeSessionCount ?? "",
    unapprovedOvertimeSessionCount ?? ""
  ].join("|");
}

function riskStatusLabel(status: RiskWorkflowStatusValue) {
  return {
    OPEN: "오픈",
    IN_PROGRESS: "조치중",
    RESOLVED: "해결",
    DISMISSED: "보류"
  }[status];
}

function riskSlaStatusLabel(status: RiskSlaStatusValue) {
  return {
    ON_TRACK: "정상",
    AT_RISK: "24시간 주의",
    OVERDUE: "48시간 초과",
    UNASSIGNED: "담당자 미지정"
  }[status];
}

function riskLawBasis(type: RiskType) {
  const map: Record<RiskType, string> = {
    WEEKLY_LIMIT: "근로기준법 제50조·제53조(근로시간·연장근로)",
    UNAPPROVED_OVERTIME: "근로기준법 제53조(연장근로) 및 사내 초과근로 승인 정책",
    REPEATED_OVERTIME: "근로기준법 제53조(연장근로) 및 반복 초과근로 관리 정책",
    MISSING_EVIDENCE: "사내 증빙 보관 정책 및 승인 근거 보존 기준",
    ADJUSTMENT_SPIKE: "근태 정정 내부통제 정책",
    LATE_RISK: "취업규칙상 지각 관리 및 스케줄 준수 기준",
    MISSING_CHECK_IN_OUT: "근태 기록 보존 의무 및 월 마감 검증 기준",
    BREAK_VIOLATION: "근로기준법 제54조(휴게)",
    SCHEDULE_MISMATCH: "사내 스케줄 배포/실근무 정합성 기준",
    NIGHT_HOLIDAY_WORK: "근로기준법 제56조(연장·야간 및 휴일근로)",
    INCLUSIVE_WAGE_RISK: "포괄임금 운영 관련 근로시간 산정·승인·정산 증빙 기준"
  };

  return map[type];
}

function riskRecommendedActions(type: RiskType) {
  const map: Record<RiskType, string[]> = {
    WEEKLY_LIMIT: ["이번 주 남은 스케줄 축소", "초과근로 승인 근거 확인", "팀장/HR 재배치 검토"],
    UNAPPROVED_OVERTIME: ["승인 요청 생성 여부 확인", "증빙 첨부 요청", "반복 시 현장 교육 메모 남김"],
    REPEATED_OVERTIME: ["반복 원인 분류", "주간 인력 재배치", "다음 주 템플릿 조정"],
    MISSING_EVIDENCE: ["증빙 첨부 재요청", "반려 또는 보완 마감일 지정", "반복 건수 추적"],
    ADJUSTMENT_SPIKE: ["최근 정정 증가 사유 확인", "현장 입력 방식 점검", "팀 단위 코칭 진행"],
    LATE_RISK: ["당일 스케줄 재확인", "지각 사유 메모 확보", "반복 시 스케줄 시작시간 조정 검토"],
    MISSING_CHECK_IN_OUT: ["정정 요청 안내", "현장 앱 사용 재안내", "월 마감 전 정리"],
    BREAK_VIOLATION: ["휴게시간 재확인", "스케줄 휴게 구간 보정", "장시간 근무 분산"],
    SCHEDULE_MISMATCH: ["실근무와 예정 스케줄 대조", "보드에서 즉시 수정", "휴가/외근 충돌 여부 확인"],
    NIGHT_HOLIDAY_WORK: ["급여 가산 분류 확인", "사전 승인/스케줄 근거 확인", "휴일·야간 근무 사유 보완"],
    INCLUSIVE_WAGE_RISK: ["반복 초과근로 사유 분류", "포괄임금 운영 문구와 실제 정산 대조", "누락 승인/증빙 보완"]
  };

  return map[type];
}

function riskWorkflowTemplates(type: RiskType) {
  const map: Record<RiskType, string[]> = {
    WEEKLY_LIMIT: [
      "주간 누적 근로시간이 높아 다음 2영업일 스케줄을 조정하고 승인 근거를 재확인합니다.",
      "주52시간 기준 초과 가능성이 있어 팀장과 재배치 일정을 협의했습니다."
    ],
    UNAPPROVED_OVERTIME: [
      "미승인 초과근로 건으로 증빙 보완과 승인 여부 확인을 요청했습니다.",
      "이번 건은 예외 승인 검토 중이며 동일 패턴 재발 방지 안내를 병행합니다."
    ],
    REPEATED_OVERTIME: [
      "반복 초과근로 원인을 파악해 다음 주 템플릿과 인원 배치를 조정합니다."
    ],
    MISSING_EVIDENCE: [
      "증빙이 부족해 추가 자료를 요청했고 마감 전까지 보완 여부를 추적합니다."
    ],
    ADJUSTMENT_SPIKE: [
      "최근 정정 급증 원인을 현장 입력 누락으로 분류하고 팀 단위 재안내를 진행합니다."
    ],
    LATE_RISK: [
      "지각 위험 건으로 당일 이동/출근 상황을 확인하고 스케줄 시작 시각 조정 가능성을 검토합니다."
    ],
    MISSING_CHECK_IN_OUT: [
      "출퇴근 누락 정정 요청을 안내했고 증빙 제출 전까지 월 마감 체크리스트에 보류 표시합니다."
    ],
    BREAK_VIOLATION: [
      "휴게 부족 가능성이 있어 실제 휴게 사용 여부를 확인하고 스케줄 휴게 구간을 재설계합니다."
    ],
    SCHEDULE_MISMATCH: [
      "실근무와 예정 스케줄 불일치를 확인해 보드에서 수정하고 관련 승인/휴가 충돌도 함께 점검합니다."
    ],
    NIGHT_HOLIDAY_WORK: [
      "야간·휴일 근로가 감지되어 급여 가산, 승인 근거, 스케줄 배포 이력을 함께 확인합니다."
    ],
    INCLUSIVE_WAGE_RISK: [
      "반복 초과근로와 승인/정산 근거를 대조해 포괄임금 오인 운영으로 보일 수 있는 부분을 정리합니다."
    ]
  };

  return map[type];
}

function riskEvidenceFacts(type: RiskType, evidence: Prisma.JsonValue | null | undefined) {
  const record = getObjectRecord(evidence);
  const facts: string[] = [];
  const workDate = getStringValue(record, "workDate");
  const weeklyMinutes = getNumberValue(record, "weeklyMinutes");
  const weeklyLimitMinutes = getNumberValue(record, "weeklyLimitMinutes");
  const overtimeMinutes = getNumberValue(record, "overtimeMinutes");
  const grossMinutes = getNumberValue(record, "grossMinutes");
  const breakMinutes = getNumberValue(record, "breakMinutes");
  const shiftName = getStringValue(record, "shiftName");
  const requestedTime = getStringValue(record, "requestedTime");
  const nightWorkMinutes = getNumberValue(record, "nightWorkMinutes");
  const holidayWorkMinutes = getNumberValue(record, "holidayWorkMinutes");
  const overtimeSessionCount = getNumberValue(record, "overtimeSessionCount");
  const totalOvertimeMinutes = getNumberValue(record, "totalOvertimeMinutes");
  const unapprovedOvertimeSessionCount = getNumberValue(record, "unapprovedOvertimeSessionCount");

  if (workDate) {
    facts.push(`대상일 ${workDate}`);
  }
  if (shiftName) {
    facts.push(`스케줄 ${shiftName}`);
  }
  if (weeklyMinutes && (type === RiskType.WEEKLY_LIMIT || type === RiskType.REPEATED_OVERTIME)) {
    facts.push(`주간 누적 ${formatMinutes(weeklyMinutes)}`);
  }
  if (weeklyLimitMinutes && type === RiskType.WEEKLY_LIMIT) {
    facts.push(`회사 기준 ${formatMinutes(weeklyLimitMinutes)}`);
  }
  if (overtimeMinutes && (type === RiskType.UNAPPROVED_OVERTIME || type === RiskType.REPEATED_OVERTIME)) {
    facts.push(`초과근로 ${formatMinutes(overtimeMinutes)}`);
  }
  if (grossMinutes && type === RiskType.BREAK_VIOLATION) {
    facts.push(`총 근무 ${formatMinutes(grossMinutes)}`);
  }
  if (breakMinutes !== null && type === RiskType.BREAK_VIOLATION) {
    facts.push(`휴게 ${formatMinutes(breakMinutes)}`);
  }
  if (requestedTime && type === RiskType.MISSING_CHECK_IN_OUT) {
    facts.push(`요청 시각 ${requestedTime}`);
  }
  if (nightWorkMinutes && type === RiskType.NIGHT_HOLIDAY_WORK) {
    facts.push(`야간 ${formatMinutes(nightWorkMinutes)}`);
  }
  if (holidayWorkMinutes && type === RiskType.NIGHT_HOLIDAY_WORK) {
    facts.push(`휴일 ${formatMinutes(holidayWorkMinutes)}`);
  }
  if (overtimeSessionCount && type === RiskType.INCLUSIVE_WAGE_RISK) {
    facts.push(`초과근로 ${overtimeSessionCount}회`);
  }
  if (totalOvertimeMinutes && type === RiskType.INCLUSIVE_WAGE_RISK) {
    facts.push(`초과 합계 ${formatMinutes(totalOvertimeMinutes)}`);
  }
  if (unapprovedOvertimeSessionCount && type === RiskType.INCLUSIVE_WAGE_RISK) {
    facts.push(`무승인 ${unapprovedOvertimeSessionCount}회`);
  }

  return facts;
}

function buildRiskExplanation(input: {
  signal: {
    type: RiskType;
    message: string;
    evidence: Prisma.JsonValue | null;
  };
  recurrence: {
    count28d: number;
    recentDates: string[];
  };
}) {
  return {
    lawBasis: riskLawBasis(input.signal.type),
    why: input.signal.message,
    evidenceFacts: riskEvidenceFacts(input.signal.type, input.signal.evidence),
    recommendedActions: riskRecommendedActions(input.signal.type),
    workflowTemplates: riskWorkflowTemplates(input.signal.type),
    recurrence: {
      count28d: input.recurrence.count28d,
      recentDates: input.recurrence.recentDates,
      label:
        input.recurrence.count28d > 1
          ? `최근 28일 ${input.recurrence.count28d}회 재발`
          : "최근 28일 재발 없음"
    }
  };
}

function riskSlaStatusForSignal(signal: {
  status: RiskWorkflowStatusValue;
  assignedTo: { id: string } | null;
  detectedAt: Date;
  workflowUpdatedAt?: Date | null;
}) {
  const anchor = signal.workflowUpdatedAt ?? signal.detectedAt;
  const ageHours = Math.max(0, Math.floor((Date.now() - anchor.getTime()) / (60 * 60 * 1000)));

  if (!signal.assignedTo && signal.status === "OPEN") {
    return {
      slaStatus: "UNASSIGNED" as const,
      slaAgeHours: ageHours
    };
  }

  if (ageHours >= 48) {
    return {
      slaStatus: "OVERDUE" as const,
      slaAgeHours: ageHours
    };
  }

  if (ageHours >= 24) {
    return {
      slaStatus: "AT_RISK" as const,
      slaAgeHours: ageHours
    };
  }

  return {
    slaStatus: "ON_TRACK" as const,
    slaAgeHours: ageHours
  };
}

function buildLeaveDateSet(
  approvals: Array<{ requesterId: string; leaveStartDate: Date | null; leaveEndDate: Date | null; leaveDuration: LeaveDuration | null }>
) {
  const dates = new Set<string>();

  for (const approval of approvals) {
    if (!approval.leaveStartDate || !approval.leaveEndDate || approval.leaveDuration !== LeaveDuration.FULL_DAY) {
      continue;
    }

    const cursor = new Date(approval.leaveStartDate);
    const end = new Date(approval.leaveEndDate);
    while (cursor <= end) {
      dates.add(`${approval.requesterId}:${dateKey(cursor)}`);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return dates;
}

function buildWeeklyLimitRisk(input: {
  companyId: string;
  userId: string;
  weeklyMinutes: number;
  weeklyLimitMinutes: number;
}) {
  if (input.weeklyMinutes < 40 * 60) {
    return null;
  }

  const overLimit = input.weeklyMinutes >= input.weeklyLimitMinutes;
  const level = overLimit ? RiskLevel.CRITICAL : input.weeklyMinutes >= 48 * 60 ? RiskLevel.HIGH : RiskLevel.MEDIUM;
  return {
    companyId: input.companyId,
    userId: input.userId,
    type: RiskType.WEEKLY_LIMIT,
    level,
    title: overLimit ? "주52시간 초과 위험" : "주간 근로시간 주의",
    message: overLimit
      ? `이번 주 누적 근로시간이 ${formatMinutes(input.weeklyMinutes)}입니다. 주52시간 기준을 초과했거나 초과 가능성이 높습니다.`
      : `이번 주 누적 근로시간이 ${formatMinutes(input.weeklyMinutes)}입니다. 초과근로 승인 여부를 미리 확인하세요.`,
    evidence: {
      weeklyMinutes: input.weeklyMinutes,
      weeklyLimitMinutes: input.weeklyLimitMinutes
    }
  } satisfies RiskDraft;
}

export async function refreshRiskSignalsForUserIds(input: {
  companyId: string;
  userIds: string[];
  actorUserId?: string | null;
  writeAudit?: boolean;
}) {
  const userIds = [...new Set(input.userIds)].filter(Boolean);
  if (userIds.length === 0) {
    return [];
  }

  const since = daysAgoDateOnly(13);
  const today = getKstDateString();
  const tomorrow = addDays(today, 1);
  const now = new Date();
  const { start: weekStart, end: weekEnd } = kstWeekBounds();
  const company = await prisma.company.findUniqueOrThrow({
    where: {
      id: input.companyId
    }
  });

  const [sessions, adjustmentRequests, schedules, approvedLeaves, policy, holidays] = await Promise.all([
    prisma.workSession.findMany({
      where: {
        companyId: input.companyId,
        userId: {
          in: userIds
        },
        workDate: {
          gte: since
        }
      },
      include: {
        approvalRequests: true,
        user: {
          include: {
            team: true
          }
        }
      },
      orderBy: [{ userId: "asc" }, { workDate: "desc" }]
    }),
    prisma.approvalRequest.findMany({
      where: {
        companyId: input.companyId,
        requesterId: {
          in: userIds
        },
        type: ApprovalType.ADJUSTMENT,
        createdAt: {
          gte: since
        }
      }
    }),
    prisma.workSchedule.findMany({
      where: {
        companyId: input.companyId,
        userId: {
          in: userIds
        },
        workDate: {
          gte: since,
          lt: dateOnly(tomorrow)
        }
      },
      orderBy: [{ userId: "asc" }, { workDate: "desc" }]
    }),
    prisma.approvalRequest.findMany({
      where: {
        companyId: input.companyId,
        requesterId: {
          in: userIds
        },
        type: ApprovalType.LEAVE,
        status: ApprovalStatus.APPROVED,
        leaveStartDate: {
          lt: dateOnly(tomorrow)
        },
        leaveEndDate: {
          gte: since
        }
      },
      select: {
        requesterId: true,
        leaveStartDate: true,
        leaveEndDate: true,
        leaveDuration: true
      }
    }),
    getCurrentWorkPolicy(input.companyId, today),
    getCompanyHolidays(input.companyId, since.toISOString().slice(0, 10), today)
  ]);

  const sessionsByUser = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const current = sessionsByUser.get(session.userId) ?? [];
    current.push(session);
    sessionsByUser.set(session.userId, current);
  }

  const schedulesByUser = new Map<string, typeof schedules>();
  for (const schedule of schedules) {
    const current = schedulesByUser.get(schedule.userId) ?? [];
    current.push(schedule);
    schedulesByUser.set(schedule.userId, current);
  }

  const adjustmentCountByUser = new Map<string, number>();
  for (const request of adjustmentRequests) {
    adjustmentCountByUser.set(request.requesterId, (adjustmentCountByUser.get(request.requesterId) ?? 0) + 1);
  }

  const fullDayLeaveDates = buildLeaveDateSet(approvedLeaves);
  const holidayDateSet = buildHolidayDateSet(holidays);
  const drafts: RiskDraft[] = [];

  for (const userId of userIds) {
    const userSessions = sessionsByUser.get(userId) ?? [];
    const userSchedules = schedulesByUser.get(userId) ?? [];
    const sessionByDate = new Map(userSessions.map((session) => [dateKey(session.workDate), session]));
    const weeklyMinutes = userSessions
      .filter((session) => session.workDate >= weekStart && session.workDate < weekEnd)
      .reduce((sum, session) => sum + session.calculatedWorkMinutes, 0);

    const weeklyRisk = buildWeeklyLimitRisk({
      companyId: input.companyId,
      userId,
      weeklyMinutes,
      weeklyLimitMinutes: company.weeklyLimitMinutes
    });
    if (weeklyRisk) {
      drafts.push(weeklyRisk);
    }

    const overtimeSessions = userSessions.filter((session) => session.overtimeMinutes > 0);
    if (overtimeSessions.length >= 3) {
      drafts.push({
        companyId: input.companyId,
        userId,
        type: RiskType.REPEATED_OVERTIME,
        level: RiskLevel.HIGH,
        title: "반복 야근 발생",
        message: `최근 2주간 초과근로가 ${overtimeSessions.length}회 발생했습니다. 업무 배분이나 사전 승인 기준을 점검하세요.`,
        evidence: {
          overtimeSessionCount: overtimeSessions.length,
          totalOvertimeMinutes: overtimeSessions.reduce((sum, session) => sum + session.overtimeMinutes, 0)
        }
      });
    }

    let unapprovedOvertimeSessionCount = 0;
    let missingEvidenceSessionCount = 0;
    const totalOvertimeMinutes = overtimeSessions.reduce((sum, session) => sum + session.overtimeMinutes, 0);

    for (const session of overtimeSessions) {
      const overtimeApprovals = session.approvalRequests.filter((request) => request.type === ApprovalType.OVERTIME);
      const hasApprovedOvertime = overtimeApprovals.some((request) => request.status === ApprovalStatus.APPROVED);
      const hasUsefulReason = overtimeApprovals.some((request) => request.reason.trim().length >= 12);

      if (!hasApprovedOvertime) {
        unapprovedOvertimeSessionCount += 1;
        drafts.push({
          companyId: input.companyId,
          userId,
          sessionId: session.id,
          type: RiskType.UNAPPROVED_OVERTIME,
          level: RiskLevel.HIGH,
          title: "무승인 초과근로",
          message: `${session.workDate.toISOString().slice(0, 10)}에 ${formatMinutes(session.overtimeMinutes)}의 초과근로가 있으나 승인 완료 이력이 없습니다.`,
          evidence: {
            workDate: session.workDate.toISOString().slice(0, 10),
            overtimeMinutes: session.overtimeMinutes,
            approvalCount: overtimeApprovals.length
          }
        });
      }

      if (!hasUsefulReason) {
        missingEvidenceSessionCount += 1;
        drafts.push({
          companyId: input.companyId,
          userId,
          sessionId: session.id,
          type: RiskType.MISSING_EVIDENCE,
          level: RiskLevel.MEDIUM,
          title: "증빙 부족",
          message: `${session.workDate.toISOString().slice(0, 10)} 초과근로에 대한 사유나 승인 근거가 부족합니다.`,
          evidence: {
            workDate: session.workDate.toISOString().slice(0, 10),
            overtimeMinutes: session.overtimeMinutes,
            reasonCount: overtimeApprovals.filter((request) => request.reason.trim().length > 0).length
          }
        });
      }
    }

    if (
      overtimeSessions.length >= 3 &&
      totalOvertimeMinutes >= 6 * 60 &&
      (unapprovedOvertimeSessionCount >= 2 || missingEvidenceSessionCount >= 2)
    ) {
      drafts.push({
        companyId: input.companyId,
        userId,
        type: RiskType.INCLUSIVE_WAGE_RISK,
        level: totalOvertimeMinutes >= 10 * 60 ? RiskLevel.CRITICAL : RiskLevel.HIGH,
        title: "포괄임금 오인 운영 위험",
        message: `최근 2주간 초과근로가 ${overtimeSessions.length}회, 총 ${formatMinutes(totalOvertimeMinutes)} 발생했고 승인/증빙 부족 패턴이 반복됩니다. 포괄임금 운영으로 오인될 수 있는 정산 근거를 확인하세요.`,
        evidence: {
          overtimeSessionCount: overtimeSessions.length,
          totalOvertimeMinutes,
          unapprovedOvertimeSessionCount,
          missingEvidenceSessionCount
        }
      });
    }

    for (const schedule of userSchedules) {
      const workDate = dateKey(schedule.workDate);
      if (fullDayLeaveDates.has(`${userId}:${workDate}`)) {
        continue;
      }

      const session = sessionByDate.get(workDate);
      const lateCutoff = new Date(schedule.scheduledStartAt.getTime() + 20 * 60 * 1000);
      const missingCutoff = new Date(schedule.scheduledEndAt.getTime() + 30 * 60 * 1000);

      if (workDate === today && now > lateCutoff && now <= missingCutoff && !session?.checkInAt) {
        drafts.push({
          companyId: input.companyId,
          userId,
          type: RiskType.LATE_RISK,
          level: RiskLevel.HIGH,
          title: "지각 위험",
          message: `스케줄 시작 후 20분이 지났지만 ${schedule.shiftName} 출근 기록이 없습니다.`,
          evidence: {
            workDate,
            scheduledStartAt: schedule.scheduledStartAt.toISOString(),
            cutoffAt: lateCutoff.toISOString()
          }
        });
      }

      const shouldCheckMissing = workDate < today || (workDate === today && now > missingCutoff);
      if (shouldCheckMissing) {
        const missingCheckIn = !session?.checkInAt;
        const missingCheckOut = !session?.checkOutAt;

        if (missingCheckIn || missingCheckOut) {
          drafts.push({
            companyId: input.companyId,
            userId,
            sessionId: session?.id,
            type: RiskType.MISSING_CHECK_IN_OUT,
            level: RiskLevel.HIGH,
            title: "출퇴근 누락 가능성",
            message: missingCheckIn && missingCheckOut
              ? `${workDate} 스케줄이 있었지만 출근과 퇴근 기록이 모두 없습니다.`
              : missingCheckIn
                ? `${workDate} 퇴근 기록은 있으나 출근 기록이 없어 확인이 필요합니다.`
                : `${workDate} 출근 기록은 있으나 퇴근 기록이 없어 근무 종료 확인이 필요합니다.`,
            evidence: {
              workDate,
              shiftName: schedule.shiftName,
              scheduledStartAt: schedule.scheduledStartAt.toISOString(),
              scheduledEndAt: schedule.scheduledEndAt.toISOString(),
              checkInAt: session?.checkInAt?.toISOString() ?? null,
              checkOutAt: session?.checkOutAt?.toISOString() ?? null
            }
          });
          continue;
        }
      }

      if (!session?.checkInAt) {
        continue;
      }

      const startGap = absoluteMinuteDifference(schedule.scheduledStartAt, session.checkInAt);
      const endGap = session.checkOutAt ? absoluteMinuteDifference(schedule.scheduledEndAt, session.checkOutAt) : 0;
      const mismatchMinutes = Math.max(startGap, endGap);

      if (mismatchMinutes >= 30) {
        drafts.push({
          companyId: input.companyId,
          userId,
          sessionId: session.id,
          type: RiskType.SCHEDULE_MISMATCH,
          level: mismatchMinutes >= 90 ? RiskLevel.HIGH : RiskLevel.MEDIUM,
          title: "스케줄 대비 실제 근무 이탈",
          message: `${workDate} 근무가 계획 대비 최대 ${formatMinutes(mismatchMinutes)} 차이났습니다. 스케줄 또는 근태 정정 여부를 확인하세요.`,
          evidence: {
            workDate,
            shiftName: schedule.shiftName,
            startGapMinutes: startGap,
            endGapMinutes: endGap,
            scheduledStartAt: schedule.scheduledStartAt.toISOString(),
            scheduledEndAt: schedule.scheduledEndAt.toISOString(),
            checkInAt: session.checkInAt.toISOString(),
            checkOutAt: session.checkOutAt?.toISOString() ?? null
          }
        });
      }
    }

    for (const session of userSessions) {
      const nightWorkMinutes = calculateNightWorkMinutes(session, policy);
      const holidayWorkMinutes = calculateHolidayWorkMinutes(session, policy, holidayDateSet);
      const specialWorkMinutes = nightWorkMinutes + holidayWorkMinutes;

      if (specialWorkMinutes >= 60) {
        const workDate = dateKey(session.workDate);
        drafts.push({
          companyId: input.companyId,
          userId,
          sessionId: session.id,
          type: RiskType.NIGHT_HOLIDAY_WORK,
          level: holidayWorkMinutes > 0 || nightWorkMinutes >= 3 * 60 ? RiskLevel.HIGH : RiskLevel.MEDIUM,
          title: "야간·휴일근로 확인 필요",
          message: `${workDate}에 야간 ${formatMinutes(nightWorkMinutes)}, 휴일 ${formatMinutes(holidayWorkMinutes)} 근로가 감지되었습니다. 급여 가산과 승인 근거를 확인하세요.`,
          evidence: {
            workDate,
            nightWorkMinutes,
            holidayWorkMinutes,
            approvedOvertimeMinutes: session.approvedOvertimeMinutes
          }
        });
      }

      if (session.grossMinutes < 8 * 60 || session.breakMinutes >= company.defaultBreakMinutes) {
        continue;
      }

      drafts.push({
        companyId: input.companyId,
        userId,
        sessionId: session.id,
        type: RiskType.BREAK_VIOLATION,
        level: session.grossMinutes >= 10 * 60 ? RiskLevel.HIGH : RiskLevel.MEDIUM,
        title: "휴게시간 부족 가능성",
        message: `${dateKey(session.workDate)} 총 체류시간이 ${formatMinutes(session.grossMinutes)}인데 휴게는 ${session.breakMinutes}분만 기록되었습니다.`,
        evidence: {
          workDate: dateKey(session.workDate),
          grossMinutes: session.grossMinutes,
          breakMinutes: session.breakMinutes,
          requiredBreakMinutes: company.defaultBreakMinutes
        }
      });
    }

    const adjustmentCount = adjustmentCountByUser.get(userId) ?? 0;
    if (adjustmentCount >= 3) {
      drafts.push({
        companyId: input.companyId,
        userId,
        type: RiskType.ADJUSTMENT_SPIKE,
        level: RiskLevel.MEDIUM,
        title: "근태 정정 요청 증가",
        message: `최근 2주간 근태 정정 요청이 ${adjustmentCount}회 발생했습니다. 기록 방식이나 승인 기준을 확인하세요.`,
        evidence: {
          adjustmentCount
        }
      });
    }
  }

  await prisma.riskSignal.deleteMany({
    where: {
      companyId: input.companyId,
      userId: {
        in: userIds
      },
      resolvedAt: null
    }
  });

  if (drafts.length > 0) {
    await prisma.riskSignal.createMany({
      data: drafts.map((draft) => ({
        ...draft,
        signature: buildRiskWorkflowKeyFromSignal(draft)
      }))
    });
  }

  if (input.writeAudit) {
    await writeAuditLog({
      companyId: input.companyId,
      actorUserId: input.actorUserId ?? null,
      action: "risk.recalculated",
      targetType: "risk_signal",
      targetId: input.companyId,
      payload: {
        userCount: userIds.length,
        signalCount: drafts.length
      }
    });
  }

  return drafts;
}

export async function refreshManagedRiskSignals(actor: Actor, options?: { writeAudit?: boolean }) {
  const users = await getManagedUsers(actor);
  await refreshRiskSignalsForUserIds({
    companyId: actor.companyId,
    userIds: users.map((user) => user.id),
    actorUserId: actor.id,
    writeAudit: options?.writeAudit
  });
  return users;
}

export async function getRiskAssignableUsers(companyId: string) {
  return prisma.user.findMany({
    where: {
      companyId,
      isActive: true,
      role: {
        in: ["ADMIN", "HR", "MANAGER"]
      }
    },
    select: {
      id: true,
      name: true,
      role: true,
      team: {
        select: {
          name: true
        }
      }
    },
    orderBy: [{ role: "asc" }, { name: "asc" }]
  });
}

type RiskWorkflowSnapshot = {
  workflowKey: string;
  status: RiskWorkflowStatusValue;
  assignedToId: string | null;
  workflowNote: string | null;
  resolutionNote: string | null;
  resolutionType: RiskResolutionTypeValue;
  resolutionReferenceId: string | null;
  resolutionReferenceLabel: string | null;
  title: string | null;
  userId: string | null;
  level: RiskLevel | null;
  createdAt: Date;
  actorName: string | null;
};

function parseRiskWorkflowPayload(
  input: unknown
): Omit<RiskWorkflowSnapshot, "createdAt" | "actorName"> | null {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
  if (!record) {
    return null;
  }

  const status = record.status;
  if (status !== "OPEN" && status !== "IN_PROGRESS" && status !== "RESOLVED" && status !== "DISMISSED") {
    return null;
  }

  const resolutionType = record.resolutionType;
  const validResolutionType =
    resolutionType === "AUTO" ||
    resolutionType === "MANUAL" ||
    resolutionType === "APPROVAL" ||
    resolutionType === "ADJUSTMENT" ||
    resolutionType === "SCHEDULE" ||
    resolutionType === "MONTH_CLOSE" ||
    resolutionType === "OTHER"
      ? resolutionType
      : "NONE";

  return {
    workflowKey: typeof record.workflowKey === "string" ? record.workflowKey : "",
    status,
    assignedToId: typeof record.assignedToId === "string" ? record.assignedToId : null,
    workflowNote: typeof record.workflowNote === "string" ? record.workflowNote : null,
    resolutionNote: typeof record.resolutionNote === "string" ? record.resolutionNote : null,
    resolutionType: validResolutionType,
    resolutionReferenceId: typeof record.resolutionReferenceId === "string" ? record.resolutionReferenceId : null,
    resolutionReferenceLabel:
      typeof record.resolutionReferenceLabel === "string" ? record.resolutionReferenceLabel : null,
    title: typeof record.title === "string" ? record.title : null,
    userId: typeof record.userId === "string" ? record.userId : null,
    level:
      record.level === "LOW" || record.level === "MEDIUM" || record.level === "HIGH" || record.level === "CRITICAL"
        ? (record.level as RiskLevel)
        : null
  };
}

async function getLatestRiskWorkflowSnapshots(companyId: string, workflowKeys: string[]) {
  if (workflowKeys.length === 0) {
    return new Map<string, RiskWorkflowSnapshot>();
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      companyId,
      targetType: "risk_workflow",
      targetId: {
        in: workflowKeys
      }
    },
    include: {
      actor: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  const latestByKey = new Map<string, RiskWorkflowSnapshot>();
  for (const log of logs) {
    const parsed = parseRiskWorkflowPayload(log.payload);
    if (!parsed || !parsed.workflowKey || latestByKey.has(parsed.workflowKey)) {
      continue;
    }

    latestByKey.set(parsed.workflowKey, {
      ...parsed,
      createdAt: log.createdAt,
      actorName: log.actor?.name ?? null
    });
  }

  return latestByKey;
}

export async function resolveRiskSignalsForAction(input: {
  companyId: string;
  userId: string;
  actorUserId?: string | null;
  targetDate?: string | null;
  types?: RiskType[];
  resolutionType: RiskResolutionTypeValue;
  resolutionReferenceId?: string | null;
  resolutionReferenceLabel?: string | null;
  resolutionNote?: string | null;
}) {
  const candidates = await prisma.riskSignal.findMany({
    where: {
      companyId: input.companyId,
      userId: input.userId,
      resolvedAt: null,
      type: input.types?.length
        ? {
            in: input.types
          }
        : undefined
    }
  });

  const matchingSignals = candidates
    .filter((signal) => {
      if (!input.targetDate) {
        return true;
      }

      return riskWorkDateFromEvidence(signal.evidence) === input.targetDate;
    });

  if (matchingSignals.length === 0) {
    return 0;
  }

  for (const signal of matchingSignals) {
    const workflowKey = buildRiskWorkflowKeyFromSignal(signal);
    await writeAuditLog({
      companyId: input.companyId,
      actorUserId: input.actorUserId ?? null,
      action: "risk.auto_resolved",
      targetType: "risk_workflow",
      targetId: workflowKey,
      payload: {
        workflowKey,
        status: "RESOLVED",
        userId: signal.userId,
        title: signal.title,
        level: signal.level,
        resolutionType: input.resolutionType,
        resolutionReferenceId: input.resolutionReferenceId ?? null,
        resolutionReferenceLabel: input.resolutionReferenceLabel ?? null,
        resolutionNote: input.resolutionNote?.trim() || null
      }
    });
  }

  return matchingSignals.length;
}

export async function updateRiskWorkflow(actor: Actor, input: {
  riskId: string;
  status: WorkflowStatusInput;
  assignedToId?: string | null;
  workflowNote?: string | null;
  resolutionNote?: string | null;
  resolutionType?: RiskResolutionTypeValue;
  resolutionReferenceId?: string | null;
  resolutionReferenceLabel?: string | null;
}) {
  const risk = await prisma.riskSignal.findUnique({
    where: {
      id: input.riskId
    },
    include: {
      user: {
        include: {
          team: true
        }
      }
    }
  });

  if (!risk || risk.companyId !== actor.companyId) {
    throw new Error("리스크를 찾을 수 없습니다.");
  }

  if (actor.role === "MANAGER") {
    const managedUsers = await getManagedUsers(actor);
    if (!managedUsers.some((user) => user.id === risk.userId)) {
      throw new Error("관리할 수 있는 팀의 리스크만 처리할 수 있습니다.");
    }
  }

  let assignedToId: string | null | undefined = undefined;
  if (input.assignedToId !== undefined) {
    assignedToId = input.assignedToId?.trim() || null;
    if (assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: {
          id: assignedToId,
          companyId: actor.companyId,
          isActive: true,
          role: {
            in: ["ADMIN", "HR", "MANAGER"]
          }
        },
        select: {
          id: true
        }
      });

      if (!assignee) {
        throw new Error("담당자는 같은 회사의 관리자 계정이어야 합니다.");
      }
    }
  }

  const workflowKey = buildRiskWorkflowKeyFromSignal(risk);
  const nextStatus = input.status;
  const isResolvedState = nextStatus === "RESOLVED" || nextStatus === "DISMISSED";
  const workflowNote = input.workflowNote?.trim() || null;
  const resolutionNote = input.resolutionNote?.trim() || null;
  const resolutionType = isResolvedState ? input.resolutionType ?? "MANUAL" : "NONE";
  const resolutionReferenceId = isResolvedState ? input.resolutionReferenceId?.trim() || null : null;
  const resolutionReferenceLabel = isResolvedState ? input.resolutionReferenceLabel?.trim() || null : null;
  const assignee = assignedToId
    ? await prisma.user.findUnique({
        where: {
          id: assignedToId
        },
        select: {
          id: true,
          name: true,
          role: true
        }
      })
    : null;

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "risk.workflow.updated",
    targetType: "risk_workflow",
    targetId: workflowKey,
    payload: {
      workflowKey,
      riskId: risk.id,
      userId: risk.userId,
      title: risk.title,
      level: risk.level,
      status: nextStatus,
      statusLabel: riskStatusLabel(nextStatus),
      assignedToId,
      workflowNote,
      resolutionNote,
      resolutionType,
      resolutionReferenceId,
      resolutionReferenceLabel
    }
  });

  return {
    ...risk,
    status: nextStatus,
    assignedTo: assignee,
    workflowNote,
    resolutionNote,
    resolutionType,
    resolutionReferenceId,
    resolutionReferenceLabel
  };
}

async function getDecoratedOpenRiskSignals(input: {
  companyId: string;
  userIds: string[];
}) {
  const since28Days = daysAgoDateOnly(27);
  const [signals, assignableUsers, recentSignals] = await Promise.all([
    prisma.riskSignal.findMany({
      where: {
        companyId: input.companyId,
        userId: {
          in: input.userIds
        },
        resolvedAt: null
      },
      include: {
        user: {
          include: {
            team: true
          }
        },
        session: true
      },
      orderBy: {
        detectedAt: "desc"
      }
    }),
    getRiskAssignableUsers(input.companyId),
    prisma.riskSignal.findMany({
      where: {
        companyId: input.companyId,
        userId: {
          in: input.userIds
        },
        detectedAt: {
          gte: since28Days
        }
      },
      select: {
        userId: true,
        type: true,
        detectedAt: true
      }
    })
  ]);

  const assignableUserMap = new Map(assignableUsers.map((user) => [user.id, user]));
  const recurrenceMap = recentSignals.reduce<Map<string, { count28d: number; recentDates: string[] }>>((acc, signal) => {
    const key = `${signal.userId}:${signal.type}`;
    const current = acc.get(key) ?? {
      count28d: 0,
      recentDates: []
    };
    current.count28d += 1;
    current.recentDates.push(signal.detectedAt.toISOString().slice(0, 10));
    acc.set(key, current);
    return acc;
  }, new Map());
  const workflowKeys = signals.map((signal) => buildRiskWorkflowKeyFromSignal(signal));
  const workflowByKey = await getLatestRiskWorkflowSnapshots(input.companyId, workflowKeys);

  const decoratedSignals = signals
    .map((signal) => {
      const workflowKey = buildRiskWorkflowKeyFromSignal(signal);
      const workflow = workflowByKey.get(workflowKey);
      const status = workflow?.status ?? "OPEN";
      const assignedTo = workflow?.assignedToId ? assignableUserMap.get(workflow.assignedToId) ?? null : null;
      const base = {
        ...signal,
        status,
        assignedTo,
        workflowNote: workflow?.workflowNote ?? null,
        resolutionNote: workflow?.resolutionNote ?? null,
        resolutionType: workflow?.resolutionType ?? "NONE",
        resolutionReferenceLabel: workflow?.resolutionReferenceLabel ?? null,
        workflowUpdatedAt: workflow?.createdAt ?? null
      };
      const sla = riskSlaStatusForSignal({
        status,
        assignedTo,
        detectedAt: signal.detectedAt,
        workflowUpdatedAt: workflow?.createdAt ?? null
      });

      return {
        ...base,
        ...sla,
        slaLabel: riskSlaStatusLabel(sla.slaStatus),
        explanation: buildRiskExplanation({
          signal,
          recurrence: recurrenceMap.get(`${signal.userId}:${signal.type}`) ?? {
            count28d: 1,
            recentDates: [signal.detectedAt.toISOString().slice(0, 10)]
          }
        })
      };
    })
    .filter((signal) => signal.status !== "RESOLVED" && signal.status !== "DISMISSED");

  return {
    assignableUsers,
    workflowByKey,
    signals: decoratedSignals
  };
}

export async function getRiskDashboard(actor: Actor) {
  const users = await refreshManagedRiskSignals(actor);
  const userIds = users.map((user) => user.id);

  const [{ signals, assignableUsers, workflowByKey }, pendingApprovals] = await Promise.all([
    getDecoratedOpenRiskSignals({
      companyId: actor.companyId,
      userIds
    }),
    prisma.approvalRequest.findMany({
      where: {
        companyId: actor.companyId,
        requesterId: {
          in: userIds
        },
        status: ApprovalStatus.PENDING
      }
    })
  ]);

  const assignableUserMap = new Map(assignableUsers.map((user) => [user.id, user]));
  const sortedSignals = signals.sort((a, b) => severityRank[b.level] - severityRank[a.level]);
  const inProgressCount = sortedSignals.filter((signal) => signal.status === "IN_PROGRESS").length;
  const openCount = sortedSignals.filter((signal) => signal.status === "OPEN").length;
  const overdueCount = sortedSignals.filter((signal) => signal.slaStatus === "OVERDUE").length;
  const atRiskCount = sortedSignals.filter((signal) => signal.slaStatus === "AT_RISK").length;
  const unassignedCount = sortedSignals.filter((signal) => signal.slaStatus === "UNASSIGNED").length;
  const typeCounts = sortedSignals.reduce<Record<RiskType, number>>(
    (acc, signal) => {
      acc[signal.type] += 1;
      return acc;
    },
    {
      WEEKLY_LIMIT: 0,
      UNAPPROVED_OVERTIME: 0,
      REPEATED_OVERTIME: 0,
      MISSING_EVIDENCE: 0,
      ADJUSTMENT_SPIKE: 0,
      LATE_RISK: 0,
      MISSING_CHECK_IN_OUT: 0,
      BREAK_VIOLATION: 0,
      SCHEDULE_MISMATCH: 0,
      NIGHT_HOLIDAY_WORK: 0,
      INCLUSIVE_WAGE_RISK: 0
    }
  );

  const highRiskCount = sortedSignals.filter((signal) => signal.level === "HIGH" || signal.level === "CRITICAL").length;
  const topSignal = sortedSignals[0] ?? null;
  const aiComments = [
    topSignal
      ? `AI가 근무 패턴을 분석했습니다. 현재 가장 높은 리스크는 '${topSignal.title}'이며 ${topSignal.user.name}에게서 감지되었습니다.`
      : "AI가 근무 패턴을 분석했습니다. 현재 즉시 조치가 필요한 노무 리스크는 없습니다.",
    pendingApprovals.length > 0
      ? `승인 대기 ${pendingApprovals.length}건이 남아 있습니다. 초과근로 확정 전 증빙을 먼저 확인하세요.`
      : "초과근로 승인 대기는 없습니다. 현재 승인 흐름은 안정적입니다.",
    highRiskCount > 0
      ? `위험 이상 리스크가 ${highRiskCount}건입니다. 관리자 확인과 사유 보완이 필요합니다.`
      : "위험 수준 리스크는 감지되지 않았습니다."
  ];

  return {
    generatedAt: new Date(),
    stats: {
      totalSignals: sortedSignals.length,
      highRiskCount,
      openCount,
      inProgressCount,
      overdueCount,
      atRiskCount,
      unassignedCount,
      pendingApprovals: pendingApprovals.length,
      weeklyLimitRisks: typeCounts.WEEKLY_LIMIT,
      unapprovedOvertimeRisks: typeCounts.UNAPPROVED_OVERTIME,
      repeatedOvertimeRisks: typeCounts.REPEATED_OVERTIME,
      missingEvidenceRisks: typeCounts.MISSING_EVIDENCE,
      lateRisks: typeCounts.LATE_RISK,
      missingCheckRisks: typeCounts.MISSING_CHECK_IN_OUT,
      breakViolationRisks: typeCounts.BREAK_VIOLATION,
      scheduleMismatchRisks: typeCounts.SCHEDULE_MISMATCH,
      nightHolidayWorkRisks: typeCounts.NIGHT_HOLIDAY_WORK,
      inclusiveWageRisks: typeCounts.INCLUSIVE_WAGE_RISK
    },
    typeCounts,
    aiComments,
    assignableUsers,
    recentlyResolved: [...workflowByKey.values()]
      .filter((snapshot) => snapshot.status === "RESOLVED")
      .slice(0, 6)
      .map((snapshot) => ({
        id: snapshot.workflowKey,
        type: "WORKFLOW",
        level: snapshot.level ?? RiskLevel.MEDIUM,
        levelLabel: riskLevelLabel(snapshot.level ?? RiskLevel.MEDIUM),
        title: snapshot.title ?? "리스크 해소",
        message: snapshot.resolutionNote ?? snapshot.workflowNote ?? "최근 해결된 리스크입니다.",
        status: snapshot.status,
        workflowNote: snapshot.workflowNote,
        resolutionNote: snapshot.resolutionNote,
        resolutionType: snapshot.resolutionType,
        resolutionReferenceLabel: snapshot.resolutionReferenceLabel,
        detectedAt: snapshot.createdAt,
        slaStatus: "ON_TRACK",
        slaLabel: riskSlaStatusLabel("ON_TRACK"),
        slaAgeHours: 0,
        user: {
          name: users.find((user) => user.id === snapshot.userId)?.name ?? "직원",
          team: {
            name: users.find((user) => user.id === snapshot.userId)?.team?.name ?? "소속 없음"
          }
        },
        assignedTo: snapshot.assignedToId ? assignableUserMap.get(snapshot.assignedToId) ?? null : null
      })),
    signals: sortedSignals.map((signal) => ({
      ...signal,
      levelLabel: riskLevelLabel(signal.level)
    }))
  };
}

export async function getCompanyRiskEscalationCandidates(companyId: string) {
  const [users, managerUsers] = await Promise.all([
    prisma.user.findMany({
      where: {
        companyId,
        isActive: true
      },
      select: {
        id: true
      }
    }),
    prisma.user.findMany({
      where: {
        companyId,
        isActive: true,
        role: {
          in: ["ADMIN", "HR", "MANAGER"]
        }
      },
      select: {
        id: true,
        role: true,
        name: true
      }
    })
  ]);

  const userIds = users.map((user) => user.id);
  await refreshRiskSignalsForUserIds({
    companyId,
    userIds
  });

  const { signals } = await getDecoratedOpenRiskSignals({
    companyId,
    userIds
  });
  const escalationManagers = managerUsers.filter((user) => user.role === "ADMIN" || user.role === "HR");

  return signals
    .filter((signal) => signal.slaStatus !== "ON_TRACK")
    .map((signal) => {
      const recipientIds =
        signal.slaStatus === "UNASSIGNED"
          ? escalationManagers.map((user) => user.id)
          : signal.slaStatus === "OVERDUE"
            ? Array.from(
                new Set([
                  ...(signal.assignedTo?.id ? [signal.assignedTo.id] : []),
                  ...escalationManagers.map((user) => user.id)
                ])
              )
            : Array.from(
                new Set([
                  ...(signal.assignedTo?.id ? [signal.assignedTo.id] : []),
                  ...(!signal.assignedTo ? escalationManagers.map((user) => user.id) : [])
                ])
              );

      return {
        signal,
        recipientIds,
        escalationLevel: signal.slaStatus
      };
    })
    .filter((entry) => entry.recipientIds.length > 0);
}

export async function getLaborRiskReport(actor: Actor) {
  await refreshManagedRiskSignals(actor);
  const month = getKstDateString().slice(0, 7);
  const { start, end } = kstMonthBounds(month);

  const [signals, auditLogs, monthlyReport, evidenceSummary, auditTrail] = await Promise.all([
    prisma.riskSignal.findMany({
      where: {
        companyId: actor.companyId,
        resolvedAt: null
      },
      include: {
        user: {
          include: {
            team: true
          }
        },
        session: true
      },
      orderBy: {
        detectedAt: "desc"
      }
    }),
    prisma.auditLog.findMany({
      where: {
        companyId: actor.companyId
      },
      include: {
        actor: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 40
    }),
    getMonthlyReport(actor, month),
    getEvidenceSecuritySummary(actor.companyId),
    getAuditTrailEntries(actor.companyId, 20)
  ]);

  return {
    generatedAt: new Date(),
    company: monthlyReport.company,
    period: {
      month,
      start,
      end
    },
    signals: signals.sort((a, b) => severityRank[b.level] - severityRank[a.level]),
    sessions: monthlyReport.sessions,
    approvalRequests: monthlyReport.approvalRequests,
    leaveRequests: monthlyReport.leaveRequests,
    adjustmentRequests: monthlyReport.adjustmentRequests,
    scheduleVarianceRows: monthlyReport.scheduleVarianceRows,
    breakRiskRows: monthlyReport.breakRiskRows,
    auditLogs,
    evidenceSummary,
    auditTrail
  };
}

export function laborRiskReportToCsv(report: Awaited<ReturnType<typeof getLaborRiskReport>>) {
  const csvLine = (row: string[]) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",");
  const signalRows = report.signals.map((signal) => [
    signal.detectedAt.toISOString(),
    signal.level,
    signal.type,
    signal.user.team?.name ?? "",
    signal.user.name,
    signal.title,
    signal.message,
    signal.session?.workDate.toISOString().slice(0, 10) ?? ""
  ]);

  const leaveRows = report.leaveRequests.map((request) => [
    request.createdAt.toISOString(),
    request.requester.team?.name ?? "",
    request.requester.name,
    request.leaveType ?? "",
    request.leaveDuration ?? "",
    request.leaveStartDate?.toISOString().slice(0, 10) ?? "",
    request.leaveEndDate?.toISOString().slice(0, 10) ?? "",
    request.status,
    String(request.attachments.length),
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
    request.reason
  ]);

  return [
    csvLine(["risk_signals"]),
    csvLine(["detected_at", "level", "type", "team", "name", "title", "message", "work_date"]),
    ...signalRows.map(csvLine),
    "",
    csvLine(["leave_requests"]),
    csvLine([
      "requested_at",
      "team",
      "name",
      "leave_type",
      "duration",
      "start_date",
      "end_date",
      "status",
      "attachment_count",
      "reason"
    ]),
    ...leaveRows.map(csvLine),
    "",
    csvLine(["adjustment_requests"]),
    csvLine([
      "requested_at",
      "team",
      "name",
      "adjustment_type",
      "target_date",
      "requested_time",
      "status",
      "attachment_count",
      "reason"
    ]),
    ...adjustmentRows.map(csvLine)
  ].join("\n");
}

import { AlertTriangle, CalendarClock, FileText, ShieldCheck, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  AutomationSettingsForm,
  CompanyPlanSettingsForm,
  CompanySettingsForm,
  EvidenceSecuritySettingsForm,
  HolidayCalendarForm,
  HolidayDeleteButton,
  IntegrationSettingsForm,
  InvitationCreateForm,
  InvitationActionButtons,
  OnboardingChecklistForm,
  PolicySettingsForm,
  TeamCreateForm,
  TeamEditList,
  UserEditList,
  WorkLocationSettingsForm
} from "@/components/admin-settings-actions";
import {
  ApprovalFilterPresetBar,
  ApprovalInboxManager,
  DashboardPersonalizationPanel,
  RiskWorkflowBoard,
  WeeklyScheduleBoard
} from "@/components/dashboard-advanced-actions";
import { OrganizationPanel } from "@/components/organization-panel";
import { GroupwarePanel } from "@/components/groupware-panel";
import {
  ActiveSessionsPanel,
  ApprovalButtons,
  AttendanceButtons,
  BrowserPushBridge,
  DashboardMobileNav,
  FieldQueueStatusBar,
  LeaveBalanceAdjustmentForm,
  LeaveBalanceAdjustmentRevokeButton,
  LeaveRequestLifecycleButton,
  LeaveRequestForm,
  LogoutButton,
  MonthCloseActions,
  MissingClockAdjustmentForm,
  NotificationCenter,
  NotificationSettingsForm,
  OvertimeRequestForm,
  PwaInstallCard,
  PasswordChangeForm,
  RefreshRisksButton,
  ScheduleCreateForm,
  StatusChangeForm
} from "@/components/dashboard-actions";
import { WorkboxPanel } from "@/components/workbox-actions";
import { listActiveSessions } from "@/lib/account-security";
import { getAdminSettings } from "@/lib/admin";
import { getApprovalInbox, getApprovalRelatedSchedule } from "@/lib/approvals";
import { canAdminSettings, canManage, canViewReports, getCurrentAuthSession, requireCurrentUser } from "@/lib/auth";
import { getAttendanceSnapshot } from "@/lib/attendance";
import { getDashboardPersonalization } from "@/lib/dashboard-personalization";
import { getGroupwareDashboard } from "@/lib/groupware";
import { getAnnualLeaveSummaryForUser } from "@/lib/leave";
import { getManagerDashboard } from "@/lib/manager";
import { getNotificationCenter } from "@/lib/notifications";
import { getOrganizationDashboard } from "@/lib/organization";
import { getPayrollReport } from "@/lib/payroll";
import { getCurrentWorkPolicy } from "@/lib/policy-engine";
import {
  invitationEmailStatusLabel,
  invitationEmailStatusTone,
  invitationStatusLabel,
  invitationStatusTone,
  monthCloseMetricLabel,
  monthCloseReopenStatusLabel,
  monthCloseReopenStatusTone,
  roleLabel,
  sessionStatusLabel,
  validationStatusLabel
} from "@/lib/display-labels";
import { getMonthlyReport } from "@/lib/reports";
import { getLaborRiskReport, getRiskDashboard } from "@/lib/risks";
import { getEmployeeScheduleBoard, getManagedScheduleBoard } from "@/lib/schedule";
import { formatKstDate, formatKstDateTime, formatKstTime, formatMinutes } from "@/lib/time";
import { formatFileSize } from "@/lib/uploads";
import { getWorkboxDashboard } from "@/lib/workbox";

const statusLabels: Record<string, string> = {
  WORKING: "근무중",
  MEETING: "회의",
  OUTSIDE: "외근",
  BUSINESS_TRIP: "출장",
  TRAINING: "교육",
  BREAK: "휴게",
  OTHER: "기타",
  OFFLINE: "오프라인"
};

const eventLabels: Record<string, string> = {
  CHECK_IN: "출근",
  CHECK_OUT: "퇴근",
  STATUS_CHANGE: "상태 변경"
};

const statusOptions = [
  { value: "WORKING", label: "근무중" },
  { value: "MEETING", label: "회의" },
  { value: "OUTSIDE", label: "외근" },
  { value: "BUSINESS_TRIP", label: "출장" },
  { value: "TRAINING", label: "교육" },
  { value: "BREAK", label: "휴게" },
  { value: "OTHER", label: "기타" }
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

function approvalTypeLabel(type: string) {
  if (type === "OVERTIME") {
    return "초과근로";
  }
  if (type === "LEAVE") {
    return "휴가";
  }
  return "근태 정정";
}

function payrollCloseStatusLabel(status: string) {
  return status === "READY" ? "준비 완료" : "확인 필요";
}

function approvalStatusMeta(input: { status: string; type?: string; reviewNote?: string | null }) {
  if (input.type === "LEAVE" && input.status === "REJECTED" && input.reviewNote?.startsWith("[철회]")) {
    return { label: "철회", tone: "gray" };
  }

  if (input.type === "LEAVE" && input.status === "REJECTED" && input.reviewNote?.startsWith("[취소]")) {
    return { label: "취소", tone: "gray" };
  }

  const labels: Record<string, string> = {
    PENDING: "대기",
    APPROVED: "승인",
    REJECTED: "반려"
  };

  if (input.status === "APPROVED") {
    return { label: labels[input.status] ?? input.status, tone: "green" };
  }
  if (input.status === "REJECTED") {
    return { label: labels[input.status] ?? input.status, tone: "red" };
  }
  return { label: labels[input.status] ?? input.status, tone: "yellow" };
}

function leaveTypeLabel(type?: string | null) {
  const labels: Record<string, string> = {
    ANNUAL: "연차",
    SICK: "병가",
    OFFICIAL: "공가",
    UNPAID: "무급휴가"
  };
  return labels[type ?? ""] ?? "휴가";
}

function leaveDurationLabel(duration?: string | null) {
  const labels: Record<string, string> = {
    FULL_DAY: "종일",
    HALF_DAY_AM: "오전 반차",
    HALF_DAY_PM: "오후 반차",
    HOURLY: "시간차"
  };
  return labels[duration ?? ""] ?? "종일";
}

function adjustmentTypeLabel(type?: string | null) {
  const labels: Record<string, string> = {
    GENERAL: "일반 정정",
    MISSING_CHECK_IN: "출근 누락",
    MISSING_CHECK_OUT: "퇴근 누락"
  };
  return labels[type ?? ""] ?? "근태 정정";
}

function formatDays(days: number) {
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(days)}일`;
}

function formatRate(rate: number) {
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(rate)}x`;
}

function roleWorkspaceMeta(role: string) {
  if (role === "ADMIN") {
    return {
      title: "관리자 작업",
      description: "설정과 외부 연동, 계정 운영을 먼저 확인하도록 기본 화면을 맞춥니다.",
      focusView: "settings" as DashboardView
    };
  }

  if (role === "HR") {
    return {
      title: "인사 담당 작업",
      description: "월 마감, 급여, 리포트 중심으로 바로 진입하도록 기본 화면을 맞춥니다.",
      focusView: "reports" as DashboardView
    };
  }

  if (role === "MANAGER") {
    return {
      title: "팀장 작업",
      description: "승인함과 현장 대응을 먼저 보도록 기본 화면을 맞춥니다.",
      focusView: "approvals" as DashboardView
    };
  }

  return {
    title: "직원 작업",
    description: "출퇴근 기록, 신청, 알림을 바로 처리할 수 있게 근로기록 화면을 기본으로 둡니다.",
    focusView: "employee" as DashboardView
  };
}

function formatMonthCloseMetricValue(key: string, value: number) {
  if (key.endsWith("Minutes")) {
    return formatMinutes(value);
  }

  if (key.toLowerCase().includes("days")) {
    return formatDays(value);
  }

  if (key === "leaveBalanceDeficitUsers" || key === "readyCount" || key === "actionRequiredCount") {
    return `${value}명`;
  }

  return `${value}건`;
}

function summarizeMonthCloseDiff(diff: unknown) {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) {
    return "변동 없음";
  }

  const items = Array.isArray((diff as { items?: unknown }).items)
    ? ((diff as { items: Array<{ key?: string; delta?: number }> }).items ?? [])
    : [];

  if (items.length === 0) {
    return "변동 없음";
  }

  return items
    .slice(0, 2)
    .map((item) => {
      const key = typeof item.key === "string" ? item.key : "-";
      const delta = typeof item.delta === "number" ? item.delta : 0;
      return `${monthCloseMetricLabel(key)} ${delta > 0 ? `+${delta}` : delta}`;
    })
    .join(" · ");
}

function buildMissingAdjustmentReasonTemplate(input: {
  adjustmentType: "MISSING_CHECK_IN" | "MISSING_CHECK_OUT";
  date: string;
  time: string;
}) {
  const label = input.adjustmentType === "MISSING_CHECK_IN" ? "출근" : "퇴근";
  return `알림에서 ${input.date} ${label} 누락 가능성을 확인했습니다. 실제 ${label} 시간은 ${input.time}이며 기록 반영을 요청합니다.`;
}

function monthCloseStatusLabel(status: "OPEN" | "CLOSED") {
  return status === "CLOSED" ? "마감 완료" : "진행 중";
}

function payrollSyncStatusLabel(status?: "PENDING" | "APPLIED") {
  return status === "APPLIED" ? "급여 반영 완료" : "반영 대기";
}

function monthCloseEventLabel(type: string) {
  const labels: Record<string, string> = {
    CLOSED: "마감 확정",
    REOPENED: "재오픈",
    PAYROLL_APPLIED: "급여 반영",
    PAYROLL_PENDING: "급여 반영 해제",
    EXPORT: "급여 내보내기"
  };
  return labels[type] ?? type;
}

function monthCloseEventSummary(
  type: string,
  detail: unknown
) {
  const record = detail && typeof detail === "object" && !Array.isArray(detail)
    ? (detail as Record<string, unknown>)
    : null;

  if (type === "REOPENED") {
    return typeof record?.reason === "string" ? record.reason : "-";
  }

  if (type !== "CLOSED") {
    return "-";
  }

  const diff = record?.diffFromPreviousClose;
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) {
    return "이전 스냅샷 대비 변동 없음";
  }

  const items = Array.isArray((diff as { items?: unknown }).items)
    ? ((diff as { items: Array<{ key?: string; delta?: number }> }).items ?? [])
    : [];

  const changed = items.filter((item) => typeof item.key === "string" && typeof item.delta === "number" && item.delta !== 0);
  if (changed.length === 0) {
    return "이전 스냅샷 대비 변동 없음";
  }

  return changed
    .slice(0, 2)
    .map((item) => {
      const delta = item.delta ?? 0;
      return `${item.key} ${delta > 0 ? "+" : ""}${delta}`;
    })
    .join(", ");
}

function leaveBalanceAdjustmentStatusMeta(status: "ACTIVE" | "REVERSED" | "REVERSAL") {
  if (status === "ACTIVE") {
    return { label: "적용됨", tone: "green" };
  }

  if (status === "REVERSED") {
    return { label: "취소됨", tone: "gray" };
  }

  return { label: "되돌림", tone: "gray" };
}

function scheduleWindow(schedule: { scheduledStartAt: Date; scheduledEndAt: Date }) {
  return `${formatKstTime(schedule.scheduledStartAt)} - ${formatKstTime(schedule.scheduledEndAt)}`;
}

function approvalSummary(approval: {
  type: string;
  requestedMinutes: number | null;
  requestedLeaveMinutes?: number | null;
  reason: string;
  adjustmentType?: string | null;
  targetDate?: Date | null;
  requestedAt?: Date | null;
  leaveType?: string | null;
  leaveStartDate?: Date | null;
  leaveEndDate?: Date | null;
  leaveDuration?: string | null;
}) {
  if (approval.type === "LEAVE") {
    const period = approval.leaveStartDate && approval.leaveEndDate
      ? `${formatKstDate(approval.leaveStartDate)} ~ ${formatKstDate(approval.leaveEndDate)}`
      : "기간 미지정";
    const hourlyText =
      approval.leaveDuration === "HOURLY" && approval.requestedLeaveMinutes
        ? ` · ${formatMinutes(approval.requestedLeaveMinutes)}`
        : "";
    return `${leaveTypeLabel(approval.leaveType)} · ${period} · ${leaveDurationLabel(approval.leaveDuration)}${hourlyText}`;
  }

  if (approval.type === "ADJUSTMENT") {
    const requestedTime = approval.requestedAt ? formatKstTime(approval.requestedAt) : "-";
    return `${adjustmentTypeLabel(approval.adjustmentType)} · ${formatKstDate(approval.targetDate)} ${requestedTime}`;
  }

  return approval.requestedMinutes ? `요청 시간 ${formatMinutes(approval.requestedMinutes)}` : approval.reason;
}

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type DashboardView = "employee" | "groupware" | "organization" | "workbox" | "notifications" | "risk" | "approvals" | "reports" | "settings";
type NotificationGroupParam = "ALL" | "APPROVAL" | "LEAVE" | "MISSING" | "MONTH_CLOSE" | "OTHER";
type RiskStatusFilter = "ALL" | "OPEN" | "IN_PROGRESS" | "RESOLVED" | "DISMISSED";
type RiskTypeFilter =
  | "ALL"
  | "WEEKLY_LIMIT"
  | "UNAPPROVED_OVERTIME"
  | "REPEATED_OVERTIME"
  | "MISSING_EVIDENCE"
  | "ADJUSTMENT_SPIKE"
  | "LATE_RISK"
  | "MISSING_CHECK_IN_OUT"
  | "BREAK_VIOLATION"
  | "SCHEDULE_MISMATCH"
  | "NIGHT_HOLIDAY_WORK"
  | "INCLUSIVE_WAGE_RISK";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function dashboardViewHref(
  view: DashboardView,
  params?: Record<string, string | undefined>,
  hash?: string
) {
  const search = new URLSearchParams();
  search.set("view", view);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        search.set(key, value);
      }
    }
  }

  return `/dashboard?${search.toString()}${hash ? `#${hash}` : ""}`;
}

function dashboardViewMeta(view: DashboardView) {
  if (view === "notifications") {
    return {
      title: "알림 센터",
      description: "승인, 누락, 휴가 시작, 월 마감 알림을 한 화면에서 확인합니다."
    };
  }

  if (view === "workbox") {
    return {
      title: "업무함",
      description: "승인, 리스크, 월마감 업무를 댓글과 멘션으로 함께 처리합니다."
    };
  }

  if (view === "groupware") {
    return {
      title: "그룹웨어",
      description: "연락처, 메모, 급여명세를 한 화면에서 처리합니다."
    };
  }

  if (view === "organization") {
    return {
      title: "조직도",
      description: "팀 구조, 직원 프로필, 오늘 근무 상태를 한 화면에서 확인합니다."
    };
  }

  if (view === "risk") {
    return {
      title: "노무 리스크",
      description: "미처리 리스크, 대응 시간, 처리 현황을 한눈에 확인합니다."
    };
  }

  if (view === "approvals") {
    return {
      title: "승인함",
      description: "휴가, 정정, 초과근로 요청을 필터 기준으로 빠르게 처리합니다."
    };
  }

  if (view === "reports") {
    return {
      title: "인사 리포트",
      description: "근로시간, 월 마감, 급여 내보내기, 리스크 리포트를 내려받습니다."
    };
  }

  if (view === "settings") {
    return {
      title: "설정",
      description: "비밀번호, 활성 세션, 회사 운영 설정을 한곳에서 관리합니다."
    };
  }

  return {
    title: "근로기록",
    description: "출퇴근 기록, 상태 변경, 스케줄과 신청 내역을 직원 화면 단위로 확인합니다."
  };
}

function dashboardApprovalsHref(params?: {
  type?: string;
  teamId?: string;
  from?: string;
  to?: string;
  approvalId?: string;
}, hash?: string) {
  return dashboardViewHref(
    "approvals",
    {
      approvalType: params?.type,
      approvalTeamId: params?.teamId,
      approvalFrom: params?.from,
      approvalTo: params?.to,
      approvalId: params?.approvalId
    },
    hash
  );
}

function dashboardNotificationsHref(params?: {
  group?: NotificationGroupParam;
  unreadOnly?: boolean;
}, hash?: string) {
  return dashboardViewHref(
    "notifications",
    {
      notificationGroup: params?.group && params.group !== "ALL" ? params.group : undefined,
      notificationUnreadOnly: params?.unreadOnly ? "1" : undefined
    },
    hash
  );
}

function dashboardRiskHref(params?: {
  status?: RiskStatusFilter;
  type?: RiskTypeFilter;
  riskId?: string;
}, hash?: string) {
  return dashboardViewHref(
    "risk",
    {
      riskStatus: params?.status && params.status !== "ALL" ? params.status : undefined,
      riskType: params?.type && params.type !== "ALL" ? params.type : undefined,
      riskId: params?.riskId
    },
    hash
  );
}

function DashboardMetricLink({
  label,
  value,
  href,
  caption
}: {
  label: string;
  value: ReactNode;
  href: string;
  caption?: ReactNode;
}) {
  return (
    <Link className="metric interactive-card" href={href}>
      <span>{label}</span>
      <strong style={{ fontSize: 22 }}>{value}</strong>
      {caption ? (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          {caption}
        </p>
      ) : null}
    </Link>
  );
}

function DashboardStatusPillLink({
  href,
  className,
  children
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <Link className={`${className} interactive-pill`} href={href}>
      {children}
    </Link>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const query = (await searchParams) ?? {};
  const rawView = firstValue(query.view) ?? "";
  const rawApprovalType = firstValue(query.approvalType) ?? "";
  const rawApprovalTeamId = firstValue(query.approvalTeamId) ?? "";
  const rawApprovalFrom = firstValue(query.approvalFrom) ?? "";
  const rawApprovalTo = firstValue(query.approvalTo) ?? "";
  const approvalId = firstValue(query.approvalId) ?? "";
  const rawNotificationGroup = firstValue(query.notificationGroup) ?? "";
  const rawNotificationUnreadOnly = firstValue(query.notificationUnreadOnly) ?? "";
  const orgUserId = firstValue(query.orgUserId) ?? "";
  const orgTeamId = firstValue(query.orgTeamId) ?? "";
  const orgStatus = firstValue(query.orgStatus) ?? "";
  const orgSearch = firstValue(query.orgSearch) ?? "";
  const groupwareSearch = firstValue(query.groupwareSearch) ?? "";
  const rawWorkboxFilter = firstValue(query.workboxFilter) ?? "";
  const workThreadId = firstValue(query.workThreadId) ?? "";
  const rawRiskStatus = firstValue(query.riskStatus) ?? "";
  const rawRiskType = firstValue(query.riskType) ?? "";
  const focusedRiskId = firstValue(query.riskId) ?? "";
  const adjustmentTypeQuery = firstValue(query.adjustmentType) ?? "";
  const adjustmentDateQuery = firstValue(query.adjustmentDate) ?? "";
  const adjustmentTimeQuery = firstValue(query.adjustmentTime) ?? "";
  const adjustmentSourceQuery = firstValue(query.adjustmentSource) ?? "";

  const user = await requireCurrentUser();
  const currentAuthSession = await getCurrentAuthSession();
  const dashboardPersonalization = canManage(user.role) ? await getDashboardPersonalization(user) : null;
  const approvalType = rawApprovalType || dashboardPersonalization?.defaultApprovalFilters.type || "";
  const approvalTeamId = rawApprovalTeamId || dashboardPersonalization?.defaultApprovalFilters.teamId || "";
  const approvalFrom = rawApprovalFrom || dashboardPersonalization?.defaultApprovalFilters.from || "";
  const approvalTo = rawApprovalTo || dashboardPersonalization?.defaultApprovalFilters.to || "";
  const notificationCenter = await getNotificationCenter(user);
  const organizationData = await getOrganizationDashboard(user, {
    selectedUserId: orgUserId,
    teamId: orgTeamId,
    status: orgStatus,
    search: orgSearch
  });
  const workboxData = await getWorkboxDashboard(user, {
    filter: rawWorkboxFilter,
    threadId: workThreadId
  });
  const groupwareData = await getGroupwareDashboard(user, {
    search: groupwareSearch
  });
  const currentPolicy = await getCurrentWorkPolicy(user.companyId);
  const snapshot = await getAttendanceSnapshot(user.id);
  const employeeScheduleBoard = await getEmployeeScheduleBoard(user.id);
  const employeeAnnualLeave = await getAnnualLeaveSummaryForUser({
    companyId: user.companyId,
    user,
    asOfDate: employeeScheduleBoard.today
  });
  const managerData = canManage(user.role) ? await getManagerDashboard(user) : null;
  const approvalInbox = canManage(user.role)
    ? await getApprovalInbox(user, {
        type: approvalType as "OVERTIME" | "ADJUSTMENT" | "LEAVE" | "",
        teamId: approvalTeamId,
        from: approvalFrom,
        to: approvalTo
      })
    : null;
  const managedScheduleBoard = canManage(user.role) ? await getManagedScheduleBoard(user) : null;
  const riskData = canManage(user.role) ? await getRiskDashboard(user) : null;
  const monthlyReport = canViewReports(user.role) ? await getMonthlyReport(user) : null;
  const laborRiskReport = canViewReports(user.role) ? await getLaborRiskReport(user) : null;
  const payrollReport = canViewReports(user.role) ? await getPayrollReport(user) : null;
  const adminSettings = canAdminSettings(user.role) ? await getAdminSettings(user) : null;
  const activeSessions = await listActiveSessions(user.id, currentAuthSession?.id ?? null);

  const session = snapshot.session;
  const canCheckIn = !session?.checkInAt;
  const canCheckOut = Boolean(session?.checkInAt && !session?.checkOutAt);
  const overtimeMinutes = session?.overtimeMinutes ?? 0;
  const selectedApproval =
    approvalInbox?.approvals.find((approval) => approval.id === approvalId) ?? approvalInbox?.approvals[0] ?? null;
  const selectedApprovalSchedule = selectedApproval
    ? await getApprovalRelatedSchedule({
        companyId: user.companyId,
        requesterId: selectedApproval.requesterId,
        targetDate: selectedApproval.targetDate ?? selectedApproval.session?.workDate ?? selectedApproval.leaveStartDate ?? null
      })
    : null;
  const missingAdjustmentType =
    adjustmentTypeQuery === "MISSING_CHECK_OUT" ? "MISSING_CHECK_OUT" : "MISSING_CHECK_IN";
  const missingAdjustmentDate = DATE_PATTERN.test(adjustmentDateQuery)
    ? adjustmentDateQuery
    : employeeScheduleBoard.today;
  const missingAdjustmentTime = TIME_PATTERN.test(adjustmentTimeQuery)
    ? adjustmentTimeQuery
    : missingAdjustmentType === "MISSING_CHECK_IN"
      ? "09:00"
      : "18:00";
  const missingAdjustmentFromNotification = adjustmentSourceQuery === "notification";
  const missingAdjustmentDefaultReason = missingAdjustmentFromNotification
    ? buildMissingAdjustmentReasonTemplate({
        adjustmentType: missingAdjustmentType,
        date: missingAdjustmentDate,
        time: missingAdjustmentTime
      })
    : "";
  const missingAdjustmentFormKey = `${missingAdjustmentType}:${missingAdjustmentDate}:${missingAdjustmentTime}:${missingAdjustmentFromNotification ? "notification" : "manual"}`;
  const notificationGroup = (
    ["ALL", "APPROVAL", "LEAVE", "MISSING", "MONTH_CLOSE", "OTHER"] as const
  ).includes(rawNotificationGroup as NotificationGroupParam)
    ? (rawNotificationGroup as NotificationGroupParam)
    : "ALL";
  const notificationUnreadOnly = rawNotificationUnreadOnly === "1";
  const riskStatusFilter = (
    ["ALL", "OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"] as const
  ).includes(rawRiskStatus as RiskStatusFilter)
    ? (rawRiskStatus as RiskStatusFilter)
    : "ALL";
  const riskTypeFilter = (
    [
      "ALL",
      "WEEKLY_LIMIT",
      "UNAPPROVED_OVERTIME",
      "REPEATED_OVERTIME",
      "MISSING_EVIDENCE",
      "ADJUSTMENT_SPIKE",
      "LATE_RISK",
      "MISSING_CHECK_IN_OUT",
      "BREAK_VIOLATION",
      "SCHEDULE_MISMATCH",
      "NIGHT_HOLIDAY_WORK",
      "INCLUSIVE_WAGE_RISK"
    ] as const
  ).includes(rawRiskType as RiskTypeFilter)
    ? (rawRiskType as RiskTypeFilter)
    : "ALL";
  const managerWidgetData = canManage(user.role)
    ? {
        myAssignedRisks: riskData?.signals.filter((signal) => signal.assignedTo?.id === user.id).length ?? 0,
        todayApprovals: approvalInbox?.approvals.length ?? 0,
        weekBlockers: payrollReport ? Object.values(payrollReport.blockingSummary).reduce((sum, value) => sum + value, 0) : 0
      }
    : null;
  const availableViews: DashboardView[] = [
    "employee",
    "groupware",
    "organization",
    "workbox",
    "notifications",
    ...(riskData ? (["risk"] as const) : []),
    ...(managerData && approvalInbox ? (["approvals"] as const) : []),
    ...(monthlyReport && laborRiskReport && payrollReport ? (["reports"] as const) : []),
    "settings"
  ];
  const roleWorkspace = roleWorkspaceMeta(user.role);
  const preferredDefaultView: DashboardView =
    approvalId || rawApprovalType || rawApprovalTeamId || rawApprovalFrom || rawApprovalTo
      ? "approvals"
      : adjustmentSourceQuery || adjustmentTypeQuery || adjustmentDateQuery || adjustmentTimeQuery
        ? "employee"
        : roleWorkspace.focusView;
  const activeView = availableViews.includes(rawView as DashboardView)
    ? (rawView as DashboardView)
    : availableViews.includes(preferredDefaultView)
      ? preferredDefaultView
      : availableViews[0];
  const activeViewMeta = dashboardViewMeta(activeView);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <Image src="/logo.jpg" alt="워크가드 로고" width={34} height={34} priority />
          <span>워크가드</span>
        </Link>
        <nav className="sidebar-nav" aria-label="대시보드 메뉴">
          <Link
            href={dashboardViewHref("employee")}
            aria-current={activeView === "employee" ? "page" : undefined}
            style={{ fontWeight: activeView === "employee" ? 700 : 500, color: activeView === "employee" ? "#1e3a8a" : undefined }}
          >
            근로기록
          </Link>
          <Link
            href={dashboardViewHref("groupware")}
            aria-current={activeView === "groupware" ? "page" : undefined}
            style={{ fontWeight: activeView === "groupware" ? 700 : 500, color: activeView === "groupware" ? "#1e3a8a" : undefined }}
          >
            그룹웨어
          </Link>
          <Link
            href={dashboardViewHref("organization")}
            aria-current={activeView === "organization" ? "page" : undefined}
            style={{ fontWeight: activeView === "organization" ? 700 : 500, color: activeView === "organization" ? "#1e3a8a" : undefined }}
          >
            조직도
          </Link>
          <Link
            href={dashboardViewHref("workbox")}
            aria-current={activeView === "workbox" ? "page" : undefined}
            style={{ fontWeight: activeView === "workbox" ? 700 : 500, color: activeView === "workbox" ? "#1e3a8a" : undefined }}
          >
            업무함
          </Link>
          <Link
            href={dashboardViewHref("notifications")}
            aria-current={activeView === "notifications" ? "page" : undefined}
            style={{ fontWeight: activeView === "notifications" ? 700 : 500, color: activeView === "notifications" ? "#1e3a8a" : undefined }}
          >
            알림
          </Link>
          {managerData ? (
            <Link
              href={dashboardViewHref("risk")}
              aria-current={activeView === "risk" ? "page" : undefined}
              style={{ fontWeight: activeView === "risk" ? 700 : 500, color: activeView === "risk" ? "#1e3a8a" : undefined }}
            >
              리스크
            </Link>
          ) : null}
          {managerData ? (
            <Link
              href={dashboardViewHref("approvals")}
              aria-current={activeView === "approvals" ? "page" : undefined}
              style={{ fontWeight: activeView === "approvals" ? 700 : 500, color: activeView === "approvals" ? "#1e3a8a" : undefined }}
            >
              승인함
            </Link>
          ) : null}
          {monthlyReport ? (
            <Link
              href={dashboardViewHref("reports")}
              aria-current={activeView === "reports" ? "page" : undefined}
              style={{ fontWeight: activeView === "reports" ? 700 : 500, color: activeView === "reports" ? "#1e3a8a" : undefined }}
            >
              리포트
            </Link>
          ) : null}
          <Link
            href={dashboardViewHref("settings")}
            aria-current={activeView === "settings" ? "page" : undefined}
            style={{ fontWeight: activeView === "settings" ? 700 : 500, color: activeView === "settings" ? "#1e3a8a" : undefined }}
          >
            설정
          </Link>
        </nav>
        <div style={{ marginTop: 28 }} className="stack">
          <div>
            <strong>{user.name}</strong>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              {user.company.name} · {user.team?.name ?? "소속 없음"}
            </p>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <strong>{roleWorkspace.title}</strong>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              {roleWorkspace.description}
            </p>
            {availableViews.includes(roleWorkspace.focusView) && activeView !== roleWorkspace.focusView ? (
              <div className="actions-row" style={{ marginTop: 12 }}>
                <Link className="button secondary" href={dashboardViewHref(roleWorkspace.focusView)}>
                  추천 화면 열기
                </Link>
              </div>
            ) : null}
          </div>
          <LogoutButton />
        </div>
      </aside>

      <main className={`main dashboard-view-${activeView}`}>
        <BrowserPushBridge
          enabled={
            notificationCenter.preference.webPushEnabled &&
            notificationCenter.preference.browserPermission === "granted"
          }
        />
        <FieldQueueStatusBar />
        <div className="topbar">
          <div>
            <h1>{activeViewMeta.title}</h1>
            <p>{activeViewMeta.description}</p>
          </div>
          <div className="actions-row">
            {activeView !== roleWorkspace.focusView && availableViews.includes(roleWorkspace.focusView) ? (
              <Link href={dashboardViewHref(roleWorkspace.focusView)} className="status-pill gray" style={{ textDecoration: "none" }}>
                {roleWorkspace.title}
              </Link>
            ) : null}
            <Link
              href={dashboardViewHref("workbox")}
              className={`status-pill ${workboxData.stats.unread > 0 ? "yellow" : "gray"}`}
              style={{ textDecoration: "none" }}
            >
              업무 {workboxData.stats.unread}건
            </Link>
            <Link
              href={dashboardViewHref("notifications")}
              className={`status-pill ${notificationCenter.unreadCount > 0 ? "yellow" : "gray"}`}
              style={{ textDecoration: "none" }}
            >
              알림 {notificationCenter.unreadCount}건
            </Link>
            {riskData && activeView === "risk" ? <RefreshRisksButton /> : null}
          </div>
        </div>

        {activeView === "organization" ? (
          <section id="organization" className="stack" style={{ marginBottom: 18 }}>
            <OrganizationPanel summary={organizationData} />
          </section>
        ) : null}

        {activeView === "groupware" ? (
          <section id="groupware" className="stack" style={{ marginBottom: 18 }}>
            <GroupwarePanel
              organization={organizationData}
              groupware={groupwareData}
              mentionableUsers={workboxData.mentionableUsers}
              assignableUsers={workboxData.assignableUsers}
              viewerId={user.id}
            />
          </section>
        ) : null}

        {activeView === "workbox" ? (
          <section id="workbox" className="stack" style={{ marginBottom: 18 }}>
            <WorkboxPanel key={workboxData.selectedThread?.id ?? "empty"} summary={workboxData} />
          </section>
        ) : null}

        {activeView === "notifications" ? (
        <section id="notifications" className="stack" style={{ marginBottom: 18 }}>
          <div className="split">
            <div className="panel stack">
              <PwaInstallCard
                showApprovals={Boolean(managerData)}
                showReports={Boolean(monthlyReport)}
                quickApprovals={(approvalInbox?.approvals ?? []).slice(0, 3).map((approval) => ({
                  id: approval.id,
                  type: approvalTypeLabel(approval.type),
                  requesterName: approval.requester.name,
                  ageLabel: approval.ageLabel
                }))}
              />
            </div>
            <div className="panel stack">
              <NotificationCenter
                key={JSON.stringify({
                  preference: notificationCenter.preference,
                  group: notificationGroup,
                  unreadOnly: notificationUnreadOnly
                })}
                unreadCount={notificationCenter.unreadCount}
                notifications={notificationCenter.notifications}
                reminders={notificationCenter.reminders}
                groupwareSummary={notificationCenter.groupwareSummary}
                preference={notificationCenter.preference}
                initialGroup={notificationGroup}
                initialShowUnreadOnly={notificationUnreadOnly}
                archivedNotifications={notificationCenter.archivedNotifications}
                archivedCount={notificationCenter.archivedCount}
              />
            </div>
          </div>
          <div className="panel stack">
            <NotificationSettingsForm
              preference={notificationCenter.preference}
              canRunScheduler={Boolean(monthlyReport)}
            />
          </div>
        </section>
        ) : null}

        {activeView === "employee" ? (
          <>
            <section id="employee" className="split employee-home-layout" style={{ marginBottom: 18 }}>
              <div id="employee-attendance" className="panel stack employee-attendance-card">
                <div className="employee-mobile-focus">
                  <div className="actions-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div className="stack" style={{ gap: 4 }}>
                      <span className="muted">현재 상태</span>
                      <strong>{statusLabels[snapshot.latestStatus]}</strong>
                    </div>
                    <span className={`status-pill ${snapshot.latestStatus === "OFFLINE" ? "gray" : "green"}`}>
                      {canCheckOut ? "근무 중" : canCheckIn ? "출근 전" : "기록 완료"}
                    </span>
                  </div>
                  <div className="employee-mobile-focus-grid">
                    <div>
                      <span>오늘 스케줄</span>
                      <strong>{employeeScheduleBoard.todaySchedule ? scheduleWindow(employeeScheduleBoard.todaySchedule) : "미등록"}</strong>
                    </div>
                    <div>
                      <span>출근</span>
                      <strong>{formatKstTime(session?.checkInAt)}</strong>
                    </div>
                    <div>
                      <span>퇴근</span>
                      <strong>{formatKstTime(session?.checkOutAt)}</strong>
                    </div>
                  </div>
                  <div className="employee-mobile-shortcuts">
                    <Link href={dashboardViewHref("employee", undefined, "employee-qr")} className="status-pill gray">
                      QR
                    </Link>
                    <Link href={dashboardViewHref("notifications")} className="status-pill gray">
                      알림 {notificationCenter.unreadCount}건
                    </Link>
                    <Link href={dashboardViewHref("employee", undefined, "employee-requests")} className="status-pill gray">
                      신청
                    </Link>
                    <Link href={dashboardViewHref("employee", undefined, "employee-events")} className="status-pill gray">
                      내역
                    </Link>
                  </div>
                </div>

                <div className="actions-row employee-desktop-summary" style={{ justifyContent: "space-between" }}>
                  <div>
                    <h2 style={{ margin: "0 0 8px" }}>오늘 근로기록</h2>
                    <p className="muted" style={{ margin: 0 }}>
                      직원이 직접 남긴 기록과 승인 이력이 나중에 근로시간 증빙이 됩니다.
                    </p>
                  </div>
                  <span className={`status-pill ${snapshot.latestStatus === "OFFLINE" ? "gray" : "green"}`}>
                    {statusLabels[snapshot.latestStatus]}
                  </span>
                </div>

                <div className="grid-4 employee-attendance-metrics">
                  <DashboardMetricLink
                    label="출근"
                    value={formatKstDateTime(session?.checkInAt)}
                    href={dashboardViewHref("employee", undefined, "employee-events")}
                    caption="오늘 기록 흐름 보기"
                  />
                  <DashboardMetricLink
                    label="퇴근"
                    value={formatKstDateTime(session?.checkOutAt)}
                    href={dashboardViewHref("employee", undefined, "employee-events")}
                    caption="오늘 기록 흐름 보기"
                  />
                  <DashboardMetricLink
                    label="인정 근로시간"
                    value={formatMinutes(session?.calculatedWorkMinutes ?? 0)}
                    href={dashboardViewHref("employee", undefined, "employee-events")}
                    caption="세부 이벤트 확인"
                  />
                  <DashboardMetricLink
                    label="초과근로"
                    value={formatMinutes(overtimeMinutes)}
                    href={dashboardApprovalsHref({ type: "OVERTIME" })}
                    caption="초과근로 승인 요청으로 이동"
                  />
                </div>

                <AttendanceButtons canCheckIn={canCheckIn} canCheckOut={canCheckOut} />
              </div>

              <div className="panel stack">
                <h2 style={{ margin: 0 }}>상태와 초과근로</h2>
                <StatusChangeForm options={statusOptions} />
                <OvertimeRequestForm defaultMinutes={overtimeMinutes} />
              </div>
            </section>

            <section className="split" style={{ marginBottom: 18 }}>
              <div id="employee-schedule" className="panel stack">
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <h2 style={{ margin: "0 0 8px" }}>이번 주 스케줄과 휴가</h2>
                    <p className="muted" style={{ margin: 0 }}>
                      기존 근무 화면은 유지하고, 일정과 휴가 요청만 카드로 확장했습니다.
                    </p>
                  </div>
                  <DashboardStatusPillLink
                    href={dashboardViewHref("employee", undefined, "employee-schedule")}
                    className="status-pill"
                  >
                    {employeeScheduleBoard.upcomingSchedules.length}개 일정
                  </DashboardStatusPillLink>
                </div>

            <div className="grid-3">
              <DashboardMetricLink
                label="오늘 스케줄"
                value={employeeScheduleBoard.todaySchedule ? scheduleWindow(employeeScheduleBoard.todaySchedule) : "미등록"}
                href={dashboardViewHref("employee", undefined, "employee-schedule")}
                caption="주간 스케줄 표 열기"
              />
              <DashboardMetricLink
                label="근무명"
                value={employeeScheduleBoard.todaySchedule?.shiftName ?? "스케줄 없음"}
                href={dashboardViewHref("employee", undefined, "employee-schedule")}
                caption="오늘 근무 상세 보기"
              />
              <DashboardMetricLink
                label="기본 휴게"
                value={employeeScheduleBoard.todaySchedule ? `${employeeScheduleBoard.todaySchedule.breakMinutes}분` : "-"}
                href={dashboardViewHref("employee", undefined, "employee-schedule")}
                caption="스케줄 정책 확인"
              />
            </div>

            {employeeScheduleBoard.upcomingSchedules.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>일정</th>
                      <th>근무명</th>
                      <th>시간</th>
                      <th>메모</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeScheduleBoard.upcomingSchedules.slice(0, 6).map((schedule) => (
                      <tr key={schedule.id}>
                        <td>{formatKstDate(schedule.workDate)}</td>
                        <td>{schedule.shiftName}</td>
                        <td>{scheduleWindow(schedule)}</td>
                        <td>{schedule.note ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">등록된 스케줄이 없습니다. 관리자에게 근무 일정을 요청하세요.</div>
            )}

            <div id="employee-leave" className="panel stack" style={{ background: "#fbfdff" }}>
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>연차 잔액</h3>
                <DashboardStatusPillLink
                  href={dashboardViewHref("employee", undefined, "employee-leave")}
                  className={`status-pill ${
                    employeeAnnualLeave.summary.deficitDays > 0
                      ? "red"
                      : employeeAnnualLeave.summary.availableToRequestDays <= 1
                        ? "yellow"
                        : "green"
                  }`}
                >
                  잔여 {formatDays(employeeAnnualLeave.summary.remainingDays)}
                </DashboardStatusPillLink>
              </div>
              <div className="grid-4">
                <DashboardMetricLink label="부여" value={formatDays(employeeAnnualLeave.summary.grantedDays)} href={dashboardViewHref("employee", undefined, "employee-leave")} />
                <DashboardMetricLink label="승인 차감" value={formatDays(employeeAnnualLeave.summary.approvedDays)} href={dashboardViewHref("employee", undefined, "employee-leave")} />
                <DashboardMetricLink label="대기" value={formatDays(employeeAnnualLeave.summary.pendingDays)} href={dashboardViewHref("employee", undefined, "employee-requests")} caption="최근 요청으로 이동" />
                <DashboardMetricLink label="신청 가능" value={formatDays(employeeAnnualLeave.summary.availableToRequestDays)} href={dashboardViewHref("employee", undefined, "employee-leave")} />
                <DashboardMetricLink label="기본 잔액" value={formatDays(employeeAnnualLeave.summary.baseRemainingDays)} href={dashboardViewHref("employee", undefined, "employee-leave")} />
                <DashboardMetricLink label="이월 잔액" value={formatDays(employeeAnnualLeave.summary.carryoverRemainingDays)} href={dashboardViewHref("employee", undefined, "employee-leave")} />
                <DashboardMetricLink label="반차 가능" value={`${employeeAnnualLeave.summary.remainingHalfDayUnits}회`} href={dashboardViewHref("employee", undefined, "employee-leave")} />
                <DashboardMetricLink label="시간차 가능" value={formatMinutes(employeeAnnualLeave.summary.remainingHourlyMinutes)} href={dashboardViewHref("employee", undefined, "employee-leave")} />
              </div>
              <p className="muted" style={{ margin: 0 }}>
                주기 {employeeAnnualLeave.summary.cycleStart} ~ {employeeAnnualLeave.summary.cycleEnd} · 이월 만료{" "}
                {employeeAnnualLeave.summary.carryoverExpiryDate}
                {employeeAnnualLeave.summary.carryoverDays > 0
                  ? ` · 이월 ${formatDays(employeeAnnualLeave.summary.carryoverDays)}`
                  : ""}
                {employeeAnnualLeave.summary.expiringCarryoverDays > 0
                  ? ` · 만료 예정 ${formatDays(employeeAnnualLeave.summary.expiringCarryoverDays)}`
                  : ""}
                {employeeAnnualLeave.summary.manualAdjustmentDays !== 0
                  ? ` · 수동 조정 ${employeeAnnualLeave.summary.manualAdjustmentDays > 0 ? "+" : ""}${formatDays(
                      employeeAnnualLeave.summary.manualAdjustmentDays
                    )}`
                  : ""}
              </p>
            </div>

            <LeaveRequestForm
              defaultDate={employeeScheduleBoard.today}
              allowHalfDay={currentPolicy.allowHalfDayLeave}
              allowHourly={currentPolicy.allowHourlyLeave}
              hourlyLeaveUnitMinutes={currentPolicy.hourlyLeaveUnitMinutes}
            />
          </div>

          <div className="panel stack">
            <div id="missing-adjustment">
              <h2 style={{ margin: "0 0 8px" }}>출퇴근 누락 수정</h2>
              <p className="muted" style={{ margin: 0 }}>
                출근 또는 퇴근 버튼을 놓친 경우 날짜와 시간을 지정해 승인 요청을 남깁니다.
              </p>
            </div>
            <MissingClockAdjustmentForm
              key={missingAdjustmentFormKey}
              defaultDate={missingAdjustmentDate}
              defaultAdjustmentType={missingAdjustmentType}
              defaultRequestedTime={missingAdjustmentTime}
              defaultReason={missingAdjustmentDefaultReason}
              autoFocusReason={missingAdjustmentFromNotification}
            />

            <div id="employee-requests" className="panel stack" style={{ background: "#fbfdff" }}>
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>최근 요청 현황</h3>
                <DashboardStatusPillLink
                  href={dashboardViewHref("employee", undefined, "employee-requests")}
                  className="status-pill gray"
                >
                  {employeeScheduleBoard.recentRequests.length}건
                </DashboardStatusPillLink>
              </div>
              {employeeScheduleBoard.recentRequests.length > 0 ? (
                <div className="stack" style={{ gap: 12 }}>
                  {employeeScheduleBoard.recentRequests.slice(0, 5).map((request) => (
                    <div className="card" key={request.id}>
                      {(() => {
                        const approvalStatus = approvalStatusMeta({
                          status: request.status,
                          type: request.type,
                          reviewNote: request.reviewNote
                        });
                        const requestDate = request.leaveStartDate?.toISOString().slice(0, 10) ?? "";
                        const canWithdraw = request.type === "LEAVE" && request.status === "PENDING";
                        const canCancel =
                          request.type === "LEAVE" && request.status === "APPROVED" && requestDate > employeeScheduleBoard.today;

                        return (
                          <>
                      <div className="actions-row" style={{ justifyContent: "space-between" }}>
                        <strong>{approvalTypeLabel(request.type)}</strong>
                        <span className={`status-pill ${approvalStatus.tone}`}>
                          {approvalStatus.label}
                        </span>
                      </div>
                      <p style={{ marginTop: 10 }}>{approvalSummary(request)}</p>
                      <p className="muted" style={{ marginTop: 8 }}>
                        {request.reason}
                      </p>
                      <p className="muted" style={{ marginTop: 8 }}>
                        첨부 {request.attachments.length}개
                      </p>
                      {canWithdraw ? <LeaveRequestLifecycleButton approvalId={request.id} mode="withdraw" /> : null}
                      {canCancel ? <LeaveRequestLifecycleButton approvalId={request.id} mode="cancel" /> : null}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">아직 신청한 내역이 없습니다. 휴가, 정정, 초과근로 요청을 올리면 여기에서 확인할 수 있습니다.</div>
              )}
            </div>
              </div>
            </section>

            <section id="employee-events" className="panel stack" style={{ marginBottom: 18 }}>
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>오늘의 기록 흐름</h2>
                <DashboardStatusPillLink
                  href={dashboardViewHref("employee", undefined, "employee-events")}
                  className="status-pill"
                >
                  {snapshot.events.length}개 이벤트
                </DashboardStatusPillLink>
              </div>
              {snapshot.events.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>시간</th>
                        <th>이벤트</th>
                        <th>상태</th>
                        <th>메모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.events.map((event) => (
                        <tr key={event.id}>
                          <td>{formatKstDateTime(event.occurredAt)}</td>
                          <td>{eventLabels[event.eventType]}</td>
                          <td>{event.status ? statusLabels[event.status] : "-"}</td>
                          <td>{event.reason ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">아직 오늘 근무 기록이 없습니다. 출근 버튼을 누르면 기록이 시작됩니다.</div>
              )}
            </section>
          </>
        ) : null}

        {riskData && activeView === "risk" ? (
          <section id="risk" className="stack" style={{ marginBottom: 18 }}>
            <div className="grid-4">
              <DashboardMetricLink label="승인 대기" value={riskData.stats.pendingApprovals} href={dashboardApprovalsHref(undefined, "approvals-inbox")} caption="승인함으로 이동" />
              <DashboardMetricLink label="주52시간 초과 위험" value={riskData.stats.weeklyLimitRisks} href={dashboardRiskHref({ type: "WEEKLY_LIMIT" }, "risk-workflow")} caption="해당 리스크만 보기" />
              <DashboardMetricLink label="무승인 근무 발생" value={riskData.stats.unapprovedOvertimeRisks} href={dashboardRiskHref({ type: "UNAPPROVED_OVERTIME" }, "risk-workflow")} caption="해당 리스크만 보기" />
              <DashboardMetricLink label="증빙 부족" value={riskData.stats.missingEvidenceRisks} href={dashboardRiskHref({ type: "MISSING_EVIDENCE" }, "risk-workflow")} caption="해당 리스크만 보기" />
              <DashboardMetricLink label="미처리" value={riskData.stats.openCount} href={dashboardRiskHref({ status: "OPEN" }, "risk-workflow")} caption="미처리 리스크 보기" />
              <DashboardMetricLink label="처리 중" value={riskData.stats.inProgressCount} href={dashboardRiskHref({ status: "IN_PROGRESS" }, "risk-workflow")} caption="처리 중 리스크 보기" />
              <DashboardMetricLink label="24시간 주의" value={riskData.stats.atRiskCount} href={dashboardRiskHref(undefined, "risk-workflow")} caption="SLA 주의 리스크 확인" />
              <DashboardMetricLink label="48시간 초과" value={riskData.stats.overdueCount} href={dashboardRiskHref(undefined, "risk-workflow")} caption="SLA 초과 리스크 확인" />
              <DashboardMetricLink label="담당자 미지정" value={riskData.stats.unassignedCount} href={dashboardRiskHref({ status: "OPEN" }, "risk-workflow")} caption="담당자 없는 미처리 리스크 보기" />
              <DashboardMetricLink label="지각 위험" value={riskData.stats.lateRisks} href={dashboardRiskHref({ type: "LATE_RISK" }, "risk-workflow")} caption="해당 리스크만 보기" />
              <DashboardMetricLink label="출퇴근 누락" value={riskData.stats.missingCheckRisks} href={dashboardRiskHref({ type: "MISSING_CHECK_IN_OUT" }, "risk-workflow")} caption="해당 리스크만 보기" />
              <DashboardMetricLink label="휴게 부족" value={riskData.stats.breakViolationRisks} href={dashboardRiskHref({ type: "BREAK_VIOLATION" }, "risk-workflow")} caption="해당 리스크만 보기" />
              <DashboardMetricLink label="스케줄 이탈" value={riskData.stats.scheduleMismatchRisks} href={dashboardRiskHref({ type: "SCHEDULE_MISMATCH" }, "risk-workflow")} caption="해당 리스크만 보기" />
              <DashboardMetricLink label="야간/휴일근로" value={riskData.stats.nightHolidayWorkRisks} href={dashboardRiskHref({ type: "NIGHT_HOLIDAY_WORK" }, "risk-workflow")} caption="가산·승인 확인" />
              <DashboardMetricLink label="포괄임금 위험" value={riskData.stats.inclusiveWageRisks} href={dashboardRiskHref({ type: "INCLUSIVE_WAGE_RISK" }, "risk-workflow")} caption="정산 근거 확인" />
            </div>

            <div className="split">
              <div id="risk-workflow" className="panel stack">
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0 }}>
                    <AlertTriangle size={22} /> 리스크 신호
                  </h2>
                  <DashboardStatusPillLink
                    href={dashboardRiskHref(undefined, "risk-workflow")}
                    className="status-pill red"
                  >
                    위험 {riskData.stats.highRiskCount}건
                  </DashboardStatusPillLink>
                </div>
                {riskData.signals.length > 0 ? (
                  <RiskWorkflowBoard
                    key={`${riskStatusFilter}:${riskTypeFilter}:${focusedRiskId || ""}`}
                    signals={riskData.signals.slice(0, dashboardPersonalization?.compactRiskView ? 6 : 12)}
                    assignableUsers={riskData.assignableUsers}
                    recentlyResolved={riskData.recentlyResolved}
                    initialStatusFilter={riskStatusFilter}
                    initialTypeFilter={riskTypeFilter}
                    focusedRiskId={focusedRiskId || null}
                  />
                ) : (
                  <div className="empty">현재 확인이 필요한 노무 리스크가 없습니다.</div>
                )}
              </div>

              <div id="risk-ai" className="panel stack">
                <h2 style={{ margin: 0 }}>
                  <ShieldCheck size={22} /> AI 코멘트
                </h2>
                {riskData.aiComments.map((comment) => (
                  <div className="card" key={comment}>
                    <p>{comment}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {managerData && approvalInbox && activeView === "approvals" ? (
          <section id="approvals" className="stack" style={{ marginBottom: 18 }}>
            {dashboardPersonalization && managerWidgetData ? (
              <div className="grid-3">
                {dashboardPersonalization.showMyAssignedRisks ? (
                  <DashboardMetricLink
                    label="내 담당 리스크"
                    value={managerWidgetData.myAssignedRisks}
                    href={dashboardRiskHref(undefined, "risk-workflow")}
                    caption="리스크 작업보드 열기"
                  />
                ) : null}
                {dashboardPersonalization.showTodayApprovals ? (
                  <DashboardMetricLink
                    label="오늘 처리할 승인"
                    value={managerWidgetData.todayApprovals}
                    href={dashboardApprovalsHref(undefined, "approvals-inbox")}
                    caption="승인함 열기"
                  />
                ) : null}
                {dashboardPersonalization.showWeekBlockers ? (
                  <DashboardMetricLink
                    label="이번 주 마감 전 확인 항목"
                    value={managerWidgetData.weekBlockers}
                    href={dashboardViewHref("reports", undefined, "report-drilldown")}
                    caption="월 마감 상세 보기"
                  />
                ) : null}
              </div>
            ) : null}
            <div className="split">
              <div id="approvals-team" className="panel stack">
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0 }}>
                    <Users size={22} /> 팀 현황
                  </h2>
                  <DashboardStatusPillLink
                    href={dashboardViewHref("approvals", undefined, "approvals-team")}
                    className="status-pill green"
                  >
                    근무중 {managerData.stats.workingUsers}명
                  </DashboardStatusPillLink>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>직원</th>
                        <th>상태</th>
                        <th>오늘 스케줄</th>
                        <th>오늘</th>
                        <th>주간 누적</th>
                      </tr>
                    </thead>
                    <tbody>
                      {managerData.teamRows.map((row) => (
                        <tr key={row.user.id}>
                          <td>
                            {row.user.name}
                            <br />
                            <span className="muted">{row.user.team?.name ?? "소속 없음"}</span>
                          </td>
                          <td>
                            <span className={`status-pill ${row.latestStatus === "OFFLINE" ? "gray" : "green"}`}>
                              {statusLabels[row.latestStatus]}
                            </span>
                          </td>
                          <td>{row.todaySchedule ? scheduleWindow(row.todaySchedule) : "미등록"}</td>
                          <td>{formatMinutes(row.session?.calculatedWorkMinutes ?? 0)}</td>
                          <td>{formatMinutes(row.weeklyMinutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div id="approvals-inbox" className="panel stack">
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0 }}>
                    <CalendarClock size={22} /> 승인함
                  </h2>
                  <DashboardStatusPillLink
                    href={dashboardApprovalsHref(undefined, "approvals-inbox")}
                    className="status-pill yellow"
                  >
                    {approvalInbox.stats.total}건
                  </DashboardStatusPillLink>
                </div>

                <form action="/dashboard" className="inline-form">
                  <input type="hidden" name="view" value="approvals" />
                  <div className="grid-4">
                    <div className="field">
                      <label htmlFor="approval-type-filter">유형</label>
                      <select id="approval-type-filter" name="approvalType" defaultValue={approvalType}>
                        <option value="">전체</option>
                        <option value="OVERTIME">초과근로</option>
                        <option value="LEAVE">휴가</option>
                        <option value="ADJUSTMENT">근태 정정</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="approval-team-filter">팀</label>
                      <select id="approval-team-filter" name="approvalTeamId" defaultValue={approvalTeamId}>
                        <option value="">전체 팀</option>
                        {approvalInbox.teams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="approval-from-filter">요청 시작일</label>
                      <input id="approval-from-filter" name="approvalFrom" type="date" defaultValue={approvalFrom} />
                    </div>
                    <div className="field">
                      <label htmlFor="approval-to-filter">요청 종료일</label>
                      <input id="approval-to-filter" name="approvalTo" type="date" defaultValue={approvalTo} />
                    </div>
                  </div>
                  <div className="actions-row">
                    <button className="button secondary" type="submit">
                      필터 적용
                    </button>
                    <Link className="button secondary" href={dashboardViewHref("approvals")}>
                      초기화
                    </Link>
                  </div>
                </form>

                <ApprovalFilterPresetBar
                  filters={{
                    type: approvalType,
                    teamId: approvalTeamId,
                    from: approvalFrom,
                    to: approvalTo
                  }}
                />
                {dashboardPersonalization ? (
                  <DashboardPersonalizationPanel
                    personalization={dashboardPersonalization}
                    currentApprovalFilters={{
                      type: approvalType,
                      teamId: approvalTeamId,
                      from: approvalFrom,
                      to: approvalTo
                    }}
                  />
                ) : null}

                <div className="grid-4">
                  <DashboardMetricLink label="초과근로" value={approvalInbox.stats.overtime} href={dashboardApprovalsHref({ type: "OVERTIME" }, "approvals-inbox")} />
                  <DashboardMetricLink label="휴가" value={approvalInbox.stats.leave} href={dashboardApprovalsHref({ type: "LEAVE" }, "approvals-inbox")} />
                  <DashboardMetricLink label="근태 정정" value={approvalInbox.stats.adjustment} href={dashboardApprovalsHref({ type: "ADJUSTMENT" }, "approvals-inbox")} />
                  <DashboardMetricLink
                    label="첨부 포함"
                    value={approvalInbox.approvals.filter((approval) => approval.attachments.length > 0).length}
                    href={dashboardApprovalsHref(undefined, "approvals-detail")}
                  />
                  <DashboardMetricLink label="SLA 주의" value={approvalInbox.stats.atRisk} href={dashboardApprovalsHref(undefined, "approvals-inbox")} />
                  <DashboardMetricLink label="SLA 초과" value={approvalInbox.stats.overdue} href={dashboardApprovalsHref(undefined, "approvals-inbox")} />
                </div>

                <ApprovalInboxManager
                  approvals={approvalInbox.approvals}
                  selectedApprovalId={selectedApproval?.id}
                  filters={{
                    type: approvalType,
                    teamId: approvalTeamId,
                    from: approvalFrom,
                    to: approvalTo
                  }}
                />
              </div>
            </div>

            <div id="approvals-detail" className="panel stack">
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <h2 style={{ margin: "0 0 8px" }}>요청 상세 패널</h2>
                  <p className="muted" style={{ margin: 0 }}>
                    요청 세부 정보, 관련 근무/스케줄, 첨부 증빙, 승인 메모를 한 번에 검토합니다.
                  </p>
                </div>
                {selectedApproval ? (
                  <span className="status-pill yellow">{approvalTypeLabel(selectedApproval.type)}</span>
                ) : null}
              </div>

              {selectedApproval ? (
                <div className="split">
                  <div className="stack">
                    <div className="grid-3">
                      <div className="metric">
                        <span>요청자</span>
                        <strong style={{ fontSize: 22 }}>{selectedApproval.requester.name}</strong>
                      </div>
                      <div className="metric">
                        <span>소속</span>
                        <strong style={{ fontSize: 22 }}>
                          {selectedApproval.requester.team?.name ?? "소속 없음"}
                        </strong>
                      </div>
                      <div className="metric">
                        <span>요청 시각</span>
                        <strong style={{ fontSize: 22 }}>{formatKstDateTime(selectedApproval.createdAt)}</strong>
                      </div>
                      <div className="metric">
                        <span>대기 시간</span>
                        <strong style={{ fontSize: 22 }}>{selectedApproval.ageLabel}</strong>
                      </div>
                      <div className="metric">
                        <span>SLA</span>
                        <strong style={{ fontSize: 22 }}>
                          {selectedApproval.slaStatus === "OVERDUE"
                            ? "초과"
                            : selectedApproval.slaStatus === "AT_RISK"
                              ? "주의"
                              : "정상"}
                        </strong>
                      </div>
                      <div className="metric">
                        <span>반복 누락</span>
                        <strong style={{ fontSize: 22 }}>
                          {selectedApproval.repeatedMissingFlag
                            ? `${selectedApproval.repeatedMissingAdjustments}건`
                            : "-"}
                        </strong>
                      </div>
                    </div>

                    <div className="card">
                      <h3 style={{ marginTop: 0 }}>요청 상세</h3>
                      <p>{approvalSummary(selectedApproval)}</p>
                      <p className="muted" style={{ marginTop: 8 }}>
                        {selectedApproval.reason}
                      </p>
                      {selectedApproval.session ? (
                        <p className="muted" style={{ marginTop: 8 }}>
                          관련 세션: {selectedApproval.session.workDate.toISOString().slice(0, 10)} · 인정{" "}
                          {formatMinutes(selectedApproval.session.calculatedWorkMinutes)} · 초과{" "}
                          {formatMinutes(selectedApproval.session.overtimeMinutes)}
                        </p>
                      ) : null}
                      {selectedApprovalSchedule ? (
                        <p className="muted" style={{ marginTop: 8 }}>
                          관련 스케줄: {selectedApprovalSchedule.shiftName} ·{" "}
                          {scheduleWindow(selectedApprovalSchedule)}
                          {selectedApprovalSchedule.note ? ` · ${selectedApprovalSchedule.note}` : ""}
                        </p>
                      ) : null}
                    </div>

                    <div className="card">
                      <h3 style={{ marginTop: 0 }}>첨부 증빙</h3>
                      {selectedApproval.attachments.length > 0 ? (
                        <div className="stack" style={{ gap: 10 }}>
                          {selectedApproval.attachments.map((attachment) => (
                            <div key={attachment.id} className="actions-row" style={{ justifyContent: "space-between" }}>
                              <div>
                                <strong>{attachment.originalName}</strong>
                                <p className="muted" style={{ margin: "6px 0 0" }}>
                                  {attachment.mimeType} · {formatFileSize(attachment.sizeBytes)}
                                </p>
                              </div>
                              <a className="button secondary" href={`/api/attachments/${attachment.id}`}>
                                다운로드
                              </a>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty">첨부된 증빙이 없습니다.</div>
                      )}
                    </div>
                  </div>

                  <div className="panel stack" style={{ background: "#fbfdff" }}>
                    <h3 style={{ margin: 0 }}>검토 메모와 승인</h3>
                    <p className="muted" style={{ margin: 0 }}>
                      승인 메모는 요청자 안내와 감사 로그 근거로 함께 남습니다.
                    </p>
                    <ApprovalButtons
                      approvalId={selectedApproval.id}
                      initialReviewNote={selectedApproval.reviewNote ?? ""}
                      templates={
                        selectedApproval.type === "ADJUSTMENT"
                          ? [
                              "증빙 확인 후 정정 승인합니다. 동일 누락이 반복되지 않도록 현장 앱 사용을 재안내하세요.",
                              "증빙은 확인되었으나 반복 누락이 있어 이번 승인 후 팀장 코칭이 필요합니다.",
                              "증빙이 부족해 반려합니다. 사진 또는 메신저 기록을 추가해 다시 요청하세요."
                            ]
                          : []
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="empty">상세로 확인할 승인 요청이 없습니다.</div>
              )}
            </div>
          </section>
        ) : null}

        {managedScheduleBoard && activeView === "approvals" ? (
          <section id="approvals-schedule" className="split" style={{ marginBottom: 18 }}>
            <div className="panel stack">
              <div>
                <h2 style={{ margin: "0 0 8px" }}>스케줄 운영</h2>
                <p className="muted" style={{ margin: 0 }}>
                  관리자 대시보드 구조는 유지하고, 팀 스케줄 등록 카드만 추가했습니다.
                </p>
              </div>
              <ScheduleCreateForm
                managedUsers={managedScheduleBoard.users.map((member) => ({
                  id: member.id,
                  name: member.name,
                  teamName: member.team?.name
                }))}
                defaultDate={managedScheduleBoard.today}
              />
            </div>

            <div className="panel stack">
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>주간 스케줄 보드</h2>
                <DashboardStatusPillLink
                  href={dashboardViewHref("approvals", undefined, "approvals-schedule")}
                  className="status-pill"
                >
                  {managedScheduleBoard.schedules.length}건
                </DashboardStatusPillLink>
              </div>
              <WeeklyScheduleBoard
                weekStart={managedScheduleBoard.weeklyBoard.weekStart}
                weekEnd={managedScheduleBoard.weeklyBoard.weekEnd}
                days={managedScheduleBoard.weeklyBoard.days}
                templates={managedScheduleBoard.weeklyBoard.templates}
                rows={managedScheduleBoard.weeklyBoard.rows}
                summary={managedScheduleBoard.weeklyBoard.summary}
              />
            </div>
          </section>
        ) : null}

        {monthlyReport && laborRiskReport && payrollReport && activeView === "reports" ? (
          <section id="reports" className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <div>
                <h2 style={{ margin: 0 }}>
                  <FileText size={22} /> 인사 리포트
                </h2>
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  근로시간 요약, 휴가/정정 이력, 월 마감 준비, 급여 내보내기 자료까지 내려받습니다.
                </p>
              </div>
              <div className="actions-row">
                <a className="button secondary" href="/api/reports/export">
                  근로시간 CSV
                </a>
                <a className="button" href="/api/reports/labor-risk/export">
                  노무 리스크 CSV
                </a>
                <a className="button secondary" href="/api/reports/labor-risk/pdf">
                  PDF 리포트
                </a>
                <a className="button secondary" href="/api/reports/payroll/export">
                  급여 CSV
                </a>
              </div>
            </div>

            <div className="grid-4">
              <DashboardMetricLink label="월 인정 근로시간" value={formatMinutes(monthlyReport.totals.calculatedWorkMinutes)} href={dashboardViewHref("reports", undefined, "reports")} caption="월간 근로시간 표 보기" />
              <DashboardMetricLink label="월 초과근로" value={formatMinutes(monthlyReport.totals.overtimeMinutes)} href={dashboardViewHref("reports", undefined, "report-payroll-preview")} caption="급여 미리보기" />
              <DashboardMetricLink label="활성 리스크" value={laborRiskReport.signals.length} href={dashboardRiskHref(undefined, "risk-workflow")} caption="리스크 화면으로 이동" />
              <DashboardMetricLink
                label="첨부 증빙"
                value={laborRiskReport.approvalRequests.reduce((sum, request) => sum + request.attachments.length, 0)}
                href={dashboardViewHref("reports", undefined, "report-history")}
                caption="휴가/정정 이력 보기"
              />
              <DashboardMetricLink label="월 마감 준비 완료" value={`${payrollReport.totals.readyCount}명`} href={dashboardViewHref("reports", undefined, "report-month-close-ready")} />
              <DashboardMetricLink label="이번 달 연차 사용" value={formatDays(payrollReport.totals.annualLeaveUsedThisMonth)} href={dashboardViewHref("reports", undefined, "report-leave-balance")} />
              <DashboardMetricLink label="총 연차 잔여" value={formatDays(payrollReport.totals.annualLeaveRemainingDays)} href={dashboardViewHref("reports", undefined, "report-leave-balance")} />
              <DashboardMetricLink label="야간근로" value={formatMinutes(payrollReport.totals.nightWorkMinutes)} href={dashboardViewHref("reports", undefined, "report-payroll-preview")} />
              <DashboardMetricLink label="휴일근로" value={formatMinutes(payrollReport.totals.holidayWorkMinutes)} href={dashboardViewHref("reports", undefined, "report-payroll-preview")} />
            </div>

            <div className="panel stack" id="report-evidence-package" style={{ background: "#fbfdff" }}>
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <h3 style={{ margin: 0 }}>노동청 제출용 증빙 패키지</h3>
                  <p className="muted" style={{ margin: "8px 0 0" }}>
                    직원별 월간 근태, 승인, 정정, 리스크 해결 이력과 첨부 증빙을 ZIP으로 묶습니다.
                  </p>
                </div>
                <span className="status-pill gray">PDF + CSV + 첨부</span>
              </div>
              <form className="actions-row" action="/api/reports/evidence-package" method="get">
                <div className="field" style={{ minWidth: 160 }}>
                  <label htmlFor="evidence-package-month">월</label>
                  <input id="evidence-package-month" name="month" type="month" defaultValue={monthlyReport.month} />
                </div>
                <div className="field" style={{ minWidth: 240 }}>
                  <label htmlFor="evidence-package-user">직원</label>
                  <select id="evidence-package-user" name="userId" defaultValue={monthlyReport.leaveBalanceRows[0]?.user.id ?? ""}>
                    {monthlyReport.leaveBalanceRows.map((row) => (
                      <option key={row.user.id} value={row.user.id}>
                        {row.user.name} · {row.user.team?.name ?? "소속 없음"}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="button" type="submit" style={{ alignSelf: "flex-end" }}>
                  증빙 ZIP 다운로드
                </button>
              </form>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>직원</th>
                    <th>스케줄</th>
                    <th>인정 근로시간</th>
                    <th>초과근로</th>
                    <th>스케줄 이탈</th>
                    <th>휴게 부족</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyReport.sessions.slice(0, 12).map((reportSession) => (
                    <tr key={reportSession.id}>
                      <td>{reportSession.workDate.toISOString().slice(0, 10)}</td>
                      <td>
                        {reportSession.user.name}
                        <br />
                        <span className="muted">{reportSession.user.team?.name ?? "소속 없음"}</span>
                      </td>
                      <td>{reportSession.schedule ? scheduleWindow(reportSession.schedule) : "미등록"}</td>
                      <td>{formatMinutes(reportSession.calculatedWorkMinutes)}</td>
                      <td>{formatMinutes(reportSession.overtimeMinutes)}</td>
                      <td>{reportSession.scheduleMismatchMinutes > 0 ? formatMinutes(reportSession.scheduleMismatchMinutes) : "-"}</td>
                      <td>{reportSession.hasBreakRisk ? "확인 필요" : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="split">
              <div id="report-history" className="panel stack" style={{ background: "#fbfdff" }}>
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>휴가 및 정정 이력</h3>
                  <DashboardStatusPillLink
                    href={dashboardViewHref("reports", undefined, "report-history")}
                    className="status-pill gray"
                  >
                    {monthlyReport.leaveRequests.length + monthlyReport.adjustmentRequests.length}건
                  </DashboardStatusPillLink>
                </div>
                {laborRiskReport.approvalRequests.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>요청일</th>
                          <th>직원</th>
                          <th>유형</th>
                          <th>상세</th>
                          <th>첨부</th>
                        </tr>
                      </thead>
                      <tbody>
                        {laborRiskReport.approvalRequests
                          .filter((request) => request.type === "LEAVE" || request.type === "ADJUSTMENT")
                          .slice(0, 10)
                          .map((request) => (
                            <tr key={request.id}>
                              <td>{formatKstDateTime(request.createdAt)}</td>
                              <td>
                                {request.requester.name}
                                <br />
                                <span className="muted">{request.requester.team?.name ?? "소속 없음"}</span>
                              </td>
                              <td>{approvalTypeLabel(request.type)}</td>
                              <td>{approvalSummary(request)}</td>
                              <td>{request.attachments.length}개</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">이번 달 휴가나 정정 요청 이력이 없습니다.</div>
                )}
              </div>

              <div id="report-schedule" className="panel stack" style={{ background: "#fbfdff" }}>
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>스케줄/휴게 점검</h3>
                  <DashboardStatusPillLink
                    href={dashboardViewHref("reports", undefined, "report-schedule")}
                    className="status-pill gray"
                  >
                    {monthlyReport.scheduleVarianceRows.length + monthlyReport.breakRiskRows.length}건
                  </DashboardStatusPillLink>
                </div>
                {monthlyReport.scheduleVarianceRows.length > 0 || monthlyReport.breakRiskRows.length > 0 ? (
                  <div className="stack" style={{ gap: 12 }}>
                    {monthlyReport.scheduleVarianceRows.slice(0, 4).map((row) => (
                      <div className="card" key={`schedule-${row.id}`}>
                        <strong>{row.user.name}</strong>
                        <p className="muted" style={{ marginTop: 8 }}>
                          {row.workDate.toISOString().slice(0, 10)} · {row.schedule.shiftName} · 이탈{" "}
                          {formatMinutes(row.scheduleMismatchMinutes)}
                        </p>
                      </div>
                    ))}
                    {monthlyReport.breakRiskRows.slice(0, 4).map((row) => (
                      <div className="card" key={`break-${row.id}`}>
                        <strong>{row.user.name}</strong>
                        <p className="muted" style={{ marginTop: 8 }}>
                          {row.workDate.toISOString().slice(0, 10)} · 총 체류 {formatMinutes(row.grossMinutes)} · 휴게{" "}
                          {row.breakMinutes}분 / 기준 {row.requiredBreakMinutes}분
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty">이번 달 스케줄 이탈 또는 휴게 부족 점검 항목이 없습니다.</div>
                )}
              </div>
            </div>

            <div id="report-leave-balance" className="panel stack" style={{ background: "#fbfdff" }}>
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>연차 잔액 현황</h3>
                <DashboardStatusPillLink
                  href={dashboardViewHref("reports", undefined, "report-leave-balance")}
                  className="status-pill gray"
                >
                  {monthlyReport.leaveBalanceRows.length}명
                </DashboardStatusPillLink>
              </div>
              {monthlyReport.leaveBalanceRows.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>직원</th>
                        <th>주기</th>
                        <th>부여</th>
                        <th>수동 조정</th>
                        <th>승인 차감</th>
                        <th>대기</th>
                        <th>기본/이월</th>
                        <th>반차/시간차</th>
                        <th>잔여</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyReport.leaveBalanceRows.slice(0, 10).map((row) => (
                        <tr key={`leave-balance-${row.user.id}`}>
                          <td>
                            {row.user.name}
                            <br />
                            <span className="muted">{row.user.team?.name ?? "소속 없음"}</span>
                          </td>
                          <td>
                            {row.cycleStart} ~ {row.cycleEnd}
                          </td>
                          <td>{formatDays(row.grantedDays)}</td>
                          <td>
                            {row.manualAdjustmentDays === 0
                              ? "-"
                              : `${row.manualAdjustmentDays > 0 ? "+" : ""}${formatDays(row.manualAdjustmentDays)}`}
                          </td>
                          <td>{formatDays(row.approvedDays)}</td>
                          <td>{formatDays(row.pendingDays)}</td>
                          <td>
                            기본 {formatDays(row.baseRemainingDays)}
                            <br />
                            <span className="muted">이월 {formatDays(row.carryoverRemainingDays)}</span>
                          </td>
                          <td>
                            반차 {row.remainingHalfDayUnits}회
                            <br />
                            <span className="muted">{formatMinutes(row.remainingHourlyMinutes)}</span>
                          </td>
                          <td>
                            <span className={`status-pill ${row.deficitDays > 0 ? "red" : row.remainingDays <= 1 ? "yellow" : "green"}`}>
                              {row.deficitDays > 0 ? `부족 ${formatDays(row.deficitDays)}` : formatDays(row.remainingDays)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">확인할 연차 잔액 데이터가 없습니다.</div>
              )}
            </div>

            <div className="split">
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <div>
                  <h3 style={{ margin: "0 0 8px" }}>연차 수동 조정</h3>
                  <p className="muted" style={{ margin: 0 }}>
                    월 마감 전 잔액 보정, 이월 보정, 예외 정정이 필요할 때만 사용합니다. 모든 변경은 감사 로그에 남습니다.
                  </p>
                </div>
                <LeaveBalanceAdjustmentForm
                  managedUsers={payrollReport.payrollRows.map((row) => ({
                    id: row.user.id,
                    name: row.user.name,
                    teamName: row.user.team?.name
                  }))}
                  defaultDate={employeeScheduleBoard.today}
                />
              </div>

              <div id="report-leave-adjustments" className="panel stack" style={{ background: "#fbfdff" }}>
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>최근 연차 조정</h3>
                  <DashboardStatusPillLink
                    href={dashboardViewHref("reports", undefined, "report-leave-adjustments")}
                    className="status-pill gray"
                  >
                    {monthlyReport.leaveAdjustmentRows.length}건
                  </DashboardStatusPillLink>
                </div>
                {monthlyReport.leaveAdjustmentRows.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>등록</th>
                          <th>직원</th>
                          <th>적용일</th>
                          <th>조정</th>
                          <th>상태</th>
                          <th>사유</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyReport.leaveAdjustmentRows.slice(0, 8).map((row) => {
                          const status = leaveBalanceAdjustmentStatusMeta(row.status);

                          return (
                            <tr key={row.auditLogId}>
                              <td>
                                {formatKstDateTime(row.createdAt)}
                                <br />
                                <span className="muted">{row.actorName ?? "시스템"}</span>
                              </td>
                              <td>
                                {row.user?.name ?? row.userId}
                                <br />
                                <span className="muted">{row.user?.team?.name ?? "소속 없음"}</span>
                              </td>
                              <td>{row.effectiveDate}</td>
                              <td>{row.deltaDays > 0 ? "+" : ""}{formatDays(row.deltaDays)}</td>
                              <td>
                                <span className={`status-pill ${status.tone}`}>{status.label}</span>
                              </td>
                              <td>{row.reason}</td>
                              <td>
                                {row.status === "ACTIVE" ? (
                                  <LeaveBalanceAdjustmentRevokeButton auditLogId={row.auditLogId} />
                                ) : (
                                  "-"
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">이번 달에 등록된 연차 수동 조정이 없습니다.</div>
                )}
              </div>
            </div>

            <div className="panel stack" style={{ background: "#fbfdff" }}>
              <h3 style={{ margin: 0 }}>최근 감사 로그</h3>
              {laborRiskReport.auditLogs.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>시간</th>
                        <th>수행자</th>
                        <th>액션</th>
                        <th>대상</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laborRiskReport.auditLogs.slice(0, 10).map((log) => (
                        <tr key={log.id}>
                          <td>{formatKstDateTime(log.createdAt)}</td>
                          <td>{log.actor?.name ?? "시스템"}</td>
                          <td>{log.action}</td>
                          <td>{log.targetType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">아직 기록된 감사 로그가 없습니다.</div>
              )}
            </div>

            <div className="split">
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>증빙 보관 현황</h3>
                  <span className="status-pill gray">
                    전체 {laborRiskReport.evidenceSummary.metrics.totalAttachments}건
                  </span>
                </div>
                <div className="grid-3">
                  <div className="metric">
                    <span>보관중</span>
                    <strong>{laborRiskReport.evidenceSummary.metrics.retainedAttachments}건</strong>
                  </div>
                  <div className="metric">
                    <span>기한 경과</span>
                    <strong>{laborRiskReport.evidenceSummary.metrics.overdueAttachments}건</strong>
                  </div>
                  <div className="metric">
                    <span>최근 다운로드</span>
                    <strong>{laborRiskReport.evidenceSummary.metrics.recentDownloadEvents}건</strong>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>파일</th>
                        <th>요청자</th>
                        <th>등록일</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laborRiskReport.evidenceSummary.recentAttachments.slice(0, 8).map((attachment) => (
                        <tr key={attachment.id}>
                          <td>
                            {attachment.originalName}
                            <br />
                            <span className="muted">
                              {attachment.mimeType} · {formatFileSize(attachment.sizeBytes)}
                            </span>
                          </td>
                          <td>
                            {attachment.requester.name}
                            <br />
                            <span className="muted">{attachment.requester.team?.name ?? "소속 없음"}</span>
                          </td>
                          <td>{formatKstDateTime(attachment.createdAt)}</td>
                          <td>
                            <span className={`status-pill ${attachment.isOverRetention ? "yellow" : "green"}`}>
                              {attachment.isOverRetention ? "기한 경과" : "보관중"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>감사 Diff 뷰어</h3>
                  <span className="status-pill gray">{laborRiskReport.auditTrail.length}건</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>시각</th>
                        <th>액션</th>
                        <th>수행자</th>
                        <th>변경 요약</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laborRiskReport.auditTrail.slice(0, 8).map((entry) => (
                        <tr key={entry.id}>
                          <td>{formatKstDateTime(entry.createdAt)}</td>
                          <td>
                            {entry.action}
                            <br />
                            <span className="muted">{entry.targetType}</span>
                          </td>
                          <td>{entry.actor?.name ?? "시스템"}</td>
                          <td>{entry.diff.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card">
                  <strong>최근 증빙 다운로드</strong>
                  {laborRiskReport.evidenceSummary.recentDownloads.length > 0 ? (
                    <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                      {laborRiskReport.evidenceSummary.recentDownloads.slice(0, 4).map((download) => (
                        <div key={download.id} className="notification-card read">
                          <div className="actions-row" style={{ justifyContent: "space-between" }}>
                            <strong>{download.originalName}</strong>
                            <span className="muted">{formatKstDateTime(download.createdAt)}</span>
                          </div>
                          <p className="muted" style={{ margin: "6px 0 0" }}>
                            {download.actor?.name ?? "시스템"} · {download.actor?.email ?? "-"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty" style={{ marginTop: 12 }}>다운로드 이력이 없습니다.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="split">
              <div id="report-month-close-ready" className="panel stack" style={{ background: "#fbfdff" }}>
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>월 마감 준비</h3>
                  <DashboardStatusPillLink
                    href={dashboardViewHref("reports", undefined, "report-drilldown")}
                    className={`status-pill ${payrollReport.totals.actionRequiredCount > 0 ? "yellow" : "green"}`}
                  >
                    조치 필요 {payrollReport.totals.actionRequiredCount}명
                  </DashboardStatusPillLink>
                </div>
                {payrollReport.payrollRows.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>직원</th>
                          <th>승인 대기</th>
                          <th>미종결/연장</th>
                          <th>누락/이탈</th>
                          <th>연차 상태</th>
                          <th>상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payrollReport.payrollRows.slice(0, 10).map((row) => (
                          <tr key={`close-${row.user.id}`}>
                            <td>
                              {row.user.name}
                              <br />
                              <span className="muted">{row.user.team?.name ?? "소속 없음"}</span>
                            </td>
                            <td>
                              {row.pendingApprovalCount}
                              <br />
                              <span className="muted">
                                휴가 {row.pendingLeaveApprovalCount} · 정정 {row.pendingAdjustmentApprovalCount}
                              </span>
                            </td>
                            <td>
                              {row.openSessionCount} / {row.unresolvedOvertimeCount}
                              <br />
                              <span className="muted">세션 / 미승인 연장</span>
                            </td>
                            <td>
                              {row.missingRecordCount} / {row.scheduleMismatchCount}
                              <br />
                              <span className="muted">누락 / 이탈</span>
                            </td>
                            <td>
                              {row.annualLeaveDeficitDays > 0 ? (
                                <span className="status-pill red">부족 {formatDays(row.annualLeaveDeficitDays)}</span>
                              ) : (
                                <span className="status-pill green">잔여 {formatDays(row.annualLeaveRemainingDays)}</span>
                              )}
                            </td>
                            <td>
                              <span className={`status-pill ${row.closeStatus === "READY" ? "green" : "yellow"}`}>
                                {payrollCloseStatusLabel(row.closeStatus)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">이번 달 월 마감 대상 데이터가 아직 없습니다.</div>
                )}
              </div>

              <div id="report-payroll-preview" className="panel stack" style={{ background: "#fbfdff" }}>
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>급여 내보내기 미리보기</h3>
                  <DashboardStatusPillLink
                    href={dashboardViewHref("reports", undefined, "report-payroll-preview")}
                    className="status-pill gray"
                  >
                    {payrollReport.payrollRows.length}명
                  </DashboardStatusPillLink>
                </div>
                <p className="muted" style={{ margin: 0 }}>
                  정책 버전 {payrollReport.policy.version} 기준으로 연차, 가산, 공휴일 달력을 함께 반영합니다.
                </p>
                {payrollReport.payrollRows.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>직원</th>
                          <th>인정 근로</th>
                          <th>초과근로</th>
                          <th>야간/휴일</th>
                          <th>가산 환산</th>
                          <th>연차 부여</th>
                          <th>승인/대기/잔여</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payrollReport.payrollRows.slice(0, 10).map((row) => (
                          <tr key={`payroll-${row.user.id}`}>
                            <td>
                              {row.user.name}
                              <br />
                              <span className="muted">{row.user.team?.name ?? "소속 없음"}</span>
                            </td>
                            <td>{formatMinutes(row.calculatedWorkMinutes)}</td>
                            <td>{formatMinutes(row.overtimeMinutes)}</td>
                            <td>
                              {formatMinutes(row.nightWorkMinutes)} / {formatMinutes(row.holidayWorkMinutes)}
                            </td>
                            <td>
                              {formatMinutes(
                                row.additionalOvertimePremiumMinutes +
                                  row.additionalNightPremiumMinutes +
                                  row.additionalHolidayPremiumMinutes
                              )}
                            </td>
                            <td>{formatDays(row.annualLeaveGrantedDays)}</td>
                            <td>
                              {formatDays(row.annualLeaveUsedInCycle)} / {formatDays(row.annualLeavePendingDays)} /{" "}
                              {formatDays(row.annualLeaveRemainingDays)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">이번 달 급여 내보내기 대상 데이터가 없습니다.</div>
                )}
              </div>
            </div>

            <div id="report-drilldown" className="panel stack" style={{ background: "#fbfdff" }}>
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>월 마감 상세 보기</h3>
                <span className="status-pill gray">확인 항목 바로 보기</span>
              </div>
              <div className="grid-3">
                {payrollReport.validationCards.map((card) => (
                  <div className="metric" key={card.key}>
                    <span>{card.title}</span>
                    <strong style={{ fontSize: 22 }}>{card.metric}</strong>
                    <p className="muted" style={{ margin: "8px 0 0" }}>
                      {validationStatusLabel(card.status)} · {card.description}
                    </p>
                  </div>
                ))}
              </div>
              <div className="split">
                <div className="panel stack" id="month-close-blocker-pending-approvals" style={{ background: "#fff" }}>
                  <h4 style={{ margin: 0 }}>승인 대기</h4>
                  {payrollReport.blockerDrillDown.pendingApprovals.length > 0 ? (
                    payrollReport.blockerDrillDown.pendingApprovals.slice(0, 8).map((approval) => (
                      <div className="card" key={`blocker-approval-${approval.id}`}>
                        <strong>{approval.requester.name}</strong>
                        <p className="muted" style={{ margin: "6px 0 0" }}>
                          {approval.requester.team?.name ?? "소속 없음"} · {approvalTypeLabel(approval.type)} · {formatKstDateTime(approval.createdAt)}
                        </p>
                        <p className="muted" style={{ margin: "6px 0 0" }}>{approval.reason}</p>
                      </div>
                    ))
                  ) : (
                    <div className="empty">승인 대기 확인 항목이 없습니다.</div>
                  )}
                </div>
                <div className="panel stack" id="month-close-blocker-open-sessions" style={{ background: "#fff" }}>
                  <h4 style={{ margin: 0 }}>미종결 세션 / 미승인 연장</h4>
                  {payrollReport.blockerDrillDown.openSessions.length > 0 || payrollReport.blockerDrillDown.unresolvedOvertime.length > 0 ? (
                    <div className="stack" style={{ gap: 10 }}>
                      {payrollReport.blockerDrillDown.openSessions.slice(0, 4).map((session) => (
                        <div className="card" key={`open-session-${session.id}`}>
                          <strong>{session.user.name}</strong>
                          <p className="muted" style={{ margin: "6px 0 0" }}>
                            {formatKstDate(session.workDate)} · {sessionStatusLabel(session.status)} · 인정 {formatMinutes(session.calculatedWorkMinutes)}
                          </p>
                        </div>
                      ))}
                      {payrollReport.blockerDrillDown.unresolvedOvertime.slice(0, 4).map((session) => (
                        <div className="card" key={`unresolved-overtime-${session.id}`}>
                          <strong>{session.user.name}</strong>
                          <p className="muted" style={{ margin: "6px 0 0" }}>
                            {formatKstDate(session.workDate)} · 초과 {formatMinutes(session.overtimeMinutes)} / 승인 {formatMinutes(session.approvedOvertimeMinutes)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty">세션/연장 확인 항목이 없습니다.</div>
                  )}
                </div>
              </div>
              <div className="split">
                <div className="panel stack" id="month-close-blocker-missing-records" style={{ background: "#fff" }}>
                  <h4 style={{ margin: 0 }}>누락 / 스케줄 이탈</h4>
                  {payrollReport.blockerDrillDown.missingRecordRisks.length > 0 || payrollReport.blockerDrillDown.scheduleMismatchSessions.length > 0 ? (
                    <div className="stack" style={{ gap: 10 }}>
                      {payrollReport.blockerDrillDown.missingRecordRisks.slice(0, 4).map((risk) => (
                        <div className="card" key={`missing-risk-${risk.id}`}>
                          <strong>{risk.user.name}</strong>
                          <p className="muted" style={{ margin: "6px 0 0" }}>
                            {risk.workDate ?? formatKstDateTime(risk.detectedAt)} · {risk.title}
                          </p>
                          <p className="muted" style={{ margin: "6px 0 0" }}>{risk.message}</p>
                        </div>
                      ))}
                      {payrollReport.blockerDrillDown.scheduleMismatchSessions.slice(0, 4).map((row) => (
                        <div className="card" key={`schedule-mismatch-${row.id}`}>
                          <strong>{row.user.name}</strong>
                          <p className="muted" style={{ margin: "6px 0 0" }}>
                            {formatKstDate(row.workDate)} · {row.schedule.shiftName} · 이탈 {formatMinutes(row.scheduleMismatchMinutes)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty">누락/이탈 확인 항목이 없습니다.</div>
                  )}
                </div>
                <div className="panel stack" id="month-close-blocker-leave-deficit" style={{ background: "#fff" }}>
                  <h4 style={{ margin: 0 }}>연차 부족 인원</h4>
                  {payrollReport.blockerDrillDown.leaveBalanceDeficitUsers.length > 0 ? (
                    payrollReport.blockerDrillDown.leaveBalanceDeficitUsers.slice(0, 6).map((row) => (
                      <div className="card" key={`leave-deficit-${row.user.id}`}>
                        <strong>{row.user.name}</strong>
                        <p className="muted" style={{ margin: "6px 0 0" }}>
                          부족 {formatDays(row.deficitDays)} · 대기 {formatDays(row.pendingDays)} · 잔여 {formatDays(row.remainingDays)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="empty">연차 부족 확인 항목이 없습니다.</div>
                  )}
                </div>
              </div>
              {payrollReport.liveDiffFromClosedSnapshot ? (
                <div className="panel stack" style={{ background: "#fff" }}>
                  <h4 style={{ margin: 0 }}>재오픈 전후 변경 내용</h4>
                  {payrollReport.liveDiffFromClosedSnapshot.changed ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>항목</th>
                            <th>이전 스냅샷</th>
                            <th>현재</th>
                            <th>변동</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payrollReport.liveDiffFromClosedSnapshot.items.map((item) => (
                            <tr key={`close-diff-${item.key}`}>
                              <td>{monthCloseMetricLabel(item.key)}</td>
                              <td>{formatMonthCloseMetricValue(item.key, item.from)}</td>
                              <td>{formatMonthCloseMetricValue(item.key, item.to)}</td>
                              <td>
                                {item.delta > 0
                                  ? `+${formatMonthCloseMetricValue(item.key, item.delta)}`
                                  : formatMonthCloseMetricValue(item.key, item.delta)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty">이전 마감 스냅샷 대비 변동이 없습니다.</div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="split">
              <div id="report-policy" className="panel stack" style={{ background: "#fbfdff" }}>
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>정책 테이블</h3>
                  <span className="status-pill gray">
                    {payrollReport.policy.name} v{payrollReport.policy.version}
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>정책 항목</th>
                        <th>값</th>
                        <th>설명</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>정책 버전</td>
                        <td>
                          v{payrollReport.policy.version} · {formatKstDateTime(payrollReport.policy.effectiveFrom)}
                        </td>
                        <td>현재 회사에 적용 중인 정책 버전</td>
                      </tr>
                      <tr>
                        <td>기본 근무시간</td>
                        <td>{formatMinutes(payrollReport.policy.standardDailyMinutes)}</td>
                        <td>일 근로 기준 시간</td>
                      </tr>
                      <tr>
                        <td>연장근로 기준</td>
                        <td>{formatMinutes(payrollReport.policy.overtimeThresholdMinutes)}</td>
                        <td>이 시간을 넘으면 연장근로로 분리</td>
                      </tr>
                      <tr>
                        <td>주간 한도</td>
                        <td>{formatMinutes(payrollReport.policy.weeklyLimitMinutes)}</td>
                        <td>주간 누적 상한</td>
                      </tr>
                      <tr>
                        <td>연차 기준</td>
                        <td>{payrollReport.policy.annualLeaveBasis === "JOIN_DATE" ? "입사일 기준" : "캘린더 연도 기준"}</td>
                        <td>연차 차감/잔여 계산 주기</td>
                      </tr>
                      <tr>
                        <td>연차 부여/이월</td>
                        <td>
                          {formatDays(payrollReport.policy.annualLeaveGrantDays)} /{" "}
                          {formatDays(payrollReport.policy.annualLeaveCarryoverDays)}
                        </td>
                        <td>연차 부여일수와 이월일수</td>
                      </tr>
                      <tr>
                        <td>첫해 월차/이월 만료</td>
                        <td>
                          {payrollReport.policy.firstYearMonthlyAccrualEnabled ? "사용" : "미사용"} /{" "}
                          {payrollReport.policy.carryoverExpiryMonth}월 {payrollReport.policy.carryoverExpiryDay}일
                        </td>
                        <td>첫해 월차 부여 여부와 이월 소멸 기준</td>
                      </tr>
                      <tr>
                        <td>반차/시간차</td>
                        <td>
                          {payrollReport.policy.allowHalfDayLeave ? "반차 허용" : "반차 미허용"} /{" "}
                          {payrollReport.policy.allowHourlyLeave
                            ? `${payrollReport.policy.hourlyLeaveUnitMinutes}분 단위`
                            : "시간차 미허용"}
                        </td>
                        <td>휴가 예외 규칙</td>
                      </tr>
                      <tr>
                        <td>연장/야간/휴일 가산</td>
                        <td>
                          {formatRate(payrollReport.policy.overtimePremiumRate)} /{" "}
                          {formatRate(payrollReport.policy.nightPremiumRate)} /{" "}
                          {formatRate(payrollReport.policy.holidayPremiumRate)}
                        </td>
                        <td>정산 환산 시 적용되는 정책 비율</td>
                      </tr>
                      <tr>
                        <td>야간 시간대</td>
                        <td>
                          {payrollReport.policy.nightWorkStart} - {payrollReport.policy.nightWorkEnd}
                        </td>
                        <td>야간근로 판정 구간</td>
                      </tr>
                      <tr>
                        <td>주말 휴일근로 포함</td>
                        <td>{payrollReport.policy.holidayIncludesWeekends ? "예" : "아니오"}</td>
                        <td>주말 근무를 휴일근로로 간주할지 여부</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div id="report-month-close" className="panel stack" style={{ background: "#fbfdff" }}>
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>월 마감 상태</h3>
                  <span className={`status-pill ${(payrollReport.monthClose?.status ?? "OPEN") === "CLOSED" ? "green" : "yellow"}`}>
                    {monthCloseStatusLabel((payrollReport.monthClose?.status ?? "OPEN") as "OPEN" | "CLOSED")}
                  </span>
                </div>
                <div className="card">
                  <p style={{ marginTop: 0 }}>
                    {payrollReport.monthClose?.status === "CLOSED"
                      ? `${payrollReport.month} 월 마감이 완료되었습니다. 해당 월의 근태, 승인, 스케줄 수정은 잠겨 있습니다.`
                      : `${payrollReport.month} 월은 아직 마감 전입니다. 아래 확인 항목이 모두 정리되면 월 마감을 확정할 수 있습니다.`}
                  </p>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    마감 처리: {payrollReport.monthClose?.lockedBy?.name ?? "-"} · 처리 시각:{" "}
                    {formatKstDateTime(payrollReport.monthClose?.lockedAt)}
                  </p>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    급여 반영: {payrollSyncStatusLabel(payrollReport.monthClose?.payrollSyncStatus)} · 반영자:{" "}
                    {payrollReport.monthClose?.payrollAppliedBy?.name ?? "-"} ·{" "}
                    {formatKstDateTime(payrollReport.monthClose?.payrollAppliedAt)}
                  </p>
                  {payrollReport.lockReason ? (
                    <p className="muted" style={{ marginBottom: 0 }}>
                      마감 메모: {payrollReport.lockReason}
                    </p>
                  ) : null}
                  {payrollReport.monthClose?.reopenedAt ? (
                    <p className="muted" style={{ marginBottom: 0 }}>
                      최근 재오픈 이력: {payrollReport.monthClose.reopenedBy?.name ?? "-"} ·{" "}
                      {formatKstDateTime(payrollReport.monthClose.reopenedAt)} ·{" "}
                      {payrollReport.monthClose.reopenReason ?? "-"}
                    </p>
                  ) : null}
                </div>
                <MonthCloseActions
                  month={payrollReport.month}
                  actorRole={user.role}
                  status={(payrollReport.monthClose?.status ?? "OPEN") as "OPEN" | "CLOSED"}
                  payrollSyncStatus={(payrollReport.monthClose?.payrollSyncStatus ?? "PENDING") as "PENDING" | "APPLIED"}
                  canClose={payrollReport.canClose}
                  blockerSummary={payrollReport.blockingSummary}
                  lockReason={payrollReport.lockReason}
                  pendingReopenRequest={payrollReport.pendingReopenRequest}
                />
                {payrollReport.reopenRequests.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>요청 시각</th>
                          <th>요청자</th>
                          <th>상태</th>
                          <th>사유</th>
                          <th>검토 내용</th>
                          <th>잠금 후 변동</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payrollReport.reopenRequests.slice(0, 6).map((request) => (
                          <tr key={request.requestId}>
                            <td>{formatKstDateTime(request.requestedAt)}</td>
                            <td>{request.requestedByName ?? "-"}</td>
                            <td>
                              <span className={`status-pill ${monthCloseReopenStatusTone(request.status)}`}>
                                {monthCloseReopenStatusLabel(request.status)}
                              </span>
                            </td>
                            <td>{request.reason}</td>
                            <td>
                              {request.reviewedByName ?? "-"}
                              <br />
                              <span className="muted">
                                {request.reviewedAt ? formatKstDateTime(request.reviewedAt) : "검토 전"}
                                {request.reviewNote ? ` · ${request.reviewNote}` : ""}
                              </span>
                            </td>
                            <td>{summarizeMonthCloseDiff(request.diffFromLockedSnapshot)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {payrollReport.recentMonthCloses.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>월</th>
                          <th>상태</th>
                          <th>확정</th>
                          <th>재오픈</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payrollReport.recentMonthCloses.slice(0, 6).map((close) => (
                          <tr key={close.id}>
                            <td>{close.month}</td>
                            <td>{monthCloseStatusLabel(close.status)}</td>
                            <td>
                              {close.lockedBy?.name ?? "-"}
                              <br />
                              <span className="muted">{formatKstDateTime(close.lockedAt)}</span>
                            </td>
                            <td>
                              {close.reopenedBy?.name ?? "-"}
                              <br />
                              <span className="muted">{close.reopenReason ?? "-"}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {payrollReport.monthCloseEvents.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>시각</th>
                          <th>이벤트</th>
                          <th>수행자</th>
                          <th>요약</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payrollReport.monthCloseEvents.slice(0, 8).map((event) => (
                          <tr key={event.id}>
                            <td>{formatKstDateTime(event.createdAt)}</td>
                            <td>{monthCloseEventLabel(event.type)}</td>
                            <td>{event.actor?.name ?? "시스템"}</td>
                            <td>{monthCloseEventSummary(event.type, event.detail)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {activeView === "settings" ? (
          <section id="settings" className="panel stack" style={{ marginTop: 18 }}>
            <div>
              <h2 style={{ margin: 0 }}>계정 및 운영 설정</h2>
              <p className="muted" style={{ margin: "8px 0 0" }}>
                개인 계정 보안을 먼저 관리하고, 관리자 권한이 있으면 회사 정책과 외부 연동 설정까지 이어서 조정할 수 있습니다.
              </p>
            </div>

            <div className="split">
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>비밀번호 변경</h3>
                <p className="muted" style={{ margin: 0 }}>
                  현재 비밀번호를 확인한 뒤 새 비밀번호로 교체합니다. 저장하면 다른 기기 세션은 다시 로그인해야 합니다.
                </p>
                <PasswordChangeForm />
              </div>
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>활성 세션</h3>
                <p className="muted" style={{ margin: 0 }}>
                  현재 사용 중인 브라우저를 유지한 채, 다른 브라우저와 모바일 세션만 종료할 수 있습니다.
                </p>
                <ActiveSessionsPanel sessions={activeSessions} />
              </div>
            </div>

            {adminSettings ? (
              <>
            <div className="split">
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>회사 설정</h3>
                <CompanySettingsForm
                  name={adminSettings.company.name}
                  weeklyLimitHours={adminSettings.company.weeklyLimitMinutes / 60}
                  defaultBreakMinutes={adminSettings.company.defaultBreakMinutes}
                />
              </div>
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>SaaS 플랜</h3>
                <CompanyPlanSettingsForm summary={adminSettings.planSummary} />
              </div>
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>계산 정책</h3>
                <PolicySettingsForm
                  standardDailyHours={adminSettings.currentPolicy.standardDailyMinutes / 60}
                  overtimeThresholdHours={adminSettings.currentPolicy.overtimeThresholdMinutes / 60}
                  weeklyLimitHours={adminSettings.currentPolicy.weeklyLimitMinutes / 60}
                  defaultBreakMinutes={adminSettings.currentPolicy.defaultBreakMinutes}
                  annualLeaveBasis={adminSettings.currentPolicy.annualLeaveBasis}
                  annualLeaveGrantDays={adminSettings.currentPolicy.annualLeaveGrantDays}
                  firstYearMonthlyAccrualEnabled={adminSettings.currentPolicy.firstYearMonthlyAccrualEnabled}
                  annualLeaveCarryoverDays={adminSettings.currentPolicy.annualLeaveCarryoverDays}
                  carryoverExpiryMonth={adminSettings.currentPolicy.carryoverExpiryMonth}
                  carryoverExpiryDay={adminSettings.currentPolicy.carryoverExpiryDay}
                  allowHalfDayLeave={adminSettings.currentPolicy.allowHalfDayLeave}
                  allowHourlyLeave={adminSettings.currentPolicy.allowHourlyLeave}
                  hourlyLeaveUnitMinutes={adminSettings.currentPolicy.hourlyLeaveUnitMinutes}
                  overtimePremiumRate={adminSettings.currentPolicy.overtimePremiumRate}
                  nightPremiumRate={adminSettings.currentPolicy.nightPremiumRate}
                  holidayPremiumRate={adminSettings.currentPolicy.holidayPremiumRate}
                  holidayIncludesWeekends={adminSettings.currentPolicy.holidayIncludesWeekends}
                  nightWorkStart={adminSettings.currentPolicy.nightWorkStart}
                  nightWorkEnd={adminSettings.currentPolicy.nightWorkEnd}
                />
              </div>
            </div>

            <div className="panel stack" style={{ background: "#fbfdff" }}>
              <h3 style={{ margin: 0 }}>외부 연동</h3>
              <IntegrationSettingsForm
                settings={adminSettings.integrationSettings}
                dispatchLogs={adminSettings.integrationDispatchLogs}
                opsSummary={adminSettings.integrationOpsSummary}
                deploymentSummary={adminSettings.deploymentOpsSummary}
                users={adminSettings.users.map((member) => ({
                  id: member.id,
                  name: member.name,
                  email: member.email
                }))}
              />
            </div>

            <div id="field-verification" className="panel stack" style={{ background: "#fbfdff" }}>
              <h3 style={{ margin: 0 }}>현장 QR 출퇴근</h3>
              <WorkLocationSettingsForm summary={adminSettings.verificationSummary} />
            </div>

            <div className="split">
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>운영 자동화</h3>
                <AutomationSettingsForm summary={adminSettings.automationSummary} />
              </div>
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>도입/배포 온보딩</h3>
                <OnboardingChecklistForm summary={adminSettings.onboardingSummary} />
              </div>
            </div>

            <div className="panel stack" style={{ background: "#fbfdff" }}>
              <h3 style={{ margin: 0 }}>증빙 보안과 감사</h3>
              <EvidenceSecuritySettingsForm summary={adminSettings.evidenceSummary} />
            </div>

            <div className="split">
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>정책 버전 히스토리</h3>
                  <span className="status-pill gray">{adminSettings.policyVersions.length}개</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>버전</th>
                        <th>적용일</th>
                        <th>연차 기준</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminSettings.policyVersions.map((policyVersion) => (
                        <tr key={policyVersion.id}>
                          <td>v{policyVersion.version}</td>
                          <td>{formatKstDateTime(policyVersion.effectiveFrom)}</td>
                          <td>{policyVersion.annualLeaveBasis === "JOIN_DATE" ? "입사일" : "연도"}</td>
                          <td>
                            <span className={`status-pill ${policyVersion.isActive ? "green" : "gray"}`}>
                              {policyVersion.isActive ? "활성" : "이력"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>공휴일 캘린더</h3>
                <p className="muted" style={{ margin: 0 }}>
                  한국 기본 공휴일과 대체공휴일은 자동 계산합니다. 여기서는 선거일, 임시공휴일, 회사 추가 휴무나 예외 덮어쓰기만 등록합니다.
                </p>
                <HolidayCalendarForm defaultDate={employeeScheduleBoard.today} />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th>이름</th>
                        <th>유급</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminSettings.holidays.length > 0 ? (
                        adminSettings.holidays.map((holiday) => (
                          <tr key={holiday.id}>
                            <td>{formatKstDate(holiday.date)}</td>
                            <td>{holiday.name}</td>
                            <td>{holiday.isPaidHoliday ? "예" : "아니오"}</td>
                            <td>
                              <HolidayDeleteButton holidayId={holiday.id} />
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4}>추가 등록된 회사 공휴일이 없습니다.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="split">
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>팀 생성</h3>
                <TeamCreateForm
                  managers={adminSettings.users
                    .filter(
                      (member) =>
                        member.isActive &&
                        (member.role === "MANAGER" || member.role === "HR" || member.role === "ADMIN")
                    )
                    .map((member) => ({
                      id: member.id,
                      name: member.name,
                      role: member.role
                    }))}
                />
              </div>
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>직원 초대</h3>
                <InvitationCreateForm
                  teams={adminSettings.teams.filter((team) => team.isActive).map((team) => ({
                    id: team.id,
                    name: team.name
                  }))}
                />
              </div>

              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>팀과 구성원</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>팀</th>
                        <th>관리자</th>
                        <th>인원</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminSettings.teams.map((team) => (
                        <tr key={team.id}>
                          <td>{team.name}</td>
                          <td>{team.manager?.name ?? "-"}</td>
                          <td>{team._count.users}</td>
                          <td>
                            <span className={`status-pill ${team.isActive ? "green" : "gray"}`}>
                              {team.isActive ? "활성" : "비활성"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="split">
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>팀 수정·비활성화</h3>
                <TeamEditList
                  teams={adminSettings.teams.map((team) => ({
                    id: team.id,
                    name: team.name,
                    managerUserId: team.managerUserId,
                    isActive: team.isActive
                  }))}
                  managers={adminSettings.users
                    .filter(
                      (member) =>
                        member.isActive &&
                        (member.role === "MANAGER" || member.role === "HR" || member.role === "ADMIN")
                    )
                    .map((member) => ({
                      id: member.id,
                      name: member.name,
                      role: member.role
                    }))}
                />
              </div>
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>직원 수정·비활성화</h3>
                <UserEditList
                  users={adminSettings.users.map((member) => ({
                    id: member.id,
                    name: member.name,
                    email: member.email,
                    role: member.role,
                    teamId: member.teamId,
                    jobTitle: member.jobTitle,
                    phoneNumber: member.phoneNumber,
                    extensionNumber: member.extensionNumber,
                    isActive: member.isActive
                  }))}
                  teams={adminSettings.teams.filter((team) => team.isActive).map((team) => ({
                    id: team.id,
                    name: team.name
                  }))}
                />
              </div>
            </div>

            <div className="panel stack" style={{ background: "#fbfdff" }}>
              <h3 style={{ margin: 0 }}>최근 초대</h3>
              {adminSettings.invitations.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>이름</th>
                        <th>이메일</th>
                        <th>팀</th>
                        <th>역할</th>
                        <th>상태</th>
                        <th>메일</th>
                        <th>초대 링크</th>
                        <th>작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminSettings.invitations.map((invitation) => (
                        <tr key={invitation.id}>
                          <td>{invitation.name}</td>
                          <td>{invitation.email}</td>
                          <td>{invitation.team?.name ?? "-"}</td>
                          <td>{roleLabel(invitation.role)}</td>
                          <td>
                            <span className={`status-pill ${invitationStatusTone(invitation.status)}`}>
                              {invitationStatusLabel(invitation.status)}
                            </span>
                          </td>
                          <td>
                            <span className={`status-pill ${invitationEmailStatusTone(invitation.emailStatus)}`}>
                              {invitationEmailStatusLabel(invitation.emailStatus)}
                            </span>
                          </td>
                          <td>
                            {invitation.status === "PENDING" ? (
                              <Link href={`/invite/${invitation.token}`}>열기</Link>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td>
                            {invitation.status === "PENDING" ? (
                              <InvitationActionButtons invitationId={invitation.id} />
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">아직 보낸 초대가 없습니다.</div>
              )}
            </div>
              </>
            ) : (
              <div className="empty">개인 계정 보안 설정은 위 카드에서 바로 관리할 수 있습니다.</div>
            )}
          </section>
        ) : null}
      </main>
      <DashboardMobileNav
        activeView={activeView}
        showApprovals={Boolean(managerData)}
        showReports={Boolean(monthlyReport)}
        showSettings
        unreadCount={notificationCenter.unreadCount}
        workboxUnreadCount={workboxData.stats.unread}
      />
    </div>
  );
}

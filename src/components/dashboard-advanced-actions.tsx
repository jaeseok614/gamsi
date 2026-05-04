"use client";

import { CheckCircle2, Save, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { roleLabel } from "@/lib/display-labels";

type ApprovalFilters = {
  type?: string;
  teamId?: string;
  from?: string;
  to?: string;
};

type ApprovalItem = {
  id: string;
  type: string;
  reason: string;
  createdAt: Date | string;
  attachments: Array<{ id: string }>;
  requester: {
    id: string;
    name: string;
    team?: {
      name?: string | null;
    } | null;
  };
  ageLabel: string;
  slaStatus: "ON_TRACK" | "AT_RISK" | "OVERDUE";
  repeatedMissingFlag: boolean;
  repeatedMissingAdjustments: number;
};

type AssignableUser = {
  id: string;
  name: string;
  role: string;
  team?: {
    name?: string | null;
  } | null;
};

type RiskItem = {
  id: string;
  type: string;
  level: string;
  levelLabel: string;
  title: string;
  message: string;
  status: string;
  workflowNote?: string | null;
  resolutionNote?: string | null;
  resolutionType?: string;
  resolutionReferenceLabel?: string | null;
  detectedAt: Date | string;
  slaStatus: string;
  slaLabel: string;
  slaAgeHours: number;
  user: {
    name: string;
    team?: {
      name?: string | null;
    } | null;
  };
  assignedTo?: {
    id: string;
    name: string;
    role: string;
  } | null;
  explanation?: {
    lawBasis: string;
    why: string;
    evidenceFacts: string[];
    recommendedActions: string[];
    workflowTemplates: string[];
    recurrence: {
      count28d: number;
      recentDates: string[];
      label: string;
    };
  };
};

type WeeklyBoardTemplate = {
  id: string;
  name: string;
  teamId: string | null;
  mode: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  shiftName: string;
  note: string;
};

type WeeklyBoardProps = {
  weekStart: string;
  weekEnd: string;
  days: Array<{
    date: string;
    label: string;
  }>;
  templates: WeeklyBoardTemplate[];
  summary: Array<{
    date: string;
    label: string;
    scheduledCount: number;
    leaveCount: number;
    conflictCount: number;
    coverageGapCount: number;
    availableCount: number;
    coverageTone: string;
  }>;
  rows: Array<{
    user: {
      id: string;
      name: string;
      teamId: string | null;
      teamName: string;
    };
    cells: Array<{
      date: string;
      schedule: {
        id: string;
        shiftName: string;
        startTime: string;
        endTime: string;
        breakMinutes: number;
        note?: string | null;
      } | null;
      leave: {
        label: string;
      } | null;
      risks: Array<{
        id: string;
        title: string;
        type: string;
      }>;
      hasConflict: boolean;
      isCoverageGap: boolean;
    }>;
  }>;
};

async function postJson(path: string, body?: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body ?? {})
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "요청 처리에 실패했습니다.");
  }

  return response.json().catch(() => ({}));
}

function approvalTypeLabel(type: string) {
  if (type === "OVERTIME") {
    return "초과근로";
  }
  if (type === "LEAVE") {
    return "휴가";
  }
  return "근태 정정";
}

function riskStatusLabel(status: string) {
  if (status === "IN_PROGRESS") {
    return "처리 중";
  }
  if (status === "RESOLVED") {
    return "조치 완료";
  }
  if (status === "DISMISSED") {
    return "보류";
  }
  return "미처리";
}

function riskTypeLabel(type: string) {
  const labels: Record<string, string> = {
    WEEKLY_LIMIT: "주 52시간 초과",
    UNAPPROVED_OVERTIME: "무승인 초과근로",
    REPEATED_OVERTIME: "반복 초과근로",
    MISSING_EVIDENCE: "증빙 부족",
    ADJUSTMENT_SPIKE: "정정 급증",
    LATE_RISK: "지각 위험",
    MISSING_CHECK_IN_OUT: "출퇴근 누락",
    BREAK_VIOLATION: "휴게 부족",
    SCHEDULE_MISMATCH: "스케줄 이탈",
    NIGHT_HOLIDAY_WORK: "야간/휴일근로",
    INCLUSIVE_WAGE_RISK: "포괄임금 위험"
  };

  return labels[type] ?? type;
}

function slaTone(status: ApprovalItem["slaStatus"]) {
  if (status === "OVERDUE") {
    return "red";
  }
  if (status === "AT_RISK") {
    return "yellow";
  }
  return "green";
}

function riskTone(level: string) {
  if (level === "CRITICAL" || level === "HIGH") {
    return "red";
  }
  if (level === "MEDIUM") {
    return "yellow";
  }
  return "green";
}

function riskSlaTone(status: RiskItem["slaStatus"]) {
  if (status === "OVERDUE" || status === "UNASSIGNED") {
    return "red";
  }
  if (status === "AT_RISK") {
    return "yellow";
  }
  return "green";
}

const PRESET_KEY = "workguard:approval-filter-presets";

type FilterPreset = {
  id: string;
  name: string;
  filters: ApprovalFilters;
};

function riskResolutionTypeLabel(type: string) {
  if (type === "APPROVAL") {
    return "승인 처리";
  }
  if (type === "ADJUSTMENT") {
    return "정정 처리";
  }
  if (type === "SCHEDULE") {
    return "스케줄 조정";
  }
  if (type === "MONTH_CLOSE") {
    return "월 마감";
  }
  if (type === "OTHER") {
    return "기타";
  }
  return "수동 처리";
}

function dashboardApprovalsHref(filters?: ApprovalFilters, approvalId?: string) {
  const params = new URLSearchParams();
  params.set("view", "approvals");

  if (filters?.type) {
    params.set("approvalType", filters.type);
  }
  if (filters?.teamId) {
    params.set("approvalTeamId", filters.teamId);
  }
  if (filters?.from) {
    params.set("approvalFrom", filters.from);
  }
  if (filters?.to) {
    params.set("approvalTo", filters.to);
  }
  if (approvalId) {
    params.set("approvalId", approvalId);
  }

  return `/dashboard?${params.toString()}`;
}

export function ApprovalFilterPresetBar({ filters }: { filters: ApprovalFilters }) {
  const router = useRouter();
  const [presets, setPresets] = useState<FilterPreset[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      return JSON.parse(window.localStorage.getItem(PRESET_KEY) ?? "[]") as FilterPreset[];
    } catch {
      return [];
    }
  });

  function sync(next: FilterPreset[]) {
    setPresets(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PRESET_KEY, JSON.stringify(next));
    }
  }

  function applyPreset(preset: FilterPreset) {
    router.push(dashboardApprovalsHref(preset.filters));
  }

  function savePreset() {
    if (typeof window === "undefined") {
      return;
    }

    const name = window.prompt("저장할 필터 이름");
    if (!name?.trim()) {
      return;
    }

    sync([
      {
        id: `${Date.now()}`,
        name: name.trim(),
        filters
      },
      ...presets
    ].slice(0, 6));
  }

  function removePreset(id: string) {
    sync(presets.filter((preset) => preset.id !== id));
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="actions-row" style={{ justifyContent: "space-between" }}>
        <strong>저장된 필터</strong>
        <button className="button secondary" type="button" onClick={savePreset}>
          <Save size={15} />
          현재 조건 저장
        </button>
      </div>
      {presets.length > 0 ? (
        <div className="actions-row" style={{ flexWrap: "wrap" }}>
          {presets.map((preset) => (
            <div className="card" key={preset.id} style={{ minWidth: 180 }}>
              <strong>{preset.name}</strong>
              <div className="actions-row" style={{ marginTop: 10 }}>
                <button className="button secondary" type="button" onClick={() => applyPreset(preset)}>
                  적용
                </button>
                <button className="button secondary" type="button" onClick={() => removePreset(preset.id)}>
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">저장된 필터가 없습니다.</div>
      )}
    </div>
  );
}

export function DashboardPersonalizationPanel({
  personalization,
  currentApprovalFilters
}: {
  personalization: {
    defaultApprovalFilters: {
      type: string;
      teamId: string;
      from: string;
      to: string;
    };
    defaultApprovalFilterName: string;
    savedApprovalViews: Array<{
      id: string;
      name: string;
      filters: ApprovalFilters;
    }>;
    showMyAssignedRisks: boolean;
    showTodayApprovals: boolean;
    showWeekBlockers: boolean;
    compactRiskView: boolean;
  };
  currentApprovalFilters: ApprovalFilters;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState(personalization);

  function patch(next: Partial<typeof state>) {
    setState((current) => ({
      ...current,
      ...next
    }));
  }

  function save(useCurrentFilters: boolean) {
    setMessage("");
    startTransition(async () => {
      try {
        await postJson("/api/dashboard/personalization", {
          ...state,
          defaultApprovalFilters: useCurrentFilters
            ? {
                type: currentApprovalFilters.type ?? "",
                teamId: currentApprovalFilters.teamId ?? "",
                from: currentApprovalFilters.from ?? "",
                to: currentApprovalFilters.to ?? ""
              }
            : state.defaultApprovalFilters
        });
        setMessage(useCurrentFilters ? "현재 필터를 기본 승인 화면으로 저장했습니다." : "대시보드 개인화를 저장했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "개인화 저장에 실패했습니다.");
      }
    });
  }

  function applySavedView(filters: ApprovalFilters) {
    router.push(dashboardApprovalsHref(filters));
  }

  function saveCurrentView() {
    const name = typeof window !== "undefined" ? window.prompt("저장할 화면 이름") : null;
    if (!name?.trim()) {
      return;
    }

    const nextState = {
      ...state,
      savedApprovalViews: [
        {
          id: `${Date.now()}`,
          name: name.trim(),
          filters: {
            type: currentApprovalFilters.type ?? "",
            teamId: currentApprovalFilters.teamId ?? "",
            from: currentApprovalFilters.from ?? "",
            to: currentApprovalFilters.to ?? ""
          }
        },
        ...state.savedApprovalViews
      ].slice(0, 8)
    };
    setState(nextState);
    setMessage("");
    startTransition(async () => {
      try {
        await postJson("/api/dashboard/personalization", nextState);
        setMessage("현재 필터를 저장한 화면에 추가했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "화면 저장에 실패했습니다.");
      }
    });
  }

  function removeSavedView(viewId: string) {
    const nextState = {
      ...state,
      savedApprovalViews: state.savedApprovalViews.filter((view) => view.id !== viewId)
    };
    setState(nextState);
    setMessage("");
    startTransition(async () => {
      try {
        await postJson("/api/dashboard/personalization", nextState);
        setMessage("저장한 화면을 삭제했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "저장한 화면 삭제에 실패했습니다.");
      }
    });
  }

  return (
    <div className="card">
      <div className="actions-row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>내 저장 화면</strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            자주 보는 위젯과 승인 기본 필터를 계정 기준으로 저장합니다.
          </p>
        </div>
        <button className="button secondary" type="button" disabled={isPending} onClick={() => save(true)}>
          <Save size={15} />
          현재 필터 기본값 저장
        </button>
      </div>
      <div className="actions-row" style={{ marginTop: 12 }}>
        <button className="button secondary" type="button" disabled={isPending} onClick={saveCurrentView}>
          <Save size={15} />
          현재 필터를 저장 화면에 추가
        </button>
      </div>
      {state.savedApprovalViews.length > 0 ? (
        <div className="stack" style={{ gap: 10, marginTop: 12 }}>
          <strong>저장한 승인 화면</strong>
          <div className="actions-row" style={{ flexWrap: "wrap" }}>
            {state.savedApprovalViews.map((view) => (
              <div className="card" key={view.id} style={{ minWidth: 190 }}>
                <strong>{view.name}</strong>
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  {view.filters.type || "전체"} · {view.filters.teamId || "전체 팀"} · {view.filters.from || "-"} ~ {view.filters.to || "-"}
                </p>
                <div className="actions-row" style={{ marginTop: 10 }}>
                  <button className="button secondary" type="button" onClick={() => applySavedView(view.filters)}>
                    적용
                  </button>
                  <button className="button secondary" type="button" disabled={isPending} onClick={() => removeSavedView(view.id)}>
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid-2" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="dashboard-default-filter-name">기본 필터 이름</label>
          <input
            id="dashboard-default-filter-name"
            value={state.defaultApprovalFilterName}
            onChange={(event) => patch({ defaultApprovalFilterName: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="dashboard-default-filter-type">기본 요청 유형</label>
          <select
            id="dashboard-default-filter-type"
            value={state.defaultApprovalFilters.type}
            onChange={(event) =>
              patch({
                defaultApprovalFilters: {
                  ...state.defaultApprovalFilters,
                  type: event.target.value
                }
              })
            }
          >
            <option value="">전체</option>
            <option value="OVERTIME">초과근로</option>
            <option value="ADJUSTMENT">근태 정정</option>
            <option value="LEAVE">휴가</option>
          </select>
        </div>
      </div>
      <div className="actions-row" style={{ flexWrap: "wrap" }}>
        <label className="check-row">
          <input
            type="checkbox"
            checked={state.showMyAssignedRisks}
            onChange={(event) => patch({ showMyAssignedRisks: event.target.checked })}
          />
          내 담당 리스크
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={state.showTodayApprovals}
            onChange={(event) => patch({ showTodayApprovals: event.target.checked })}
          />
          오늘 처리할 승인
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={state.showWeekBlockers}
            onChange={(event) => patch({ showWeekBlockers: event.target.checked })}
          />
          이번 주 마감 전 확인 항목
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={state.compactRiskView}
            onChange={(event) => patch({ compactRiskView: event.target.checked })}
          />
          리스크 요약 보기
        </label>
      </div>
      <div className="actions-row">
        <button className="button" type="button" disabled={isPending} onClick={() => save(false)}>
          <Save size={15} />
          개인화 저장
        </button>
      </div>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function ApprovalInboxManager({
  approvals,
  selectedApprovalId,
  filters
}: {
  approvals: ApprovalItem[];
  selectedApprovalId?: string | null;
  filters: ApprovalFilters;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const allSelected = approvals.length > 0 && selectedIds.length === approvals.length;

  const hrefForApproval = (approvalId: string) => {
    return dashboardApprovalsHref(filters, approvalId);
  };

  function toggleSelection(approvalId: string) {
    setSelectedIds((current) =>
      current.includes(approvalId) ? current.filter((id) => id !== approvalId) : [...current, approvalId]
    );
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : approvals.map((approval) => approval.id));
  }

  function bulkReview(action: "approve" | "reject") {
    setMessage("");
    startTransition(async () => {
      try {
        const result = (await postJson("/api/manager/approvals/bulk", {
          approvalIds: selectedIds,
          action,
          reviewNote
        })) as {
          processed: number;
          failed: number;
          resolvedRiskCount: number;
        };
        setMessage(
          `${action === "approve" ? "다건 승인" : "다건 반려"} ${result.processed}건 완료` +
            (result.resolvedRiskCount > 0 ? ` · 관련 리스크 ${result.resolvedRiskCount}건 해소` : "") +
            (result.failed > 0 ? ` · 실패 ${result.failed}건` : "")
        );
        setSelectedIds([]);
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "다건 승인 처리에 실패했습니다.");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card">
        <div className="actions-row" style={{ justifyContent: "space-between" }}>
          <label className="check-row" style={{ margin: 0 }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            전체 선택
          </label>
          <span className="muted">선택 {selectedIds.length}건</span>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="bulk-review-note">다건 처리 메모</label>
          <textarea
            id="bulk-review-note"
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="SLA 지연 사유, 일괄 승인 기준, 후속 안내를 남겨주세요."
          />
        </div>
        <div className="actions-row">
          <button className="button" type="button" disabled={isPending || selectedIds.length === 0} onClick={() => bulkReview("approve")}>
            <ThumbsUp size={15} />
            다건 승인
          </button>
          <button className="button danger" type="button" disabled={isPending || selectedIds.length === 0} onClick={() => bulkReview("reject")}>
            <ThumbsDown size={15} />
            다건 반려
          </button>
        </div>
      </div>

      {approvals.length > 0 ? (
        <div className="stack" style={{ gap: 12 }}>
          {approvals.map((approval) => (
            <div
              className="card"
              key={approval.id}
              style={selectedApprovalId === approval.id ? { borderColor: "#3b82f6", background: "#f8fbff" } : undefined}
            >
              <div className="actions-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <label className="check-row" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(approval.id)}
                    onChange={() => toggleSelection(approval.id)}
                  />
                  <strong>{approval.requester.name}</strong>
                </label>
                <span className={`status-pill ${slaTone(approval.slaStatus)}`}>
                  {approval.slaStatus === "OVERDUE" ? "SLA 초과" : approval.slaStatus === "AT_RISK" ? "SLA 주의" : "SLA 정상"}
                </span>
              </div>
              <p style={{ marginTop: 10 }}>{approvalTypeLabel(approval.type)} · {approval.reason}</p>
              <p className="muted" style={{ marginTop: 8 }}>
                {approval.requester.team?.name ?? "소속 없음"} · 대기 {approval.ageLabel} · 첨부 {approval.attachments.length}개
              </p>
              {approval.repeatedMissingFlag ? (
                <p className="muted" style={{ marginTop: 8, color: "#b45309" }}>
                  최근 30일 누락 정정 {approval.repeatedMissingAdjustments}건으로 반복 누락 주의 대상입니다.
                </p>
              ) : null}
              <div className="actions-row" style={{ marginTop: 10 }}>
                <Link className="button secondary" href={hrefForApproval(approval.id)}>
                  상세 보기
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">조건에 맞는 승인 대기 요청이 없습니다.</div>
      )}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function RiskWorkflowBoard({
  signals,
  assignableUsers,
  recentlyResolved,
  initialStatusFilter = "ALL",
  initialTypeFilter = "ALL",
  focusedRiskId = null
}: {
  signals: RiskItem[];
  assignableUsers: AssignableUser[];
  recentlyResolved: RiskItem[];
  initialStatusFilter?: "ALL" | RiskItem["status"];
  initialTypeFilter?: "ALL" | RiskItem["type"];
  focusedRiskId?: string | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [statusFilter, setStatusFilter] = useState<"ALL" | RiskItem["status"]>(initialStatusFilter);
  const [typeFilter, setTypeFilter] = useState<"ALL" | RiskItem["type"]>(initialTypeFilter);
  const [drafts, setDrafts] = useState<Record<string, {
    status: RiskItem["status"];
    assignedToId: string;
    workflowNote: string;
    resolutionNote: string;
    resolutionType: string;
    resolutionReferenceLabel: string;
  }>>(() =>
    Object.fromEntries(
      signals.map((signal) => [
        signal.id,
        {
          status: signal.status,
          assignedToId: signal.assignedTo?.id ?? "",
          workflowNote: signal.workflowNote ?? "",
          resolutionNote: signal.resolutionNote ?? "",
          resolutionType: signal.resolutionType ?? "MANUAL",
          resolutionReferenceLabel: signal.resolutionReferenceLabel ?? ""
        }
      ])
    )
  );

  const orderedSignals = useMemo(
    () =>
      [...signals].sort((a, b) => {
        const aPriority = a.status === "OPEN" ? 0 : 1;
        const bPriority = b.status === "OPEN" ? 0 : 1;
        return aPriority - bPriority;
      }),
    [signals]
  );
  const filteredSignals = useMemo(
    () =>
      orderedSignals.filter((signal) => {
        const matchesStatus = statusFilter === "ALL" || signal.status === statusFilter;
        const matchesType = typeFilter === "ALL" || signal.type === typeFilter;
        return matchesStatus && matchesType;
      }),
    [orderedSignals, statusFilter, typeFilter]
  );
  const filteredRecentlyResolved = useMemo(
    () =>
      recentlyResolved.filter((signal) => {
        const matchesType = typeFilter === "ALL" || signal.type === typeFilter;
        return matchesType;
      }),
    [recentlyResolved, typeFilter]
  );
  const typeOptions = useMemo(
    () =>
      Array.from(new Set(signals.map((signal) => signal.type))).sort((a, b) => a.localeCompare(b)),
    [signals]
  );

  function patch(riskId: string, next: Partial<(typeof drafts)[string]>) {
    setDrafts((current) => ({
      ...current,
      [riskId]: {
        ...current[riskId],
        ...next
      }
    }));
  }

  function saveRisk(riskId: string) {
    const draft = drafts[riskId];
    setMessage("");
    startTransition(async () => {
      try {
        await postJson(`/api/risks/${riskId}/workflow`, {
          status: draft.status,
          assignedToId: draft.assignedToId || null,
          workflowNote: draft.workflowNote,
          resolutionNote: draft.resolutionNote,
          resolutionType: draft.resolutionType,
          resolutionReferenceLabel: draft.resolutionReferenceLabel
        });
        setMessage("리스크 처리 내용을 저장했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "리스크 처리 내용 저장에 실패했습니다.");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card">
        <div className="actions-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <strong>리스크 필터</strong>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              setStatusFilter("ALL");
              setTypeFilter("ALL");
            }}
          >
            전체 보기
          </button>
        </div>
        <div className="grid-2" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="risk-status-filter">처리 상태</label>
            <select
              id="risk-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "ALL" | RiskItem["status"])}
            >
              <option value="ALL">전체 상태</option>
              <option value="OPEN">{riskStatusLabel("OPEN")}</option>
              <option value="IN_PROGRESS">{riskStatusLabel("IN_PROGRESS")}</option>
              <option value="RESOLVED">{riskStatusLabel("RESOLVED")}</option>
              <option value="DISMISSED">{riskStatusLabel("DISMISSED")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="risk-type-filter">유형</label>
            <select
              id="risk-type-filter"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as "ALL" | RiskItem["type"])}
            >
              <option value="ALL">전체 유형</option>
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {riskTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {filteredSignals.length > 0 ? (
        filteredSignals.map((signal) => {
          const draft = drafts[signal.id];
          return (
            <div
              className="card"
              key={signal.id}
              style={focusedRiskId === signal.id ? { borderColor: "#3b82f6", background: "#f8fbff" } : undefined}
            >
              <div className="actions-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <strong>{signal.title}</strong>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    {signal.user.name} · {signal.user.team?.name ?? "소속 없음"} · {signal.message}
                  </p>
                </div>
                <div className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
                  <span className={`status-pill ${riskTone(signal.level)}`}>{signal.levelLabel}</span>
                  <span className="status-pill gray">{riskStatusLabel(signal.status)}</span>
                  <span className={`status-pill ${riskSlaTone(signal.slaStatus)}`}>{signal.slaLabel}</span>
                </div>
              </div>

                <div className="grid-3" style={{ marginTop: 12 }}>
                  <div className="field">
                  <label htmlFor={`risk-status-${signal.id}`}>처리 상태</label>
                  <select
                    id={`risk-status-${signal.id}`}
                    value={draft.status}
                    onChange={(event) => patch(signal.id, { status: event.target.value as RiskItem["status"] })}
                  >
                    <option value="OPEN">미처리</option>
                    <option value="IN_PROGRESS">처리 중</option>
                    <option value="RESOLVED">조치 완료</option>
                    <option value="DISMISSED">보류</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`risk-assignee-${signal.id}`}>담당자</label>
                  <select
                    id={`risk-assignee-${signal.id}`}
                    value={draft.assignedToId}
                    onChange={(event) => patch(signal.id, { assignedToId: event.target.value })}
                  >
                    <option value="">미지정</option>
                    {assignableUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} · {roleLabel(user.role)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`risk-resolution-type-${signal.id}`}>처리 방식</label>
                  <select
                    id={`risk-resolution-type-${signal.id}`}
                    value={draft.resolutionType}
                    onChange={(event) => patch(signal.id, { resolutionType: event.target.value })}
                  >
                    <option value="MANUAL">수동 처리</option>
                    <option value="APPROVAL">승인 처리</option>
                    <option value="ADJUSTMENT">정정 처리</option>
                    <option value="SCHEDULE">스케줄 조정</option>
                    <option value="MONTH_CLOSE">월 마감</option>
                    <option value="OTHER">기타</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label htmlFor={`risk-note-${signal.id}`}>조치 메모</label>
                <textarea
                  id={`risk-note-${signal.id}`}
                  value={draft.workflowNote}
                  onChange={(event) => patch(signal.id, { workflowNote: event.target.value })}
                  placeholder="누가 언제 어떤 조치를 진행 중인지 기록합니다."
                />
              </div>
              {signal.explanation ? (
                <div className="card" style={{ marginTop: 12, background: "#fbfdff" }}>
                  <div className="actions-row" style={{ justifyContent: "space-between" }}>
                    <strong>판단 근거</strong>
                    <span className="status-pill gray">{signal.explanation.recurrence.label}</span>
                  </div>
                  <p className="muted" style={{ margin: "8px 0 0" }}>{signal.explanation.lawBasis}</p>
                  {signal.explanation.evidenceFacts.length > 0 ? (
                    <div className="actions-row" style={{ gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                      {signal.explanation.evidenceFacts.map((fact) => (
                        <span key={`${signal.id}-${fact}`} className="status-pill gray">
                          {fact}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="grid-2" style={{ marginTop: 12 }}>
                    <div>
                      <strong>권장 조치</strong>
                      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                        {signal.explanation.recommendedActions.map((item) => (
                          <span key={`${signal.id}-action-${item}`} className="muted">
                            • {item}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <strong>메모 템플릿</strong>
                      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                        {signal.explanation.workflowTemplates.map((template) => (
                          <button
                            key={`${signal.id}-template-${template}`}
                            className="button secondary"
                            type="button"
                            onClick={() => patch(signal.id, { workflowNote: template })}
                          >
                            {template.length > 34 ? `${template.slice(0, 34)}...` : template}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="grid-2">
                <div className="field">
                  <label htmlFor={`risk-resolution-note-${signal.id}`}>처리 결과 메모</label>
                  <textarea
                    id={`risk-resolution-note-${signal.id}`}
                    value={draft.resolutionNote}
                    onChange={(event) => patch(signal.id, { resolutionNote: event.target.value })}
                    placeholder="어떻게 처리했는지 또는 왜 보류했는지 적어주세요."
                  />
                </div>
                <div className="field">
                  <label htmlFor={`risk-resolution-ref-${signal.id}`}>관련 작업</label>
                  <input
                    id={`risk-resolution-ref-${signal.id}`}
                    value={draft.resolutionReferenceLabel}
                    onChange={(event) => patch(signal.id, { resolutionReferenceLabel: event.target.value })}
                    placeholder="예: 정정 승인, 스케줄 수정, 월 마감 재검토"
                  />
                </div>
              </div>

              <div className="actions-row">
                <button className="button" type="button" disabled={isPending} onClick={() => saveRisk(signal.id)}>
                  <Save size={15} />
                  저장
                </button>
                <span className="muted">
                  감지 {new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(signal.detectedAt))} · SLA 경과 {signal.slaAgeHours}시간
                </span>
              </div>
            </div>
          );
        })
      ) : (
        <div className="empty">현재 필터 조건에서 처리할 리스크가 없습니다.</div>
      )}

      <div className="card">
        <div className="actions-row" style={{ justifyContent: "space-between" }}>
          <strong>
            <CheckCircle2 size={18} /> 최근 자동/수동 해소
          </strong>
          <span className="status-pill gray">{filteredRecentlyResolved.length}건</span>
        </div>
        {filteredRecentlyResolved.length > 0 ? (
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            {filteredRecentlyResolved.map((signal) => (
              <div key={`resolved-${signal.id}`} className="notification-card read">
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <strong>{signal.title}</strong>
                  <span className="status-pill green">{riskResolutionTypeLabel(signal.resolutionType ?? "MANUAL")}</span>
                </div>
                <p className="muted" style={{ margin: "6px 0 0" }}>
                  {signal.user.name} · {signal.resolutionReferenceLabel ?? signal.resolutionNote ?? "자동 해소"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty" style={{ marginTop: 12 }}>현재 필터 기준의 최근 해소 이력이 없습니다.</div>
        )}
      </div>

      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function WeeklyScheduleBoard({
  weekStart,
  weekEnd,
  days,
  templates,
  summary,
  rows
}: WeeklyBoardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [teamId, setTeamId] = useState("ALL");
  const [templateName, setTemplateName] = useState("");
  const [shiftName, setShiftName] = useState(templates[0]?.shiftName ?? "기본 근무");
  const [startTime, setStartTime] = useState(templates[0]?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(templates[0]?.endTime ?? "18:00");
  const [breakMinutes, setBreakMinutes] = useState(String(templates[0]?.breakMinutes ?? 60));
  const [note, setNote] = useState(templates[0]?.note ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<null | {
    summaryLine: string;
    total: number;
    overwriteCount: number;
    deleteCount: number;
  }>(null);
  const teams = useMemo(
    () =>
      Array.from(
        rows.reduce<Map<string, { id: string; name: string }>>((acc, row) => {
          if (row.user.teamId && !acc.has(row.user.teamId)) {
            acc.set(row.user.teamId, {
              id: row.user.teamId,
              name: row.user.teamName
            });
          }
          return acc;
        }, new Map()).values()
      ),
    [rows]
  );
  const visibleRows = rows.filter((row) => teamId === "ALL" || row.user.teamId === teamId);
  const visibleTemplates = templates.filter((template) => teamId === "ALL" || template.teamId === null || template.teamId === teamId);
  const selectedEntries = selected.map((key) => {
    const [userId, workDate] = key.split(":");
    return {
      userId,
      workDate
    };
  });

  function patchFromTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId);
    const next = templates.find((item) => item.id === nextTemplateId);
    if (!next) {
      return;
    }

    setShiftName(next.shiftName);
    setStartTime(next.startTime);
    setEndTime(next.endTime);
    setBreakMinutes(String(next.breakMinutes));
    setNote(next.note);
    setTemplateName(next.name);
  }

  function selectCell(key: string) {
    setSelected((current) => (current.includes(key) ? current : [...current, key]));
  }

  async function requestPreview(mode: "board_apply" | "board_clear") {
    const response = await fetch("/api/schedules/preview", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        mode,
        entries: selectedEntries,
        startTime,
        endTime,
        breakMinutes: Number(breakMinutes),
        shiftName,
        note
      })
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          summaryLine?: string;
          total?: number;
          overwriteCount?: number;
          deleteCount?: number;
        }
      | null;
    if (!response.ok) {
      throw new Error(payload?.error ?? "보드 미리보기에 실패했습니다.");
    }
    setPreview({
      summaryLine: payload?.summaryLine ?? "",
      total: payload?.total ?? 0,
      overwriteCount: payload?.overwriteCount ?? 0,
      deleteCount: payload?.deleteCount ?? 0
    });
  }

  function applySelection(mode: "board_apply" | "board_clear") {
    if (selectedEntries.length === 0) {
      setMessage("먼저 보드에서 셀을 선택하세요.");
      return;
    }

    setMessage("");
    startTransition(async () => {
      try {
        await requestPreview(mode);
        const response = await fetch("/api/schedules", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            mode,
            entries: selectedEntries,
            startTime,
            endTime,
            breakMinutes: Number(breakMinutes),
            shiftName,
            note
          })
        });
        const payload = (await response.json().catch(() => null)) as { error?: string; summary?: { summaryLine?: string } } | null;
        if (!response.ok) {
          throw new Error(payload?.error ?? "보드 스케줄 적용에 실패했습니다.");
        }

        setSelected([]);
        setMessage(mode === "board_clear" ? "선택한 스케줄을 삭제했습니다." : "선택한 스케줄을 적용했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "보드 작업에 실패했습니다.");
      }
    });
  }

  function saveTeamTemplate() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/schedules/templates", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            name: templateName.trim() || shiftName.trim() || "팀 템플릿",
            teamId: teamId === "ALL" ? null : teamId,
            mode: "single",
            startTime,
            endTime,
            breakMinutes: Number(breakMinutes),
            shiftName,
            note
          })
        });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.error ?? "팀 템플릿 저장에 실패했습니다.");
        }

        setMessage("팀 템플릿을 저장했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "팀 템플릿 저장에 실패했습니다.");
      }
    });
  }

  return (
    <div className="stack" onMouseUp={() => setIsDragging(false)} onMouseLeave={() => setIsDragging(false)}>
      <div className="actions-row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>주간 보드</strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            {weekStart} ~ {weekEnd} · 셀을 드래그로 선택한 뒤 바로 적용하거나 삭제합니다.
          </p>
        </div>
        <span className="status-pill gray">선택 {selectedEntries.length}칸</span>
      </div>

      <div className="grid-4">
        {summary.map((day) => (
          <div className="metric" key={day.date}>
            <span>{day.label}</span>
            <strong>{day.scheduledCount}/{day.availableCount}</strong>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              휴가 {day.leaveCount} · 충돌 {day.conflictCount} · 공백 {day.coverageGapCount}
            </p>
          </div>
        ))}
      </div>

      <div className="split">
        <div className="card">
          <div className="grid-3">
            <div className="field">
              <label htmlFor="board-team-filter">팀</label>
              <select id="board-team-filter" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                <option value="ALL">전체 팀</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="board-template-select">팀 템플릿</label>
              <select
                id="board-template-select"
                value={templateId}
                onChange={(event) => patchFromTemplate(event.target.value)}
              >
                <option value="">직접 입력</option>
                {visibleTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.teamId ? "[팀]" : "[공용]"} {template.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="board-template-name">저장 이름</label>
              <input
                id="board-template-name"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="예: 오전 운영조"
              />
            </div>
          </div>
          <div className="grid-4" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="board-shift-name">근무명</label>
              <input id="board-shift-name" value={shiftName} onChange={(event) => setShiftName(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="board-start-time">시작</label>
              <input id="board-start-time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="board-end-time">종료</label>
              <input id="board-end-time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="board-break-minutes">휴게</label>
              <input
                id="board-break-minutes"
                inputMode="numeric"
                value={breakMinutes}
                onChange={(event) => setBreakMinutes(event.target.value)}
              />
            </div>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="board-note">메모</label>
            <input id="board-note" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <div className="actions-row" style={{ marginTop: 12 }}>
            <button className="button secondary" type="button" disabled={isPending} onClick={saveTeamTemplate}>
              <Save size={16} />
              팀 템플릿 저장
            </button>
            <button className="button" type="button" disabled={isPending} onClick={() => applySelection("board_apply")}>
              <CheckCircle2 size={16} />
              선택 적용
            </button>
            <button className="button secondary" type="button" disabled={isPending} onClick={() => applySelection("board_clear")}>
              선택 삭제
            </button>
            <button className="button secondary" type="button" disabled={isPending} onClick={() => setSelected([])}>
              선택 비우기
            </button>
          </div>
          {preview ? (
            <p className="muted" style={{ marginTop: 10 }}>
              {preview.summaryLine}
            </p>
          ) : null}
          {message ? <p className="muted" style={{ marginTop: 10 }}>{message}</p> : null}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>직원</th>
              {days.map((day) => (
                <th key={day.date}>{day.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.user.id}>
                <td>
                  {row.user.name}
                  <br />
                  <span className="muted">{row.user.teamName}</span>
                </td>
                {row.cells.map((cell) => {
                  const key = `${row.user.id}:${cell.date}`;
                  const isSelected = selected.includes(key);
                  return (
                    <td
                      key={key}
                      style={{
                        minWidth: 132,
                        cursor: "crosshair",
                        background: isSelected ? "#eff6ff" : cell.hasConflict ? "#fff7ed" : cell.isCoverageGap ? "#fefce8" : undefined,
                        border: isSelected ? "2px solid #2563eb" : undefined
                      }}
                      onMouseDown={() => {
                        setIsDragging(true);
                        selectCell(key);
                      }}
                      onMouseEnter={() => {
                        if (isDragging) {
                          selectCell(key);
                        }
                      }}
                    >
                      {cell.schedule ? (
                        <div>
                          <strong>{cell.schedule.shiftName}</strong>
                          <br />
                          <span className="muted">{cell.schedule.startTime} - {cell.schedule.endTime}</span>
                        </div>
                      ) : (
                        <span className="muted">미배정</span>
                      )}
                      {cell.leave ? <div className="status-pill gray" style={{ marginTop: 6 }}>{cell.leave.label}</div> : null}
                      {cell.hasConflict ? <div className="status-pill yellow" style={{ marginTop: 6 }}>휴가 충돌</div> : null}
                      {cell.risks.length > 0 ? (
                        <div className="status-pill red" style={{ marginTop: 6 }}>
                          리스크 {cell.risks.length}
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

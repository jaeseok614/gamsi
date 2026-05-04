import type { User } from "@/generated/prisma";

import { getAuditPayloadRecord, getLatestAuditSnapshot, writeAuditSnapshot } from "@/lib/settings-store";

type Actor = Pick<User, "id" | "companyId" | "role">;

export type ApprovalFilterState = {
  type: string;
  teamId: string;
  from: string;
  to: string;
};

export type SavedApprovalView = {
  id: string;
  name: string;
  filters: ApprovalFilterState;
};

export type DashboardPersonalization = {
  defaultApprovalFilters: ApprovalFilterState;
  defaultApprovalFilterName: string;
  savedApprovalViews: SavedApprovalView[];
  showMyAssignedRisks: boolean;
  showTodayApprovals: boolean;
  showWeekBlockers: boolean;
  compactRiskView: boolean;
};

export function defaultDashboardPersonalization(): DashboardPersonalization {
  return {
    defaultApprovalFilters: {
      type: "",
      teamId: "",
      from: "",
      to: ""
    },
    defaultApprovalFilterName: "기본 승인 화면",
    savedApprovalViews: [],
    showMyAssignedRisks: true,
    showTodayApprovals: true,
    showWeekBlockers: true,
    compactRiskView: false
  };
}

function normalizeFilterValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function parseSavedApprovalViews(value: unknown): SavedApprovalView[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const record = getAuditPayloadRecord(entry);
      const filters = getAuditPayloadRecord(record?.filters);
      const id = typeof record?.id === "string" && record.id.trim() ? record.id.trim() : "";
      const name = typeof record?.name === "string" && record.name.trim() ? record.name.trim() : "";

      if (!id || !name) {
        return null;
      }

      return {
        id,
        name,
        filters: {
          type: normalizeFilterValue(filters?.type),
          teamId: normalizeFilterValue(filters?.teamId),
          from: normalizeFilterValue(filters?.from),
          to: normalizeFilterValue(filters?.to)
        }
      } satisfies SavedApprovalView;
    })
    .filter((entry): entry is SavedApprovalView => Boolean(entry))
    .slice(0, 8);
}

function parseDashboardPersonalization(payload: unknown): DashboardPersonalization {
  const record = getAuditPayloadRecord(payload);
  if (!record) {
    return defaultDashboardPersonalization();
  }

  const filters = getAuditPayloadRecord(record.defaultApprovalFilters);
  const defaults = defaultDashboardPersonalization();

  return {
    defaultApprovalFilters: {
      type: normalizeFilterValue(filters?.type),
      teamId: normalizeFilterValue(filters?.teamId),
      from: normalizeFilterValue(filters?.from),
      to: normalizeFilterValue(filters?.to)
    },
    defaultApprovalFilterName:
      typeof record.defaultApprovalFilterName === "string" && record.defaultApprovalFilterName.trim()
        ? record.defaultApprovalFilterName.trim()
        : defaults.defaultApprovalFilterName,
    savedApprovalViews: parseSavedApprovalViews(record.savedApprovalViews),
    showMyAssignedRisks:
      typeof record.showMyAssignedRisks === "boolean" ? record.showMyAssignedRisks : defaults.showMyAssignedRisks,
    showTodayApprovals:
      typeof record.showTodayApprovals === "boolean" ? record.showTodayApprovals : defaults.showTodayApprovals,
    showWeekBlockers:
      typeof record.showWeekBlockers === "boolean" ? record.showWeekBlockers : defaults.showWeekBlockers,
    compactRiskView:
      typeof record.compactRiskView === "boolean" ? record.compactRiskView : defaults.compactRiskView
  };
}

export async function getDashboardPersonalization(actor: Actor) {
  const latest = await getLatestAuditSnapshot({
    companyId: actor.companyId,
    action: "dashboard.personalization.saved",
    targetType: "dashboard_personalization",
    targetId: actor.id
  });

  return parseDashboardPersonalization(latest?.payload);
}

export async function saveDashboardPersonalization(
  actor: Actor,
  input: DashboardPersonalization
) {
  await writeAuditSnapshot({
    actor,
    action: "dashboard.personalization.saved",
    targetType: "dashboard_personalization",
    targetId: actor.id,
    payload: {
      defaultApprovalFilters: input.defaultApprovalFilters,
      defaultApprovalFilterName: input.defaultApprovalFilterName,
      savedApprovalViews: input.savedApprovalViews,
      showMyAssignedRisks: input.showMyAssignedRisks,
      showTodayApprovals: input.showTodayApprovals,
      showWeekBlockers: input.showWeekBlockers,
      compactRiskView: input.compactRiskView
    }
  });

  return input;
}

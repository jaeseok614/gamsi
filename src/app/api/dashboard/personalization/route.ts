import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canManage } from "@/lib/auth";
import {
  defaultDashboardPersonalization,
  getDashboardPersonalization,
  saveDashboardPersonalization
} from "@/lib/dashboard-personalization";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("개인화 설정 권한이 필요합니다.", 403);
  }

  return NextResponse.json(await getDashboardPersonalization(user));
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("개인화 설정 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => null)) as Partial<ReturnType<typeof defaultDashboardPersonalization>> | null;
  const defaults = defaultDashboardPersonalization();

  try {
    return NextResponse.json(
      await saveDashboardPersonalization(user, {
        defaultApprovalFilters: {
          type: typeof body?.defaultApprovalFilters?.type === "string" ? body.defaultApprovalFilters.type : defaults.defaultApprovalFilters.type,
          teamId: typeof body?.defaultApprovalFilters?.teamId === "string" ? body.defaultApprovalFilters.teamId : defaults.defaultApprovalFilters.teamId,
          from: typeof body?.defaultApprovalFilters?.from === "string" ? body.defaultApprovalFilters.from : defaults.defaultApprovalFilters.from,
          to: typeof body?.defaultApprovalFilters?.to === "string" ? body.defaultApprovalFilters.to : defaults.defaultApprovalFilters.to
        },
        defaultApprovalFilterName:
          typeof body?.defaultApprovalFilterName === "string" && body.defaultApprovalFilterName.trim()
            ? body.defaultApprovalFilterName.trim()
            : defaults.defaultApprovalFilterName,
        savedApprovalViews: Array.isArray(body?.savedApprovalViews)
          ? body.savedApprovalViews
              .map((entry) => ({
                id: typeof entry?.id === "string" ? entry.id.trim() : "",
                name: typeof entry?.name === "string" ? entry.name.trim() : "",
                filters: {
                  type: typeof entry?.filters?.type === "string" ? entry.filters.type : "",
                  teamId: typeof entry?.filters?.teamId === "string" ? entry.filters.teamId : "",
                  from: typeof entry?.filters?.from === "string" ? entry.filters.from : "",
                  to: typeof entry?.filters?.to === "string" ? entry.filters.to : ""
                }
              }))
              .filter((entry) => entry.id && entry.name)
              .slice(0, 8)
          : defaults.savedApprovalViews,
        showMyAssignedRisks:
          typeof body?.showMyAssignedRisks === "boolean" ? body.showMyAssignedRisks : defaults.showMyAssignedRisks,
        showTodayApprovals:
          typeof body?.showTodayApprovals === "boolean" ? body.showTodayApprovals : defaults.showTodayApprovals,
        showWeekBlockers:
          typeof body?.showWeekBlockers === "boolean" ? body.showWeekBlockers : defaults.showWeekBlockers,
        compactRiskView:
          typeof body?.compactRiskView === "boolean" ? body.compactRiskView : defaults.compactRiskView
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "개인화 설정 저장에 실패했습니다.");
  }
}

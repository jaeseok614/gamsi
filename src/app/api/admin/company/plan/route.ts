import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";
import { getCompanyPlanSummary, updateCompanyPlan, type CompanyPlanTier } from "@/lib/company-plan";

const allowedTiers = new Set<CompanyPlanTier>([
  "TRIAL",
  "STARTER",
  "GROWTH",
  "ENTERPRISE"
]);

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("플랜 조회 권한이 필요합니다.", 403);
  }

  return NextResponse.json(await getCompanyPlanSummary(user.companyId));
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("플랜 설정 권한이 필요합니다.", 403);
  }

  const body = (await request.json()) as {
    planTier?: CompanyPlanTier;
    userLimit?: number;
  };

  if (!body.planTier || !allowedTiers.has(body.planTier)) {
    return jsonError("플랜을 확인하세요.");
  }

  try {
    return NextResponse.json(
      await updateCompanyPlan(user, {
        planTier: body.planTier,
        userLimit: Number(body.userLimit ?? 0)
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "플랜 저장에 실패했습니다.");
  }
}

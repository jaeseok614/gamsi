import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { getOperationsAutomationSummary } from "@/lib/automation";
import { canAdminSettings } from "@/lib/auth";
import { getEvidenceSecuritySummary } from "@/lib/evidence";
import { getIntegrationOpsSummary } from "@/lib/integrations";
import { getOnboardingSummary } from "@/lib/onboarding";
import { getDeploymentOpsSummary } from "@/lib/ops";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("운영 상태 권한이 필요합니다.", 403);
  }

  const [deployment, integrations, automation, evidence, onboarding] = await Promise.all([
    getDeploymentOpsSummary(user.companyId),
    getIntegrationOpsSummary(user.companyId),
    getOperationsAutomationSummary(user.companyId),
    getEvidenceSecuritySummary(user.companyId),
    getOnboardingSummary(user.companyId)
  ]);

  return NextResponse.json({
    deployment,
    integrations,
    automation,
    evidence,
    onboarding
  });
}

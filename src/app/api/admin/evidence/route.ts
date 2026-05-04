import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";
import { getEvidenceSecuritySettings, getEvidenceSecuritySummary, saveEvidenceSecuritySettings } from "@/lib/evidence";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("증빙 보안 설정 권한이 필요합니다.", 403);
  }

  const [settings, summary] = await Promise.all([
    getEvidenceSecuritySettings(user.companyId),
    getEvidenceSecuritySummary(user.companyId)
  ]);

  return NextResponse.json({
    settings,
    summary
  });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("증빙 보안 설정 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => null)) as
    | {
        retentionDays?: number;
        managerScopedAccess?: boolean;
      }
    | null;

  try {
    return NextResponse.json(
      await saveEvidenceSecuritySettings(user, {
        retentionDays: body?.retentionDays ?? 365,
        managerScopedAccess: body?.managerScopedAccess ?? true
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "증빙 보안 설정 저장에 실패했습니다.");
  }
}

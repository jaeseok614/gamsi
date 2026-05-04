import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { canViewReports } from "@/lib/auth";
import { jsonError, requireApiUser } from "@/lib/api";
import { buildErpExportBundle, getIntegrationSettings } from "@/lib/integrations";
import { getPayrollReport } from "@/lib/payroll";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canViewReports(user.role)) {
    return jsonError("ERP 내보내기 권한이 필요합니다.", 403);
  }

  const report = await getPayrollReport(user, request.nextUrl.searchParams.get("month") ?? undefined);
  const settings = await getIntegrationSettings(user.companyId);
  const bundle = buildErpExportBundle({
    report,
    settings
  });

  return new NextResponse(bundle.content, {
    headers: {
      "content-type": bundle.contentType,
      "content-disposition": `attachment; filename="${bundle.filename}"`
    }
  });
}

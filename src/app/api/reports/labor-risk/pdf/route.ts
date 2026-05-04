import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canViewReports } from "@/lib/auth";
import { renderLaborRiskPdf } from "@/lib/pdf";
import { getLaborRiskReport } from "@/lib/risks";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canViewReports(user.role)) {
    return jsonError("이 기능은 인사 담당 또는 관리자만 사용할 수 있습니다.", 403);
  }

  const report = await getLaborRiskReport(user);
  const pdf = await renderLaborRiskPdf(report);

  return new NextResponse(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="workguard-labor-risk.pdf"`
    }
  });
}

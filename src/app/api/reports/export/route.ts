import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { canViewReports } from "@/lib/auth";
import { jsonError, requireApiUser } from "@/lib/api";
import { getMonthlyReport, reportToCsv } from "@/lib/reports";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canViewReports(user.role)) {
    return jsonError("이 기능은 인사 담당 또는 관리자만 사용할 수 있습니다.", 403);
  }

  const month = request.nextUrl.searchParams.get("month") ?? undefined;
  const report = await getMonthlyReport(user, month);
  const csv = reportToCsv(report);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="gamsi-${report.month}.csv"`
    }
  });
}

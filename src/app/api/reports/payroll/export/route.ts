import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { canViewReports } from "@/lib/auth";
import { jsonError, requireApiUser } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { buildMappedPayrollExport, getIntegrationSettings } from "@/lib/integrations";
import { recordMonthCloseExport } from "@/lib/month-close";
import { getPayrollReport, payrollReportToCsv } from "@/lib/payroll";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canViewReports(user.role)) {
    return jsonError("이 기능은 인사 담당 또는 관리자만 사용할 수 있습니다.", 403);
  }

  const month = request.nextUrl.searchParams.get("month") ?? undefined;
  const mapped = request.nextUrl.searchParams.get("mapped") === "1";
  const report = await getPayrollReport(user, month);
  const settings = mapped ? await getIntegrationSettings(user.companyId) : null;
  const csv = mapped && settings ? buildMappedPayrollExport(report, settings) : payrollReportToCsv(report);

  await recordMonthCloseExport({
    actor: user,
    month: report.month,
    detail: {
      exportedAt: new Date().toISOString(),
      rowCount: report.payrollRows.length
    }
  });
  await writeAuditLog({
    companyId: user.companyId,
    actorUserId: user.id,
    action: "payroll.exported",
    targetType: "month_close",
    targetId: report.month,
    payload: {
      month: report.month,
      rowCount: report.payrollRows.length
    }
  });

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${mapped ? "workguard-payroll-mapped" : "workguard-payroll"}-${report.month}.csv"`
    }
  });
}

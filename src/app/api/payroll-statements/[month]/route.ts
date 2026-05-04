import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import {
  auditPayrollStatementDownload,
  getPayrollStatement,
  payrollStatementToCsv,
  renderPayrollStatementPdf
} from "@/lib/payroll-statements";

type RouteContext = {
  params: Promise<{
    month: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const params = await context.params;
  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "pdf";

  try {
    const statement = await getPayrollStatement(user, {
      month: params.month,
      userId: request.nextUrl.searchParams.get("userId")
    });
    await auditPayrollStatementDownload(user, statement, format);

    if (format === "csv") {
      const csv = payrollStatementToCsv(statement);
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="workguard-pay-statement-${statement.month}.csv"`
        }
      });
    }

    const pdf = await renderPayrollStatementPdf(statement);
    return new NextResponse(pdf, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="workguard-pay-statement-${statement.month}.pdf"`
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "급여명세를 내려받지 못했습니다.");
  }
}

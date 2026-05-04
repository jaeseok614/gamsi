import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { canViewReports } from "@/lib/auth";
import { jsonError, requireApiUser } from "@/lib/api";
import { getPayrollReport } from "@/lib/payroll";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canViewReports(user.role)) {
    return jsonError("이 기능은 인사 담당 또는 관리자만 사용할 수 있습니다.", 403);
  }

  const month = request.nextUrl.searchParams.get("month") ?? undefined;
  return NextResponse.json(await getPayrollReport(user, month));
}

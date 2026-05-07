import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { exportGroupwareOperationLogsCsv } from "@/lib/groupware";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  try {
    const csv = await exportGroupwareOperationLogsCsv(user, {
      action: request.nextUrl.searchParams.get("action"),
      actorId: request.nextUrl.searchParams.get("actorId"),
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to")
    });
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=groupware-operations.csv"
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "운영 로그를 내보내지 못했습니다.");
  }
}

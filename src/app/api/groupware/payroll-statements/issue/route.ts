import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { issuePayrollStatements } from "@/lib/groupware";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    month?: string;
    userIds?: string[];
    status?: string;
    note?: string;
  };

  try {
    return NextResponse.json(
      await issuePayrollStatements(user, {
        month: body.month ?? "",
        userIds: Array.isArray(body.userIds) ? body.userIds : undefined,
        status: body.status,
        note: body.note
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "급여명세 발행에 실패했습니다.");
  }
}

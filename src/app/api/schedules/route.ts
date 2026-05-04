import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canManage } from "@/lib/auth";
import { getManagedUsers } from "@/lib/manager";
import { applyScheduleOperation, buildScheduleOperationPlan, type ScheduleOperationBody, type ScheduleOperationMode } from "@/lib/schedule-operations";

function normalizeScheduleMode(value: unknown): ScheduleOperationMode {
  return value === "range" ||
    value === "copy_week" ||
    value === "bulk_update" ||
    value === "bulk_delete" ||
    value === "board_apply" ||
    value === "board_clear"
    ? value
    : "single";
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("관리자 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as ScheduleOperationBody;

  try {
    const managedUsers = await getManagedUsers(user);
    const plan = await buildScheduleOperationPlan({
      companyId: user.companyId,
      mode: normalizeScheduleMode(body.mode),
      body,
      managedUserIds: new Set(managedUsers.map((member) => member.id))
    });

    return NextResponse.json(await applyScheduleOperation({
      actor: user,
      plan
    }));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "스케줄 저장에 실패했습니다.");
  }
}

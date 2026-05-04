import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canManage } from "@/lib/auth";
import {
  archiveScheduleTemplate,
  listScheduleTemplates,
  saveScheduleTemplate,
  type ScheduleOperationMode
} from "@/lib/schedule-operations";

function normalizeMode(value: unknown): Extract<ScheduleOperationMode, "single" | "range" | "copy_week" | "bulk_update" | "bulk_delete"> {
  return value === "range" || value === "copy_week" || value === "bulk_update" || value === "bulk_delete"
    ? value
    : "single";
}

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("스케줄 템플릿 권한이 필요합니다.", 403);
  }

  return NextResponse.json({
    templates: await listScheduleTemplates(user.companyId)
  });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("스케줄 템플릿 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as {
    templateId?: string;
    name?: string;
    mode?: ScheduleOperationMode;
    teamId?: string | null;
    startTime?: string;
    endTime?: string;
    breakMinutes?: number;
    shiftName?: string;
    note?: string;
    weekdays?: number[];
  };

  try {
    const templateId = await saveScheduleTemplate({
      actor: user,
      templateId: body.templateId,
      name: body.name?.trim() || "새 템플릿",
      mode: normalizeMode(body.mode),
      teamId: body.teamId,
      startTime: body.startTime,
      endTime: body.endTime,
      breakMinutes: body.breakMinutes,
      shiftName: body.shiftName,
      note: body.note,
      weekdays: body.weekdays
    });

    return NextResponse.json({
      ok: true,
      templateId
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "스케줄 템플릿 저장에 실패했습니다.");
  }
}

export async function DELETE(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("스케줄 템플릿 권한이 필요합니다.", 403);
  }

  const templateId = request.nextUrl.searchParams.get("id")?.trim();
  if (!templateId) {
    return jsonError("삭제할 템플릿 id가 필요합니다.");
  }

  await archiveScheduleTemplate({
    actor: user,
    templateId
  });

  return NextResponse.json({ ok: true });
}

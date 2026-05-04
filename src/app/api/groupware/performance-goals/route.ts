import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { createPerformanceGoal, updatePerformanceGoal } from "@/lib/groupware";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    ownerType?: string;
    userId?: string | null;
    teamId?: string | null;
    month?: string;
    title?: string;
    unit?: string;
    targetValue?: number;
    actualValue?: number;
    note?: string;
  };

  try {
    return NextResponse.json(
      await createPerformanceGoal(user, {
        ownerType: body.ownerType,
        userId: body.userId,
        teamId: body.teamId,
        month: body.month ?? "",
        title: body.title ?? "",
        unit: body.unit,
        targetValue: Number(body.targetValue),
        actualValue: Number(body.actualValue ?? 0),
        note: body.note
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "실적 목표를 저장하지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    actualValue?: number;
    evaluationMemo?: string | null;
  };
  if (!body.id) {
    return jsonError("실적 목표를 선택하세요.");
  }

  try {
    return NextResponse.json(
      await updatePerformanceGoal(user, {
        id: body.id,
        actualValue: body.actualValue === undefined ? undefined : Number(body.actualValue),
        evaluationMemo: body.evaluationMemo
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "실적 목표를 수정하지 못했습니다.");
  }
}

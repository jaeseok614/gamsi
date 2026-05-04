import { WorkThreadStatus } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { getWorkThreadDetail, markWorkThreadRead, updateWorkThread } from "@/lib/workbox";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const params = await context.params;
  try {
    return NextResponse.json(await getWorkThreadDetail(user, params.id));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "업무함 항목을 불러오지 못했습니다.", 404);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const params = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    assigneeId?: string | null;
    status?: WorkThreadStatus;
    markRead?: boolean;
  };

  try {
    if (body.markRead) {
      await markWorkThreadRead(user, params.id);
      return NextResponse.json({ ok: true });
    }

    if (body.status && body.status !== WorkThreadStatus.OPEN && body.status !== WorkThreadStatus.RESOLVED) {
      return jsonError("업무 상태를 확인하세요.");
    }

    return NextResponse.json(
      await updateWorkThread(user, {
        threadId: params.id,
        assigneeId: body.assigneeId,
        status: body.status
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "업무함 항목을 수정하지 못했습니다.");
  }
}

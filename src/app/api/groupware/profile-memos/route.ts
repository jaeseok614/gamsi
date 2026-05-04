import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canCreateProfileMemo } from "@/lib/groupware";
import { addWorkComment, ensureWorkThreadForUserProfile } from "@/lib/workbox";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    userId?: string;
    memo?: string;
    mentionUserIds?: string[];
    assigneeId?: string | null;
  };
  const targetUserId = body.userId?.trim();
  if (!targetUserId) {
    return jsonError("메모를 남길 직원을 선택하세요.");
  }

  try {
    if (!(await canCreateProfileMemo(user, targetUserId))) {
      return jsonError("이 직원 프로필에는 메모를 남길 수 없습니다.", 403);
    }

    const thread = await ensureWorkThreadForUserProfile({
      companyId: user.companyId,
      targetUserId,
      actorUserId: user.id,
      assigneeId: body.assigneeId?.trim() || null
    });
    const comment = await addWorkComment(user, {
      threadId: thread.id,
      body: body.memo ?? "",
      mentionUserIds: Array.isArray(body.mentionUserIds) ? body.mentionUserIds : []
    });

    return NextResponse.json({
      thread,
      comment
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "프로필 메모를 저장하지 못했습니다.");
  }
}

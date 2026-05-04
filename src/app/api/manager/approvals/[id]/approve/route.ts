import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { reviewApproval } from "@/lib/approval-workflow";
import { canManage } from "@/lib/auth";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("관리자 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as { reviewNote?: string };

  try {
    return NextResponse.json(
      await reviewApproval({
        actor: user,
        approvalId: params.id,
        action: "approve",
        reviewNote: body.reviewNote
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "승인 처리에 실패했습니다.");
  }
}

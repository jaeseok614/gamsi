import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { bulkReviewApprovals } from "@/lib/approval-workflow";
import { canManage } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("관리자 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as {
    approvalIds?: string[];
    action?: "approve" | "reject";
    reviewNote?: string;
  };

  if (body.action !== "approve" && body.action !== "reject") {
    return jsonError("다건 처리 액션을 확인하세요.");
  }

  try {
    return NextResponse.json(
      await bulkReviewApprovals({
        actor: user,
        approvalIds: Array.isArray(body.approvalIds) ? body.approvalIds : [],
        action: body.action,
        reviewNote: body.reviewNote
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "다건 승인 처리에 실패했습니다.");
  }
}

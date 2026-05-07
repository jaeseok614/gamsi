import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { reviewDocumentRequest } from "@/lib/groupware";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const params = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    reviewNote?: string | null;
    delegateForUserId?: string | null;
  };

  try {
    return NextResponse.json(
      await reviewDocumentRequest(user, {
        id: params.id,
        status: body.status === "APPROVED" ? "APPROVED" : "REJECTED",
        reviewNote: body.reviewNote,
        delegateForUserId: body.delegateForUserId
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "전자결재 처리에 실패했습니다.");
  }
}

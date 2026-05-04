import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { createDocumentRequest } from "@/lib/groupware";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    category?: string;
    amount?: number | null;
    reviewerId?: string | null;
  };

  try {
    return NextResponse.json(
      await createDocumentRequest(user, {
        title: body.title ?? "",
        body: body.body ?? "",
        category: body.category,
        amount: body.amount === undefined || body.amount === null ? null : Number(body.amount),
        reviewerId: body.reviewerId
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "전자결재 요청을 저장하지 못했습니다.");
  }
}

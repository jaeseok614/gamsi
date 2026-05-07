import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { resubmitDocumentRequest } from "@/lib/groupware";

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
  try {
    return NextResponse.json(await resubmitDocumentRequest(user, params.id));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "전자결재를 재상신하지 못했습니다.");
  }
}

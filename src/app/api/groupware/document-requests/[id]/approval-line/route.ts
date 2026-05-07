import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { updateDocumentApprovalLine } from "@/lib/groupware";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const params = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    stepId?: string;
    approverId?: string;
  };

  try {
    return NextResponse.json(
      await updateDocumentApprovalLine(user, {
        documentId: params.id,
        stepId: body.stepId ?? "",
        approverId: body.approverId ?? ""
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "결재선을 변경하지 못했습니다.");
  }
}

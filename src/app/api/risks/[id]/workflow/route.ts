import { WorkThreadStatus } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canManage } from "@/lib/auth";
import { updateRiskWorkflow } from "@/lib/risks";
import { ensureWorkThreadForRisk, updateWorkThread } from "@/lib/workbox";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const VALID_STATUSES = new Set(["OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"]);
const VALID_RESOLUTION_TYPES = new Set(["NONE", "AUTO", "MANUAL", "APPROVAL", "ADJUSTMENT", "SCHEDULE", "MONTH_CLOSE", "OTHER"]);

export async function POST(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("리스크 처리 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as {
    status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "DISMISSED";
    assignedToId?: string | null;
    workflowNote?: string | null;
    resolutionNote?: string | null;
    resolutionType?: "NONE" | "AUTO" | "MANUAL" | "APPROVAL" | "ADJUSTMENT" | "SCHEDULE" | "MONTH_CLOSE" | "OTHER";
    resolutionReferenceId?: string | null;
    resolutionReferenceLabel?: string | null;
  };

  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return jsonError("처리 상태를 확인하세요.");
  }

  if (body.resolutionType && !VALID_RESOLUTION_TYPES.has(body.resolutionType)) {
    return jsonError("처리 방식을 확인하세요.");
  }

  try {
    const result = await updateRiskWorkflow(user, {
        riskId: params.id,
        status: body.status,
        assignedToId: body.assignedToId,
        workflowNote: body.workflowNote,
        resolutionNote: body.resolutionNote,
        resolutionType: body.resolutionType,
        resolutionReferenceId: body.resolutionReferenceId,
        resolutionReferenceLabel: body.resolutionReferenceLabel
      })
    const thread = await ensureWorkThreadForRisk(params.id, user.id);
    if (thread) {
      await updateWorkThread(user, {
        threadId: thread.id,
        assigneeId: body.assignedToId,
        status:
          body.status === "RESOLVED" || body.status === "DISMISSED"
            ? WorkThreadStatus.RESOLVED
            : WorkThreadStatus.OPEN
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "리스크 처리 내용 저장에 실패했습니다.");
  }
}

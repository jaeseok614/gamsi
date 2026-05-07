import type { Prisma } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { createDocumentRequest } from "@/lib/groupware";
import { saveDocumentAttachments, validateApprovalAttachmentFiles } from "@/lib/uploads";

async function parsePayload(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const category = String(formData.get("category") ?? "");
    return {
      title: String(formData.get("title") ?? ""),
      body: String(formData.get("body") ?? ""),
      category,
      amount: String(formData.get("amount") ?? ""),
      reviewerId: String(formData.get("reviewerId") ?? "") || null,
      approvalStepUserIds: formData.getAll("approvalStepUserIds").map((value) => String(value)).filter(Boolean),
      formData: {
        category,
        vendor: String(formData.get("vendor") ?? ""),
        dueDate: String(formData.get("dueDate") ?? ""),
        budgetCode: String(formData.get("budgetCode") ?? "")
      } satisfies Prisma.JsonObject,
      attachments: formData.getAll("attachments").filter((value): value is File => value instanceof File)
    };
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    category?: string;
    amount?: number | null;
    reviewerId?: string | null;
    approvalStepUserIds?: string[];
    formData?: Prisma.JsonObject | null;
  };
  return {
    title: body.title ?? "",
    body: body.body ?? "",
    category: body.category,
    amount: body.amount === undefined || body.amount === null ? "" : String(body.amount),
    reviewerId: body.reviewerId,
    approvalStepUserIds: Array.isArray(body.approvalStepUserIds) ? body.approvalStepUserIds : [],
    formData: body.formData ?? null,
    attachments: [] as File[]
  };
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const payload = await parsePayload(request);

  try {
    validateApprovalAttachmentFiles(payload.attachments);
    const document = await createDocumentRequest(user, {
      title: payload.title,
      body: payload.body,
      category: payload.category,
      amount: payload.amount ? Number(payload.amount) : null,
      reviewerId: payload.reviewerId,
      approvalStepUserIds: payload.approvalStepUserIds,
      formData: payload.formData
    });
    const attachments = await saveDocumentAttachments({
      companyId: user.companyId,
      documentRequestId: document.id,
      uploadedById: user.id,
      files: payload.attachments
    });
    return NextResponse.json({
      ...document,
      attachmentCount: attachments.length
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "전자결재 요청을 저장하지 못했습니다.");
  }
}

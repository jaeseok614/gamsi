import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { createAnnouncement } from "@/lib/groupware";
import { saveAnnouncementAttachments, validateApprovalAttachmentFiles } from "@/lib/uploads";

async function parsePayload(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return {
      title: String(formData.get("title") ?? ""),
      body: String(formData.get("body") ?? ""),
      audience: String(formData.get("audience") ?? ""),
      teamId: String(formData.get("teamId") ?? "") || null,
      category: String(formData.get("category") ?? ""),
      publishAt: String(formData.get("publishAt") ?? "") || null,
      isPinned: formData.get("isPinned") === "true",
      allowComments: formData.get("allowComments") === "true",
      attachments: formData.getAll("attachments").filter((value): value is File => value instanceof File)
    };
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    audience?: string;
    teamId?: string | null;
    category?: string | null;
    publishAt?: string | null;
    isPinned?: boolean;
    allowComments?: boolean;
  };
  return {
    title: body.title ?? "",
    body: body.body ?? "",
    audience: body.audience,
    teamId: body.teamId,
    category: body.category,
    publishAt: body.publishAt,
    isPinned: Boolean(body.isPinned),
    allowComments: Boolean(body.allowComments),
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
    const announcement = await createAnnouncement(user, {
      title: payload.title,
      body: payload.body,
      audience: payload.audience,
      teamId: payload.teamId,
      category: payload.category,
      publishAt: payload.publishAt,
      isPinned: payload.isPinned,
      allowComments: payload.allowComments
    });
    const attachments = await saveAnnouncementAttachments({
      companyId: user.companyId,
      announcementId: announcement.id,
      uploadedById: user.id,
      files: payload.attachments
    });
    return NextResponse.json({
      ...announcement,
      attachmentCount: attachments.length
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "공지사항을 저장하지 못했습니다.");
  }
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { recordGroupwareAttachmentDownload } from "@/lib/evidence";
import { getAnnouncementAttachmentForActor } from "@/lib/groupware";
import { attachmentContentDisposition, canPreviewAttachment, readStoredAttachment } from "@/lib/uploads";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const params = await context.params;
  try {
    const attachment = await getAnnouncementAttachmentForActor(user, params.id);
    const stored = await readStoredAttachment(attachment.storagePath);
    const preview = request.nextUrl.searchParams.get("preview") === "1" && canPreviewAttachment(attachment);
    if (!preview) {
      await recordGroupwareAttachmentDownload({
        companyId: user.companyId,
        actorUserId: user.id,
        targetType: "announcement_attachment",
        targetId: attachment.id,
        originalName: attachment.originalName,
        sourceType: "announcement",
        sourceId: attachment.announcementId,
        ownerUserId: attachment.announcement.authorId
      });
    }
    return new NextResponse(stored.content, {
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(stored.content.byteLength),
        "content-disposition": attachmentContentDisposition(preview ? "inline" : "attachment", attachment.originalName)
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "첨부 파일을 내려받지 못했습니다.", 404);
  }
}

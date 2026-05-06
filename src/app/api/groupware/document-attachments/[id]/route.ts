import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { recordGroupwareAttachmentDownload } from "@/lib/evidence";
import { getDocumentAttachmentForActor } from "@/lib/groupware";
import { readStoredAttachment } from "@/lib/uploads";

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
    const attachment = await getDocumentAttachmentForActor(user, params.id);
    const stored = await readStoredAttachment(attachment.storagePath);
    await recordGroupwareAttachmentDownload({
      companyId: user.companyId,
      actorUserId: user.id,
      targetType: "document_attachment",
      targetId: attachment.id,
      originalName: attachment.originalName,
      sourceType: "document_request",
      sourceId: attachment.documentRequestId,
      ownerUserId: attachment.documentRequest.requesterId
    });
    return new NextResponse(stored.content, {
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(stored.content.byteLength),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "첨부 파일을 내려받지 못했습니다.", 404);
  }
}

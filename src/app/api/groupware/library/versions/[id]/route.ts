import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { recordGroupwareAttachmentDownload } from "@/lib/evidence";
import { getDocumentLibraryVersionForActor, notifyExcessiveLibraryDownloads } from "@/lib/groupware";
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
    const version = await getDocumentLibraryVersionForActor(user, params.id);
    const stored = await readStoredAttachment(version.storagePath);
    const preview = request.nextUrl.searchParams.get("preview") === "1" && canPreviewAttachment(version);
    if (!preview) {
      await recordGroupwareAttachmentDownload({
        companyId: user.companyId,
        actorUserId: user.id,
        targetType: "document_library_version",
        targetId: version.id,
        originalName: version.originalName,
        sourceType: "document_library",
        sourceId: version.itemId,
        ownerUserId: version.item.createdById
      });
      await notifyExcessiveLibraryDownloads(user, version.itemId);
    }
    return new NextResponse(stored.content, {
      headers: {
        "content-type": version.mimeType,
        "content-length": String(stored.content.byteLength),
        "content-disposition": attachmentContentDisposition(preview ? "inline" : "attachment", version.originalName)
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "자료실 파일을 내려받지 못했습니다.", 404);
  }
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { getAnnouncementAttachmentForActor } from "@/lib/groupware";
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
    const attachment = await getAnnouncementAttachmentForActor(user, params.id);
    const stored = await readStoredAttachment(attachment.storagePath);
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

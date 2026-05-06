import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { getDocumentRequestForActor } from "@/lib/groupware";
import { renderDocumentRequestPdf } from "@/lib/pdf";

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
    const document = await getDocumentRequestForActor(user, params.id);
    const pdf = await renderDocumentRequestPdf(document);
    return new NextResponse(pdf, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="workguard-document-${document.documentNumber ?? document.id}.pdf"`
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "전자결재 PDF를 만들지 못했습니다.", 404);
  }
}

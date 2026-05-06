import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { createDocumentLibraryVersion } from "@/lib/groupware";
import { saveDocumentLibraryVersionFile, validateApprovalAttachmentFiles } from "@/lib/uploads";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonError("자료실 파일을 첨부하세요.");
  }

  try {
    validateApprovalAttachmentFiles([file]);
    const prepared = await createDocumentLibraryVersion(user, {
      itemId: String(formData.get("itemId") ?? "") || null,
      title: String(formData.get("title") ?? ""),
      category: String(formData.get("category") ?? ""),
      accessScope: String(formData.get("accessScope") ?? ""),
      teamId: String(formData.get("teamId") ?? "") || null,
      description: String(formData.get("description") ?? ""),
      note: String(formData.get("note") ?? "")
    });
    const version = await saveDocumentLibraryVersionFile({
      companyId: user.companyId,
      itemId: prepared.item.id,
      uploadedById: user.id,
      versionNo: prepared.nextVersionNo,
      note: String(formData.get("note") ?? ""),
      file
    });

    return NextResponse.json({
      item: prepared.item,
      version
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "자료실 파일을 저장하지 못했습니다.");
  }
}

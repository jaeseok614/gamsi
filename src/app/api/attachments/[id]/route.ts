import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canViewReports } from "@/lib/auth";
import { getEvidenceSecuritySettings, recordAttachmentDownload } from "@/lib/evidence";
import { getManagedUsers } from "@/lib/manager";
import { prisma } from "@/lib/prisma";
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

  const { id } = await context.params;
  const attachment = await prisma.requestAttachment.findUnique({
    where: {
      id
    },
    include: {
      approvalRequest: {
        select: {
          companyId: true,
          id: true,
          requesterId: true
        }
      }
    }
  });

  if (!attachment || attachment.companyId !== user.companyId) {
    return jsonError("첨부 파일을 찾을 수 없습니다.", 404);
  }

  const evidenceSettings = await getEvidenceSecuritySettings(user.companyId);
  const managerUserIds =
    user.role === "MANAGER" && evidenceSettings.managerScopedAccess
      ? new Set((await getManagedUsers(user)).map((member) => member.id))
      : new Set<string>();
  const canOpen =
    attachment.approvalRequest.requesterId === user.id ||
    canViewReports(user.role) ||
    (user.role === "MANAGER" &&
      (!evidenceSettings.managerScopedAccess || managerUserIds.has(attachment.approvalRequest.requesterId)));

  if (!canOpen) {
    return jsonError("첨부 파일에 접근할 수 없습니다.", 403);
  }

  const retentionCutoff = new Date(Date.now() - evidenceSettings.retentionDays * 24 * 60 * 60 * 1000);
  if (attachment.createdAt < retentionCutoff && !canViewReports(user.role)) {
    return jsonError("보관기간이 지난 증빙은 인사 담당/관리자 권한으로만 조회할 수 있습니다.", 410);
  }

  const stored = await readStoredAttachment(attachment.storagePath);
  await recordAttachmentDownload({
    companyId: user.companyId,
    actorUserId: user.id,
    attachmentId: attachment.id,
    approvalRequestId: attachment.approvalRequest.id,
    originalName: attachment.originalName,
    requesterId: attachment.approvalRequest.requesterId
  });

  return new NextResponse(stored.content, {
    headers: {
      "content-type": attachment.mimeType,
      "content-length": String(stored.content.byteLength),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
      "x-workguard-retention-days": String(evidenceSettings.retentionDays)
    }
  });
}

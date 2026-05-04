import type { User } from "@/generated/prisma";

import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getAuditPayloadRecord, getLatestAuditSnapshot } from "@/lib/settings-store";

type Actor = Pick<User, "id" | "companyId">;

export type EvidenceSecuritySettings = {
  retentionDays: number;
  managerScopedAccess: boolean;
};

function defaultEvidenceSecuritySettings(): EvidenceSecuritySettings {
  return {
    retentionDays: 365,
    managerScopedAccess: true
  };
}

function normalizeEvidenceSettings(payload: unknown): EvidenceSecuritySettings {
  const record = getAuditPayloadRecord(payload);
  const defaults = defaultEvidenceSecuritySettings();

  return {
    retentionDays:
      typeof record?.retentionDays === "number" && Number.isFinite(record.retentionDays)
        ? Math.max(30, Math.min(3650, Math.round(record.retentionDays)))
        : defaults.retentionDays,
    managerScopedAccess:
      typeof record?.managerScopedAccess === "boolean" ? record.managerScopedAccess : defaults.managerScopedAccess
  };
}

export async function getEvidenceSecuritySettings(companyId: string) {
  const latest = await getLatestAuditSnapshot({
    companyId,
    action: "evidence.settings.saved",
    targetType: "evidence_settings",
    targetId: companyId
  });

  return normalizeEvidenceSettings(latest?.payload);
}

export async function saveEvidenceSecuritySettings(actor: Actor, input: EvidenceSecuritySettings) {
  const settings = normalizeEvidenceSettings(input);
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "evidence.settings.saved",
    targetType: "evidence_settings",
    targetId: actor.companyId,
    payload: settings
  });

  return settings;
}

export async function recordAttachmentDownload(input: {
  companyId: string;
  actorUserId: string;
  attachmentId: string;
  approvalRequestId: string;
  originalName: string;
  requesterId: string;
}) {
  await writeAuditLog({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    action: "attachment.downloaded",
    targetType: "request_attachment",
    targetId: input.attachmentId,
    payload: {
      attachmentId: input.attachmentId,
      approvalRequestId: input.approvalRequestId,
      originalName: input.originalName,
      requesterId: input.requesterId
    }
  });
}

export async function getEvidenceSecuritySummary(companyId: string) {
  const settings = await getEvidenceSecuritySettings(companyId);
  const retentionCutoff = new Date(Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000);
  const [totalAttachments, overdueAttachments, recentAttachments, recentDownloads] = await Promise.all([
    prisma.requestAttachment.count({
      where: {
        companyId
      }
    }),
    prisma.requestAttachment.count({
      where: {
        companyId,
        createdAt: {
          lt: retentionCutoff
        }
      }
    }),
    prisma.requestAttachment.findMany({
      where: {
        companyId
      },
      include: {
        approvalRequest: {
          select: {
            id: true,
            type: true,
            requester: {
              select: {
                id: true,
                name: true,
                team: {
                  select: {
                    name: true
                  }
                }
              }
            }
          }
        },
        uploadedBy: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 12
    }),
    prisma.auditLog.findMany({
      where: {
        companyId,
        action: "attachment.downloaded"
      },
      include: {
        actor: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 12
    })
  ]);

  return {
    settings,
    metrics: {
      totalAttachments,
      overdueAttachments,
      retainedAttachments: Math.max(0, totalAttachments - overdueAttachments),
      recentDownloadEvents: recentDownloads.length
    },
    recentAttachments: recentAttachments.map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt,
      uploadedByName: attachment.uploadedBy.name,
      requestType: attachment.approvalRequest.type,
      requester: attachment.approvalRequest.requester,
      isOverRetention: attachment.createdAt < retentionCutoff
    })),
    recentDownloads: recentDownloads.map((log) => {
      const payload = getAuditPayloadRecord(log.payload);
      return {
        id: log.id,
        createdAt: log.createdAt,
        actor: log.actor,
        attachmentId: typeof payload?.attachmentId === "string" ? payload.attachmentId : log.targetId,
        originalName: typeof payload?.originalName === "string" ? payload.originalName : "-",
        requesterId: typeof payload?.requesterId === "string" ? payload.requesterId : null
      };
    })
  };
}

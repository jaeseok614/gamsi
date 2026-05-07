import { ApprovalType, type User } from "@/generated/prisma";

import { writeAuditLog } from "@/lib/audit";
import { canViewReports } from "@/lib/auth";
import { renderEvidencePackagePdf } from "@/lib/pdf";
import { prisma } from "@/lib/prisma";
import { kstMonthBounds } from "@/lib/time";
import { readStoredAttachment } from "@/lib/uploads";
import { buildZip } from "@/lib/zip";

type Actor = Pick<User, "id" | "companyId" | "role">;

function csvLine(values: Array<string | number | null | undefined>) {
  return values.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",");
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9가-힣._-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "file";
}

function approvalTypeLabel(type: ApprovalType) {
  if (type === ApprovalType.LEAVE) {
    return "휴가";
  }
  if (type === ApprovalType.ADJUSTMENT) {
    return "근태 정정";
  }
  return "초과근로";
}

export async function getEvidencePackageData(
  actor: Actor,
  input: {
    month: string;
    userId: string;
  }
) {
  if (!canViewReports(actor.role)) {
    throw new Error("증빙 패키지는 인사 담당 또는 관리자만 생성할 수 있습니다.");
  }

  const month = /^\d{4}-\d{2}$/.test(input.month) ? input.month : new Date().toISOString().slice(0, 7);
  const { start, end } = kstMonthBounds(month);
  const targetUser = await prisma.user.findFirst({
    where: {
      id: input.userId,
      companyId: actor.companyId
    },
    include: {
      team: true,
      company: true
    }
  });

  if (!targetUser) {
    throw new Error("직원을 찾을 수 없습니다.");
  }

  const [sessions, attendanceEvents, approvalRequests, riskSignals, monthClose, auditLogs] = await Promise.all([
    prisma.workSession.findMany({
      where: {
        companyId: actor.companyId,
        userId: targetUser.id,
        workDate: {
          gte: start,
          lt: end
        }
      },
      orderBy: {
        workDate: "asc"
      }
    }),
    prisma.attendanceEvent.findMany({
      where: {
        companyId: actor.companyId,
        userId: targetUser.id,
        occurredAt: {
          gte: start,
          lt: end
        }
      },
      orderBy: {
        occurredAt: "asc"
      }
    }),
    prisma.approvalRequest.findMany({
      where: {
        companyId: actor.companyId,
        requesterId: targetUser.id,
        OR: [
          {
            createdAt: {
              gte: start,
              lt: end
            }
          },
          {
            targetDate: {
              gte: start,
              lt: end
            }
          },
          {
            leaveStartDate: {
              lt: end
            },
            leaveEndDate: {
              gte: start
            }
          },
          {
            session: {
              is: {
                workDate: {
                  gte: start,
                  lt: end
                }
              }
            }
          }
        ]
      },
      include: {
        reviewer: true,
        session: true,
        attachments: {
          orderBy: {
            createdAt: "asc"
          }
        }
      },
      orderBy: {
        createdAt: "asc"
      }
    }),
    prisma.riskSignal.findMany({
      where: {
        companyId: actor.companyId,
        userId: targetUser.id,
        OR: [
          {
            detectedAt: {
              gte: start,
              lt: end
            }
          },
          {
            session: {
              is: {
                workDate: {
                  gte: start,
                  lt: end
                }
              }
            }
          }
        ]
      },
      include: {
        assignedTo: true,
        session: true
      },
      orderBy: {
        detectedAt: "asc"
      }
    }),
    prisma.monthClose.findUnique({
      where: {
        companyId_month: {
          companyId: actor.companyId,
          month
        }
      },
      include: {
        events: {
          include: {
            actor: true
          },
          orderBy: {
            createdAt: "asc"
          }
        },
        lockedBy: true,
        reopenedBy: true
      }
    }),
    prisma.auditLog.findMany({
      where: {
        companyId: actor.companyId,
        createdAt: {
          gte: start,
          lt: end
        },
        OR: [
          {
            actorUserId: targetUser.id
          },
          {
            targetId: targetUser.id
          },
          {
            targetType: {
              in: ["attendance_event", "approval_request", "risk_signal"]
            }
          }
        ]
      },
      include: {
        actor: true
      },
      orderBy: {
        createdAt: "asc"
      },
      take: 120
    })
  ]);

  return {
    month,
    period: {
      start,
      end
    },
    generatedAt: new Date(),
    company: targetUser.company,
    user: targetUser,
    sessions,
    attendanceEvents,
    approvalRequests,
    riskSignals,
    monthClose,
    auditLogs
  };
}

export type EvidencePackageData = Awaited<ReturnType<typeof getEvidencePackageData>>;

export function evidencePackageToCsv(data: EvidencePackageData) {
  const lines = [
    csvLine(["section", "field1", "field2", "field3", "field4", "field5", "field6", "field7"]),
    csvLine(["package", data.company.name, data.user.name, data.user.email, data.month, data.generatedAt.toISOString()]),
    "",
    csvLine(["sessions", "date", "check_in", "check_out", "gross_minutes", "break_minutes", "work_minutes", "status"]),
    ...data.sessions.map((session) =>
      csvLine([
        "sessions",
        session.workDate.toISOString().slice(0, 10),
        session.checkInAt?.toISOString(),
        session.checkOutAt?.toISOString(),
        session.grossMinutes,
        session.breakMinutes,
        session.calculatedWorkMinutes,
        session.status
      ])
    ),
    "",
    csvLine(["attendance_events", "occurred_at", "type", "status", "source", "reason", "metadata"]),
    ...data.attendanceEvents.map((event) =>
      csvLine([
        "attendance_events",
        event.occurredAt.toISOString(),
        event.eventType,
        event.status,
        event.source,
        event.reason,
        event.metadata ? JSON.stringify(event.metadata) : ""
      ])
    ),
    "",
    csvLine(["approvals", "created_at", "type", "status", "reviewer", "reviewed_at", "attachments", "reason"]),
    ...data.approvalRequests.map((request) =>
      csvLine([
        "approvals",
        request.createdAt.toISOString(),
        approvalTypeLabel(request.type),
        request.status,
        request.reviewer?.name,
        request.reviewedAt?.toISOString(),
        request.attachments.length,
        request.reason
      ])
    ),
    "",
    csvLine(["risks", "detected_at", "type", "level", "status", "resolved_at", "title", "resolution_note"]),
    ...data.riskSignals.map((signal) =>
      csvLine([
        "risks",
        signal.detectedAt.toISOString(),
        signal.type,
        signal.level,
        signal.status,
        signal.resolvedAt?.toISOString(),
        signal.title,
        signal.resolutionNote
      ])
    ),
    "",
    csvLine(["month_close", "month", "status", "locked_at", "locked_by", "reopened_at", "reopen_reason"]),
    csvLine([
      "month_close",
      data.monthClose?.month,
      data.monthClose?.status,
      data.monthClose?.lockedAt?.toISOString(),
      data.monthClose?.lockedBy?.name,
      data.monthClose?.reopenedAt?.toISOString(),
      data.monthClose?.reopenReason
    ]),
    "",
    csvLine(["audit_logs", "created_at", "actor", "action", "target_type", "target_id", "payload"]),
    ...data.auditLogs.map((log) =>
      csvLine([
        "audit_logs",
        log.createdAt.toISOString(),
        log.actor?.name ?? "시스템",
        log.action,
        log.targetType,
        log.targetId,
        log.payload ? JSON.stringify(log.payload) : ""
      ])
    )
  ];

  return lines.join("\n");
}

export async function buildEvidencePackageZip(
  actor: Actor,
  input: {
    month: string;
    userId: string;
  }
) {
  const data = await getEvidencePackageData(actor, input);
  const pdf = await renderEvidencePackagePdf(data);
  const csv = evidencePackageToCsv(data);
  const manifest: string[] = [
    `워크가드 증빙 패키지`,
    `company=${data.company.name}`,
    `employee=${data.user.name} <${data.user.email}>`,
    `month=${data.month}`,
    `generatedAt=${data.generatedAt.toISOString()}`
  ];

  const entries = [
    {
      name: "summary.pdf",
      content: pdf
    },
    {
      name: "raw-data.csv",
      content: Buffer.from(`\uFEFF${csv}`, "utf8")
    }
  ];

  for (const request of data.approvalRequests) {
    for (const attachment of request.attachments) {
      try {
        const stored = await readStoredAttachment(attachment.storagePath);
        entries.push({
          name: `attachments/${request.id}/${safeFileName(attachment.originalName)}`,
          content: stored.content
        });
      } catch (error) {
        manifest.push(
          `missingAttachment=${request.id}/${attachment.originalName}: ${
            error instanceof Error ? error.message : "파일 읽기 실패"
          }`
        );
      }
    }
  }

  entries.push({
    name: "manifest.txt",
    content: Buffer.from(manifest.join("\n"), "utf8")
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "reports.evidence_package.exported",
    targetType: "user",
    targetId: data.user.id,
    payload: {
      month: data.month,
      attachmentCount: data.approvalRequests.reduce((sum, request) => sum + request.attachments.length, 0)
    }
  });

  return {
    data,
    zip: buildZip(entries)
  };
}

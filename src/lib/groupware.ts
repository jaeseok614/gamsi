import {
  AnnouncementAudience,
  DocumentApprovalStepStatus,
  DocumentRequestStatus,
  NotificationType,
  PayrollStatementStatus,
  PerformanceOwnerType,
  Prisma,
  Role,
  WorkThreadTargetType,
  type User
} from "@/generated/prisma";

import { canManage, canViewReports } from "@/lib/auth";
import { getManagedUsers } from "@/lib/manager";
import { createNotifications } from "@/lib/notifications";
import { getPayrollStatement } from "@/lib/payroll-statements";
import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";
import { ensureWorkThreadForDocumentRequest } from "@/lib/workbox";

type Actor = Pick<User, "id" | "companyId" | "role" | "teamId" | "name">;
type GroupwareSearchResult = {
  type: "USER" | "ANNOUNCEMENT" | "MEMO" | "DOCUMENT" | "PAYROLL" | "LIBRARY";
  label: string;
  title: string;
  description: string;
  href: string;
};

function addMonths(monthString: string, offset: number) {
  const date = new Date(`${monthString}-01T00:00:00+09:00`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit"
  }).format(date);
}

export async function canCreateProfileMemo(actor: Actor, targetUserId: string) {
  if (actor.role === "ADMIN" || actor.role === "HR" || actor.id === targetUserId) {
    return true;
  }

  if (!canManage(actor.role)) {
    return false;
  }

  const managedUsers = await getManagedUsers(actor);
  return managedUsers.some((user) => user.id === targetUserId);
}

async function visibleProfileMemoUserIds(actor: Actor) {
  if (actor.role === "ADMIN" || actor.role === "HR") {
    const users = await prisma.user.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true
      },
      select: {
        id: true
      }
    });
    return new Set(users.map((user) => user.id));
  }

  if (canManage(actor.role)) {
    const managedUsers = await getManagedUsers(actor);
    return new Set([actor.id, ...managedUsers.map((user) => user.id)]);
  }

  return new Set([actor.id]);
}

function assertManagerOrAbove(actor: Actor) {
  if (!canManage(actor.role)) {
    throw new Error("관리자, HR 또는 팀장 권한이 필요합니다.");
  }
}

async function managedUserIds(actor: Actor) {
  if (actor.role === "ADMIN" || actor.role === "HR") {
    const users = await prisma.user.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true
      },
      select: {
        id: true
      }
    });
    return users.map((user) => user.id);
  }

  if (!canManage(actor.role)) {
    return [actor.id];
  }

  const users = await getManagedUsers(actor);
  return [actor.id, ...users.map((user) => user.id)];
}

async function visibleTeamIds(actor: Actor) {
  if (actor.role === "ADMIN" || actor.role === "HR") {
    const teams = await prisma.team.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true
      },
      select: {
        id: true
      }
    });
    return teams.map((team) => team.id);
  }

  if (!canManage(actor.role)) {
    return actor.teamId ? [actor.teamId] : [];
  }

  const teams = await prisma.team.findMany({
    where: {
      companyId: actor.companyId,
      isActive: true,
      OR: [{ managerUserId: actor.id }, actor.teamId ? { id: actor.teamId } : { id: "__none__" }]
    },
    select: {
      id: true
    }
  });
  return teams.map((team) => team.id);
}

async function announcementRecipientIds(actor: Actor, input: { audience: AnnouncementAudience; teamId?: string | null }) {
  const where =
    input.audience === AnnouncementAudience.TEAM
      ? {
          companyId: actor.companyId,
          isActive: true,
          teamId: input.teamId ?? "__none__"
        }
      : {
          companyId: actor.companyId,
          isActive: true
        };
  const users = await prisma.user.findMany({
    where,
    select: {
      id: true
    }
  });
  return users.map((user) => user.id);
}

function normalizeAnnouncementCategory(value?: string | null) {
  const category = value?.trim().toUpperCase();
  if (category === "RESOURCE" || category === "TEAM" || category === "HR") {
    return category;
  }
  return "NOTICE";
}

function normalizeDocumentCategory(value?: string | null) {
  const category = value?.trim().toUpperCase();
  if (category === "EXPENSE" || category === "PURCHASE") {
    return category;
  }
  return "GENERAL";
}

function normalizeLibraryCategory(value?: string | null) {
  const category = value?.trim().toUpperCase();
  if (category === "CONTRACT" || category === "LEAVE" || category === "PAYROLL" || category === "FORM") {
    return category;
  }
  return "POLICY";
}

function normalizeLibraryAccessScope(value?: string | null) {
  const scope = value?.trim().toUpperCase();
  if (scope === "TEAM" || scope === "HR") {
    return scope;
  }
  return "ALL";
}

function parseOptionalDateTime(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isPublishedAnnouncement(announcement: { publishAt?: Date | null }) {
  return !announcement.publishAt || announcement.publishAt <= new Date();
}

async function dispatchAnnouncementNotifications(announcementId: string) {
  const announcement = await prisma.announcement.findUnique({
    where: {
      id: announcementId
    }
  });
  if (!announcement || !isPublishedAnnouncement(announcement) || announcement.emailStatus === "sent") {
    return;
  }

  const recipientIds = await announcementRecipientIds(
    {
      id: announcement.authorId,
      companyId: announcement.companyId,
      role: Role.ADMIN,
      teamId: null,
      name: ""
    },
    {
      audience: announcement.audience,
      teamId: announcement.teamId
    }
  );

  await createNotifications({
    companyId: announcement.companyId,
    userIds: recipientIds,
    type: NotificationType.ANNOUNCEMENT,
    title: `새 공지: ${announcement.title}`,
    message: announcement.body.slice(0, 140),
    actionUrl: "/dashboard?view=groupware#groupware-announcements",
    metadata: {
      announcementId: announcement.id,
      audience: announcement.audience,
      teamId: announcement.teamId,
      category: announcement.category
    } satisfies Prisma.JsonObject
  });
  await prisma.announcement.update({
    where: {
      id: announcement.id
    },
    data: {
      emailStatus: "sent"
    }
  });
}

async function publishDueAnnouncements(companyId: string) {
  const dueAnnouncements = await prisma.announcement.findMany({
    where: {
      companyId,
      emailStatus: "scheduled",
      OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }]
    },
    select: {
      id: true
    },
    take: 20
  });
  await Promise.all(dueAnnouncements.map((announcement) => dispatchAnnouncementNotifications(announcement.id)));
}

export async function createAnnouncement(actor: Actor, input: {
  title: string;
  body: string;
  audience?: string | null;
  teamId?: string | null;
  isPinned?: boolean;
  category?: string | null;
  allowComments?: boolean;
  publishAt?: string | null;
}) {
  assertManagerOrAbove(actor);

  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 2) {
    throw new Error("공지 제목을 입력하세요.");
  }
  if (body.length < 2) {
    throw new Error("공지 내용을 입력하세요.");
  }

  const audience = input.audience === "TEAM" ? AnnouncementAudience.TEAM : AnnouncementAudience.ALL;
  const teamId = audience === AnnouncementAudience.TEAM ? input.teamId?.trim() || null : null;
  if (audience === AnnouncementAudience.TEAM) {
    const allowedTeamIds = await visibleTeamIds(actor);
    if (!teamId || !allowedTeamIds.includes(teamId)) {
      throw new Error("공지 대상 팀을 확인하세요.");
    }
  }

  const publishAt = parseOptionalDateTime(input.publishAt);
  const shouldPublishNow = !publishAt || publishAt <= new Date();
  const announcement = await prisma.announcement.create({
    data: {
      companyId: actor.companyId,
      authorId: actor.id,
      audience,
      teamId,
      category: normalizeAnnouncementCategory(input.category),
      title,
      body,
      isPinned: Boolean(input.isPinned),
      allowComments: Boolean(input.allowComments),
      publishAt,
      emailStatus: shouldPublishNow ? "not_sent" : "scheduled"
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      },
      team: true,
      attachments: true,
      comments: true
    }
  });
  await prisma.announcementRead.upsert({
    where: {
      announcementId_userId: {
        announcementId: announcement.id,
        userId: actor.id
      }
    },
    update: {
      readAt: new Date()
    },
    create: {
      companyId: actor.companyId,
      announcementId: announcement.id,
      userId: actor.id
    }
  });
  if (shouldPublishNow) {
    await dispatchAnnouncementNotifications(announcement.id);
  }

  return announcement;
}

function visibleAnnouncementWhere(actor: Actor) {
  return {
    companyId: actor.companyId,
    OR: [
      {
        AND: [
          {
            OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }]
          },
          {
            OR: [
              { audience: AnnouncementAudience.ALL },
              actor.teamId
                ? {
                    audience: AnnouncementAudience.TEAM,
                    teamId: actor.teamId
                  }
                : { id: "__none__" }
            ]
          }
        ]
      },
      { authorId: actor.id },
      canManage(actor.role) ? { id: { not: "__none__" } } : { id: "__none__" }
    ]
  } satisfies Prisma.AnnouncementWhereInput;
}

export async function markAnnouncementRead(actor: Actor, announcementId: string) {
  const announcement = await prisma.announcement.findFirst({
    where: {
      id: announcementId,
      ...visibleAnnouncementWhere(actor)
    }
  });
  if (!announcement) {
    throw new Error("공지사항을 찾을 수 없습니다.");
  }

  return prisma.announcementRead.upsert({
    where: {
      announcementId_userId: {
        announcementId,
        userId: actor.id
      }
    },
    update: {
      readAt: new Date()
    },
    create: {
      companyId: actor.companyId,
      announcementId,
      userId: actor.id
    }
  });
}

export async function createAnnouncementComment(actor: Actor, input: {
  announcementId: string;
  body: string;
}) {
  const body = input.body.trim();
  if (body.length < 2) {
    throw new Error("댓글 내용을 입력하세요.");
  }

  const announcement = await prisma.announcement.findFirst({
    where: {
      id: input.announcementId,
      ...visibleAnnouncementWhere(actor)
    }
  });
  if (!announcement || !announcement.allowComments) {
    throw new Error("댓글을 남길 수 없는 공지입니다.");
  }

  const comment = await prisma.announcementComment.create({
    data: {
      companyId: actor.companyId,
      announcementId: announcement.id,
      authorId: actor.id,
      body
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      }
    }
  });

  const notifyUserIds = [announcement.authorId].filter((userId) => userId !== actor.id);
  await createNotifications({
    companyId: actor.companyId,
    userIds: notifyUserIds,
    type: NotificationType.ANNOUNCEMENT,
    title: "공지 댓글이 등록되었습니다",
    message: `${actor.name}: ${body.slice(0, 120)}`,
    actionUrl: "/dashboard?view=groupware#groupware-announcements",
    metadata: {
      announcementId: announcement.id,
      commentId: comment.id
    } satisfies Prisma.JsonObject
  });

  return comment;
}

export async function createPerformanceGoal(actor: Actor, input: {
  ownerType?: string | null;
  userId?: string | null;
  teamId?: string | null;
  month: string;
  title: string;
  unit?: string | null;
  targetValue: number;
  actualValue?: number;
  note?: string | null;
}) {
  assertManagerOrAbove(actor);

  const ownerType = input.ownerType === "TEAM" ? PerformanceOwnerType.TEAM : PerformanceOwnerType.USER;
  const month = input.month.trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("실적 목표 월을 확인하세요.");
  }
  const title = input.title.trim();
  if (title.length < 2) {
    throw new Error("실적 목표명을 입력하세요.");
  }
  if (!Number.isFinite(input.targetValue) || input.targetValue <= 0) {
    throw new Error("목표값은 0보다 커야 합니다.");
  }

  let userId: string | null = null;
  let teamId: string | null = null;
  if (ownerType === PerformanceOwnerType.USER) {
    userId = input.userId?.trim() || null;
    const allowedUserIds = await managedUserIds(actor);
    if (!userId || !allowedUserIds.includes(userId)) {
      throw new Error("실적 대상 직원을 확인하세요.");
    }
  } else {
    teamId = input.teamId?.trim() || null;
    const allowedTeamIds = await visibleTeamIds(actor);
    if (!teamId || !allowedTeamIds.includes(teamId)) {
      throw new Error("실적 대상 팀을 확인하세요.");
    }
  }

  return prisma.performanceGoal.create({
    data: {
      companyId: actor.companyId,
      ownerType,
      userId,
      teamId,
      month,
      title,
      unit: input.unit?.trim() || "건",
      targetValue: input.targetValue,
      actualValue: Number.isFinite(input.actualValue) ? input.actualValue ?? 0 : 0,
      note: input.note?.trim() || null,
      createdById: actor.id
    }
  });
}

export async function updatePerformanceGoal(actor: Actor, input: {
  id: string;
  actualValue?: number;
  evaluationMemo?: string | null;
}) {
  const goal = await prisma.performanceGoal.findFirst({
    where: {
      id: input.id,
      companyId: actor.companyId
    }
  });
  if (!goal) {
    throw new Error("실적 목표를 찾을 수 없습니다.");
  }

  const allowedUserIds = await managedUserIds(actor);
  const allowedTeamIds = await visibleTeamIds(actor);
  const canEdit =
    actor.role === "ADMIN" ||
    actor.role === "HR" ||
    goal.createdById === actor.id ||
    (goal.userId ? allowedUserIds.includes(goal.userId) : false) ||
    (goal.teamId ? allowedTeamIds.includes(goal.teamId) : false);
  if (!canEdit) {
    throw new Error("실적 목표를 수정할 권한이 없습니다.");
  }

  return prisma.performanceGoal.update({
    where: {
      id: goal.id
    },
    data: {
      actualValue: Number.isFinite(input.actualValue) ? input.actualValue : goal.actualValue,
      evaluationMemo: input.evaluationMemo?.trim() || goal.evaluationMemo,
      reviewedById: input.evaluationMemo ? actor.id : goal.reviewedById,
      reviewedAt: input.evaluationMemo ? new Date() : goal.reviewedAt
    }
  });
}

export async function issuePayrollStatements(actor: Actor, input: {
  month: string;
  userIds?: string[];
  status?: string | null;
  note?: string | null;
}) {
  if (!canViewReports(actor.role)) {
    throw new Error("급여명세 발행은 HR 또는 관리자만 가능합니다.");
  }
  const month = input.month.trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("급여명세 월을 확인하세요.");
  }
  const users = await prisma.user.findMany({
    where: {
      companyId: actor.companyId,
      isActive: true,
      ...(input.userIds?.length
        ? {
            id: {
              in: input.userIds
            }
          }
        : {})
    },
    select: {
      id: true,
      name: true
    },
    take: 200
  });
  const status = input.status === "LOCKED" ? PayrollStatementStatus.LOCKED : PayrollStatementStatus.PUBLISHED;
  const now = new Date();
  const issues = [];
  for (const user of users) {
    const statement = await getPayrollStatement(actor, {
      month,
      userId: user.id,
      bypassIssueCheck: true
    });
    const issue = await prisma.payrollStatementIssue.upsert({
      where: {
        companyId_userId_month: {
          companyId: actor.companyId,
          userId: user.id,
          month
        }
      },
      update: {
        status,
        snapshot: {
          payableEquivalentMinutes: statement.row.payableEquivalentMinutes,
          calculatedWorkMinutes: statement.row.calculatedWorkMinutes,
          closeStatus: statement.row.closeStatus,
          policyVersion: statement.policy.version
        } satisfies Prisma.JsonObject,
        note: input.note?.trim() || null,
        issuedById: actor.id,
        issuedAt: now,
        lockedById: status === PayrollStatementStatus.LOCKED ? actor.id : null,
        lockedAt: status === PayrollStatementStatus.LOCKED ? now : null
      },
      create: {
        companyId: actor.companyId,
        userId: user.id,
        month,
        status,
        snapshot: {
          payableEquivalentMinutes: statement.row.payableEquivalentMinutes,
          calculatedWorkMinutes: statement.row.calculatedWorkMinutes,
          closeStatus: statement.row.closeStatus,
          policyVersion: statement.policy.version
        } satisfies Prisma.JsonObject,
        note: input.note?.trim() || null,
        issuedById: actor.id,
        issuedAt: now,
        lockedById: status === PayrollStatementStatus.LOCKED ? actor.id : null,
        lockedAt: status === PayrollStatementStatus.LOCKED ? now : null
      }
    });
    issues.push(issue);
  }

  await createNotifications({
    companyId: actor.companyId,
    userIds: users.map((user) => user.id),
    type: NotificationType.PAYROLL_STATEMENT,
    title: `${month} 급여명세가 발행되었습니다`,
    message: "그룹웨어 급여명세 탭에서 PDF 또는 CSV로 내려받을 수 있습니다.",
    actionUrl: "/dashboard?view=groupware#groupware-payroll-statements",
    metadata: {
      month,
      issueCount: issues.length
    } satisfies Prisma.JsonObject
  });

  return {
    count: issues.length,
    issues
  };
}

async function defaultDocumentReviewer(actor: Actor) {
  const users = await prisma.user.findMany({
    where: {
      companyId: actor.companyId,
      isActive: true,
      OR: [
        { role: "ADMIN" },
        { role: "HR" },
        actor.teamId
          ? {
              managedTeams: {
                some: {
                  id: actor.teamId
                }
              }
            }
          : { id: "__none__" }
      ]
    },
    select: {
      id: true
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }]
  });
  return users.find((user) => user.id !== actor.id)?.id ?? null;
}

async function generateDocumentNumber(companyId: string) {
  const month = getKstDateString().slice(0, 7).replace("-", "");
  const count = await prisma.documentRequest.count({
    where: {
      companyId,
      documentNumber: {
        startsWith: `DOC-${month}-`
      }
    }
  });
  return `DOC-${month}-${String(count + 1).padStart(4, "0")}`;
}

async function findFirstRoleUser(companyId: string, role: Role) {
  return prisma.user.findFirst({
    where: {
      companyId,
      role,
      isActive: true
    },
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      role: true
    }
  });
}

async function buildDocumentApprovalSteps(actor: Actor, fallbackReviewerId?: string | null) {
  const requester = await prisma.user.findUnique({
    where: {
      id: actor.id
    },
    include: {
      team: {
        include: {
          manager: {
            select: {
              id: true,
              role: true
            }
          }
        }
      }
    }
  });
  const hr = await findFirstRoleUser(actor.companyId, Role.HR);
  const admin = await findFirstRoleUser(actor.companyId, Role.ADMIN);
  const fallback = fallbackReviewerId
    ? await prisma.user.findFirst({
        where: {
          id: fallbackReviewerId,
          companyId: actor.companyId,
          isActive: true,
          role: {
            in: [Role.ADMIN, Role.HR, Role.MANAGER]
          }
        },
        select: {
          id: true,
          role: true
        }
      })
    : null;

  const candidates = [
    requester?.team?.manager
      ? {
          label: "팀장 결재",
          approverId: requester.team.manager.id,
          approverRole: Role.MANAGER
        }
      : null,
    hr
      ? {
          label: "HR 검토",
          approverId: hr.id,
          approverRole: Role.HR
        }
      : null,
    admin
      ? {
          label: "관리자 승인",
          approverId: admin.id,
          approverRole: Role.ADMIN
        }
      : null,
    fallback
      ? {
          label: "지정 결재자",
          approverId: fallback.id,
          approverRole: fallback.role
        }
      : null
  ];
  const seen = new Set<string>();
  const steps = candidates.filter((candidate): candidate is { label: string; approverId: string; approverRole: Role } => {
    if (!candidate || candidate.approverId === actor.id || seen.has(candidate.approverId)) {
      return false;
    }
    seen.add(candidate.approverId);
    return true;
  });

  if (steps.length > 0) {
    return steps;
  }

  const fallbackId = await defaultDocumentReviewer(actor);
  if (!fallbackId) {
    return [];
  }

  const fallbackUser = await prisma.user.findUnique({
    where: {
      id: fallbackId
    },
    select: {
      id: true,
      role: true
    }
  });
  return fallbackUser
    ? [
        {
          label: "기본 결재자",
          approverId: fallbackUser.id,
          approverRole: fallbackUser.role
        }
      ]
    : [];
}

async function notifyDocumentAssignee(documentId: string) {
  const document = await prisma.documentRequest.findUnique({
    where: {
      id: documentId
    },
    include: {
      requester: true,
      reviewer: true
    }
  });
  if (!document || !document.reviewerId || document.status !== DocumentRequestStatus.PENDING) {
    return;
  }

  const thread = await ensureWorkThreadForDocumentRequest(document.id);
  await createNotifications({
    companyId: document.companyId,
    userIds: [document.reviewerId],
    type: NotificationType.DOCUMENT_REQUEST,
    title: `${document.requester.name}님의 전자결재 요청`,
    message: `${document.documentNumber ?? "문서번호 미정"} · ${document.category} · ${document.title}`,
    actionUrl: thread ? `/dashboard?view=workbox&workThreadId=${thread.id}` : "/dashboard?view=workbox",
    metadata: {
      documentRequestId: document.id,
      documentNumber: document.documentNumber
    } satisfies Prisma.JsonObject
  });
}

export async function createDocumentRequest(actor: Actor, input: {
  title: string;
  body: string;
  category?: string | null;
  amount?: number | null;
  reviewerId?: string | null;
  formData?: Prisma.JsonObject | null;
}) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 2) {
    throw new Error("결재 제목을 입력하세요.");
  }
  if (body.length < 2) {
    throw new Error("결재 내용을 입력하세요.");
  }

  const steps = await buildDocumentApprovalSteps(actor, input.reviewerId?.trim() || null);
  const firstStep = steps[0] ?? null;
  if (!firstStep) {
    throw new Error("결재선을 만들 수 없습니다. 팀장, HR 또는 관리자를 먼저 등록하세요.");
  }

  const document = await prisma.documentRequest.create({
    data: {
      companyId: actor.companyId,
      requesterId: actor.id,
      reviewerId: firstStep.approverId,
      documentNumber: await generateDocumentNumber(actor.companyId),
      category: normalizeDocumentCategory(input.category),
      title,
      body,
      amount: Number.isFinite(input.amount) ? input.amount : null,
      formData: input.formData ?? Prisma.JsonNull,
      approvalSteps: {
        create: steps.map((step, index) => ({
          companyId: actor.companyId,
          stepOrder: index + 1,
          label: step.label,
          approverId: step.approverId,
          approverRole: step.approverRole
        }))
      }
    },
    include: {
      requester: true,
      reviewer: true,
      approvalSteps: {
        include: {
          approver: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },
        orderBy: {
          stepOrder: "asc"
        }
      },
      attachments: true
    }
  });
  await ensureWorkThreadForDocumentRequest(document.id);
  await notifyDocumentAssignee(document.id);

  return document;
}

export async function reviewDocumentRequest(actor: Actor, input: {
  id: string;
  status: string;
  reviewNote?: string | null;
}) {
  if (!canManage(actor.role)) {
    throw new Error("전자결재 처리 권한이 필요합니다.");
  }
  const document = await prisma.documentRequest.findFirst({
    where: {
      id: input.id,
      companyId: actor.companyId
    },
    include: {
      approvalSteps: {
        include: {
          approver: true
        },
        orderBy: {
          stepOrder: "asc"
        }
      }
    }
  });
  if (!document) {
    throw new Error("전자결재 문서를 찾을 수 없습니다.");
  }
  if (document.status !== DocumentRequestStatus.PENDING) {
    throw new Error("이미 처리된 전자결재 문서입니다.");
  }

  const currentStep = document.approvalSteps.find((step) => step.status === DocumentApprovalStepStatus.PENDING);
  if (!currentStep) {
    throw new Error("처리할 결재 단계가 없습니다.");
  }
  const canReview =
    actor.role === "ADMIN" ||
    currentStep.approverId === actor.id ||
    (actor.role === "HR" && currentStep.approverRole === Role.HR);
  if (!canReview) {
    throw new Error("담당 결재 문서만 처리할 수 있습니다.");
  }

  const reviewNote = input.reviewNote?.trim() || null;
  if (input.status !== "APPROVED") {
    await prisma.documentApprovalStep.update({
      where: {
        id: currentStep.id
      },
      data: {
        status: DocumentApprovalStepStatus.REJECTED,
        reviewNote,
        reviewedAt: new Date()
      }
    });
    const rejected = await prisma.documentRequest.update({
      where: {
        id: document.id
      },
      data: {
        status: DocumentRequestStatus.REJECTED,
        reviewerId: actor.id,
        reviewNote,
        reviewedAt: new Date()
      }
    });
    const thread = await ensureWorkThreadForDocumentRequest(document.id);
    await createNotifications({
      companyId: actor.companyId,
      userIds: [document.requesterId],
      type: NotificationType.DOCUMENT_REQUEST,
      title: "전자결재가 반려되었습니다",
      message: `${document.documentNumber ?? ""} ${document.title} · ${reviewNote || actor.name}`,
      actionUrl: thread ? `/dashboard?view=workbox&workThreadId=${thread.id}` : "/dashboard?view=workbox",
      metadata: {
        documentRequestId: document.id,
        status: DocumentRequestStatus.REJECTED
      } satisfies Prisma.JsonObject
    });
    return rejected;
  }

  await prisma.documentApprovalStep.update({
    where: {
      id: currentStep.id
    },
    data: {
      status: DocumentApprovalStepStatus.APPROVED,
      reviewNote,
      reviewedAt: new Date()
    }
  });
  const nextStep = document.approvalSteps.find((step) => step.stepOrder > currentStep.stepOrder && step.status === DocumentApprovalStepStatus.PENDING);
  const isFinalApproved = !nextStep;
  const updated = await prisma.documentRequest.update({
    where: {
      id: document.id
    },
    data: {
      status: isFinalApproved ? DocumentRequestStatus.APPROVED : DocumentRequestStatus.PENDING,
      reviewerId: isFinalApproved ? actor.id : nextStep.approverId,
      reviewNote: isFinalApproved ? reviewNote : document.reviewNote,
      reviewedAt: isFinalApproved ? new Date() : null
    }
  });
  const thread = await ensureWorkThreadForDocumentRequest(document.id);
  await createNotifications({
    companyId: actor.companyId,
    userIds: [document.requesterId],
    type: NotificationType.DOCUMENT_REQUEST,
    title: isFinalApproved ? "전자결재가 승인되었습니다" : "전자결재 단계가 승인되었습니다",
    message: `${document.documentNumber ?? ""} ${document.title} · ${currentStep.label}`,
    actionUrl: thread ? `/dashboard?view=workbox&workThreadId=${thread.id}` : "/dashboard?view=workbox",
    metadata: {
      documentRequestId: document.id,
      status: updated.status
    } satisfies Prisma.JsonObject
  });
  if (!isFinalApproved) {
    await notifyDocumentAssignee(document.id);
  }
  return updated;
}

function visibleDocumentWhere(actor: Actor) {
  return {
    companyId: actor.companyId,
    OR: [
      { requesterId: actor.id },
      { reviewerId: actor.id },
      canViewReports(actor.role) ? { id: { not: "__none__" } } : { id: "__none__" }
    ]
  } satisfies Prisma.DocumentRequestWhereInput;
}

function visibleLibraryWhere(actor: Actor) {
  return {
    companyId: actor.companyId,
    OR: [
      { accessScope: "ALL" },
      actor.teamId ? { accessScope: "TEAM", teamId: actor.teamId } : { id: "__none__" },
      canViewReports(actor.role) ? { accessScope: "HR" } : { id: "__none__" },
      canManage(actor.role) ? { createdById: actor.id } : { id: "__none__" }
    ]
  } satisfies Prisma.DocumentLibraryItemWhereInput;
}

export async function getDocumentRequestForActor(actor: Actor, documentRequestId: string) {
  const document = await prisma.documentRequest.findFirst({
    where: {
      id: documentRequestId,
      ...visibleDocumentWhere(actor)
    },
    include: {
      requester: {
        include: {
          team: true
        }
      },
      reviewer: true,
      approvalSteps: {
        include: {
          approver: true
        },
        orderBy: {
          stepOrder: "asc"
        }
      },
      attachments: {
        include: {
          uploadedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });
  if (!document) {
    throw new Error("전자결재 문서를 찾을 수 없습니다.");
  }
  return document;
}

export async function getDocumentAttachmentForActor(actor: Actor, attachmentId: string) {
  const attachment = await prisma.documentAttachment.findFirst({
    where: {
      id: attachmentId,
      companyId: actor.companyId,
      documentRequest: {
        is: visibleDocumentWhere(actor)
      }
    },
    include: {
      documentRequest: {
        select: {
          requesterId: true
        }
      }
    }
  });
  if (!attachment) {
    throw new Error("첨부 파일을 찾을 수 없습니다.");
  }
  return attachment;
}

export async function getAnnouncementAttachmentForActor(actor: Actor, attachmentId: string) {
  const attachment = await prisma.announcementAttachment.findFirst({
    where: {
      id: attachmentId,
      companyId: actor.companyId,
      announcement: {
        is: visibleAnnouncementWhere(actor)
      }
    },
    include: {
      announcement: {
        select: {
          authorId: true
        }
      }
    }
  });
  if (!attachment) {
    throw new Error("첨부 파일을 찾을 수 없습니다.");
  }
  return attachment;
}

export async function createDocumentLibraryVersion(actor: Actor, input: {
  itemId?: string | null;
  title: string;
  category?: string | null;
  accessScope?: string | null;
  teamId?: string | null;
  description?: string | null;
  note?: string | null;
}) {
  if (!canManage(actor.role)) {
    throw new Error("자료실 등록 권한이 필요합니다.");
  }
  const title = input.title.trim();
  if (!input.itemId && title.length < 2) {
    throw new Error("자료 제목을 입력하세요.");
  }

  const accessScope = normalizeLibraryAccessScope(input.accessScope);
  const teamId = accessScope === "TEAM" ? input.teamId?.trim() || actor.teamId : null;
  if (accessScope === "TEAM") {
    const allowedTeamIds = await visibleTeamIds(actor);
    if (!teamId || !allowedTeamIds.includes(teamId)) {
      throw new Error("자료 공개 부서를 확인하세요.");
    }
  }

  if (input.itemId) {
    const item = await prisma.documentLibraryItem.findFirst({
      where: {
        id: input.itemId,
        companyId: actor.companyId
      },
      include: {
        versions: {
          orderBy: {
            versionNo: "desc"
          },
          take: 1
        }
      }
    });
    if (!item) {
      throw new Error("자료를 찾을 수 없습니다.");
    }
    return {
      item,
      nextVersionNo: (item.versions[0]?.versionNo ?? 0) + 1
    };
  }

  const item = await prisma.documentLibraryItem.create({
    data: {
      companyId: actor.companyId,
      createdById: actor.id,
      title,
      category: normalizeLibraryCategory(input.category),
      accessScope,
      teamId,
      description: input.description?.trim() || null
    }
  });
  return {
    item,
    nextVersionNo: 1
  };
}

export async function getDocumentLibraryVersionForActor(actor: Actor, versionId: string) {
  const version = await prisma.documentLibraryVersion.findFirst({
    where: {
      id: versionId,
      companyId: actor.companyId,
      item: {
        is: visibleLibraryWhere(actor)
      }
    },
    include: {
      item: true
    }
  });
  if (!version) {
    throw new Error("자료실 파일을 찾을 수 없습니다.");
  }
  return version;
}

async function getGroupwareSearchResults(actor: Actor, query: string) {
  const keyword = query.trim();
  if (keyword.length < 2) {
    return [] as GroupwareSearchResult[];
  }

  const visibleUserIds = await visibleProfileMemoUserIds(actor);
  const [users, announcements, memoThreads, documents, payrollIssues, libraryItems] = await Promise.all([
    prisma.user.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true,
        id: {
          in: [...visibleUserIds]
        },
        OR: [
          { name: { contains: keyword, mode: "insensitive" } },
          { email: { contains: keyword, mode: "insensitive" } },
          { jobTitle: { contains: keyword, mode: "insensitive" } },
          { extensionNumber: { contains: keyword, mode: "insensitive" } }
        ]
      },
      include: {
        team: true
      },
      take: 5
    }),
    prisma.announcement.findMany({
      where: {
        ...visibleAnnouncementWhere(actor),
        OR: [
          { title: { contains: keyword, mode: "insensitive" } },
          { body: { contains: keyword, mode: "insensitive" } },
          { category: { contains: keyword, mode: "insensitive" } }
        ]
      },
      take: 5,
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.workThread.findMany({
      where: {
        companyId: actor.companyId,
        targetType: WorkThreadTargetType.USER_PROFILE,
        targetId: {
          in: [...visibleUserIds]
        },
        OR: [
          { title: { contains: keyword, mode: "insensitive" } },
          {
            comments: {
              some: {
                body: { contains: keyword, mode: "insensitive" },
                deletedAt: null
              }
            }
          }
        ]
      },
      take: 5,
      orderBy: {
        updatedAt: "desc"
      }
    }),
    prisma.documentRequest.findMany({
      where: {
        ...visibleDocumentWhere(actor),
        OR: [
          { documentNumber: { contains: keyword, mode: "insensitive" } },
          { title: { contains: keyword, mode: "insensitive" } },
          { body: { contains: keyword, mode: "insensitive" } },
          { category: { contains: keyword, mode: "insensitive" } }
        ]
      },
      include: {
        requester: true
      },
      take: 5,
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.payrollStatementIssue.findMany({
      where: {
        companyId: actor.companyId,
        ...(canViewReports(actor.role) ? {} : { userId: actor.id }),
        OR: [
          { month: { contains: keyword, mode: "insensitive" } },
          { user: { name: { contains: keyword, mode: "insensitive" } } },
          { note: { contains: keyword, mode: "insensitive" } }
        ]
      },
      include: {
        user: true
      },
      take: 5,
      orderBy: {
        issuedAt: "desc"
      }
    }),
    prisma.documentLibraryItem.findMany({
      where: {
        ...visibleLibraryWhere(actor),
        OR: [
          { title: { contains: keyword, mode: "insensitive" } },
          { description: { contains: keyword, mode: "insensitive" } },
          { category: { contains: keyword, mode: "insensitive" } }
        ]
      },
      include: {
        versions: {
          orderBy: {
            versionNo: "desc"
          },
          take: 1
        }
      },
      take: 5,
      orderBy: {
        updatedAt: "desc"
      }
    })
  ]);

  return [
    ...users.map((user) => ({
      type: "USER" as const,
      label: "직원",
      title: user.name,
      description: `${user.team?.name ?? "소속 없음"} · ${user.email}`,
      href: `/dashboard?view=groupware&orgUserId=${user.id}`
    })),
    ...announcements.map((announcement) => ({
      type: "ANNOUNCEMENT" as const,
      label: "공지",
      title: announcement.title,
      description: `${announcement.category} · ${announcement.body.slice(0, 80)}`,
      href: "/dashboard?view=groupware#groupware-announcements"
    })),
    ...memoThreads.map((thread) => ({
      type: "MEMO" as const,
      label: "메모",
      title: thread.title,
      description: thread.status === "OPEN" ? "미결 메모" : "해결 메모",
      href: `/dashboard?view=workbox&workThreadId=${thread.id}`
    })),
    ...documents.map((document) => ({
      type: "DOCUMENT" as const,
      label: "전자결재",
      title: `${document.documentNumber ?? ""} ${document.title}`.trim(),
      description: `${document.requester.name} · ${document.status}`,
      href: "/dashboard?view=groupware#groupware-documents"
    })),
    ...payrollIssues.map((issue) => ({
      type: "PAYROLL" as const,
      label: "급여명세",
      title: `${issue.month} · ${issue.user.name}`,
      description: issue.status === "LOCKED" ? "잠금 발행" : "발행",
      href: "/dashboard?view=groupware#groupware-payroll-statements"
    })),
    ...libraryItems.map((item) => ({
      type: "LIBRARY" as const,
      label: "문서함",
      title: item.title,
      description: `${item.category} · v${item.versions[0]?.versionNo ?? 0}`,
      href: "/dashboard?view=groupware#groupware-library"
    }))
  ].slice(0, 20);
}

export async function getGroupwareDashboard(actor: Actor, input?: { search?: string | null }) {
  await publishDueAnnouncements(actor.companyId);
  const visibleUserIds = await visibleProfileMemoUserIds(actor);
  const allowedUserIds = await managedUserIds(actor);
  const allowedTeamIds = await visibleTeamIds(actor);
  const memoThreads = await prisma.workThread.findMany({
    where: {
      companyId: actor.companyId,
      targetType: WorkThreadTargetType.USER_PROFILE,
      OR: [
        {
          targetId: {
            in: [...visibleUserIds]
          }
        },
        { assigneeId: actor.id },
        { createdById: actor.id }
      ]
    },
    include: {
      assignee: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      },
      comments: {
        where: {
          deletedAt: null
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      }
    },
    orderBy: [{ status: "asc" }, { lastCommentAt: "desc" }, { updatedAt: "desc" }],
    take: 40
  });
  const targetUsers = await prisma.user.findMany({
    where: {
      companyId: actor.companyId,
      id: {
        in: memoThreads.map((thread) => thread.targetId)
      }
    },
    include: {
      team: true
    }
  });
  const targetUserById = new Map(targetUsers.map((user) => [user.id, user]));
  const profileMemoThreads = memoThreads.map((thread) => ({
    id: thread.id,
    targetUserId: thread.targetId,
    title: thread.title,
    status: thread.status,
    assignee: thread.assignee,
    createdBy: thread.createdBy,
    lastCommentAt: thread.lastCommentAt,
    updatedAt: thread.updatedAt,
    lastComment: thread.comments[0] ?? null,
    targetUser: targetUserById.get(thread.targetId) ?? null,
    href: `/dashboard?view=workbox&workThreadId=${thread.id}`
  }));
  const memoStatsByUser = profileMemoThreads.reduce<Array<{
    userId: string;
    openCount: number;
    lastCommentAt: Date | null;
  }>>((acc, thread) => {
    const current = acc.find((item) => item.userId === thread.targetUserId);
    if (!current) {
      acc.push({
        userId: thread.targetUserId,
        openCount: thread.status === "OPEN" ? 1 : 0,
        lastCommentAt: thread.lastCommentAt
      });
      return acc;
    }
    current.openCount += thread.status === "OPEN" ? 1 : 0;
    if (thread.lastCommentAt && (!current.lastCommentAt || thread.lastCommentAt > current.lastCommentAt)) {
      current.lastCommentAt = thread.lastCommentAt;
    }
    return acc;
  }, []);
  const currentMonth = getKstDateString().slice(0, 7);
  const [announcements, performanceGoals, payrollIssues, documentRequests, libraryItems, searchResults] = await Promise.all([
    prisma.announcement.findMany({
      where: visibleAnnouncementWhere(actor),
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        team: true,
        reads: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true
              }
            }
          }
        },
        attachments: {
          orderBy: {
            createdAt: "desc"
          }
        },
        comments: {
          where: {
            deletedAt: null
          },
          include: {
            author: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 3
        },
        _count: {
          select: {
            reads: true,
            comments: true
          }
        }
      },
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      take: 8
    }),
    prisma.performanceGoal.findMany({
      where: {
        companyId: actor.companyId,
        month: currentMonth,
        OR: [
          {
            userId: {
              in: allowedUserIds
            }
          },
          {
            teamId: {
              in: allowedTeamIds
            }
          },
          { createdById: actor.id }
        ]
      },
      include: {
        user: {
          include: {
            team: true
          }
        },
        team: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 12
    }),
    prisma.payrollStatementIssue.findMany({
      where: {
        companyId: actor.companyId,
        month: {
          in: Array.from({ length: 6 }, (_, index) => addMonths(currentMonth, -index))
        },
        ...(canViewReports(actor.role)
          ? {}
          : {
              userId: actor.id
            })
      },
      include: {
        user: {
          include: {
            team: true
          }
        },
        issuedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: [{ month: "desc" }, { issuedAt: "desc" }],
      take: 40
    }),
    prisma.documentRequest.findMany({
      where: visibleDocumentWhere(actor),
      include: {
        requester: {
          include: {
            team: true
          }
        },
        reviewer: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        approvalSteps: {
          include: {
            approver: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true
              }
            }
          },
          orderBy: {
            stepOrder: "asc"
          }
        },
        attachments: {
          include: {
            uploadedBy: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        }
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 12
    }),
    prisma.documentLibraryItem.findMany({
      where: visibleLibraryWhere(actor),
      include: {
        team: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        versions: {
          include: {
            uploadedBy: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true
              }
            }
          },
          orderBy: {
            versionNo: "desc"
          },
          take: 3
        }
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 12
    }),
    getGroupwareSearchResults(actor, input?.search ?? "")
  ]);
  const documentThreads = await prisma.workThread.findMany({
    where: {
      companyId: actor.companyId,
      targetType: WorkThreadTargetType.DOCUMENT_REQUEST,
      targetId: {
        in: documentRequests.map((document) => document.id)
      }
    },
    include: {
      comments: {
        where: {
          deletedAt: null
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      },
      _count: {
        select: {
          comments: true
        }
      }
    }
  });
  const documentThreadByTargetId = new Map(documentThreads.map((thread) => [thread.targetId, thread]));
  const announcementStats = await Promise.all(
    announcements.map(async (announcement) => {
      const recipients = await announcementRecipientIds(actor, {
        audience: announcement.audience,
        teamId: announcement.teamId
      });
      const readUserIds = new Set(announcement.reads.map((read) => read.userId));
      const unreadUsers = recipients.filter((userId) => !readUserIds.has(userId));
      const unreadUserRows = unreadUsers.length
        ? await prisma.user.findMany({
            where: {
              id: {
                in: unreadUsers
              }
            },
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            },
            take: 8
          })
        : [];
      return {
        announcementId: announcement.id,
        recipientCount: recipients.length,
        readCount: readUserIds.size,
        unreadCount: unreadUsers.length,
        unreadUsers: unreadUserRows
      };
    })
  );
  const announcementStatById = new Map(announcementStats.map((stat) => [stat.announcementId, stat]));

  return {
    profileMemoThreads,
    memoStatsByUser,
    payrollMonths: Array.from({ length: 6 }, (_, index) => addMonths(currentMonth, -index)),
    currentMonth,
    announcements: announcements.map((announcement) => ({
      ...announcement,
      isReadByViewer: announcement.reads.some((read) => read.userId === actor.id),
      readStats: announcementStatById.get(announcement.id) ?? {
        announcementId: announcement.id,
        recipientCount: 0,
        readCount: 0,
        unreadCount: 0,
        unreadUsers: []
      },
      isPublished: isPublishedAnnouncement(announcement)
    })),
    unreadAnnouncementCount: announcements.filter((announcement) => isPublishedAnnouncement(announcement) && !announcement.reads.some((read) => read.userId === actor.id)).length,
    performanceGoals,
    payrollIssues,
    documentRequests: documentRequests.map((document) => ({
      ...document,
      workThread: documentThreadByTargetId.get(document.id) ?? null
    })),
    libraryItems,
    searchQuery: input?.search?.trim() ?? "",
    searchResults,
    canManageGroupware: canManage(actor.role),
    canViewPayrollForOthers: canViewReports(actor.role)
  };
}

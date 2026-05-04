import {
  AnnouncementAudience,
  DocumentRequestStatus,
  NotificationType,
  PayrollStatementStatus,
  PerformanceOwnerType,
  Prisma,
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

export async function createAnnouncement(actor: Actor, input: {
  title: string;
  body: string;
  audience?: string | null;
  teamId?: string | null;
  isPinned?: boolean;
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

  const announcement = await prisma.announcement.create({
    data: {
      companyId: actor.companyId,
      authorId: actor.id,
      audience,
      teamId,
      title,
      body,
      isPinned: Boolean(input.isPinned)
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
      team: true
    }
  });
  const recipientIds = await announcementRecipientIds(actor, { audience, teamId });
  await createNotifications({
    companyId: actor.companyId,
    userIds: recipientIds,
    type: NotificationType.ANNOUNCEMENT,
    title: `새 공지: ${title}`,
    message: body.slice(0, 140),
    actionUrl: `/dashboard?view=groupware#groupware-announcements`,
    metadata: {
      announcementId: announcement.id,
      audience,
      teamId
    } satisfies Prisma.JsonObject
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

  return announcement;
}

export async function markAnnouncementRead(actor: Actor, announcementId: string) {
  const announcement = await prisma.announcement.findFirst({
    where: {
      id: announcementId,
      companyId: actor.companyId,
      OR: [
        { audience: AnnouncementAudience.ALL },
        actor.teamId
          ? {
              audience: AnnouncementAudience.TEAM,
              teamId: actor.teamId
            }
          : { id: "__none__" },
        { authorId: actor.id }
      ]
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

export async function createDocumentRequest(actor: Actor, input: {
  title: string;
  body: string;
  category?: string | null;
  amount?: number | null;
  reviewerId?: string | null;
}) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 2) {
    throw new Error("결재 제목을 입력하세요.");
  }
  if (body.length < 2) {
    throw new Error("결재 내용을 입력하세요.");
  }
  const reviewerId = input.reviewerId?.trim() || (await defaultDocumentReviewer(actor));
  if (reviewerId) {
    const reviewer = await prisma.user.findFirst({
      where: {
        id: reviewerId,
        companyId: actor.companyId,
        isActive: true,
        role: {
          in: ["ADMIN", "HR", "MANAGER"]
        }
      }
    });
    if (!reviewer) {
      throw new Error("결재자는 관리자, HR, 팀장 중에서 선택하세요.");
    }
  }

  const document = await prisma.documentRequest.create({
    data: {
      companyId: actor.companyId,
      requesterId: actor.id,
      reviewerId,
      category: input.category?.trim() || "GENERAL",
      title,
      body,
      amount: Number.isFinite(input.amount) ? input.amount : null
    },
    include: {
      requester: true,
      reviewer: true
    }
  });
  const thread = await ensureWorkThreadForDocumentRequest(document.id);
  await createNotifications({
    companyId: actor.companyId,
    userIds: reviewerId ? [reviewerId] : [],
    type: NotificationType.DOCUMENT_REQUEST,
    title: `${actor.name}님의 전자결재 요청`,
    message: `${document.category} · ${title}`,
    actionUrl: thread ? `/dashboard?view=workbox&workThreadId=${thread.id}` : "/dashboard?view=workbox",
    metadata: {
      documentRequestId: document.id
    } satisfies Prisma.JsonObject
  });

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
    }
  });
  if (!document) {
    throw new Error("전자결재 문서를 찾을 수 없습니다.");
  }
  if (actor.role === "MANAGER" && document.reviewerId !== actor.id) {
    throw new Error("담당 결재 문서만 처리할 수 있습니다.");
  }
  const status = input.status === "APPROVED" ? DocumentRequestStatus.APPROVED : DocumentRequestStatus.REJECTED;
  const updated = await prisma.documentRequest.update({
    where: {
      id: document.id
    },
    data: {
      status,
      reviewerId: actor.id,
      reviewNote: input.reviewNote?.trim() || null,
      reviewedAt: new Date()
    }
  });
  const thread = await ensureWorkThreadForDocumentRequest(document.id);
  await createNotifications({
    companyId: actor.companyId,
    userIds: [document.requesterId],
    type: NotificationType.DOCUMENT_REQUEST,
    title: `전자결재가 ${status === DocumentRequestStatus.APPROVED ? "승인" : "반려"}되었습니다`,
    message: `${document.title} · ${input.reviewNote?.trim() || actor.name}`,
    actionUrl: thread ? `/dashboard?view=workbox&workThreadId=${thread.id}` : "/dashboard?view=workbox",
    metadata: {
      documentRequestId: document.id,
      status
    } satisfies Prisma.JsonObject
  });
  return updated;
}

export async function getGroupwareDashboard(actor: Actor) {
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
  const [announcements, performanceGoals, payrollIssues, documentRequests] = await Promise.all([
    prisma.announcement.findMany({
      where: {
        companyId: actor.companyId,
        OR: [
          { audience: AnnouncementAudience.ALL },
          actor.teamId
            ? {
                audience: AnnouncementAudience.TEAM,
                teamId: actor.teamId
              }
            : { id: "__none__" },
          { authorId: actor.id }
        ]
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
        reads: {
          where: {
            userId: actor.id
          }
        },
        _count: {
          select: {
            reads: true
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
      where: {
        companyId: actor.companyId,
        OR: [
          { requesterId: actor.id },
          { reviewerId: actor.id },
          actor.role === "ADMIN" || actor.role === "HR"
            ? { id: { not: "__none__" } }
            : { id: "__none__" }
        ]
      },
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
        }
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 12
    })
  ]);

  return {
    profileMemoThreads,
    memoStatsByUser,
    payrollMonths: Array.from({ length: 6 }, (_, index) => addMonths(currentMonth, -index)),
    currentMonth,
    announcements: announcements.map((announcement) => ({
      ...announcement,
      isReadByViewer: announcement.reads.length > 0
    })),
    unreadAnnouncementCount: announcements.filter((announcement) => announcement.reads.length === 0).length,
    performanceGoals,
    payrollIssues,
    documentRequests,
    canManageGroupware: canManage(actor.role),
    canViewPayrollForOthers: canViewReports(actor.role)
  };
}

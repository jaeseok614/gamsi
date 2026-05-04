import {
  NotificationType,
  Prisma,
  WorkThreadPriority,
  WorkThreadStatus,
  WorkThreadTargetType,
  type ApprovalType,
  type RiskLevel,
  type User
} from "@/generated/prisma";

import { writeAuditLog } from "@/lib/audit";
import { canManage, canViewReports } from "@/lib/auth";
import { getManagedUsers } from "@/lib/manager";
import { createNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

type Actor = Pick<User, "id" | "companyId" | "role" | "teamId" | "name">;
type WorkThreadListRow = Prisma.WorkThreadGetPayload<{
  include: {
    assignee: {
      select: {
        id: true;
        name: true;
        email: true;
        role: true;
      };
    };
    createdBy: {
      select: {
        id: true;
        name: true;
        email: true;
        role: true;
      };
    };
    comments: true;
    readStates: true;
  };
}>;

export type WorkboxFilter = "mine" | "unread" | "approval" | "risk" | "month-close" | "resolved";

const DEFAULT_WORKBOX_FILTER: WorkboxFilter = "mine";

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function normalizeWorkboxFilter(value?: string | null): WorkboxFilter {
  const filters: WorkboxFilter[] = ["mine", "unread", "approval", "risk", "month-close", "resolved"];
  return filters.includes(value as WorkboxFilter) ? (value as WorkboxFilter) : DEFAULT_WORKBOX_FILTER;
}

function approvalTypeLabel(type: ApprovalType) {
  if (type === "OVERTIME") {
    return "초과근로";
  }
  if (type === "LEAVE") {
    return "휴가";
  }
  return "근태 정정";
}

function priorityFromRiskLevel(level: RiskLevel) {
  if (level === "CRITICAL") {
    return WorkThreadPriority.URGENT;
  }
  if (level === "HIGH") {
    return WorkThreadPriority.HIGH;
  }
  return WorkThreadPriority.NORMAL;
}

function threadHref(threadId: string) {
  return `/dashboard?view=workbox&workThreadId=${threadId}`;
}

async function managerRecipientIds(companyId: string, requesterId?: string | null) {
  const requester = requesterId
    ? await prisma.user.findFirst({
        where: {
          id: requesterId,
          companyId
        },
        select: {
          teamId: true
        }
      })
    : null;

  const users = await prisma.user.findMany({
    where: {
      companyId,
      isActive: true,
      OR: [
        { role: "ADMIN" },
        { role: "HR" },
        requester?.teamId
          ? {
              managedTeams: {
                some: {
                  id: requester.teamId
                }
              }
            }
          : { id: "__none__" }
      ]
    },
    select: {
      id: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return unique(users.map((user) => user.id).filter((id) => id !== requesterId));
}

async function getTargetUserIds(thread: {
  companyId: string;
  targetType: WorkThreadTargetType;
  targetId: string;
}) {
  if (thread.targetType === WorkThreadTargetType.APPROVAL_REQUEST) {
    const approval = await prisma.approvalRequest.findFirst({
      where: {
        id: thread.targetId,
        companyId: thread.companyId
      },
      select: {
        requesterId: true,
        reviewerId: true
      }
    });
    return unique([approval?.requesterId, approval?.reviewerId]);
  }

  if (thread.targetType === WorkThreadTargetType.RISK_SIGNAL) {
    const risk = await prisma.riskSignal.findFirst({
      where: {
        id: thread.targetId,
        companyId: thread.companyId
      },
      select: {
        userId: true,
        assignedToId: true
      }
    });
    return unique([risk?.userId, risk?.assignedToId]);
  }

  if (thread.targetType === WorkThreadTargetType.USER_PROFILE) {
    const user = await prisma.user.findFirst({
      where: {
        id: thread.targetId,
        companyId: thread.companyId
      },
      select: {
        id: true
      }
    });
    return unique([user?.id]);
  }

  const managers = await prisma.user.findMany({
    where: {
      companyId: thread.companyId,
      isActive: true,
      role: {
        in: ["ADMIN", "HR"]
      }
    },
    select: {
      id: true
    }
  });
  return managers.map((manager) => manager.id);
}

async function managedUserIdSet(actor: Actor) {
  if (!canManage(actor.role)) {
    return new Set<string>();
  }
  const users = await getManagedUsers(actor);
  return new Set(users.map((user) => user.id));
}

async function canAccessThread(actor: Actor, thread: {
  companyId: string;
  targetType: WorkThreadTargetType;
  targetId: string;
  assigneeId: string | null;
  createdById: string | null;
}) {
  if (thread.companyId !== actor.companyId) {
    return false;
  }

  if (actor.role === "ADMIN" || actor.role === "HR" || thread.assigneeId === actor.id || thread.createdById === actor.id) {
    return true;
  }

  if (thread.targetType === WorkThreadTargetType.MONTH_CLOSE) {
    return canViewReports(actor.role);
  }

  const targetUserIds = await getTargetUserIds(thread);
  if (targetUserIds.includes(actor.id)) {
    return true;
  }

  if (canManage(actor.role)) {
    const managedIds = await managedUserIdSet(actor);
    return targetUserIds.some((userId) => managedIds.has(userId));
  }

  return false;
}

export async function ensureWorkThreadForApproval(approvalId: string) {
  const approval = await prisma.approvalRequest.findUnique({
    where: {
      id: approvalId
    },
    include: {
      requester: {
        include: {
          team: true
        }
      }
    }
  });

  if (!approval) {
    return null;
  }

  const recipientIds = await managerRecipientIds(approval.companyId, approval.requesterId);
  const title = `${approval.requester.name}님의 ${approvalTypeLabel(approval.type)} 요청`;
  const existing = await prisma.workThread.findUnique({
    where: {
      companyId_targetType_targetId: {
        companyId: approval.companyId,
        targetType: WorkThreadTargetType.APPROVAL_REQUEST,
        targetId: approval.id
      }
    }
  });

  if (existing) {
    return prisma.workThread.update({
      where: {
        id: existing.id
      },
      data: {
        title,
        status: approval.status === "PENDING" ? existing.status : WorkThreadStatus.RESOLVED,
        priority: approval.type === "ADJUSTMENT" ? WorkThreadPriority.HIGH : existing.priority
      }
    });
  }

  const thread = await prisma.workThread.create({
    data: {
      companyId: approval.companyId,
      targetType: WorkThreadTargetType.APPROVAL_REQUEST,
      targetId: approval.id,
      title,
      priority: approval.type === "ADJUSTMENT" ? WorkThreadPriority.HIGH : WorkThreadPriority.NORMAL,
      assigneeId: recipientIds[0] ?? null,
      createdById: approval.requesterId
    }
  });

  await prisma.workThreadReadState.create({
    data: {
      companyId: approval.companyId,
      threadId: thread.id,
      userId: approval.requesterId,
      lastReadAt: new Date()
    }
  });

  return thread;
}

export async function ensureWorkThreadForRisk(riskId: string, actorUserId?: string | null) {
  const risk = await prisma.riskSignal.findUnique({
    where: {
      id: riskId
    },
    include: {
      user: true
    }
  });

  if (!risk) {
    return null;
  }

  const existing = await prisma.workThread.findUnique({
    where: {
      companyId_targetType_targetId: {
        companyId: risk.companyId,
        targetType: WorkThreadTargetType.RISK_SIGNAL,
        targetId: risk.id
      }
    }
  });

  if (existing) {
    return prisma.workThread.update({
      where: {
        id: existing.id
      },
      data: {
        title: risk.title,
        priority: priorityFromRiskLevel(risk.level),
        assigneeId: risk.assignedToId ?? existing.assigneeId
      }
    });
  }

  return prisma.workThread.create({
    data: {
      companyId: risk.companyId,
      targetType: WorkThreadTargetType.RISK_SIGNAL,
      targetId: risk.id,
      title: risk.title,
      priority: priorityFromRiskLevel(risk.level),
      assigneeId: risk.assignedToId,
      createdById: actorUserId ?? null
    }
  });
}

export async function ensureWorkThreadForMonthClose(input: {
  companyId: string;
  month: string;
  actorUserId?: string | null;
  title?: string;
}) {
  const targetId = input.month;
  const title = input.title ?? `${input.month} 월마감 업무`;
  const existing = await prisma.workThread.findUnique({
    where: {
      companyId_targetType_targetId: {
        companyId: input.companyId,
        targetType: WorkThreadTargetType.MONTH_CLOSE,
        targetId
      }
    }
  });

  if (existing) {
    return prisma.workThread.update({
      where: {
        id: existing.id
      },
      data: {
        title
      }
    });
  }

  const recipients = await managerRecipientIds(input.companyId);
  return prisma.workThread.create({
    data: {
      companyId: input.companyId,
      targetType: WorkThreadTargetType.MONTH_CLOSE,
      targetId,
      title,
      priority: WorkThreadPriority.HIGH,
      assigneeId: recipients[0] ?? null,
      createdById: input.actorUserId ?? null
    }
  });
}

export async function ensureWorkThreadForUserProfile(input: {
  companyId: string;
  targetUserId: string;
  actorUserId?: string | null;
  assigneeId?: string | null;
}) {
  const targetUser = await prisma.user.findFirst({
    where: {
      id: input.targetUserId,
      companyId: input.companyId,
      isActive: true
    },
    include: {
      team: true
    }
  });

  if (!targetUser) {
    throw new Error("직원을 찾을 수 없습니다.");
  }

  const assigneeId = input.assigneeId?.trim() || null;
  if (assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: {
        id: assigneeId,
        companyId: input.companyId,
        isActive: true,
        role: {
          in: ["ADMIN", "HR", "MANAGER"]
        }
      }
    });
    if (!assignee) {
      throw new Error("담당자는 관리자, HR, 팀장 중에서 선택하세요.");
    }
  }

  const title = `${targetUser.name}님 프로필 메모`;
  const existing = await prisma.workThread.findUnique({
    where: {
      companyId_targetType_targetId: {
        companyId: input.companyId,
        targetType: WorkThreadTargetType.USER_PROFILE,
        targetId: targetUser.id
      }
    }
  });

  if (existing) {
    return prisma.workThread.update({
      where: {
        id: existing.id
      },
      data: {
        title,
        assigneeId: assigneeId ?? existing.assigneeId
      }
    });
  }

  return prisma.workThread.create({
    data: {
      companyId: input.companyId,
      targetType: WorkThreadTargetType.USER_PROFILE,
      targetId: targetUser.id,
      title,
      priority: WorkThreadPriority.NORMAL,
      assigneeId,
      createdById: input.actorUserId ?? null
    }
  });
}

export async function closeWorkThreadForTarget(input: {
  companyId: string;
  targetType: WorkThreadTargetType;
  targetId: string;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  const thread = await prisma.workThread.findUnique({
    where: {
      companyId_targetType_targetId: {
        companyId: input.companyId,
        targetType: input.targetType,
        targetId: input.targetId
      }
    }
  });

  if (!thread) {
    return null;
  }

  const updated = await prisma.workThread.update({
    where: {
      id: thread.id
    },
    data: {
      status: WorkThreadStatus.RESOLVED
    }
  });

  await writeAuditLog({
    companyId: input.companyId,
    actorUserId: input.actorUserId ?? null,
    action: "workbox.thread.resolved",
    targetType: "work_thread",
    targetId: thread.id,
    payload: {
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason ?? null
    }
  });

  return updated;
}

async function syncVisibleApprovalThreads(actor: Actor) {
  const requesterIds = canManage(actor.role)
    ? [...(await managedUserIdSet(actor))]
    : [actor.id];
  if (requesterIds.length === 0) {
    return;
  }

  const approvals = await prisma.approvalRequest.findMany({
    where: {
      companyId: actor.companyId,
      requesterId: {
        in: requesterIds
      },
      status: "PENDING"
    },
    select: {
      id: true
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 25
  });

  await Promise.all(approvals.map((approval) => ensureWorkThreadForApproval(approval.id)));
}

function targetTypeForFilter(filter: WorkboxFilter) {
  if (filter === "approval") {
    return WorkThreadTargetType.APPROVAL_REQUEST;
  }
  if (filter === "risk") {
    return WorkThreadTargetType.RISK_SIGNAL;
  }
  if (filter === "month-close") {
    return WorkThreadTargetType.MONTH_CLOSE;
  }
  return null;
}

async function targetSummary(thread: {
  companyId: string;
  targetType: WorkThreadTargetType;
  targetId: string;
}) {
  if (thread.targetType === WorkThreadTargetType.APPROVAL_REQUEST) {
    const approval = await prisma.approvalRequest.findFirst({
      where: {
        id: thread.targetId,
        companyId: thread.companyId
      },
      include: {
        requester: {
          include: {
            team: true
          }
        }
      }
    });
    if (!approval) {
      return "승인 요청을 찾을 수 없음";
    }
    return `${approval.requester.name} · ${approvalTypeLabel(approval.type)} · ${approval.status}`;
  }

  if (thread.targetType === WorkThreadTargetType.RISK_SIGNAL) {
    const risk = await prisma.riskSignal.findFirst({
      where: {
        id: thread.targetId,
        companyId: thread.companyId
      },
      include: {
        user: true
      }
    });
    if (!risk) {
      return "리스크 신호를 찾을 수 없음";
    }
    return `${risk.user.name} · ${risk.level} · ${risk.message}`;
  }

  if (thread.targetType === WorkThreadTargetType.USER_PROFILE) {
    const user = await prisma.user.findFirst({
      where: {
        id: thread.targetId,
        companyId: thread.companyId
      },
      include: {
        team: true
      }
    });
    if (!user) {
      return "직원 프로필을 찾을 수 없음";
    }
    return `${user.name} · ${user.team?.name ?? "소속 없음"} · ${user.jobTitle ?? user.role}`;
  }

  const monthClose = await prisma.monthClose.findUnique({
    where: {
      companyId_month: {
        companyId: thread.companyId,
        month: thread.targetId
      }
    }
  });
  return `${thread.targetId} · ${monthClose?.status ?? "OPEN"}`;
}

async function decorateThread(actor: Actor, thread: WorkThreadListRow) {
  const lastComment = thread.comments[0] ?? null;
  const readState = thread.readStates[0] ?? null;
  const lastActivityAt = thread.lastCommentAt ?? thread.updatedAt ?? thread.createdAt;
  const isUnread = !readState || readState.lastReadAt < lastActivityAt;

  return {
    id: thread.id,
    targetType: thread.targetType,
    targetId: thread.targetId,
    title: thread.title,
    status: thread.status,
    priority: thread.priority,
    assignee: thread.assignee,
    createdBy: thread.createdBy,
    lastCommentAt: thread.lastCommentAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastCommentPreview: lastComment?.body ?? null,
    isUnread,
    targetSummary: await targetSummary(thread),
    href: threadHref(thread.id),
    mine: thread.assigneeId === actor.id || thread.createdById === actor.id
  };
}

export async function markWorkThreadRead(actor: Actor, threadId: string) {
  const thread = await prisma.workThread.findUnique({
    where: {
      id: threadId
    }
  });
  if (!thread || !(await canAccessThread(actor, thread))) {
    throw new Error("업무함 항목을 찾을 수 없습니다.");
  }

  await prisma.workThreadReadState.upsert({
    where: {
      threadId_userId: {
        threadId,
        userId: actor.id
      }
    },
    update: {
      lastReadAt: new Date()
    },
    create: {
      companyId: actor.companyId,
      threadId,
      userId: actor.id,
      lastReadAt: new Date()
    }
  });
}

export async function getWorkThreadDetail(actor: Actor, threadId: string, options?: { markRead?: boolean }) {
  const thread = await prisma.workThread.findUnique({
    where: {
      id: threadId
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
          createdAt: "asc"
        }
      },
      readStates: {
        where: {
          userId: actor.id
        }
      }
    }
  });

  if (!thread || !(await canAccessThread(actor, thread))) {
    throw new Error("업무함 항목을 찾을 수 없습니다.");
  }

  if (options?.markRead !== false) {
    await markWorkThreadRead(actor, thread.id);
  }

  const decorated = await decorateThread(actor, thread);

  return {
    ...decorated,
    isUnread: options?.markRead === false ? decorated.isUnread : false,
    comments: thread.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      mentions: comment.mentions,
      createdAt: comment.createdAt,
      author: comment.author
    }))
  };
}

export async function getWorkboxDashboard(actor: Actor, input?: {
  filter?: string | null;
  threadId?: string | null;
}) {
  await syncVisibleApprovalThreads(actor);

  const filter = normalizeWorkboxFilter(input?.filter);
  const threadRows = await prisma.workThread.findMany({
    where: {
      companyId: actor.companyId
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
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      },
      readStates: {
        where: {
          userId: actor.id
        }
      }
    },
    orderBy: [{ lastCommentAt: "desc" }, { updatedAt: "desc" }],
    take: 100
  });

  const accessibleRows = [];
  for (const thread of threadRows) {
    if (await canAccessThread(actor, thread)) {
      accessibleRows.push(thread);
    }
  }

  const decorated = await Promise.all(accessibleRows.map((thread) => decorateThread(actor, thread)));
  const targetType = targetTypeForFilter(filter);
  const filtered = decorated.filter((thread) => {
    if (filter === "mine") {
      return thread.status === "OPEN" && thread.mine;
    }
    if (filter === "unread") {
      return thread.isUnread;
    }
    if (filter === "resolved") {
      return thread.status === "RESOLVED";
    }
    if (targetType) {
      return thread.status === "OPEN" && thread.targetType === targetType;
    }
    return thread.status === "OPEN";
  });

  const selectedThreadId = input?.threadId && decorated.some((thread) => thread.id === input.threadId)
    ? input.threadId
    : filtered[0]?.id ?? decorated[0]?.id ?? null;
  const selectedThread = selectedThreadId
    ? await getWorkThreadDetail(actor, selectedThreadId, { markRead: true }).catch(() => null)
    : null;
  const visibleRows = selectedThread
    ? filtered.map((thread) => (thread.id === selectedThread.id ? { ...thread, isUnread: false } : thread))
    : filtered;
  const visibleDecorated = selectedThread
    ? decorated.map((thread) => (thread.id === selectedThread.id ? { ...thread, isUnread: false } : thread))
    : decorated;

  const [assignableUsers, mentionableUsers] = await Promise.all([
    prisma.user.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true,
        role: {
          in: ["ADMIN", "HR", "MANAGER"]
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true
      },
      orderBy: [{ role: "asc" }, { name: "asc" }]
    }),
    prisma.user.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true
      },
      orderBy: [{ role: "asc" }, { name: "asc" }]
    })
  ]);

  return {
    filter,
    threads: visibleRows,
    selectedThread,
    assignableUsers,
    mentionableUsers,
    canManageThreads: canManage(actor.role),
    stats: {
      total: visibleDecorated.length,
      mine: visibleDecorated.filter((thread) => thread.status === "OPEN" && thread.mine).length,
      unread: visibleDecorated.filter((thread) => thread.isUnread).length,
      approval: visibleDecorated.filter((thread) => thread.status === "OPEN" && thread.targetType === WorkThreadTargetType.APPROVAL_REQUEST).length,
      risk: visibleDecorated.filter((thread) => thread.status === "OPEN" && thread.targetType === WorkThreadTargetType.RISK_SIGNAL).length,
      monthClose: visibleDecorated.filter((thread) => thread.status === "OPEN" && thread.targetType === WorkThreadTargetType.MONTH_CLOSE).length,
      resolved: visibleDecorated.filter((thread) => thread.status === "RESOLVED").length
    }
  };
}

async function notifyThreadUsers(input: {
  actor: Actor;
  thread: {
    id: string;
    companyId: string;
    targetType: WorkThreadTargetType;
    targetId: string;
    title: string;
    assigneeId: string | null;
    createdById: string | null;
  };
  type: "comment" | "mention" | "assigned";
  userIds: string[];
  message: string;
}) {
  const userIds = unique(input.userIds).filter((userId) => userId !== input.actor.id);
  if (userIds.length === 0) {
    return;
  }

  await createNotifications({
    companyId: input.thread.companyId,
    userIds,
    type:
      input.type === "mention"
        ? NotificationType.WORKBOX_MENTION
        : input.type === "assigned"
          ? NotificationType.WORKBOX_ASSIGNED
          : NotificationType.WORKBOX_COMMENT,
    title:
      input.type === "mention"
        ? `${input.actor.name}님이 업무함에서 나를 멘션했습니다`
        : input.type === "assigned"
          ? "업무함 담당자로 지정되었습니다"
          : `${input.thread.title}에 댓글이 추가되었습니다`,
    message: input.message,
    actionUrl: threadHref(input.thread.id),
    metadata: {
      workThreadId: input.thread.id,
      targetType: input.thread.targetType,
      targetId: input.thread.targetId
    } satisfies Prisma.JsonObject
  });
}

export async function addWorkComment(actor: Actor, input: {
  threadId: string;
  body: string;
  mentionUserIds?: string[];
}) {
  const thread = await prisma.workThread.findUnique({
    where: {
      id: input.threadId
    }
  });

  if (!thread || !(await canAccessThread(actor, thread))) {
    throw new Error("업무함 항목을 찾을 수 없습니다.");
  }

  const body = input.body.trim();
  if (body.length < 1) {
    throw new Error("댓글 내용을 입력하세요.");
  }
  if (body.length > 2000) {
    throw new Error("댓글은 2000자 이하로 입력하세요.");
  }

  const mentionUserIds = unique(input.mentionUserIds ?? []);
  const mentionUsers = mentionUserIds.length > 0
    ? await prisma.user.findMany({
        where: {
          companyId: actor.companyId,
          id: {
            in: mentionUserIds
          },
          isActive: true
        },
        select: {
          id: true
        }
      })
    : [];
  const validMentionIds = mentionUsers.map((user) => user.id);
  const now = new Date();

  const comment = await prisma.workComment.create({
    data: {
      companyId: actor.companyId,
      threadId: thread.id,
      authorId: actor.id,
      body,
      mentions: {
        userIds: validMentionIds
      } satisfies Prisma.JsonObject
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

  await prisma.workThread.update({
    where: {
      id: thread.id
    },
    data: {
      lastCommentAt: now
    }
  });

  await prisma.workThreadReadState.upsert({
    where: {
      threadId_userId: {
        threadId: thread.id,
        userId: actor.id
      }
    },
    update: {
      lastReadAt: now
    },
    create: {
      companyId: actor.companyId,
      threadId: thread.id,
      userId: actor.id,
      lastReadAt: now
    }
  });

  const targetUserIds = await getTargetUserIds(thread);
  const priorCommentAuthors = await prisma.workComment.findMany({
    where: {
      threadId: thread.id,
      deletedAt: null
    },
    select: {
      authorId: true
    },
    distinct: ["authorId"]
  });
  const participantIds = unique([
    thread.assigneeId,
    thread.createdById,
    ...targetUserIds,
    ...priorCommentAuthors.map((author) => author.authorId)
  ]);
  const message = `${actor.name}: ${body.slice(0, 120)}`;

  await notifyThreadUsers({
    actor,
    thread,
    type: "comment",
    userIds: participantIds.filter((userId) => !validMentionIds.includes(userId)),
    message
  });
  await notifyThreadUsers({
    actor,
    thread,
    type: "mention",
    userIds: validMentionIds,
    message
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "workbox.comment.created",
    targetType: "work_thread",
    targetId: thread.id,
    payload: {
      commentId: comment.id,
      mentionUserIds: validMentionIds
    }
  });

  return comment;
}

export async function updateWorkThread(actor: Actor, input: {
  threadId: string;
  assigneeId?: string | null;
  status?: WorkThreadStatus;
}) {
  if (!canManage(actor.role)) {
    throw new Error("업무함 관리 권한이 필요합니다.");
  }

  const thread = await prisma.workThread.findUnique({
    where: {
      id: input.threadId
    }
  });
  if (!thread || !(await canAccessThread(actor, thread))) {
    throw new Error("업무함 항목을 찾을 수 없습니다.");
  }

  let assigneeId: string | null | undefined = undefined;
  if (input.assigneeId !== undefined) {
    assigneeId = input.assigneeId?.trim() || null;
    if (assigneeId) {
      const assignee = await prisma.user.findFirst({
        where: {
          id: assigneeId,
          companyId: actor.companyId,
          isActive: true,
          role: {
            in: ["ADMIN", "HR", "MANAGER"]
          }
        }
      });
      if (!assignee) {
        throw new Error("담당자는 관리자, HR, 팀장 중에서 선택하세요.");
      }
    }
  }

  const updated = await prisma.workThread.update({
    where: {
      id: thread.id
    },
    data: {
      assigneeId,
      status: input.status
    }
  });

  if (assigneeId && assigneeId !== thread.assigneeId) {
    await notifyThreadUsers({
      actor,
      thread: updated,
      type: "assigned",
      userIds: [assigneeId],
      message: `${actor.name}님이 ${updated.title} 업무의 담당자로 지정했습니다.`
    });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "workbox.thread.updated",
    targetType: "work_thread",
    targetId: thread.id,
    payload: {
      assigneeId: assigneeId ?? thread.assigneeId,
      status: input.status ?? thread.status
    }
  });

  return updated;
}

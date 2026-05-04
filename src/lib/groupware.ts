import { WorkThreadTargetType, type User } from "@/generated/prisma";

import { canManage, canViewReports } from "@/lib/auth";
import { getManagedUsers } from "@/lib/manager";
import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";

type Actor = Pick<User, "id" | "companyId" | "role" | "teamId">;

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

export async function getGroupwareDashboard(actor: Actor) {
  const visibleUserIds = await visibleProfileMemoUserIds(actor);
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

  return {
    profileMemoThreads,
    memoStatsByUser,
    payrollMonths: Array.from({ length: 6 }, (_, index) => addMonths(currentMonth, -index)),
    canViewPayrollForOthers: canViewReports(actor.role)
  };
}

import { Prisma, type AuditLog, type User } from "@/generated/prisma";

import { prisma } from "@/lib/prisma";

type Actor = Pick<User, "id" | "companyId">;

export function getAuditPayloadRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function getLatestAuditSnapshot(input: {
  companyId: string;
  action: string;
  targetType: string;
  targetId: string;
}) {
  return prisma.auditLog.findFirst({
    where: {
      companyId: input.companyId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

export async function listAuditSnapshots(input: {
  companyId: string;
  actions: string[];
  targetType?: string;
  targetId?: string;
  take?: number;
}) {
  return prisma.auditLog.findMany({
    where: {
      companyId: input.companyId,
      action: {
        in: input.actions
      },
      targetType: input.targetType,
      targetId: input.targetId
    },
    include: {
      actor: true
    },
    orderBy: {
      createdAt: "desc"
    },
    take: input.take
  });
}

export async function writeAuditSnapshot(input: {
  actor: Actor;
  action: string;
  targetType: string;
  targetId: string;
  payload: Prisma.InputJsonValue;
}) {
  return prisma.auditLog.create({
    data: {
      companyId: input.actor.companyId,
      actorUserId: input.actor.id,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: input.payload
    }
  });
}

export function jsonDateString(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type AuditWithActor = AuditLog & {
  actor: {
    id: string;
    name: string;
    role: string;
  } | null;
};

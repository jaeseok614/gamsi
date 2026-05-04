import { Prisma } from "@/generated/prisma";

import { prisma } from "@/lib/prisma";

type AuditInput = {
  companyId: string;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  payload?: Prisma.InputJsonValue;
};

export async function writeAuditLog(input: AuditInput) {
  await prisma.auditLog.create({
    data: {
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: input.payload
    }
  });
}

import { randomUUID } from "node:crypto";

import type { User } from "@/generated/prisma";

import {
  clearFailedLoginAttempts,
  revokeOtherUserSessions,
  revokeUserSessionById
} from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { sendPasswordResetEmail, smtpConfigured } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from "@/lib/security";

type Actor = Pick<User, "id" | "companyId" | "role" | "email" | "name">;

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const ALLOW_LOCAL_DEBUG_RESET_TOKEN =
  process.env.NODE_ENV !== "production" || (process.env.APP_BASE_URL ?? "").includes("localhost");

type SessionListRow = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastSeenAt: Date;
  expiresAt: Date;
  createdAt: Date;
  isCurrent: boolean;
};

type PasswordResetLookupRow = {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
  email: string;
  name: string;
  companyId: string;
  companyName: string;
  isActive: boolean;
};

function trimOptionalValue(value?: string | null, maxLength = 255) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

async function invalidateActivePasswordResetTokens(userId: string) {
  const now = new Date();
  await prisma.$executeRaw`
    UPDATE "PasswordResetToken"
    SET "usedAt" = ${now}, "updatedAt" = ${now}
    WHERE "userId" = ${userId} AND "usedAt" IS NULL AND "expiresAt" > ${now}
  `;
}

async function findValidPasswordResetToken(token: string) {
  const [row] = await prisma.$queryRaw<PasswordResetLookupRow[]>`
    SELECT
      t."id",
      t."userId",
      t."expiresAt",
      t."usedAt",
      u."email",
      u."name",
      u."companyId",
      c."name" AS "companyName",
      u."isActive"
    FROM "PasswordResetToken" t
    JOIN "User" u ON u."id" = t."userId"
    JOIN "Company" c ON c."id" = u."companyId"
    WHERE t."tokenHash" = ${hashSessionToken(token)}
    LIMIT 1
  `;

  if (!row || row.usedAt || row.expiresAt <= new Date() || !row.isActive) {
    return null;
  }

  return row;
}

export async function listActiveSessions(userId: string, currentSessionId?: string | null) {
  return prisma.$queryRaw<SessionListRow[]>`
    SELECT
      "id",
      "ipAddress",
      "userAgent",
      "lastSeenAt",
      "expiresAt",
      "createdAt",
      CASE WHEN "id" = ${currentSessionId ?? ""} THEN true ELSE false END AS "isCurrent"
    FROM "AuthSession"
    WHERE "userId" = ${userId} AND "revokedAt" IS NULL AND "expiresAt" > ${new Date()}
    ORDER BY "lastSeenAt" DESC, "createdAt" DESC
  `;
}

export async function changePassword(input: {
  actor: Actor;
  currentPassword: string;
  nextPassword: string;
  currentSessionId?: string | null;
}) {
  if (input.nextPassword.length < 8) {
    throw new Error("새 비밀번호는 8자 이상이어야 합니다.");
  }

  if (input.currentPassword === input.nextPassword) {
    throw new Error("새 비밀번호를 현재 비밀번호와 다르게 설정하세요.");
  }

  const user = await prisma.user.findUnique({
    where: {
      id: input.actor.id
    },
    select: {
      passwordHash: true
    }
  });

  if (!user) {
    throw new Error("사용자를 찾을 수 없습니다.");
  }

  const verification = verifyPassword(input.currentPassword, user.passwordHash);
  if (!verification.valid) {
    throw new Error("현재 비밀번호가 올바르지 않습니다.");
  }

  await prisma.user.update({
    where: {
      id: input.actor.id
    },
    data: {
      passwordHash: hashPassword(input.nextPassword)
    }
  });

  await invalidateActivePasswordResetTokens(input.actor.id);
  await revokeOtherUserSessions(input.actor.id, input.currentSessionId ?? null);
  await clearFailedLoginAttempts(input.actor.email);

  await writeAuditLog({
    companyId: input.actor.companyId,
    actorUserId: input.actor.id,
    action: "auth.password.changed",
    targetType: "user",
    targetId: input.actor.id,
    payload: {
      revokedOtherSessions: true
    }
  });
}

export async function createPasswordResetRequest(input: {
  email: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const genericResult = {
    accepted: true,
    status: "accepted" as const,
    debugToken: null as string | null
  };

  const user = await prisma.user.findUnique({
    where: {
      email: input.email
    },
    include: {
      company: true
    }
  });

  if (!user || !user.isActive) {
    return genericResult;
  }

  await invalidateActivePasswordResetTokens(user.id);

  const token = createSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);

  await prisma.$executeRaw`
    INSERT INTO "PasswordResetToken" (
      "id",
      "userId",
      "tokenHash",
      "requestedByIp",
      "userAgent",
      "expiresAt",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${user.id},
      ${hashSessionToken(token)},
      ${trimOptionalValue(input.ipAddress, 128)},
      ${trimOptionalValue(input.userAgent, 512)},
      ${expiresAt},
      ${now},
      ${now}
    )
  `;

  if (smtpConfigured()) {
    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      companyName: user.company.name,
      resetUrl: new URL(`/reset-password/${token}`, process.env.APP_BASE_URL ?? "http://localhost:3000").toString()
    });
  }

  await writeAuditLog({
    companyId: user.companyId,
    actorUserId: user.id,
    action: "auth.password_reset.requested",
    targetType: "user",
    targetId: user.id,
    payload: {
      emailDeliveryConfigured: smtpConfigured()
    }
  });

  return {
    ...genericResult,
    debugToken: ALLOW_LOCAL_DEBUG_RESET_TOKEN ? token : null
  };
}

export async function getPasswordResetRequestMeta(token: string) {
  const row = await findValidPasswordResetToken(token);
  if (!row) {
    return null;
  }

  return {
    token,
    name: row.name,
    email: row.email,
    companyName: row.companyName
  };
}

export async function completePasswordReset(input: { token: string; nextPassword: string }) {
  if (input.nextPassword.length < 8) {
    throw new Error("비밀번호는 8자 이상이어야 합니다.");
  }

  const tokenRow = await findValidPasswordResetToken(input.token);
  if (!tokenRow) {
    throw new Error("비밀번호 재설정 링크가 만료되었거나 유효하지 않습니다.");
  }

  const now = new Date();

  await prisma.user.update({
    where: {
      id: tokenRow.userId
    },
    data: {
      passwordHash: hashPassword(input.nextPassword)
    }
  });

  await prisma.$executeRaw`
    UPDATE "PasswordResetToken"
    SET "usedAt" = ${now}, "updatedAt" = ${now}
    WHERE "id" = ${tokenRow.id}
  `;

  await revokeOtherUserSessions(tokenRow.userId, null);
  await clearFailedLoginAttempts(tokenRow.email);

  await writeAuditLog({
    companyId: tokenRow.companyId,
    actorUserId: tokenRow.userId,
    action: "auth.password_reset.completed",
    targetType: "user",
    targetId: tokenRow.userId,
    payload: {
      tokenId: tokenRow.id
    }
  });
}

export async function revokeSession(input: {
  actor: Actor;
  sessionId: string;
  currentSessionId?: string | null;
}) {
  if (input.sessionId === input.currentSessionId) {
    throw new Error("현재 사용 중인 세션은 여기서 종료할 수 없습니다. 로그아웃 버튼을 사용하세요.");
  }

  await revokeUserSessionById(input.actor.id, input.sessionId);

  await writeAuditLog({
    companyId: input.actor.companyId,
    actorUserId: input.actor.id,
    action: "auth.session.revoked",
    targetType: "auth_session",
    targetId: input.sessionId,
    payload: {
      revokedBy: input.actor.id
    }
  });
}

export async function revokeOtherSessions(input: {
  actor: Actor;
  currentSessionId?: string | null;
}) {
  await revokeOtherUserSessions(input.actor.id, input.currentSessionId ?? null);

  await writeAuditLog({
    companyId: input.actor.companyId,
    actorUserId: input.actor.id,
    action: "auth.other_sessions.revoked",
    targetType: "user",
    targetId: input.actor.id,
    payload: {
      keptSessionId: input.currentSessionId ?? null
    }
  });
}

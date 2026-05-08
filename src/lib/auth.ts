import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  hashSessionToken,
  verifySessionToken
} from "@/lib/security";

const SESSION_ACTIVITY_REFRESH_MS = 15 * 60 * 1000;
const LOGIN_WINDOW_MINUTES = 15;
const MAX_FAILED_EMAIL_ATTEMPTS = 5;
const MAX_FAILED_IP_ATTEMPTS = 20;

const authUserInclude = {
  company: true,
  team: true
} as const;

export type AuthSessionRow = {
  id: string;
  userId: string;
  tokenHash?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  isActive?: boolean;
};

type CountRow = {
  count: number;
};

function sessionExpiresAt() {
  return new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
}

function sessionCookieOptions() {
  const configuredSecure = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: configuredSecure ? configuredSecure === "true" : process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  };
}

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

function loginWindowStart() {
  return new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000);
}

async function getUserFromSessionToken(token?: string | null) {
  const session = await getAuthSessionFromToken(token);
  if (!session || session.expiresAt <= new Date()) {
    return null;
  }

  return prisma.user.findFirst({
    where: {
      id: session.userId,
      isActive: true
    },
    include: authUserInclude
  });
}

export async function getAuthSessionFromToken(token?: string | null) {
  const verifiedToken = verifySessionToken(token);
  if (!verifiedToken) {
    return null;
  }

  const [session] = await prisma.$queryRaw<AuthSessionRow[]>`
    SELECT
      s."id",
      s."userId",
      s."tokenHash",
      s."ipAddress",
      s."userAgent",
      s."lastSeenAt",
      s."expiresAt",
      s."revokedAt",
      u."isActive"
    FROM "AuthSession" s
    JOIN "User" u ON u."id" = s."userId"
    WHERE s."tokenHash" = ${hashSessionToken(verifiedToken)}
    LIMIT 1
  `;

  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.isActive) {
    return null;
  }

  if (Date.now() - session.lastSeenAt.getTime() >= SESSION_ACTIVITY_REFRESH_MS) {
    void prisma.$executeRaw`
      UPDATE "AuthSession"
      SET "lastSeenAt" = ${new Date()}, "updatedAt" = ${new Date()}
      WHERE "id" = ${session.id}
    `
      .catch(() => undefined);
  }

  return session;
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  return getUserFromSessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function getCurrentAuthSession() {
  const cookieStore = await cookies();
  return getAuthSessionFromToken(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function getRequestUser(request: NextRequest) {
  return getUserFromSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function getRequestAuthSession(request: NextRequest) {
  return getAuthSessionFromToken(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function createUserSession(input: {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const token = createSessionToken();
  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO "AuthSession" (
      "id",
      "userId",
      "tokenHash",
      "ipAddress",
      "userAgent",
      "lastSeenAt",
      "expiresAt",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${input.userId},
      ${hashSessionToken(token)},
      ${trimOptionalValue(input.ipAddress, 128)},
      ${trimOptionalValue(input.userAgent, 512)},
      ${now},
      ${sessionExpiresAt()},
      ${now},
      ${now}
    )
  `;

  return token;
}

export async function revokeSessionToken(token?: string | null) {
  const verifiedToken = verifySessionToken(token);
  if (!verifiedToken) {
    return;
  }

  const now = new Date();
  await prisma.$executeRaw`
    UPDATE "AuthSession"
    SET "revokedAt" = ${now}, "updatedAt" = ${now}
    WHERE "tokenHash" = ${hashSessionToken(verifiedToken)} AND "revokedAt" IS NULL
  `;
}

export async function revokeUserSessionById(userId: string, sessionId: string) {
  const now = new Date();
  await prisma.$executeRaw`
    UPDATE "AuthSession"
    SET "revokedAt" = ${now}, "updatedAt" = ${now}
    WHERE "id" = ${sessionId} AND "userId" = ${userId} AND "revokedAt" IS NULL
  `;
}

export async function revokeOtherUserSessions(userId: string, keepSessionId?: string | null) {
  const now = new Date();

  if (keepSessionId) {
    await prisma.$executeRaw`
      UPDATE "AuthSession"
      SET "revokedAt" = ${now}, "updatedAt" = ${now}
      WHERE "userId" = ${userId} AND "id" <> ${keepSessionId} AND "revokedAt" IS NULL
    `;
    return;
  }

  await prisma.$executeRaw`
    UPDATE "AuthSession"
    SET "revokedAt" = ${now}, "updatedAt" = ${now}
    WHERE "userId" = ${userId} AND "revokedAt" IS NULL
  `;
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0
  });
}

export function clientIpFromRequest(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(",");
    return trimOptionalValue(firstIp, 128);
  }

  return trimOptionalValue(request.headers.get("x-real-ip"), 128);
}

export async function getLoginThrottleState(input: {
  email: string;
  ipAddress?: string | null;
}) {
  const since = loginWindowStart();
  const [emailFailuresRow, ipFailuresRow] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM "AuthLoginAttempt"
      WHERE "email" = ${input.email} AND "succeeded" = false AND "createdAt" >= ${since}
    `,
    input.ipAddress
      ? prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::int AS count
          FROM "AuthLoginAttempt"
          WHERE "ipAddress" = ${input.ipAddress} AND "succeeded" = false AND "createdAt" >= ${since}
        `
      : Promise.resolve([{ count: 0 }])
  ]);
  const emailFailures = emailFailuresRow[0]?.count ?? 0;
  const ipFailures = ipFailuresRow[0]?.count ?? 0;

  return {
    windowMinutes: LOGIN_WINDOW_MINUTES,
    maxFailedEmailAttempts: MAX_FAILED_EMAIL_ATTEMPTS,
    maxFailedIpAttempts: MAX_FAILED_IP_ATTEMPTS,
    emailFailures,
    ipFailures,
    limited: emailFailures >= MAX_FAILED_EMAIL_ATTEMPTS || ipFailures >= MAX_FAILED_IP_ATTEMPTS
  };
}

export async function recordLoginAttempt(input: {
  email: string;
  ipAddress?: string | null;
  succeeded: boolean;
  reason?: string | null;
}) {
  await prisma.$executeRaw`
    INSERT INTO "AuthLoginAttempt" (
      "id",
      "email",
      "ipAddress",
      "succeeded",
      "reason",
      "createdAt"
    )
    VALUES (
      ${randomUUID()},
      ${input.email},
      ${trimOptionalValue(input.ipAddress, 128)},
      ${input.succeeded},
      ${trimOptionalValue(input.reason, 200)},
      ${new Date()}
    )
  `;
}

export async function clearFailedLoginAttempts(email: string) {
  await prisma.$executeRaw`
    DELETE FROM "AuthLoginAttempt"
    WHERE "email" = ${email} AND "succeeded" = false
  `;
}

export function canManage(role: string) {
  return role === "MANAGER" || role === "HR" || role === "ADMIN";
}

export function canViewReports(role: string) {
  return role === "HR" || role === "ADMIN";
}

export function canAdminSettings(role: string) {
  return role === "ADMIN";
}

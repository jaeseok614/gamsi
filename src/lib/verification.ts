import { createHash, randomBytes, randomUUID } from "node:crypto";

import { EventType, type User } from "@/generated/prisma";

import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

type Actor = Pick<User, "id" | "companyId" | "role">;

export type QrTokenPurpose = "CHECK_IN" | "CHECK_OUT" | "BOTH";

type WorkLocationRow = {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type QrTokenRow = {
  id: string;
  companyId: string;
  locationId: string;
  locationName: string;
  locationIsActive: boolean;
  purpose: QrTokenPurpose;
  expiresAt: Date;
  usedAt: Date | null;
  usedById: string | null;
  usedByName: string | null;
  usedByEmail: string | null;
  generatedById: string | null;
  generatedByName: string | null;
  generatedByEmail: string | null;
  createdAt: Date;
};

const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_QR_TOKEN_TTL_SECONDS = 60;

function makeQrToken(length = 16) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]).join("");
}

function hashQrToken(token: string) {
  return createHash("sha256").update(normalizeQrToken(token)).digest("hex");
}

export function normalizeQrToken(rawToken: string) {
  const trimmed = rawToken.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    const fromQuery = url.searchParams.get("clockToken") ?? url.searchParams.get("token");
    if (fromQuery) {
      return normalizeQrToken(fromQuery);
    }
  } catch {
    // Plain QR payloads are expected for short-lived workplace codes.
  }

  return trimmed
    .replace(/^WG(?:1)?:/i, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function purposeMatchesEvent(purpose: QrTokenPurpose, eventType: EventType) {
  if (purpose === "BOTH") {
    return true;
  }
  if (eventType === EventType.CHECK_IN) {
    return purpose === "CHECK_IN";
  }
  if (eventType === EventType.CHECK_OUT) {
    return purpose === "CHECK_OUT";
  }
  return false;
}

function mapTokenRow(row: QrTokenRow) {
  return {
    id: row.id,
    purpose: row.purpose,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
    location: {
      id: row.locationId,
      name: row.locationName,
      isActive: row.locationIsActive
    },
    usedBy: row.usedById
      ? {
          id: row.usedById,
          name: row.usedByName ?? "-",
          email: row.usedByEmail ?? "-"
        }
      : null,
    generatedBy: row.generatedById
      ? {
          id: row.generatedById,
          name: row.generatedByName ?? "-",
          email: row.generatedByEmail ?? "-"
        }
      : null
  };
}

export async function getFieldVerificationSummary(companyId: string) {
  const [locations, tokenRows] = await Promise.all([
    prisma.$queryRaw<WorkLocationRow[]>`
      SELECT "id", "companyId", "name", "description", "isActive", "createdAt", "updatedAt"
      FROM "WorkLocation"
      WHERE "companyId" = ${companyId}
      ORDER BY "isActive" DESC, "updatedAt" DESC
    `,
    prisma.$queryRaw<QrTokenRow[]>`
      SELECT
        t."id",
        t."companyId",
        t."locationId",
        l."name" AS "locationName",
        l."isActive" AS "locationIsActive",
        t."purpose",
        t."expiresAt",
        t."usedAt",
        t."usedById",
        used_by."name" AS "usedByName",
        used_by."email" AS "usedByEmail",
        t."generatedById",
        generated_by."name" AS "generatedByName",
        generated_by."email" AS "generatedByEmail",
        t."createdAt"
      FROM "QrClockToken" t
      JOIN "WorkLocation" l ON l."id" = t."locationId"
      LEFT JOIN "User" used_by ON used_by."id" = t."usedById"
      LEFT JOIN "User" generated_by ON generated_by."id" = t."generatedById"
      WHERE t."companyId" = ${companyId}
        AND t."createdAt" >= ${new Date(Date.now() - 24 * 60 * 60 * 1000)}
      ORDER BY t."createdAt" DESC
      LIMIT 20
    `
  ]);
  const recentTokens = tokenRows.map(mapTokenRow);
  const activeTokens = recentTokens.filter((token) => !token.usedAt && token.expiresAt > new Date()).length;
  const usedTokens = recentTokens.filter((token) => token.usedAt).length;

  return {
    locations,
    metrics: {
      totalLocations: locations.length,
      activeLocations: locations.filter((location) => location.isActive).length,
      activeTokens,
      usedTokens
    },
    recentTokens
  };
}

export async function createWorkLocation(
  actor: Actor,
  input: {
    name: string;
    description?: string | null;
  }
) {
  if (actor.role !== "ADMIN") {
    throw new Error("근무지 설정 권한이 없습니다.");
  }

  const name = input.name.trim();
  if (name.length < 2) {
    throw new Error("근무지 이름은 2자 이상 입력하세요.");
  }

  const id = randomUUID();
  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO "WorkLocation" ("id", "companyId", "name", "description", "isActive", "createdAt", "updatedAt")
    VALUES (${id}, ${actor.companyId}, ${name}, ${input.description?.trim() || null}, true, ${now}, ${now})
  `;

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "admin.work_location.created",
    targetType: "work_location",
    targetId: id,
    payload: {
      name
    }
  });

  return { id, name };
}

export async function updateWorkLocation(
  actor: Actor,
  input: {
    locationId: string;
    name: string;
    description?: string | null;
    isActive: boolean;
  }
) {
  if (actor.role !== "ADMIN") {
    throw new Error("근무지 설정 권한이 없습니다.");
  }

  const rows = await prisma.$queryRaw<WorkLocationRow[]>`
    SELECT "id", "companyId", "name", "description", "isActive", "createdAt", "updatedAt"
    FROM "WorkLocation"
    WHERE "id" = ${input.locationId} AND "companyId" = ${actor.companyId}
    LIMIT 1
  `;
  const location = rows[0];

  if (!location) {
    throw new Error("근무지를 찾을 수 없습니다.");
  }

  const name = input.name.trim();
  if (name.length < 2) {
    throw new Error("근무지 이름은 2자 이상 입력하세요.");
  }

  await prisma.$executeRaw`
    UPDATE "WorkLocation"
    SET "name" = ${name},
        "description" = ${input.description?.trim() || null},
        "isActive" = ${input.isActive},
        "updatedAt" = ${new Date()}
    WHERE "id" = ${location.id}
  `;

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "admin.work_location.updated",
    targetType: "work_location",
    targetId: location.id,
    payload: {
      name,
      isActive: input.isActive
    }
  });

  return {
    ...location,
    name,
    description: input.description?.trim() || null,
    isActive: input.isActive
  };
}

export async function issueQrClockToken(
  actor: Actor,
  input: {
    locationId: string;
    purpose?: QrTokenPurpose;
    ttlSeconds?: number;
  }
) {
  if (actor.role !== "ADMIN" && actor.role !== "HR" && actor.role !== "MANAGER") {
    throw new Error("QR 발급 권한이 없습니다.");
  }

  const rows = await prisma.$queryRaw<WorkLocationRow[]>`
    SELECT "id", "companyId", "name", "description", "isActive", "createdAt", "updatedAt"
    FROM "WorkLocation"
    WHERE "id" = ${input.locationId} AND "companyId" = ${actor.companyId} AND "isActive" = true
    LIMIT 1
  `;
  const location = rows[0];

  if (!location) {
    throw new Error("활성 근무지를 찾을 수 없습니다.");
  }

  const id = randomUUID();
  const token = makeQrToken();
  const purpose = input.purpose ?? "BOTH";
  const ttlSeconds = Math.max(30, Math.min(300, Math.round(input.ttlSeconds ?? DEFAULT_QR_TOKEN_TTL_SECONDS)));
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await prisma.$executeRaw`
    INSERT INTO "QrClockToken" (
      "id", "companyId", "locationId", "tokenHash", "purpose", "expiresAt", "generatedById", "createdAt"
    )
    VALUES (
      ${id}, ${actor.companyId}, ${location.id}, ${hashQrToken(token)}, ${purpose}::"QrTokenPurpose", ${expiresAt}, ${actor.id}, ${new Date()}
    )
  `;

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "ops.qr_clock.issued",
    targetType: "qr_clock_token",
    targetId: id,
    payload: {
      locationId: location.id,
      locationName: location.name,
      purpose,
      expiresAt: expiresAt.toISOString()
    }
  });

  return {
    id,
    token,
    payload: `WG1:${token}`,
    purpose,
    location,
    expiresAt,
    ttlSeconds
  };
}

export async function consumeQrClockToken(input: {
  companyId: string;
  actorUserId: string;
  eventType: EventType;
  token: string;
}) {
  const token = normalizeQrToken(input.token);
  if (!token) {
    throw new Error("QR 토큰을 입력하세요.");
  }

  const rows = await prisma.$queryRaw<QrTokenRow[]>`
    SELECT
      t."id",
      t."companyId",
      t."locationId",
      l."name" AS "locationName",
      l."isActive" AS "locationIsActive",
      t."purpose",
      t."expiresAt",
      t."usedAt",
      t."usedById",
      used_by."name" AS "usedByName",
      used_by."email" AS "usedByEmail",
      t."generatedById",
      generated_by."name" AS "generatedByName",
      generated_by."email" AS "generatedByEmail",
      t."createdAt"
    FROM "QrClockToken" t
    JOIN "WorkLocation" l ON l."id" = t."locationId"
    LEFT JOIN "User" used_by ON used_by."id" = t."usedById"
    LEFT JOIN "User" generated_by ON generated_by."id" = t."generatedById"
    WHERE t."tokenHash" = ${hashQrToken(token)}
    LIMIT 1
  `;
  const record = rows[0];

  if (!record || record.companyId !== input.companyId || !record.locationIsActive) {
    throw new Error("유효하지 않은 QR입니다.");
  }

  if (record.expiresAt <= new Date()) {
    throw new Error("QR 유효 시간이 지났습니다.");
  }

  if (record.usedAt) {
    throw new Error("이미 사용된 QR입니다.");
  }

  if (!purposeMatchesEvent(record.purpose, input.eventType)) {
    throw new Error("현재 출퇴근 동작에 사용할 수 없는 QR입니다.");
  }

  const consumed = await prisma.$executeRaw`
    UPDATE "QrClockToken"
    SET "usedAt" = ${new Date()},
        "usedById" = ${input.actorUserId}
    WHERE "id" = ${record.id} AND "usedAt" IS NULL
  `;

  if (consumed !== 1) {
    throw new Error("이미 사용된 QR입니다.");
  }

  return {
    verificationMethod: "qr",
    tokenId: record.id,
    locationId: record.locationId,
    locationName: record.locationName,
    verifiedAt: new Date().toISOString()
  };
}

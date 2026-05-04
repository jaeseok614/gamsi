import { prisma } from "@/lib/prisma";
import { getAuditPayloadRecord } from "@/lib/settings-store";

type FlatRecord = Record<string, string>;

function flattenRecord(input: unknown, prefix = "", depth = 0): FlatRecord {
  if (!input || typeof input !== "object" || Array.isArray(input) || depth > 2) {
    return {};
  }

  const record = input as Record<string, unknown>;
  return Object.entries(record).reduce<FlatRecord>((acc, [key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return {
        ...acc,
        ...flattenRecord(value, nextKey, depth + 1)
      };
    }

    acc[nextKey] =
      value === null
        ? "null"
        : Array.isArray(value)
          ? `${value.length} items`
          : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : typeof value === "undefined"
              ? "-"
              : JSON.stringify(value);
    return acc;
  }, {});
}

function summarizeDiff(currentPayload: unknown, previousPayload: unknown) {
  const currentFlat = flattenRecord(getAuditPayloadRecord(currentPayload));
  const previousFlat = flattenRecord(getAuditPayloadRecord(previousPayload));
  const keys = [...new Set([...Object.keys(previousFlat), ...Object.keys(currentFlat)])];
  const changes = keys
    .filter((key) => previousFlat[key] !== currentFlat[key])
    .slice(0, 6)
    .map((key) => ({
      key,
      previous: previousFlat[key] ?? "-",
      current: currentFlat[key] ?? "-"
    }));

  return {
    changes,
    summary:
      changes.length === 0
        ? "payload diff 없음"
        : changes.map((change) => `${change.key}: ${change.previous} -> ${change.current}`).join(" · ")
  };
}

export async function getAuditTrailEntries(companyId: string, take = 20) {
  const logs = await prisma.auditLog.findMany({
    where: {
      companyId
    },
    include: {
      actor: {
        select: {
          name: true,
          email: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take
  });

  const previousLogs = await Promise.all(
    logs.map((log) =>
      prisma.auditLog.findFirst({
        where: {
          companyId,
          targetType: log.targetType,
          targetId: log.targetId,
          createdAt: {
            lt: log.createdAt
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        select: {
          payload: true
        }
      })
    )
  );

  return logs.map((log, index) => {
    const diff = summarizeDiff(log.payload, previousLogs[index]?.payload ?? null);
    return {
      id: log.id,
      createdAt: log.createdAt,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      actor: log.actor,
      payload: log.payload,
      diff
    };
  });
}

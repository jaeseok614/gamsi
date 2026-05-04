import { EventType, Prisma, SessionStatus, WorkStatus } from "@/generated/prisma";

import { writeAuditLog } from "@/lib/audit";
import { assertDateMonthOpen } from "@/lib/month-close";
import { prisma } from "@/lib/prisma";
import { dateOnly, getKstDateString, kstDayBounds, minutesBetween } from "@/lib/time";

const NON_WORK_STATUSES = new Set<WorkStatus>([WorkStatus.BREAK]);

export type AttendanceSnapshot = Awaited<ReturnType<typeof getAttendanceSnapshot>>;

async function getPolicy(companyId: string) {
  return prisma.workPolicy.findFirst({
    where: {
      companyId
    },
    orderBy: {
      updatedAt: "desc"
    }
  });
}

function effectiveEventsForDate<T extends { occurredAt: Date }>(events: T[], dateString: string) {
  if (dateString !== getKstDateString()) {
    return events;
  }

  const now = new Date();
  return events.filter((event) => event.occurredAt <= now);
}

function sumStatusMinutes(
  events: Array<{ eventType: EventType; status: WorkStatus | null; occurredAt: Date }>,
  checkInAt: Date,
  endAt: Date,
  targetStatuses: Set<WorkStatus>
) {
  let activeStatus: WorkStatus = WorkStatus.WORKING;
  let cursor = checkInAt;
  let total = 0;

  for (const event of events) {
    if (event.occurredAt < checkInAt || event.occurredAt > endAt) {
      continue;
    }

    if (targetStatuses.has(activeStatus)) {
      total += minutesBetween(cursor, event.occurredAt);
    }

    if (event.eventType === EventType.STATUS_CHANGE && event.status) {
      activeStatus = event.status;
    }

    if (event.eventType === EventType.CHECK_OUT) {
      activeStatus = WorkStatus.OFFLINE;
    }

    cursor = event.occurredAt;
  }

  if (targetStatuses.has(activeStatus)) {
    total += minutesBetween(cursor, endAt);
  }

  return total;
}

export async function recalculateSession(userId: string, dateString = getKstDateString()) {
  const user = await prisma.user.findUniqueOrThrow({
    where: {
      id: userId
    },
    select: {
      companyId: true
    }
  });

  const { start, end } = kstDayBounds(dateString);
  const events = await prisma.attendanceEvent.findMany({
    where: {
      userId,
      occurredAt: {
        gte: start,
        lt: end
      }
    },
    orderBy: {
      occurredAt: "asc"
    }
  });
  const effectiveEvents = effectiveEventsForDate(events, dateString);

  const checkInAt = effectiveEvents.find((event) => event.eventType === EventType.CHECK_IN)?.occurredAt ?? null;
  const checkOutAt =
    [...effectiveEvents].reverse().find((event) => event.eventType === EventType.CHECK_OUT)?.occurredAt ?? null;

  if (!checkInAt) {
    return null;
  }

  const endAt = checkOutAt ?? new Date();
  const grossMinutes = minutesBetween(checkInAt, endAt);
  const breakMinutes = sumStatusMinutes(effectiveEvents, checkInAt, endAt, NON_WORK_STATUSES);
  const calculatedWorkMinutes = Math.max(0, grossMinutes - breakMinutes);
  const policy = await getPolicy(user.companyId);
  const threshold = policy?.overtimeThresholdMinutes ?? 8 * 60;
  const overtimeMinutes = Math.max(0, calculatedWorkMinutes - threshold);
  const status =
    checkOutAt && checkOutAt < checkInAt
      ? SessionStatus.NEEDS_REVIEW
      : checkOutAt
        ? SessionStatus.CLOSED
        : SessionStatus.OPEN;

  return prisma.workSession.upsert({
    where: {
      userId_workDate: {
        userId,
        workDate: dateOnly(dateString)
      }
    },
    create: {
      companyId: user.companyId,
      userId,
      workDate: dateOnly(dateString),
      checkInAt,
      checkOutAt,
      grossMinutes,
      breakMinutes,
      calculatedWorkMinutes,
      overtimeMinutes,
      status
    },
    update: {
      checkInAt,
      checkOutAt,
      grossMinutes,
      breakMinutes,
      calculatedWorkMinutes,
      overtimeMinutes,
      status
    }
  });
}

export async function getAttendanceSnapshot(userId: string, dateString = getKstDateString()) {
  await recalculateSession(userId, dateString);

  const { start, end } = kstDayBounds(dateString);
  const events = await prisma.attendanceEvent.findMany({
    where: {
      userId,
      occurredAt: {
        gte: start,
        lt: end
      }
    },
    orderBy: {
      occurredAt: "asc"
    }
  });
  const effectiveEvents = effectiveEventsForDate(events, dateString);

  const session = await prisma.workSession.findUnique({
    where: {
      userId_workDate: {
        userId,
        workDate: dateOnly(dateString)
      }
    }
  });

  const latestEvent = [...effectiveEvents].reverse().find(Boolean);
  const latestStatus =
    latestEvent?.eventType === EventType.CHECK_OUT
      ? WorkStatus.OFFLINE
      : latestEvent?.status ?? (session?.checkInAt ? WorkStatus.WORKING : WorkStatus.OFFLINE);

  const pendingApprovals = await prisma.approvalRequest.findMany({
    where: {
      requesterId: userId,
      status: "PENDING"
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return {
    dateString,
    latestStatus,
    session,
    events: effectiveEvents,
    pendingApprovals
  };
}

export async function createAttendanceEvent(input: {
  actorUserId: string;
  companyId: string;
  eventType: EventType;
  status?: WorkStatus;
  reason?: string;
  source?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const dateString = getKstDateString();
  await assertDateMonthOpen(input.companyId, dateString, "마감이 확정된 월은 출퇴근 기록을 수정할 수 없습니다.");
  const snapshot = await getAttendanceSnapshot(input.actorUserId, dateString);

  if (input.eventType === EventType.CHECK_IN && snapshot.session?.checkInAt) {
    throw new Error("이미 오늘 출근 기록이 있습니다.");
  }

  if (input.eventType === EventType.CHECK_OUT && !snapshot.session?.checkInAt) {
    throw new Error("출근 기록이 없습니다.");
  }

  if (input.eventType === EventType.CHECK_OUT && snapshot.session?.checkOutAt) {
    throw new Error("이미 오늘 퇴근 기록이 있습니다.");
  }

  if (input.eventType === EventType.STATUS_CHANGE && !snapshot.session?.checkInAt) {
    throw new Error("출근 후 상태를 변경할 수 있습니다.");
  }

  if (input.eventType === EventType.STATUS_CHANGE && snapshot.session?.checkOutAt) {
    throw new Error("퇴근 후 상태를 변경할 수 없습니다.");
  }

  const event = await prisma.attendanceEvent.create({
    data: {
      companyId: input.companyId,
      userId: input.actorUserId,
      eventType: input.eventType,
      status: input.status,
      occurredAt: new Date(),
      source: input.source ?? "web",
      reason: input.reason,
      metadata: input.metadata
    }
  });

  const session = await recalculateSession(input.actorUserId, dateString);

  await writeAuditLog({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    action: `attendance.${input.eventType.toLowerCase()}`,
    targetType: "attendance_event",
    targetId: event.id,
    payload: {
      status: input.status,
      reason: input.reason,
      source: input.source ?? "web",
      metadata: input.metadata ?? null,
      sessionId: session?.id
    } as Prisma.JsonObject
  });

  return event;
}

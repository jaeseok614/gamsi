import { randomUUID } from "node:crypto";

import { RiskType, type User } from "@/generated/prisma";

import { writeAuditLog } from "@/lib/audit";
import { getAuditPayloadRecord, listAuditSnapshots, writeAuditSnapshot } from "@/lib/settings-store";
import { assertMonthOpen } from "@/lib/month-close";
import { notifyScheduleUpdated } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { refreshRiskSignalsForUserIds, resolveRiskSignalsForAction } from "@/lib/risks";
import { dateOnly, kstDateTimeFromTimeString } from "@/lib/time";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const TEMPLATE_ACTIONS = ["schedule.template.saved", "schedule.template.archived"] as const;

export type ScheduleOperationMode =
  | "single"
  | "range"
  | "copy_week"
  | "bulk_update"
  | "bulk_delete"
  | "board_apply"
  | "board_clear";

export type ScheduleOperationBody = {
  mode?: ScheduleOperationMode;
  userId?: string;
  workDate?: string;
  userIds?: string[];
  entries?: Array<{
    userId?: string;
    workDate?: string;
  }>;
  startDate?: string;
  endDate?: string;
  weekdays?: number[];
  startTime?: string;
  endTime?: string;
  breakMinutes?: number;
  shiftName?: string;
  note?: string;
  sourceWeekStart?: string;
  targetWeekStart?: string;
};

export type ScheduleTemplate = {
  id: string;
  name: string;
  mode: Extract<ScheduleOperationMode, "single" | "range" | "copy_week" | "bulk_update" | "bulk_delete">;
  teamId: string | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  shiftName: string;
  note: string;
  weekdays: number[];
  createdAt: Date;
  updatedAt: Date;
  actorName: string | null;
};

type Actor = Pick<User, "id" | "companyId" | "role" | "name">;

type ScheduleChange = {
  userId: string;
  workDate: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  breakMinutes: number;
  shiftName: string;
  note?: string;
  resolutionLabelBase: string;
};

type ExistingScheduleRow = {
  id: string;
  userId: string;
  workDate: Date;
  shiftName: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  breakMinutes: number;
  note: string | null;
};

type SchedulePreviewRow = {
  action: "create" | "update" | "delete";
  userId: string;
  workDate: string;
  shiftName: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  breakMinutes?: number;
  note?: string | null;
  previous?: {
    shiftName: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    breakMinutes: number;
    note?: string | null;
  };
};

export type ScheduleOperationPreview = {
  mode: ScheduleOperationMode;
  total: number;
  userCount: number;
  createCount: number;
  updateCount: number;
  deleteCount: number;
  overwriteCount: number;
  fromDate: string;
  toDate: string;
  requiresConfirmation: boolean;
  summaryLine: string;
  rows: SchedulePreviewRow[];
};

type ScheduleOperationPlan = {
  mode: ScheduleOperationMode;
  changes: ScheduleChange[];
  existingMap: Map<string, ExistingScheduleRow>;
  deleteTargets: ExistingScheduleRow[];
  preview: ScheduleOperationPreview;
  affectedUserIds: string[];
  affectedDates: string[];
};

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)).map((value) => value.trim()))];
}

function uniqueScheduleEntries(entries: ScheduleOperationBody["entries"]) {
  const seen = new Set<string>();
  return (entries ?? []).reduce<Array<{ userId: string; workDate: string }>>((acc, entry) => {
    const userId = entry?.userId?.trim();
    const workDate = entry?.workDate?.trim();
    if (!userId || !workDate || !isDateString(workDate)) {
      return acc;
    }

    const key = scheduleKey(userId, workDate);
    if (seen.has(key)) {
      return acc;
    }

    seen.add(key);
    acc.push({
      userId,
      workDate
    });
    return acc;
  }, []);
}

function isDateString(value?: string | null) {
  return Boolean(value && DATE_PATTERN.test(value));
}

function shiftDateString(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function enumerateDateRange(startDate: string, endDate: string) {
  const start = dateOnly(startDate).getTime();
  const end = dateOnly(endDate).getTime();
  const dates: string[] = [];

  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }

  return dates;
}

function weekdayNumber(dateString: string) {
  return new Date(`${dateString}T12:00:00.000Z`).getUTCDay();
}

function scheduleKey(userId: string, workDate: string) {
  return `${userId}:${workDate}`;
}

function buildTimedSchedule(dateString: string, startTime: string, endTime: string) {
  const scheduledStartAt = kstDateTimeFromTimeString(dateString, startTime);
  const scheduledEndAt = kstDateTimeFromTimeString(dateString, endTime);
  if (!scheduledStartAt || !scheduledEndAt || scheduledEndAt <= scheduledStartAt) {
    throw new Error("근무 시작과 종료 시간을 올바르게 입력하세요.");
  }

  return {
    scheduledStartAt,
    scheduledEndAt
  };
}

function toKstTimeValue(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(value);
}

function parseBreakMinutes(value?: number) {
  return Math.max(0, Math.min(180, Math.round(value ?? 60)));
}

async function assertMonthsOpen(companyId: string, dates: string[]) {
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))];
  for (const month of months) {
    await assertMonthOpen(companyId, month, "마감이 확정된 월은 스케줄을 수정할 수 없습니다.");
  }
}

function previewLine(input: ScheduleOperationPreview) {
  const parts = [`총 ${input.total}건`, `직원 ${input.userCount}명`];
  if (input.createCount > 0) {
    parts.push(`신규 ${input.createCount}건`);
  }
  if (input.updateCount > 0) {
    parts.push(`수정 ${input.updateCount}건`);
  }
  if (input.deleteCount > 0) {
    parts.push(`삭제 ${input.deleteCount}건`);
  }
  if (input.overwriteCount > 0) {
    parts.push(`덮어쓰기 ${input.overwriteCount}건`);
  }
  parts.push(`${input.fromDate} ~ ${input.toDate}`);
  return parts.join(" · ");
}

function previewFromChanges(input: {
  mode: ScheduleOperationMode;
  changes: ScheduleChange[];
  existingMap: Map<string, ExistingScheduleRow>;
}) {
  const rows = input.changes.map<SchedulePreviewRow>((change) => {
    const existing = input.existingMap.get(scheduleKey(change.userId, change.workDate));
    return {
      action: existing ? "update" : "create",
      userId: change.userId,
      workDate: change.workDate,
      shiftName: change.shiftName,
      scheduledStartAt: change.scheduledStartAt.toISOString(),
      scheduledEndAt: change.scheduledEndAt.toISOString(),
      breakMinutes: change.breakMinutes,
      note: change.note ?? null,
      previous: existing
        ? {
            shiftName: existing.shiftName,
            scheduledStartAt: existing.scheduledStartAt.toISOString(),
            scheduledEndAt: existing.scheduledEndAt.toISOString(),
            breakMinutes: existing.breakMinutes,
            note: existing.note
          }
        : undefined
    };
  });

  const uniqueUsers = uniqueStrings(rows.map((row) => row.userId));
  const uniqueDates = [...new Set(rows.map((row) => row.workDate))].sort();
  const createCount = rows.filter((row) => row.action === "create").length;
  const updateCount = rows.length - createCount;

  const preview: ScheduleOperationPreview = {
    mode: input.mode,
    total: rows.length,
    userCount: uniqueUsers.length,
    createCount,
    updateCount,
    deleteCount: 0,
    overwriteCount: updateCount,
    fromDate: uniqueDates[0] ?? "",
    toDate: uniqueDates[uniqueDates.length - 1] ?? "",
    requiresConfirmation: updateCount > 0,
    summaryLine: "",
    rows: rows.slice(0, 12)
  };
  preview.summaryLine = previewLine(preview);
  return preview;
}

function previewFromDeletes(mode: ScheduleOperationMode, schedules: ExistingScheduleRow[]) {
  const rows = schedules.map<SchedulePreviewRow>((schedule) => ({
    action: "delete",
    userId: schedule.userId,
    workDate: schedule.workDate.toISOString().slice(0, 10),
    shiftName: schedule.shiftName,
    scheduledStartAt: schedule.scheduledStartAt.toISOString(),
    scheduledEndAt: schedule.scheduledEndAt.toISOString(),
    breakMinutes: schedule.breakMinutes,
    note: schedule.note
  }));

  const uniqueUsers = uniqueStrings(rows.map((row) => row.userId));
  const uniqueDates = [...new Set(rows.map((row) => row.workDate))].sort();
  const preview: ScheduleOperationPreview = {
    mode,
    total: rows.length,
    userCount: uniqueUsers.length,
    createCount: 0,
    updateCount: 0,
    deleteCount: rows.length,
    overwriteCount: 0,
    fromDate: uniqueDates[0] ?? "",
    toDate: uniqueDates[uniqueDates.length - 1] ?? "",
    requiresConfirmation: rows.length > 0,
    summaryLine: "",
    rows: rows.slice(0, 12)
  };
  preview.summaryLine = previewLine(preview);
  return preview;
}

async function buildScheduleChanges(input: {
  companyId: string;
  mode: ScheduleOperationMode;
  body: ScheduleOperationBody;
  managedUserIds: Set<string>;
}) {
  if (input.mode === "board_apply") {
    const entries = uniqueScheduleEntries(input.body.entries);
    if (entries.length === 0) {
      throw new Error("보드에서 적용할 셀을 한 개 이상 선택하세요.");
    }
    if (entries.some((entry) => !input.managedUserIds.has(entry.userId))) {
      throw new Error("관리 가능한 직원만 스케줄을 수정할 수 있습니다.");
    }

    const breakMinutes = parseBreakMinutes(input.body.breakMinutes);
    const shiftName = input.body.shiftName?.trim() || "기본 근무";
    const note = input.body.note?.trim() || undefined;
    return entries.map((entry) => {
      const timed = buildTimedSchedule(entry.workDate, input.body.startTime ?? "", input.body.endTime ?? "");
      return {
        userId: entry.userId,
        workDate: entry.workDate,
        scheduledStartAt: timed.scheduledStartAt,
        scheduledEndAt: timed.scheduledEndAt,
        breakMinutes,
        shiftName,
        note,
        resolutionLabelBase: "보드 스케줄"
      };
    }) satisfies ScheduleChange[];
  }

  if (input.mode === "single") {
    const userId = input.body.userId?.trim();
    const workDate = input.body.workDate?.trim();
    if (!userId || !workDate || !isDateString(workDate)) {
      throw new Error("스케줄 대상자와 날짜를 확인하세요.");
    }
    if (!input.managedUserIds.has(userId)) {
      throw new Error("관리 가능한 직원만 스케줄을 등록할 수 있습니다.");
    }

    const timed = buildTimedSchedule(workDate, input.body.startTime ?? "", input.body.endTime ?? "");
    return [
      {
        userId,
        workDate,
        scheduledStartAt: timed.scheduledStartAt,
        scheduledEndAt: timed.scheduledEndAt,
        breakMinutes: parseBreakMinutes(input.body.breakMinutes),
        shiftName: input.body.shiftName?.trim() || "기본 근무",
        note: input.body.note?.trim() || undefined,
        resolutionLabelBase: "스케줄"
      }
    ] satisfies ScheduleChange[];
  }

  const userIds = uniqueStrings(input.body.userIds ?? []);
  if (userIds.length === 0) {
    throw new Error("적어도 한 명 이상의 직원을 선택하세요.");
  }
  if (userIds.some((userId) => !input.managedUserIds.has(userId))) {
    throw new Error("관리 가능한 직원만 스케줄을 등록할 수 있습니다.");
  }

  if (input.mode === "range") {
    const startDate = input.body.startDate?.trim();
    const endDate = input.body.endDate?.trim();
    if (!startDate || !endDate || !isDateString(startDate) || !isDateString(endDate)) {
      throw new Error("반복 스케줄 시작일과 종료일을 확인하세요.");
    }
    if (dateOnly(endDate) < dateOnly(startDate)) {
      throw new Error("반복 종료일은 시작일보다 빠를 수 없습니다.");
    }

    const weekdays = (input.body.weekdays ?? []).filter(
      (value): value is number => Number.isInteger(value) && value >= 0 && value <= 6
    );
    if (weekdays.length === 0) {
      throw new Error("반복할 요일을 한 개 이상 선택하세요.");
    }

    const breakMinutes = parseBreakMinutes(input.body.breakMinutes);
    const shiftName = input.body.shiftName?.trim() || "기본 근무";
    const note = input.body.note?.trim() || undefined;
    const matchingDates = enumerateDateRange(startDate, endDate).filter((date) => weekdays.includes(weekdayNumber(date)));
    if (matchingDates.length === 0) {
      throw new Error("선택한 기간 안에 해당 요일이 없습니다.");
    }

    return userIds.flatMap((userId) =>
      matchingDates.map((workDate) => {
        const nextTimed = buildTimedSchedule(workDate, input.body.startTime ?? "", input.body.endTime ?? "");
        return {
          userId,
          workDate,
          scheduledStartAt: nextTimed.scheduledStartAt,
          scheduledEndAt: nextTimed.scheduledEndAt,
          breakMinutes,
          shiftName,
          note,
          resolutionLabelBase: "반복 스케줄"
        };
      })
    );
  }

  if (input.mode === "copy_week") {
    const sourceWeekStart = input.body.sourceWeekStart?.trim();
    const targetWeekStart = input.body.targetWeekStart?.trim();
    if (!sourceWeekStart || !targetWeekStart || !isDateString(sourceWeekStart) || !isDateString(targetWeekStart)) {
      throw new Error("복사할 주 시작일과 붙여넣을 주 시작일을 확인하세요.");
    }

    const sourceSchedules = await prisma.workSchedule.findMany({
      where: {
        companyId: input.companyId,
        userId: {
          in: userIds
        },
        workDate: {
          gte: dateOnly(sourceWeekStart),
          lt: dateOnly(shiftDateString(sourceWeekStart, 7))
        }
      },
      orderBy: [{ userId: "asc" }, { workDate: "asc" }]
    });

    if (sourceSchedules.length === 0) {
      throw new Error("복사할 원본 주간 스케줄이 없습니다.");
    }

    return sourceSchedules.map((schedule) => {
      const offsetDays = Math.round((schedule.workDate.getTime() - dateOnly(sourceWeekStart).getTime()) / DAY_MS);
      const workDate = shiftDateString(targetWeekStart, offsetDays);
      const timed = buildTimedSchedule(
        workDate,
        toKstTimeValue(schedule.scheduledStartAt),
        toKstTimeValue(schedule.scheduledEndAt)
      );

      return {
        userId: schedule.userId,
        workDate,
        scheduledStartAt: timed.scheduledStartAt,
        scheduledEndAt: timed.scheduledEndAt,
        breakMinutes: schedule.breakMinutes,
        shiftName: schedule.shiftName,
        note: schedule.note ?? undefined,
        resolutionLabelBase: "주간 스케줄"
      };
    });
  }

  throw new Error("미지원 스케줄 등록 모드입니다.");
}

async function listTargetSchedules(input: {
  companyId: string;
  managedUserIds: Set<string>;
  body: ScheduleOperationBody;
}) {
  const explicitEntries = uniqueScheduleEntries(input.body.entries);
  if (explicitEntries.length > 0) {
    if (explicitEntries.some((entry) => !input.managedUserIds.has(entry.userId))) {
      throw new Error("관리 가능한 직원만 선택하세요.");
    }

    const schedules = await prisma.workSchedule.findMany({
      where: {
        companyId: input.companyId,
        OR: explicitEntries.map((entry) => ({
          userId: entry.userId,
          workDate: dateOnly(entry.workDate)
        }))
      },
      orderBy: [{ workDate: "asc" }, { userId: "asc" }]
    });

    if (schedules.length === 0) {
      throw new Error("선택한 셀에 기존 스케줄이 없습니다.");
    }

    return schedules;
  }

  const userIds = uniqueStrings(input.body.userIds ?? []);
  if (userIds.length === 0) {
    throw new Error("적어도 한 명 이상의 직원을 선택하세요.");
  }
  if (userIds.some((userId) => !input.managedUserIds.has(userId))) {
    throw new Error("관리 가능한 직원만 선택하세요.");
  }

  const startDate = input.body.startDate?.trim();
  const endDate = input.body.endDate?.trim();
  if (!startDate || !endDate || !isDateString(startDate) || !isDateString(endDate)) {
    throw new Error("시작일과 종료일을 확인하세요.");
  }
  if (dateOnly(endDate) < dateOnly(startDate)) {
    throw new Error("종료일은 시작일보다 빠를 수 없습니다.");
  }

  const weekdays = (input.body.weekdays ?? []).filter(
    (value): value is number => Number.isInteger(value) && value >= 0 && value <= 6
  );

  const schedules = await prisma.workSchedule.findMany({
    where: {
      companyId: input.companyId,
      userId: {
        in: userIds
      },
      workDate: {
        gte: dateOnly(startDate),
        lte: dateOnly(endDate)
      }
    },
    orderBy: [{ workDate: "asc" }, { userId: "asc" }]
  });

  const filtered = weekdays.length
    ? schedules.filter((schedule) => weekdays.includes(weekdayNumber(schedule.workDate.toISOString().slice(0, 10))))
    : schedules;

  if (filtered.length === 0) {
    throw new Error("선택한 조건에 맞는 기존 스케줄이 없습니다.");
  }

  return filtered;
}

export async function buildScheduleOperationPlan(input: {
  companyId: string;
  mode: ScheduleOperationMode;
  body: ScheduleOperationBody;
  managedUserIds: Set<string>;
}) {
  if (input.mode === "bulk_delete" || input.mode === "board_clear") {
    const deleteTargets = await listTargetSchedules({
      companyId: input.companyId,
      managedUserIds: input.managedUserIds,
      body: input.body
    });

    const preview = previewFromDeletes(input.mode, deleteTargets);
    return {
      mode: input.mode,
      changes: [],
      existingMap: new Map<string, ExistingScheduleRow>(),
      deleteTargets,
      preview,
      affectedUserIds: uniqueStrings(deleteTargets.map((schedule) => schedule.userId)),
      affectedDates: deleteTargets.map((schedule) => schedule.workDate.toISOString().slice(0, 10))
    } satisfies ScheduleOperationPlan;
  }

  if (input.mode === "bulk_update") {
    const targets = await listTargetSchedules({
      companyId: input.companyId,
      managedUserIds: input.managedUserIds,
      body: input.body
    });

    const nextShiftName = input.body.shiftName?.trim();
    const nextNote = input.body.note?.trim();
    const nextBreakMinutes = parseBreakMinutes(input.body.breakMinutes);
    const hasNextTime = Boolean(input.body.startTime?.trim() && input.body.endTime?.trim());

    const changes = targets.map((schedule) => {
      const workDate = schedule.workDate.toISOString().slice(0, 10);
      const timed = hasNextTime
        ? buildTimedSchedule(workDate, input.body.startTime ?? "", input.body.endTime ?? "")
        : {
            scheduledStartAt: schedule.scheduledStartAt,
            scheduledEndAt: schedule.scheduledEndAt
          };

      return {
        userId: schedule.userId,
        workDate,
        scheduledStartAt: timed.scheduledStartAt,
        scheduledEndAt: timed.scheduledEndAt,
        breakMinutes: input.body.breakMinutes === undefined ? schedule.breakMinutes : nextBreakMinutes,
        shiftName: nextShiftName || schedule.shiftName,
        note: input.body.note === undefined ? schedule.note ?? undefined : nextNote || undefined,
        resolutionLabelBase: "일괄 스케줄"
      };
    });

    const existingMap = new Map(
      targets.map((schedule) => [scheduleKey(schedule.userId, schedule.workDate.toISOString().slice(0, 10)), schedule])
    );
    const preview = previewFromChanges({
      mode: input.mode,
      changes,
      existingMap
    });

    return {
      mode: input.mode,
      changes,
      existingMap,
      deleteTargets: [],
      preview,
      affectedUserIds: uniqueStrings(changes.map((change) => change.userId)),
      affectedDates: changes.map((change) => change.workDate)
    } satisfies ScheduleOperationPlan;
  }

  const changes = await buildScheduleChanges(input);
  if (changes.length === 0) {
    throw new Error("저장할 스케줄이 없습니다.");
  }

  const uniqueUsers = uniqueStrings(changes.map((change) => change.userId));
  const uniqueDates = [...new Set(changes.map((change) => change.workDate))];
  const existingSchedules = await prisma.workSchedule.findMany({
    where: {
      companyId: input.companyId,
      userId: {
        in: uniqueUsers
      },
      workDate: {
        in: uniqueDates.map((date) => dateOnly(date))
      }
    }
  });
  const existingMap = new Map(
    existingSchedules.map((schedule) => [
      scheduleKey(schedule.userId, schedule.workDate.toISOString().slice(0, 10)),
      schedule
    ])
  );

  const preview = previewFromChanges({
    mode: input.mode,
    changes,
    existingMap
  });

  return {
    mode: input.mode,
    changes,
    existingMap,
    deleteTargets: [],
    preview,
    affectedUserIds: uniqueUsers,
    affectedDates: uniqueDates
  } satisfies ScheduleOperationPlan;
}

export async function applyScheduleOperation(input: {
  actor: Actor;
  plan: ScheduleOperationPlan;
}) {
  if (input.plan.deleteTargets.length > 0) {
    await assertMonthsOpen(input.actor.companyId, input.plan.affectedDates);
    const deleteIds = input.plan.deleteTargets.map((schedule) => schedule.id);

    await prisma.workSchedule.deleteMany({
      where: {
        companyId: input.actor.companyId,
        id: {
          in: deleteIds
        }
      }
    });

    await Promise.all(
      input.plan.deleteTargets.map((schedule) =>
        writeAuditLog({
          companyId: input.actor.companyId,
          actorUserId: input.actor.id,
          action: "schedule.deleted",
          targetType: "work_schedule",
          targetId: schedule.id,
          payload: {
            mode: input.plan.mode,
            userId: schedule.userId,
            workDate: schedule.workDate.toISOString().slice(0, 10),
            shiftName: schedule.shiftName
          }
        })
      )
    );

    await refreshRiskSignalsForUserIds({
      companyId: input.actor.companyId,
      userIds: input.plan.affectedUserIds,
      actorUserId: input.actor.id,
      writeAudit: true
    });

    return {
      mode: input.plan.mode,
      total: input.plan.deleteTargets.length,
      created: 0,
      updated: 0,
      deleted: input.plan.deleteTargets.length,
      overwritten: 0,
      summary: input.plan.preview
    };
  }

  await assertMonthsOpen(input.actor.companyId, input.plan.affectedDates);

  const schedules = await prisma.$transaction(
    input.plan.changes.map((change) =>
      prisma.workSchedule.upsert({
        where: {
          userId_workDate: {
            userId: change.userId,
            workDate: dateOnly(change.workDate)
          }
        },
        create: {
          companyId: input.actor.companyId,
          userId: change.userId,
          workDate: dateOnly(change.workDate),
          shiftName: change.shiftName,
          scheduledStartAt: change.scheduledStartAt,
          scheduledEndAt: change.scheduledEndAt,
          breakMinutes: change.breakMinutes,
          note: change.note
        },
        update: {
          shiftName: change.shiftName,
          scheduledStartAt: change.scheduledStartAt,
          scheduledEndAt: change.scheduledEndAt,
          breakMinutes: change.breakMinutes,
          note: change.note
        }
      })
    )
  );

  await Promise.all(
    schedules.map((schedule, index) =>
      writeAuditLog({
        companyId: input.actor.companyId,
        actorUserId: input.actor.id,
        action: "schedule.upserted",
        targetType: "work_schedule",
        targetId: schedule.id,
        payload: {
          mode: input.plan.mode,
          userId: input.plan.changes[index].userId,
          workDate: input.plan.changes[index].workDate,
          shiftName: input.plan.changes[index].shiftName,
          breakMinutes: input.plan.changes[index].breakMinutes
        }
      })
    )
  );

  await Promise.all(
    schedules.map((schedule, index) => {
      const change = input.plan.changes[index];
      const existed = input.plan.existingMap.has(scheduleKey(change.userId, change.workDate));

      return Promise.all([
        notifyScheduleUpdated({
          scheduleId: schedule.id,
          actorName: input.actor.name,
          isUpdate: existed
        }),
        resolveRiskSignalsForAction({
          companyId: input.actor.companyId,
          userId: change.userId,
          actorUserId: input.actor.id,
          targetDate: change.workDate,
          types: [RiskType.SCHEDULE_MISMATCH, RiskType.LATE_RISK],
          resolutionType: "SCHEDULE",
          resolutionReferenceId: schedule.id,
          resolutionReferenceLabel: existed
            ? `${change.resolutionLabelBase} 수정`
            : `${change.resolutionLabelBase} 등록`,
          resolutionNote: `${change.resolutionLabelBase}${existed ? " 수정" : " 등록"}으로 재검토`
        })
      ]);
    })
  );

  await refreshRiskSignalsForUserIds({
    companyId: input.actor.companyId,
    userIds: input.plan.affectedUserIds,
    actorUserId: input.actor.id,
    writeAudit: true
  });

  const created = input.plan.changes.filter(
    (change) => !input.plan.existingMap.has(scheduleKey(change.userId, change.workDate))
  ).length;
  const updated = schedules.length - created;

  return {
    mode: input.plan.mode,
    total: schedules.length,
    created,
    updated,
    deleted: 0,
    overwritten: updated,
    summary: input.plan.preview
  };
}

function normalizeTemplateMode(value: unknown): ScheduleTemplate["mode"] {
  return value === "range" || value === "copy_week" || value === "bulk_update" || value === "bulk_delete"
    ? value
    : "single";
}

function normalizeTemplate(payload: unknown, fallbackId: string, createdAt: Date, actorName: string | null) {
  const record = getAuditPayloadRecord(payload);
  const weekdays = Array.isArray(record?.weekdays)
    ? record.weekdays.filter((value): value is number => Number.isInteger(value) && value >= 0 && value <= 6)
    : [1, 2, 3, 4, 5];

  return {
    id: typeof record?.id === "string" ? record.id : fallbackId,
    name: typeof record?.name === "string" ? record.name.trim() || "새 템플릿" : "새 템플릿",
    mode: normalizeTemplateMode(record?.mode),
    teamId: typeof record?.teamId === "string" ? record.teamId : null,
    startTime: typeof record?.startTime === "string" ? record.startTime : "09:00",
    endTime: typeof record?.endTime === "string" ? record.endTime : "18:00",
    breakMinutes:
      typeof record?.breakMinutes === "number" && Number.isFinite(record.breakMinutes)
        ? parseBreakMinutes(record.breakMinutes)
        : 60,
    shiftName: typeof record?.shiftName === "string" ? record.shiftName : "기본 근무",
    note: typeof record?.note === "string" ? record.note : "",
    weekdays,
    createdAt,
    updatedAt: createdAt,
    actorName
  } satisfies ScheduleTemplate;
}

export async function listScheduleTemplates(companyId: string) {
  const snapshots = await listAuditSnapshots({
    companyId,
    actions: [...TEMPLATE_ACTIONS],
    targetType: "schedule_template",
    take: 200
  });

  const templateMap = new Map<string, ScheduleTemplate | null>();

  for (const snapshot of snapshots) {
    if (templateMap.has(snapshot.targetId)) {
      continue;
    }

    if (snapshot.action === "schedule.template.archived") {
      templateMap.set(snapshot.targetId, null);
      continue;
    }

    const template = normalizeTemplate(snapshot.payload, snapshot.targetId, snapshot.createdAt, snapshot.actor?.name ?? null);
    template.updatedAt = snapshot.createdAt;
    templateMap.set(snapshot.targetId, template);
  }

  return [...templateMap.values()]
    .filter((value): value is ScheduleTemplate => Boolean(value))
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

export async function saveScheduleTemplate(input: {
  actor: Pick<User, "id" | "companyId">;
  templateId?: string | null;
  name: string;
  mode: ScheduleTemplate["mode"];
  teamId?: string | null;
  startTime?: string;
  endTime?: string;
  breakMinutes?: number;
  shiftName?: string;
  note?: string;
  weekdays?: number[];
}) {
  const templateId = input.templateId?.trim() || randomUUID();
  const weekdays = Array.isArray(input.weekdays)
    ? input.weekdays.filter((value): value is number => Number.isInteger(value) && value >= 0 && value <= 6)
    : [1, 2, 3, 4, 5];

  await writeAuditSnapshot({
    actor: input.actor,
    action: "schedule.template.saved",
    targetType: "schedule_template",
    targetId: templateId,
    payload: {
      id: templateId,
      name: input.name.trim() || "새 템플릿",
      mode: input.mode,
      teamId: input.teamId?.trim() || null,
      startTime: input.startTime ?? "09:00",
      endTime: input.endTime ?? "18:00",
      breakMinutes: parseBreakMinutes(input.breakMinutes),
      shiftName: input.shiftName?.trim() || "기본 근무",
      note: input.note?.trim() || "",
      weekdays
    }
  });

  return templateId;
}

export async function archiveScheduleTemplate(input: {
  actor: Pick<User, "id" | "companyId">;
  templateId: string;
}) {
  await writeAuditSnapshot({
    actor: input.actor,
    action: "schedule.template.archived",
    targetType: "schedule_template",
    targetId: input.templateId,
    payload: {
      archived: true
    }
  });
}

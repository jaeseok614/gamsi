import { LeaveDuration, LeaveType, type CompanyHoliday, type User, type WorkPolicy } from "@/generated/prisma";

import { prisma } from "@/lib/prisma";
import { kstDateTime, parseTimeValue } from "@/lib/time";

const KOREAN_PUBLIC_HOLIDAY_BUFFER_DAYS = 14;
const LUNAR_NUMERIC_FORMATTER = new Intl.DateTimeFormat("en-u-ca-chinese", {
  year: "numeric",
  month: "numeric",
  day: "numeric"
});
const LUNAR_MONTH_FORMATTER = new Intl.DateTimeFormat("en-u-ca-chinese", {
  month: "long"
});

type KoreanHolidayCategory = 2 | 3 | 4 | 6 | 7 | 8 | 9 | 10;

type HolidayEntry = {
  category: KoreanHolidayCategory;
  name: string;
};

export type ResolvedHoliday = Pick<
  CompanyHoliday,
  "id" | "companyId" | "date" | "name" | "isPaidHoliday" | "createdAt" | "updatedAt"
> & {
  source: "SYSTEM" | "MANUAL";
};

function addDays(dateString: string, offset: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function isSaturday(dateString: string) {
  return new Date(`${dateString}T00:00:00.000Z`).getUTCDay() === 6;
}

function isSunday(dateString: string) {
  return new Date(`${dateString}T00:00:00.000Z`).getUTCDay() === 0;
}

function listDateRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function getLunarDateInfo(dateString: string) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  const numericParts = LUNAR_NUMERIC_FORMATTER.formatToParts(date);
  const longMonth = LUNAR_MONTH_FORMATTER.formatToParts(date).find((part) => part.type === "month")?.value ?? "";
  const rawMonth = numericParts.find((part) => part.type === "month")?.value ?? "";
  const rawDay = numericParts.find((part) => part.type === "day")?.value ?? "";
  const month = Number.parseInt(rawMonth, 10);
  const day = Number.parseInt(rawDay, 10);

  if (!Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`음력 날짜 계산에 실패했습니다: ${dateString}`);
  }

  return {
    month,
    day,
    isLeapMonth: /bis/i.test(longMonth)
  };
}

function appendHolidayEntry(map: Map<string, HolidayEntry[]>, date: string, entry: HolidayEntry) {
  const rows = map.get(date) ?? [];
  if (!rows.some((row) => row.category === entry.category && row.name === entry.name)) {
    rows.push(entry);
    map.set(date, rows);
  }
}

function combineHolidayNames(entries: HolidayEntry[]) {
  return Array.from(new Set(entries.map((entry) => entry.name))).join(" · ");
}

function buildSubstituteHolidayName(entries: HolidayEntry[]) {
  return `${combineHolidayNames(entries)} 대체공휴일`;
}

function includesAnyCategory(entries: HolidayEntry[], categories: ReadonlySet<KoreanHolidayCategory>) {
  return entries.some((entry) => categories.has(entry.category));
}

const SUBSTITUTE_WEEKEND_CATEGORIES = new Set<KoreanHolidayCategory>([2, 4, 6, 7, 9, 10]);
const SUBSTITUTE_SATURDAY_CATEGORIES = new Set<KoreanHolidayCategory>([2, 6, 7, 10]);

function requiresSubstituteHoliday(date: string, entries: HolidayEntry[]) {
  if (isSaturday(date)) {
    return includesAnyCategory(entries, SUBSTITUTE_SATURDAY_CATEGORIES);
  }

  if (isSunday(date)) {
    return includesAnyCategory(entries, SUBSTITUTE_WEEKEND_CATEGORIES);
  }

  return entries.length > 1 && includesAnyCategory(entries, SUBSTITUTE_WEEKEND_CATEGORIES);
}

function buildKoreanPublicHolidayMap(startDate: string, endDate: string, blockedDates: Set<string>) {
  const actualHolidayEntries = new Map<string, HolidayEntry[]>();
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));

  for (let year = startYear; year <= endYear; year += 1) {
    appendHolidayEntry(actualHolidayEntries, `${year}-01-01`, { category: 3, name: "신정" });
    appendHolidayEntry(actualHolidayEntries, `${year}-03-01`, { category: 2, name: "삼일절" });
    appendHolidayEntry(actualHolidayEntries, `${year}-05-05`, { category: 7, name: "어린이날" });
    appendHolidayEntry(actualHolidayEntries, `${year}-06-06`, { category: 8, name: "현충일" });
    appendHolidayEntry(actualHolidayEntries, `${year}-08-15`, { category: 2, name: "광복절" });
    appendHolidayEntry(actualHolidayEntries, `${year}-10-03`, { category: 2, name: "개천절" });
    appendHolidayEntry(actualHolidayEntries, `${year}-10-09`, { category: 2, name: "한글날" });
    appendHolidayEntry(actualHolidayEntries, `${year}-12-25`, { category: 10, name: "기독탄신일" });

    for (const date of listDateRange(`${year}-01-01`, `${year}-12-31`)) {
      const lunar = getLunarDateInfo(date);
      if (lunar.isLeapMonth) {
        continue;
      }

      if (lunar.month === 1 && lunar.day === 1) {
        appendHolidayEntry(actualHolidayEntries, addDays(date, -1), { category: 4, name: "설날 전날" });
        appendHolidayEntry(actualHolidayEntries, date, { category: 4, name: "설날" });
        appendHolidayEntry(actualHolidayEntries, addDays(date, 1), { category: 4, name: "설날 다음날" });
      }

      if (lunar.month === 4 && lunar.day === 8) {
        appendHolidayEntry(actualHolidayEntries, date, { category: 6, name: "부처님오신날" });
      }

      if (lunar.month === 8 && lunar.day === 15) {
        appendHolidayEntry(actualHolidayEntries, addDays(date, -1), { category: 9, name: "추석 전날" });
        appendHolidayEntry(actualHolidayEntries, date, { category: 9, name: "추석" });
        appendHolidayEntry(actualHolidayEntries, addDays(date, 1), { category: 9, name: "추석 다음날" });
      }
    }
  }

  const observedHolidayDates = new Set<string>([...actualHolidayEntries.keys(), ...blockedDates]);
  const systemHolidayMap = new Map<string, { name: string }>();

  for (const [date, entries] of actualHolidayEntries) {
    systemHolidayMap.set(date, {
      name: combineHolidayNames(entries)
    });
  }

  for (const date of [...actualHolidayEntries.keys()].sort()) {
    const entries = actualHolidayEntries.get(date);
    if (!entries || !requiresSubstituteHoliday(date, entries)) {
      continue;
    }

    let substituteDate = addDays(date, 1);
    while (isSaturday(substituteDate) || isSunday(substituteDate) || observedHolidayDates.has(substituteDate)) {
      substituteDate = addDays(substituteDate, 1);
    }

    observedHolidayDates.add(substituteDate);
    systemHolidayMap.set(substituteDate, {
      name: buildSubstituteHolidayName(entries)
    });
  }

  return systemHolidayMap;
}

function overlapMinutes(startA: Date, endA: Date, startB: Date, endB: Date) {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  if (end <= start) {
    return 0;
  }

  return Math.round((end - start) / (60 * 1000));
}

function fullMonthDifference(startDate: string, endDate: string) {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  let months = (endYear - startYear) * 12 + (endMonth - startMonth);
  if (endDay < startDay) {
    months -= 1;
  }
  return Math.max(0, months);
}

function getAnniversaryForYear(joinedAt: string, year: number) {
  const [, month, day] = joinedAt.split("-").map(Number);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getAnnualLeaveCycleStart(input: {
  joinedAt: string;
  asOfDate: string;
  annualLeaveBasis: WorkPolicy["annualLeaveBasis"];
}) {
  if (input.annualLeaveBasis === "CALENDAR_YEAR") {
    return `${input.asOfDate.slice(0, 4)}-01-01`;
  }

  const joinedAt = input.joinedAt;
  const year = Number(input.asOfDate.slice(0, 4));
  const thisYearAnniversary = getAnniversaryForYear(joinedAt, year);
  if (thisYearAnniversary <= input.asOfDate) {
    return thisYearAnniversary;
  }
  return getAnniversaryForYear(joinedAt, year - 1);
}

function getCarryoverExpiryDate(
  cycleStart: string,
  policy: Pick<WorkPolicy, "carryoverExpiryMonth" | "carryoverExpiryDay">
) {
  const cycleYear = Number(cycleStart.slice(0, 4));
  const candidate = `${String(cycleYear).padStart(4, "0")}-${String(policy.carryoverExpiryMonth).padStart(2, "0")}-${String(policy.carryoverExpiryDay).padStart(2, "0")}`;
  if (candidate >= cycleStart) {
    return candidate;
  }
  return `${String(cycleYear + 1).padStart(4, "0")}-${String(policy.carryoverExpiryMonth).padStart(2, "0")}-${String(policy.carryoverExpiryDay).padStart(2, "0")}`;
}

function normalizeDate(value: Date | string) {
  if (typeof value === "string") {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  return value.toISOString().slice(0, 10);
}

export async function getCurrentWorkPolicy(companyId: string, effectiveFor: Date | string = new Date()) {
  const dateString = normalizeDate(effectiveFor);
  const existing =
    (await prisma.workPolicy.findFirst({
      where: {
        companyId,
        effectiveFrom: {
          lte: new Date(`${dateString}T23:59:59.999Z`)
        }
      },
      orderBy: [{ version: "desc" }, { effectiveFrom: "desc" }]
    })) ??
    (await prisma.workPolicy.findFirst({
      where: {
        companyId,
        isActive: true
      },
      orderBy: [{ version: "desc" }, { effectiveFrom: "desc" }]
    })) ??
    (await prisma.workPolicy.findFirst({
      where: {
        companyId
      },
      orderBy: [{ version: "desc" }, { updatedAt: "desc" }]
    }));

  if (existing) {
    return existing;
  }

  const company = await prisma.company.findUniqueOrThrow({
    where: {
      id: companyId
    }
  });

  return prisma.workPolicy.create({
    data: {
      companyId,
      name: "기본 계산 정책",
      version: 1,
      isActive: true,
      effectiveFrom: new Date(),
      weeklyLimitMinutes: company.weeklyLimitMinutes,
      defaultBreakMinutes: company.defaultBreakMinutes
    }
  });
}

export async function getWorkPolicyVersions(companyId: string, take = 6) {
  return prisma.workPolicy.findMany({
    where: {
      companyId
    },
    orderBy: [{ version: "desc" }, { effectiveFrom: "desc" }],
    take
  });
}

export function getMonthString(value: Date | string) {
  if (typeof value === "string") {
    return value.length >= 7 ? value.slice(0, 7) : value;
  }

  return value.toISOString().slice(0, 7);
}

export function getMonthStringsInRange(startDate: string, endDate: string) {
  const months: string[] = [];
  let cursor = `${startDate.slice(0, 7)}-01`;
  const endMonth = endDate.slice(0, 7);

  while (cursor.slice(0, 7) <= endMonth) {
    months.push(cursor.slice(0, 7));
    const [year, month] = cursor.slice(0, 7).split("-").map(Number);
    const nextMonth = month === 12 ? [year + 1, 1] : [year, month + 1];
    cursor = `${String(nextMonth[0]).padStart(4, "0")}-${String(nextMonth[1]).padStart(2, "0")}-01`;
  }

  return months;
}

export async function getCompanyHolidays(companyId: string, startDate: string, endDate: string): Promise<ResolvedHoliday[]> {
  const expandedStart = addDays(startDate, -KOREAN_PUBLIC_HOLIDAY_BUFFER_DAYS);
  const expandedEnd = addDays(endDate, KOREAN_PUBLIC_HOLIDAY_BUFFER_DAYS);
  const manualHolidays = await prisma.companyHoliday.findMany({
    where: {
      companyId,
      date: {
        gte: new Date(`${expandedStart}T00:00:00.000Z`),
        lte: new Date(`${expandedEnd}T00:00:00.000Z`)
      }
    },
    orderBy: {
      date: "asc"
    }
  });

  const manualHolidayDateSet = new Set(manualHolidays.map((holiday) => holiday.date.toISOString().slice(0, 10)));
  const systemHolidayMap = buildKoreanPublicHolidayMap(expandedStart, expandedEnd, manualHolidayDateSet);
  const holidaysByDate = new Map<string, ResolvedHoliday>();

  for (const [date, holiday] of systemHolidayMap) {
    if (date < startDate || date > endDate) {
      continue;
    }

    const resolvedDate = new Date(`${date}T00:00:00.000Z`);
    holidaysByDate.set(date, {
      id: `system:${date}`,
      companyId,
      date: resolvedDate,
      name: holiday.name,
      isPaidHoliday: true,
      createdAt: resolvedDate,
      updatedAt: resolvedDate,
      source: "SYSTEM"
    });
  }

  for (const holiday of manualHolidays) {
    const date = holiday.date.toISOString().slice(0, 10);
    if (date < startDate || date > endDate) {
      continue;
    }

    holidaysByDate.set(date, {
      ...holiday,
      source: "MANUAL"
    });
  }

  return [...holidaysByDate.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function buildHolidayDateSet(holidays: Array<Pick<CompanyHoliday, "date">>) {
  return new Set(holidays.map((holiday) => holiday.date.toISOString().slice(0, 10)));
}

export function getAnnualLeaveAllowanceDays(policy: Pick<WorkPolicy, "annualLeaveGrantDays" | "annualLeaveCarryoverDays">) {
  return policy.annualLeaveGrantDays + policy.annualLeaveCarryoverDays;
}

export function leaveDaysInRange(
  request: {
    leaveType: LeaveType | null;
    leaveDuration: LeaveDuration | null;
    leaveStartDate: Date | null;
    leaveEndDate: Date | null;
    requestedLeaveMinutes?: number | null;
  },
  startDate: string,
  endDate: string,
  policy: Pick<WorkPolicy, "standardDailyMinutes">
) {
  if (request.leaveType !== LeaveType.ANNUAL || !request.leaveStartDate || !request.leaveEndDate) {
    return 0;
  }

  const requestStart = request.leaveStartDate.toISOString().slice(0, 10);
  const requestEnd = request.leaveEndDate.toISOString().slice(0, 10);
  const overlapStart = requestStart > startDate ? requestStart : startDate;
  const overlapEnd = requestEnd < endDate ? requestEnd : endDate;

  if (overlapStart > overlapEnd) {
    return 0;
  }

  if (request.leaveDuration === LeaveDuration.HOURLY) {
    if (overlapStart !== overlapEnd || !request.requestedLeaveMinutes || policy.standardDailyMinutes <= 0) {
      return 0;
    }
    return Number((request.requestedLeaveMinutes / policy.standardDailyMinutes).toFixed(2));
  }

  if (request.leaveDuration === LeaveDuration.HALF_DAY_AM || request.leaveDuration === LeaveDuration.HALF_DAY_PM) {
    return overlapStart === overlapEnd ? 0.5 : 0;
  }

  const start = new Date(`${overlapStart}T00:00:00.000Z`);
  const end = new Date(`${overlapEnd}T00:00:00.000Z`);
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

export function getAnnualLeaveEntitlement(input: {
  user: Pick<User, "joinedAt">;
  policy: Pick<
    WorkPolicy,
    | "annualLeaveBasis"
    | "annualLeaveGrantDays"
    | "annualLeaveCarryoverDays"
    | "firstYearMonthlyAccrualEnabled"
    | "carryoverExpiryMonth"
    | "carryoverExpiryDay"
  >;
  asOfDate: string;
  usedDaysInCycle: number;
}) {
  const joinedAt = input.user.joinedAt.toISOString().slice(0, 10);
  const cycleStart = getAnnualLeaveCycleStart({
    joinedAt,
    asOfDate: input.asOfDate,
    annualLeaveBasis: input.policy.annualLeaveBasis
  });

  const completedMonths = fullMonthDifference(joinedAt, input.asOfDate);
  const firstYearMonthlyDays =
    input.policy.firstYearMonthlyAccrualEnabled && completedMonths < 12 ? Math.min(11, completedMonths) : 0;
  const expiryDate = getCarryoverExpiryDate(cycleStart, input.policy);
  const carryoverDays = input.asOfDate <= expiryDate ? input.policy.annualLeaveCarryoverDays : 0;
  const baseGrantDays = firstYearMonthlyDays > 0 ? firstYearMonthlyDays : input.policy.annualLeaveGrantDays;
  const grantedDays = baseGrantDays + carryoverDays;
  const remainingDays = Math.max(0, Number((grantedDays - input.usedDaysInCycle).toFixed(2)));

  return {
    cycleStart,
    carryoverExpiryDate: expiryDate,
    baseGrantDays,
    carryoverDays,
    grantedDays,
    usedDaysInCycle: Number(input.usedDaysInCycle.toFixed(2)),
    remainingDays,
    firstYearMonthlyDays
  };
}

export function isWeekendWorkDate(workDate: Date) {
  const weekday = workDate.getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function calculateNightWorkMinutes(
  session: {
    workDate: Date;
    checkInAt: Date | null;
    checkOutAt: Date | null;
    grossMinutes: number;
    calculatedWorkMinutes: number;
  },
  policy: Pick<WorkPolicy, "nightWorkStart" | "nightWorkEnd">
) {
  if (!session.checkInAt || !session.checkOutAt || session.grossMinutes <= 0 || session.calculatedWorkMinutes <= 0) {
    return 0;
  }

  const nightStart = parseTimeValue(policy.nightWorkStart);
  const nightEnd = parseTimeValue(policy.nightWorkEnd);
  if (!nightStart || !nightEnd) {
    return 0;
  }

  const dateString = session.workDate.toISOString().slice(0, 10);
  const workRatio = Math.min(1, Math.max(0, session.calculatedWorkMinutes / session.grossMinutes));

  let rawNightMinutes = 0;
  if (
    nightStart.hour < nightEnd.hour ||
    (nightStart.hour === nightEnd.hour && nightStart.minute < nightEnd.minute)
  ) {
    rawNightMinutes += overlapMinutes(
      session.checkInAt,
      session.checkOutAt,
      kstDateTime(dateString, nightStart.hour, nightStart.minute),
      kstDateTime(dateString, nightEnd.hour, nightEnd.minute)
    );
  } else {
    rawNightMinutes += overlapMinutes(
      session.checkInAt,
      session.checkOutAt,
      kstDateTime(addDays(dateString, -1), nightStart.hour, nightStart.minute),
      kstDateTime(dateString, nightEnd.hour, nightEnd.minute)
    );
    rawNightMinutes += overlapMinutes(
      session.checkInAt,
      session.checkOutAt,
      kstDateTime(dateString, nightStart.hour, nightStart.minute),
      kstDateTime(addDays(dateString, 1), nightEnd.hour, nightEnd.minute)
    );
  }

  return Math.max(0, Math.round(rawNightMinutes * workRatio));
}

export function calculateHolidayWorkMinutes(
  session: {
    workDate: Date;
    calculatedWorkMinutes: number;
  },
  policy: Pick<WorkPolicy, "holidayIncludesWeekends">,
  holidayDateSet: Set<string> = new Set()
) {
  const workDate = session.workDate.toISOString().slice(0, 10);
  const isHoliday =
    holidayDateSet.has(workDate) ||
    isSunday(workDate) ||
    (policy.holidayIncludesWeekends && isWeekendWorkDate(session.workDate));
  return isHoliday ? session.calculatedWorkMinutes : 0;
}

export function calculateOvertimePremiumMinutes(
  approvedOvertimeMinutes: number,
  policy: Pick<WorkPolicy, "overtimePremiumRate">
) {
  return Math.max(0, Math.round(approvedOvertimeMinutes * Math.max(0, policy.overtimePremiumRate - 1)));
}

export function calculateNightPremiumMinutes(
  nightWorkMinutes: number,
  policy: Pick<WorkPolicy, "nightPremiumRate">
) {
  return Math.max(0, Math.round(nightWorkMinutes * Math.max(0, policy.nightPremiumRate)));
}

export function calculateHolidayPremiumMinutes(
  holidayWorkMinutes: number,
  policy: Pick<WorkPolicy, "holidayPremiumRate">
) {
  return Math.max(0, Math.round(holidayWorkMinutes * Math.max(0, policy.holidayPremiumRate - 1)));
}

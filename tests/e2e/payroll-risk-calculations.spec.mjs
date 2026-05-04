import { expect, test } from "@playwright/test";
import { PrismaClient } from "../../src/generated/prisma/index.js";

const prisma = new PrismaClient();
const password = "password123!";

function firstCookie(setCookie) {
  if (!setCookie) {
    throw new Error("세션 쿠키가 없습니다.");
  }

  return setCookie.split(";")[0];
}

function kstDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addDays(dateString, offset) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function dateOnly(dateString) {
  return new Date(`${dateString}T00:00:00.000Z`);
}

function kstDateTime(dateString, hour, minute = 0) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 9 * 60 * 60 * 1000);
}

function nextSunday(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  const day = date.getUTCDay();
  return addDays(dateString, (7 - day) % 7);
}

function recentWeekdayDates(count) {
  const today = kstDate();
  const dates = [];
  let offset = 1;
  while (dates.length < count) {
    const candidate = addDays(today, -offset);
    const day = new Date(`${candidate}T00:00:00.000Z`).getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(candidate);
    }
    offset += 1;
  }
  return dates;
}

function recentSunday() {
  const today = kstDate();
  const day = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  return addDays(today, day === 0 ? 0 : -day);
}

async function loginApi(request, email) {
  const response = await request.post("/api/auth/login", {
    data: {
      email,
      password
    }
  });
  expect(response.ok()).toBeTruthy();
  return firstCookie(response.headers()["set-cookie"]);
}

async function requestJson(request, cookie, path, method = "GET", body) {
  const response = await request.fetch(path, {
    method,
    headers: {
      cookie,
      "content-type": "application/json"
    },
    data: body
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createTempEmployee(request, adminCookie, label) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `pw-${label}-${stamp}@gamsi.kr`;
  const invite = await requestJson(request, adminCookie, "/api/admin/invitations", "POST", {
    name: `PW ${label} ${stamp.slice(-4)}`,
    email,
    role: "EMPLOYEE"
  });
  const accept = await request.post(`/api/invitations/${invite.token}/accept`, {
    data: {
      password
    }
  });
  expect(accept.ok()).toBeTruthy();

  const user = await prisma.user.findUniqueOrThrow({
    where: {
      email
    }
  });
  return user;
}

async function createClosedSession(input) {
  return prisma.workSession.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      workDate: dateOnly(input.workDate),
      checkInAt: input.checkInAt,
      checkOutAt: input.checkOutAt,
      grossMinutes: input.grossMinutes,
      breakMinutes: input.breakMinutes,
      calculatedWorkMinutes: input.calculatedWorkMinutes,
      overtimeMinutes: input.overtimeMinutes,
      approvedOvertimeMinutes: input.approvedOvertimeMinutes,
      status: "CLOSED"
    }
  });
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("급여 리포트가 야간, 휴일, 연장 가산을 같은 행에서 정확히 계산한다", async ({ request }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const payrollUser = await createTempEmployee(request, adminCookie, "payroll");
  const workDate = nextSunday(kstDate());
  const month = workDate.slice(0, 7);
  const session = await createClosedSession({
    companyId: payrollUser.companyId,
    userId: payrollUser.id,
    workDate,
    checkInAt: kstDateTime(workDate, 21, 0),
    checkOutAt: kstDateTime(addDays(workDate, 1), 2, 0),
    grossMinutes: 300,
    breakMinutes: 0,
    calculatedWorkMinutes: 300,
    overtimeMinutes: 60,
    approvedOvertimeMinutes: 60
  });

  await prisma.approvalRequest.create({
    data: {
      companyId: payrollUser.companyId,
      requesterId: payrollUser.id,
      sessionId: session.id,
      type: "OVERTIME",
      requestedMinutes: 60,
      reason: "Playwright payroll premium proof",
      status: "APPROVED",
      reviewedAt: new Date()
    }
  });

  const report = await requestJson(request, adminCookie, `/api/reports/payroll?month=${month}`);
  const row = report.payrollRows.find((item) => item.user.email === payrollUser.email);

  expect(row).toBeTruthy();
  expect(row.calculatedWorkMinutes).toBe(300);
  expect(row.approvedOvertimeMinutes).toBe(60);
  expect(row.nightWorkMinutes).toBe(240);
  expect(row.holidayWorkMinutes).toBe(300);
  expect(row.additionalOvertimePremiumMinutes).toBe(30);
  expect(row.additionalNightPremiumMinutes).toBe(120);
  expect(row.additionalHolidayPremiumMinutes).toBe(150);
  expect(row.payableEquivalentMinutes).toBe(600);
});

test("리스크 재계산이 미승인 초과근로, 포괄임금, 휴게, 스케줄, 야간/휴일 위험을 만든다", async ({ request }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const riskUser = await createTempEmployee(request, adminCookie, "risk");
  const [dateA, dateB, dateC, breakDate] = recentWeekdayDates(4);
  const nightHolidayDate = recentSunday();

  for (const workDate of [dateA, dateB, dateC]) {
    await createClosedSession({
      companyId: riskUser.companyId,
      userId: riskUser.id,
      workDate,
      checkInAt: kstDateTime(workDate, 9, 0),
      checkOutAt: kstDateTime(workDate, 20, 0),
      grossMinutes: 660,
      breakMinutes: 60,
      calculatedWorkMinutes: 600,
      overtimeMinutes: 180,
      approvedOvertimeMinutes: 0
    });
  }

  await createClosedSession({
    companyId: riskUser.companyId,
    userId: riskUser.id,
    workDate: breakDate,
    checkInAt: kstDateTime(breakDate, 10, 0),
    checkOutAt: kstDateTime(breakDate, 20, 0),
    grossMinutes: 600,
    breakMinutes: 0,
    calculatedWorkMinutes: 600,
    overtimeMinutes: 120,
    approvedOvertimeMinutes: 0
  });

  await prisma.workSchedule.create({
    data: {
      companyId: riskUser.companyId,
      userId: riskUser.id,
      workDate: dateOnly(breakDate),
      shiftName: "PW mismatch shift",
      scheduledStartAt: kstDateTime(breakDate, 9, 0),
      scheduledEndAt: kstDateTime(breakDate, 18, 0),
      breakMinutes: 60
    }
  });

  await createClosedSession({
    companyId: riskUser.companyId,
    userId: riskUser.id,
    workDate: nightHolidayDate,
    checkInAt: kstDateTime(nightHolidayDate, 21, 0),
    checkOutAt: kstDateTime(addDays(nightHolidayDate, 1), 2, 0),
    grossMinutes: 300,
    breakMinutes: 0,
    calculatedWorkMinutes: 300,
    overtimeMinutes: 60,
    approvedOvertimeMinutes: 0
  });

  await requestJson(request, adminCookie, "/api/risks/recalculate", "POST", {});

  const risks = await prisma.riskSignal.findMany({
    where: {
      userId: riskUser.id,
      type: {
        in: [
          "UNAPPROVED_OVERTIME",
          "REPEATED_OVERTIME",
          "INCLUSIVE_WAGE_RISK",
          "BREAK_VIOLATION",
          "SCHEDULE_MISMATCH",
          "NIGHT_HOLIDAY_WORK"
        ]
      }
    },
    select: {
      type: true
    }
  });
  const types = new Set(risks.map((risk) => risk.type));

  expect(types.has("UNAPPROVED_OVERTIME")).toBeTruthy();
  expect(types.has("REPEATED_OVERTIME")).toBeTruthy();
  expect(types.has("INCLUSIVE_WAGE_RISK")).toBeTruthy();
  expect(types.has("BREAK_VIOLATION")).toBeTruthy();
  expect(types.has("SCHEDULE_MISMATCH")).toBeTruthy();
  expect(types.has("NIGHT_HOLIDAY_WORK")).toBeTruthy();
});

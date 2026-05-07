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

function weekdayInMonth(month, startDay = 1) {
  for (let day = startDay; day <= 28; day += 1) {
    const candidate = `${month}-${String(day).padStart(2, "0")}`;
    const weekday = new Date(`${candidate}T00:00:00.000Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      return candidate;
    }
  }

  throw new Error(`${month} 월에서 평일을 찾지 못했습니다.`);
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

async function createIsolatedCompanyUser(role, label) {
  const passwordHash = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@gamsi.kr" } })).passwordHash;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const company = await prisma.company.create({
    data: {
      name: `PW payroll company ${label} ${stamp}`
    }
  });
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      name: `PW ${label} ${stamp.slice(-4)}`,
      email: `pw-${label}-${stamp}@payroll.example`,
      passwordHash,
      role,
      joinedAt: dateOnly("2024-01-01")
    }
  });
  return { company, user };
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

test("야간근로가 자정을 넘어도 야간 가산 시간이 누락되지 않는다", async ({ request }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const payrollUser = await createTempEmployee(request, adminCookie, "midnight");
  const month = kstDate().slice(0, 7);
  const workDate = weekdayInMonth(month, 10);
  await createClosedSession({
    companyId: payrollUser.companyId,
    userId: payrollUser.id,
    workDate,
    checkInAt: kstDateTime(workDate, 23, 30),
    checkOutAt: kstDateTime(addDays(workDate, 1), 2, 30),
    grossMinutes: 180,
    breakMinutes: 0,
    calculatedWorkMinutes: 180,
    overtimeMinutes: 0,
    approvedOvertimeMinutes: 0
  });

  const report = await requestJson(request, adminCookie, `/api/reports/payroll?month=${month}`);
  const row = report.payrollRows.find((item) => item.user.email === payrollUser.email);

  expect(row).toBeTruthy();
  expect(row.nightWorkMinutes).toBe(180);
  expect(row.additionalNightPremiumMinutes).toBe(90);
  expect(row.holidayWorkMinutes).toBe(0);
  expect(row.payableEquivalentMinutes).toBe(270);
});

test("반차와 시간차 승인 휴가가 급여 리포트의 연차 사용량에 반영된다", async ({ request }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const leaveUser = await createTempEmployee(request, adminCookie, "leave");
  const month = kstDate().slice(0, 7);
  const halfDayDate = weekdayInMonth(month, 10);
  const hourlyDate = weekdayInMonth(month, Number(halfDayDate.slice(8)) + 1);

  await prisma.approvalRequest.createMany({
    data: [
      {
        companyId: leaveUser.companyId,
        requesterId: leaveUser.id,
        type: "LEAVE",
        leaveType: "ANNUAL",
        leaveStartDate: dateOnly(halfDayDate),
        leaveEndDate: dateOnly(halfDayDate),
        leaveDuration: "HALF_DAY_PM",
        reason: "Playwright half-day leave",
        status: "APPROVED",
        reviewedAt: new Date()
      },
      {
        companyId: leaveUser.companyId,
        requesterId: leaveUser.id,
        type: "LEAVE",
        leaveType: "ANNUAL",
        leaveStartDate: dateOnly(hourlyDate),
        leaveEndDate: dateOnly(hourlyDate),
        leaveDuration: "HOURLY",
        requestedLeaveMinutes: 120,
        reason: "Playwright hourly leave",
        status: "APPROVED",
        reviewedAt: new Date()
      }
    ]
  });

  const report = await requestJson(request, adminCookie, `/api/reports/payroll?month=${month}`);
  const row = report.payrollRows.find((item) => item.user.email === leaveUser.email);

  expect(row).toBeTruthy();
  expect(row.annualLeaveUsedThisMonth).toBeCloseTo(0.75, 2);
});

test("월 마감 후 근태 데이터가 바뀌면 잠금 스냅샷과 라이브 리포트 차이를 표시한다", async ({ request }) => {
  const { company, user } = await createIsolatedCompanyUser("ADMIN", "close-diff");
  const adminCookie = await loginApi(request, user.email);
  const month = "2025-11";

  const closed = await requestJson(request, adminCookie, "/api/reports/month-close", "POST", {
    month,
    reason: "Playwright close snapshot"
  });
  expect(closed.status).toBe("CLOSED");

  await createClosedSession({
    companyId: company.id,
    userId: user.id,
    workDate: `${month}-11`,
    checkInAt: kstDateTime(`${month}-11`, 9, 0),
    checkOutAt: kstDateTime(`${month}-11`, 18, 0),
    grossMinutes: 540,
    breakMinutes: 60,
    calculatedWorkMinutes: 480,
    overtimeMinutes: 0,
    approvedOvertimeMinutes: 0
  });

  const report = await requestJson(request, adminCookie, `/api/reports/payroll?month=${month}`);
  const diff = report.liveDiffFromClosedSnapshot;

  expect(diff.changed).toBeTruthy();
  expect(diff.items.some((item) => item.key === "calculatedWorkMinutes" && item.from === 0 && item.to === 480)).toBeTruthy();
});

test("정책 버전 변경 전후 급여 리포트가 해당 월 말 기준 정책으로 계산된다", async ({ request }) => {
  const { company, user } = await createIsolatedCompanyUser("ADMIN", "policy-version");
  const adminCookie = await loginApi(request, user.email);

  await prisma.workPolicy.createMany({
    data: [
      {
        companyId: company.id,
        name: "PW policy v1",
        version: 1,
        isActive: false,
        effectiveFrom: dateOnly("2025-01-01"),
        overtimePremiumRate: 1.5
      },
      {
        companyId: company.id,
        name: "PW policy v2",
        version: 2,
        isActive: true,
        effectiveFrom: dateOnly("2025-02-01"),
        overtimePremiumRate: 2
      }
    ]
  });
  await createClosedSession({
    companyId: company.id,
    userId: user.id,
    workDate: "2025-01-02",
    checkInAt: kstDateTime("2025-01-02", 9, 0),
    checkOutAt: kstDateTime("2025-01-02", 18, 0),
    grossMinutes: 540,
    breakMinutes: 60,
    calculatedWorkMinutes: 480,
    overtimeMinutes: 60,
    approvedOvertimeMinutes: 60
  });
  await createClosedSession({
    companyId: company.id,
    userId: user.id,
    workDate: "2025-02-03",
    checkInAt: kstDateTime("2025-02-03", 9, 0),
    checkOutAt: kstDateTime("2025-02-03", 18, 0),
    grossMinutes: 540,
    breakMinutes: 60,
    calculatedWorkMinutes: 480,
    overtimeMinutes: 60,
    approvedOvertimeMinutes: 60
  });

  const january = await requestJson(request, adminCookie, "/api/reports/payroll?month=2025-01");
  const february = await requestJson(request, adminCookie, "/api/reports/payroll?month=2025-02");
  const januaryRow = january.payrollRows.find((item) => item.user.email === user.email);
  const februaryRow = february.payrollRows.find((item) => item.user.email === user.email);

  expect(january.policy.version).toBe(1);
  expect(february.policy.version).toBe(2);
  expect(januaryRow.additionalOvertimePremiumMinutes).toBe(30);
  expect(februaryRow.additionalOvertimePremiumMinutes).toBe(60);
});

test("월 경계 야간근로는 근무일 월에만 반영된다", async ({ request }) => {
  const { user } = await createIsolatedCompanyUser("ADMIN", "month-boundary");
  const adminCookie = await loginApi(request, user.email);
  await createClosedSession({
    companyId: user.companyId,
    userId: user.id,
    workDate: "2026-04-30",
    checkInAt: kstDateTime("2026-04-30", 22, 0),
    checkOutAt: kstDateTime("2026-05-01", 2, 0),
    grossMinutes: 240,
    breakMinutes: 0,
    calculatedWorkMinutes: 240,
    overtimeMinutes: 0,
    approvedOvertimeMinutes: 0
  });

  const april = await requestJson(request, adminCookie, "/api/reports/payroll?month=2026-04");
  const may = await requestJson(request, adminCookie, "/api/reports/payroll?month=2026-05");
  const aprilRow = april.payrollRows.find((item) => item.user.email === user.email);
  const mayRow = may.payrollRows.find((item) => item.user.email === user.email);

  expect(aprilRow.calculatedWorkMinutes).toBe(240);
  expect(aprilRow.nightWorkMinutes).toBe(240);
  expect(aprilRow.payableEquivalentMinutes).toBe(360);
  expect(mayRow.calculatedWorkMinutes).toBe(0);
  expect(mayRow.nightWorkMinutes).toBe(0);
});

test("수동 공휴일은 휴일 가산에 반영하고 토요일은 정책에 따라 제외한다", async ({ request }) => {
  const { company, user } = await createIsolatedCompanyUser("ADMIN", "manual-holiday");
  const adminCookie = await loginApi(request, user.email);
  await prisma.workPolicy.create({
    data: {
      companyId: company.id,
      name: "PW manual holiday policy",
      version: 1,
      isActive: true,
      effectiveFrom: dateOnly("2026-04-01"),
      holidayIncludesWeekends: false
    }
  });
  await prisma.companyHoliday.create({
    data: {
      companyId: company.id,
      date: dateOnly("2026-04-07"),
      name: "PW manual holiday"
    }
  });
  await createClosedSession({
    companyId: company.id,
    userId: user.id,
    workDate: "2026-04-04",
    checkInAt: kstDateTime("2026-04-04", 9, 0),
    checkOutAt: kstDateTime("2026-04-04", 13, 0),
    grossMinutes: 240,
    breakMinutes: 0,
    calculatedWorkMinutes: 240,
    overtimeMinutes: 0,
    approvedOvertimeMinutes: 0
  });
  await createClosedSession({
    companyId: company.id,
    userId: user.id,
    workDate: "2026-04-07",
    checkInAt: kstDateTime("2026-04-07", 9, 0),
    checkOutAt: kstDateTime("2026-04-07", 13, 0),
    grossMinutes: 240,
    breakMinutes: 0,
    calculatedWorkMinutes: 240,
    overtimeMinutes: 0,
    approvedOvertimeMinutes: 0
  });

  const report = await requestJson(request, adminCookie, "/api/reports/payroll?month=2026-04");
  const row = report.payrollRows.find((item) => item.user.email === user.email);

  expect(row.holidayWorkMinutes).toBe(240);
  expect(row.additionalHolidayPremiumMinutes).toBe(120);
  expect(row.calculatedWorkMinutes).toBe(480);
  expect(row.payableEquivalentMinutes).toBe(600);
});

test("리스크 재계산이 미승인 초과근로, 포괄임금, 휴게, 스케줄, 야간/휴일 위험을 만든다", async ({ request }) => {
  const { company, user: riskUser } = await createIsolatedCompanyUser("ADMIN", "risk");
  const adminCookie = await loginApi(request, riskUser.email);
  const [dateA, dateB, dateC, breakDate] = recentWeekdayDates(4);
  const nightHolidayDate = recentSunday();

  for (const workDate of [dateA, dateB, dateC]) {
    await createClosedSession({
      companyId: company.id,
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
    companyId: company.id,
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
      companyId: company.id,
      userId: riskUser.id,
      workDate: dateOnly(breakDate),
      shiftName: "PW mismatch shift",
      scheduledStartAt: kstDateTime(breakDate, 9, 0),
      scheduledEndAt: kstDateTime(breakDate, 18, 0),
      breakMinutes: 60
    }
  });

  await createClosedSession({
    companyId: company.id,
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

test("승인된 전일 휴가는 스케줄 누락 리스크를 만들지 않고 4시간 이상 휴게 부족은 잡아낸다", async ({ request }) => {
  const { company, user: riskUser } = await createIsolatedCompanyUser("ADMIN", "risk-edge");
  const adminCookie = await loginApi(request, riskUser.email);
  const [leaveDate, breakDate, shortBreakDate] = recentWeekdayDates(3);

  await prisma.approvalRequest.create({
    data: {
      companyId: company.id,
      requesterId: riskUser.id,
      type: "LEAVE",
      leaveType: "ANNUAL",
      leaveStartDate: dateOnly(leaveDate),
      leaveEndDate: dateOnly(leaveDate),
      leaveDuration: "FULL_DAY",
      reason: "Playwright full-day leave suppresses schedule risk",
      status: "APPROVED",
      reviewedAt: new Date()
    }
  });
  await prisma.workSchedule.createMany({
    data: [
      {
        companyId: company.id,
        userId: riskUser.id,
        workDate: dateOnly(leaveDate),
        shiftName: "PW leave schedule",
        scheduledStartAt: kstDateTime(leaveDate, 9, 0),
        scheduledEndAt: kstDateTime(leaveDate, 18, 0),
        breakMinutes: 60
      },
      {
        companyId: company.id,
        userId: riskUser.id,
        workDate: dateOnly(breakDate),
        shiftName: "PW break edge",
        scheduledStartAt: kstDateTime(breakDate, 9, 0),
        scheduledEndAt: kstDateTime(breakDate, 17, 0),
        breakMinutes: 60
      },
      {
        companyId: company.id,
        userId: riskUser.id,
        workDate: dateOnly(shortBreakDate),
        shiftName: "PW short break edge",
        scheduledStartAt: kstDateTime(shortBreakDate, 9, 0),
        scheduledEndAt: kstDateTime(shortBreakDate, 15, 0),
        breakMinutes: 30
      }
    ]
  });
  await createClosedSession({
    companyId: company.id,
    userId: riskUser.id,
    workDate: breakDate,
    checkInAt: kstDateTime(breakDate, 9, 0),
    checkOutAt: kstDateTime(breakDate, 17, 0),
    grossMinutes: 480,
    breakMinutes: 0,
    calculatedWorkMinutes: 480,
    overtimeMinutes: 0,
    approvedOvertimeMinutes: 0
  });
  await createClosedSession({
    companyId: company.id,
    userId: riskUser.id,
    workDate: shortBreakDate,
    checkInAt: kstDateTime(shortBreakDate, 9, 0),
    checkOutAt: kstDateTime(shortBreakDate, 15, 0),
    grossMinutes: 360,
    breakMinutes: 0,
    calculatedWorkMinutes: 360,
    overtimeMinutes: 0,
    approvedOvertimeMinutes: 0
  });

  await requestJson(request, adminCookie, "/api/risks/recalculate", "POST", {});
  const monthlyReport = await requestJson(request, adminCookie, `/api/reports/monthly?month=${shortBreakDate.slice(0, 7)}`);

  const risks = await prisma.riskSignal.findMany({
    where: {
      userId: riskUser.id,
      type: {
        in: ["MISSING_CHECK_IN_OUT", "SCHEDULE_MISMATCH", "BREAK_VIOLATION"]
      }
    }
  });
  const riskByTypeAndDate = new Set(
    risks.map((risk) => {
      const evidence = risk.evidence && typeof risk.evidence === "object" && !Array.isArray(risk.evidence) ? risk.evidence : {};
      return `${risk.type}:${evidence.workDate ?? ""}`;
    })
  );

  expect(riskByTypeAndDate.has(`MISSING_CHECK_IN_OUT:${leaveDate}`)).toBeFalsy();
  expect(riskByTypeAndDate.has(`SCHEDULE_MISMATCH:${leaveDate}`)).toBeFalsy();
  expect(riskByTypeAndDate.has(`BREAK_VIOLATION:${breakDate}`)).toBeTruthy();
  expect(riskByTypeAndDate.has(`BREAK_VIOLATION:${shortBreakDate}`)).toBeTruthy();
  expect(
    monthlyReport.breakRiskRows.some(
      (row) => row.workDate.startsWith(shortBreakDate) && row.requiredBreakMinutes === 30 && row.breakMinutes === 0
    )
  ).toBeTruthy();
});

import { expect, test } from "@playwright/test";

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
  const date = new Date(`${dateString}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + offset);
  return kstDate(date);
}

function addMonths(monthString, offset) {
  const date = new Date(`${monthString}-01T00:00:00+09:00`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return kstDate(date).slice(0, 7);
}

function weekStart(dateString) {
  const date = new Date(`${dateString}T12:00:00+09:00`);
  const day = date.getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  return addDays(dateString, -daysFromMonday);
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

async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ERR_ABORTED")) {
      throw error;
    }
  }
}

async function findClosableMonth(request, adminCookie, baseMonth) {
  for (let offset = 1; offset <= 12; offset += 1) {
    const month = addMonths(baseMonth, offset);
    const report = await requestJson(request, adminCookie, `/api/reports/payroll?month=${month}`);
    if (report.canClose) {
      return month;
    }
  }

  throw new Error("월 마감 가능한 테스트 월을 찾지 못했습니다.");
}

async function createTempEmployee(request, adminCookie) {
  const stamp = Date.now();
  const email = `pw-qa-${stamp}@gamsi.kr`;
  const invite = await requestJson(request, adminCookie, "/api/admin/invitations", "POST", {
    name: `PW QA ${String(stamp).slice(-4)}`,
    email,
    role: "EMPLOYEE"
  });
  const accept = await request.post(`/api/invitations/${invite.token}/accept`, {
    data: {
      password
    }
  });
  expect(accept.ok()).toBeTruthy();
  return { email };
}

test("핵심 대시보드 흐름이 UI와 API에서 함께 동작한다", async ({ page, request, baseURL }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const hrCookie = await loginApi(request, "hr@gamsi.kr");
  const tempEmployee = await createTempEmployee(request, adminCookie);
  const today = kstDate();
  const tomorrow = addDays(today, 1);
  const currentWeekStart = weekStart(today);
  const nextWeekStart = addDays(currentWeekStart, 7);
  const nextWeekEnd = addDays(nextWeekStart, 6);
  const sourceCopyDate = addDays(currentWeekStart, 1);
  const rangeStart = addDays(nextWeekStart, 2);
  const rangeEnd = addDays(nextWeekStart, 4);
  const copiedShiftName = "PW 주간 복사 근무";
  const recurringShiftName = "PW 반복 근무";
  const closableMonth = await findClosableMonth(request, adminCookie, today.slice(0, 7));

  await page.goto("/login");
  await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();
  const uiLogin = await page.context().request.post(`${baseURL}/api/auth/login`, {
    data: {
      email: tempEmployee.email,
      password
    }
  });
  expect(uiLogin.ok()).toBeTruthy();
  await safeGoto(page, "/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("attendance-check-in")).toBeVisible();
  await expect(page.getByTestId("attendance-check-out")).toBeVisible();
  await expect(page.getByTestId("attendance-status-submit")).toBeVisible();
  await expect(page.getByTestId("leave-request-submit")).toBeVisible();
  await expect(page.getByTestId("adjustment-request-submit")).toBeVisible();
  const tempCookie = await loginApi(request, tempEmployee.email);
  const me = await requestJson(request, tempCookie, "/api/me");

  const pushConfig = await requestJson(request, tempCookie, "/api/notifications/push/public-key");
  expect(pushConfig.enabled).toBeTruthy();
  expect(typeof pushConfig.publicKey).toBe("string");
  expect(pushConfig.publicKey.length).toBeGreaterThan(40);

  const dummyEndpoint = `https://example.com/playwright-push/${Date.now()}`;
  await requestJson(request, tempCookie, "/api/notifications/push/subscription", "POST", {
    endpoint: dummyEndpoint,
    expirationTime: null,
    keys: {
      p256dh: "dummy-p256dh-key",
      auth: "dummy-auth-key"
    }
  });
  await requestJson(request, tempCookie, "/api/notifications/push/subscription", "DELETE", {
    endpoint: dummyEndpoint
  });

  const sourceSchedule = await requestJson(request, hrCookie, "/api/schedules", "POST", {
    mode: "single",
    userId: me.user.id,
    workDate: sourceCopyDate,
    startTime: "09:00",
    endTime: "18:00",
    breakMinutes: 60,
    shiftName: copiedShiftName,
    note: "Playwright 주간 복사 원본"
  });
  expect(sourceSchedule.total).toBe(1);

  const copiedSchedule = await requestJson(request, hrCookie, "/api/schedules", "POST", {
    mode: "copy_week",
    userIds: [me.user.id],
    sourceWeekStart: currentWeekStart,
    targetWeekStart: nextWeekStart
  });
  expect(copiedSchedule.total).toBeGreaterThanOrEqual(1);

  const recurringSchedule = await requestJson(request, hrCookie, "/api/schedules", "POST", {
    mode: "range",
    userIds: [me.user.id],
    startDate: rangeStart,
    endDate: rangeEnd,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: "10:00",
    endTime: "19:00",
    breakMinutes: 60,
    shiftName: recurringShiftName,
    note: "Playwright 반복 스케줄"
  });
  expect(recurringSchedule.total).toBe(3);

  await requestJson(request, tempCookie, "/api/attendance/check-in", "POST", {});
  await requestJson(request, tempCookie, "/api/attendance/status", "POST", {
    status: "MEETING",
    reason: "Playwright 회귀 테스트 상태 변경"
  });
  await requestJson(request, tempCookie, "/api/attendance/check-out", "POST", {});
  const leaveRequest = await requestJson(request, tempCookie, "/api/approvals/leave", "POST", {
    leaveType: "OFFICIAL",
    startDate: tomorrow,
    endDate: tomorrow,
    duration: "FULL_DAY",
    requestedLeaveMinutes: 0,
    reason: "Playwright 회귀 테스트 휴가"
  });
  const adjustmentRequest = await requestJson(request, tempCookie, "/api/approvals/adjustment", "POST", {
    adjustmentType: "GENERAL",
    reason: "Playwright 회귀 테스트 정정"
  });

  const approvalInbox = await requestJson(request, hrCookie, "/api/manager/approvals");
  const leaveApproval = approvalInbox.approvals.find((approval) => approval.id === leaveRequest.id);
  const adjustmentApproval = approvalInbox.approvals.find((approval) => approval.id === adjustmentRequest.id);
  expect(leaveApproval).toBeTruthy();
  expect(adjustmentApproval).toBeTruthy();

  await requestJson(request, hrCookie, "/api/manager/approvals/bulk", "POST", {
    approvalIds: [leaveApproval.id],
    action: "approve",
    reviewNote: "Playwright 자동 승인"
  });
  await requestJson(request, hrCookie, "/api/manager/approvals/bulk", "POST", {
    approvalIds: [adjustmentApproval.id],
    action: "reject",
    reviewNote: "Playwright 자동 반려"
  });

  await requestJson(request, adminCookie, "/api/reports/month-close", "POST", {
    month: closableMonth,
    action: "close",
    reason: "Playwright 자동 월 마감"
  });
  await requestJson(request, adminCookie, "/api/reports/month-close", "POST", {
    month: closableMonth,
    action: "applyPayroll",
    reason: "Playwright 자동 급여 반영"
  });
  await requestJson(request, adminCookie, "/api/reports/month-close", "POST", {
    month: closableMonth,
    action: "markPayrollPending",
    reason: "Playwright 자동 급여 반영 해제"
  });
  const reopenRequest = await requestJson(request, hrCookie, "/api/reports/month-close", "POST", {
    month: closableMonth,
    action: "requestReopen",
    reason: "Playwright 자동 재오픈 요청"
  });
  await requestJson(request, adminCookie, "/api/reports/month-close", "POST", {
    month: closableMonth,
    action: "approveReopen",
    requestId: reopenRequest.requestId,
    reason: "Playwright 자동 재오픈 승인"
  });

  const immediateCalendarExport = await request.get(`${baseURL}/api/integrations/calendar/export?scope=company&from=${today}&to=${tomorrow}`, {
    headers: { cookie: adminCookie }
  });
  expect(immediateCalendarExport.ok()).toBeTruthy();

  const erpExport = await request.get(`${baseURL}/api/integrations/erp/export?month=${closableMonth}`, {
    headers: { cookie: adminCookie }
  });
  expect(erpExport.ok()).toBeTruthy();

  const payrollExport = await request.get(`${baseURL}/api/reports/payroll/export?month=${closableMonth}&mapped=1`, {
    headers: { cookie: adminCookie }
  });
  expect(payrollExport.ok()).toBeTruthy();

  const nextWeekCalendarExport = await request.get(
    `${baseURL}/api/integrations/calendar/export?scope=company&from=${nextWeekStart}&to=${nextWeekEnd}`,
    {
      headers: { cookie: adminCookie }
    }
  );
  expect(nextWeekCalendarExport.ok()).toBeTruthy();
  const calendarText = await nextWeekCalendarExport.text();
  expect(calendarText).toContain(copiedShiftName);
  expect(calendarText).toContain(recurringShiftName);

  await safeGoto(page, "/dashboard?view=employee");
  await expect(page.getByText(copiedShiftName)).toBeVisible();
  await expect(page.getByText(recurringShiftName).first()).toBeVisible();
  await safeGoto(page, "/dashboard?view=settings");
  await expect(page.getByRole("heading", { name: "계정 및 운영 설정" })).toBeVisible();
  const adminUiLogin = await page.context().request.post(`${baseURL}/api/auth/login`, {
    data: {
      email: "admin@gamsi.kr",
      password
    }
  });
  expect(adminUiLogin.ok()).toBeTruthy();
  await safeGoto(page, "/dashboard?view=settings");
  await expect(page.getByText("연동 상태 체크")).toBeVisible();
  await expect(page.getByText("배포 상태 체크")).toBeVisible();
  await expect(page.getByText("운영 자동화")).toBeVisible();
  await expect(page.getByText("증빙 보안과 감사")).toBeVisible();
  await expect(page.getByText("첫 회사 설정 Wizard")).toBeVisible();
  await safeGoto(page, "/dashboard?view=approvals");
  await expect(page.getByRole("button", { name: "일괄 수정" })).toBeVisible();
  await expect(page.getByRole("button", { name: "일괄 삭제" })).toBeVisible();
  await expect(page.getByText("주간 스케줄 보드")).toBeVisible();
});

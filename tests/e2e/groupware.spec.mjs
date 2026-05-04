import { expect, test } from "@playwright/test";
import { PrismaClient } from "../../src/generated/prisma/index.js";

const prisma = new PrismaClient();
const password = "password123!";

test.use({
  serviceWorkers: "block"
});

function firstCookie(setCookie) {
  if (!setCookie) {
    throw new Error("세션 쿠키가 없습니다.");
  }

  return setCookie.split(";")[0];
}

function kstMonth(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit"
  }).format(date);
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

async function addSessionCookie(page, cookie, baseURL) {
  await page.context().addCookies([
    {
      name: cookie.split("=")[0],
      value: cookie.split("=").slice(1).join("="),
      url: baseURL
    }
  ]);
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("그룹웨어 연락처, 공지, 메모, 실적, 급여명세, 전자결재가 동작한다", async ({ page, request, baseURL }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const employeeCookie = await loginApi(request, "employee@gamsi.kr");
  const hrCookie = await loginApi(request, "hr@gamsi.kr");
  const employee = await prisma.user.findUniqueOrThrow({
    where: {
      email: "employee@gamsi.kr"
    }
  });
  const hr = await prisma.user.findUniqueOrThrow({
    where: {
      email: "hr@gamsi.kr"
    }
  });
  await prisma.payrollStatementIssue.deleteMany({
    where: {
      companyId: employee.companyId,
      userId: employee.id,
      month: kstMonth()
    }
  });
  await addSessionCookie(page, adminCookie, baseURL);

  await page.goto(`/dashboard?view=groupware&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "그룹웨어" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "공지/게시판" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "사내 직원 연락처" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "실적관리" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "급여명세 다운로드" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "전자결재/문서함" })).toBeVisible();
  await expect(page.getByText("employee@gamsi.kr").first()).toBeVisible();

  const stamp = Date.now();
  const announcementTitle = `Playwright 그룹웨어 공지 ${stamp}`;
  const announcement = await requestJson(request, adminCookie, "/api/groupware/announcements", "POST", {
    title: announcementTitle,
    body: "전체 대상 읽음 확인 공지",
    audience: "ALL",
    isPinned: true
  });
  await requestJson(request, employeeCookie, `/api/groupware/announcements/${announcement.id}/read`, "POST", {});
  const announcementRead = await prisma.announcementRead.findUnique({
    where: {
      announcementId_userId: {
        announcementId: announcement.id,
        userId: employee.id
      }
    }
  });
  expect(announcementRead).toBeTruthy();
  const employeeAnnouncementNotification = await prisma.notification.findFirst({
    where: {
      userId: employee.id,
      type: "ANNOUNCEMENT",
      metadata: {
        path: ["announcementId"],
        equals: announcement.id
      }
    }
  });
  expect(employeeAnnouncementNotification).toBeTruthy();
  await page.goto(`/dashboard?view=groupware&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(announcementTitle)).toBeVisible();

  const memoText = `Playwright 그룹웨어 메모 ${Date.now()}`;
  await page.getByLabel("프로필 메모").fill(memoText);
  await page.getByRole("button", { name: "메모 저장" }).click();
  await expect(page.getByText("메모를 저장했습니다.")).toBeVisible();
  await expect(page.getByText(memoText)).toBeVisible();

  const thread = await prisma.workThread.findUniqueOrThrow({
    where: {
      companyId_targetType_targetId: {
        companyId: employee.companyId,
        targetType: "USER_PROFILE",
        targetId: employee.id
      }
    }
  });
  const comment = await prisma.workComment.findFirst({
    where: {
      threadId: thread.id,
      body: memoText
    }
  });
  expect(comment).toBeTruthy();

  const goalTitle = `Playwright 월간 처리량 ${stamp}`;
  const goal = await requestJson(request, adminCookie, "/api/groupware/performance-goals", "POST", {
    ownerType: "USER",
    userId: employee.id,
    month: kstMonth(),
    title: goalTitle,
    unit: "건",
    targetValue: 120,
    actualValue: 45
  });
  const updatedGoal = await requestJson(request, adminCookie, "/api/groupware/performance-goals", "PATCH", {
    id: goal.id,
    actualValue: 80,
    evaluationMemo: "Playwright 실적 평가"
  });
  expect(updatedGoal.actualValue).toBe(80);
  expect(updatedGoal.evaluationMemo).toBe("Playwright 실적 평가");

  const beforeIssue = await request.get(`${baseURL}/api/payroll-statements/${kstMonth()}?format=csv`, {
    headers: {
      cookie: employeeCookie
    }
  });
  expect(beforeIssue.ok()).toBeFalsy();

  const issueResult = await requestJson(request, hrCookie, "/api/groupware/payroll-statements/issue", "POST", {
    month: kstMonth(),
    userIds: [employee.id],
    status: "LOCKED",
    note: "Playwright 발행"
  });
  expect(issueResult.count).toBe(1);
  const payrollIssue = await prisma.payrollStatementIssue.findUnique({
    where: {
      companyId_userId_month: {
        companyId: employee.companyId,
        userId: employee.id,
        month: kstMonth()
      }
    }
  });
  expect(payrollIssue?.status).toBe("LOCKED");
  const employeePayrollNotification = await prisma.notification.findFirst({
    where: {
      userId: employee.id,
      type: "PAYROLL_STATEMENT",
      metadata: {
        path: ["month"],
        equals: kstMonth()
      }
    }
  });
  expect(employeePayrollNotification).toBeTruthy();
  const csv = await request.get(`${baseURL}/api/payroll-statements/${kstMonth()}?format=csv&userId=${employee.id}`, {
    headers: {
      cookie: adminCookie
    }
  });
  expect(csv.ok()).toBeTruthy();
  expect(await csv.text()).toContain("급여명세 기초자료");
  const employeeCsv = await request.get(`${baseURL}/api/payroll-statements/${kstMonth()}?format=csv`, {
    headers: {
      cookie: employeeCookie
    }
  });
  expect(employeeCsv.ok()).toBeTruthy();
  expect(await employeeCsv.text()).toContain("급여명세 기초자료");

  const documentTitle = `Playwright 지출결의 ${stamp}`;
  const document = await requestJson(request, employeeCookie, "/api/groupware/document-requests", "POST", {
    title: documentTitle,
    body: "장비 구매 비용 승인 요청",
    category: "EXPENSE",
    amount: 77000,
    reviewerId: hr.id
  });
  const documentThread = await prisma.workThread.findUnique({
    where: {
      companyId_targetType_targetId: {
        companyId: employee.companyId,
        targetType: "DOCUMENT_REQUEST",
        targetId: document.id
      }
    }
  });
  expect(documentThread?.status).toBe("OPEN");
  const reviewerNotification = await prisma.notification.findFirst({
    where: {
      userId: hr.id,
      type: "DOCUMENT_REQUEST",
      metadata: {
        path: ["documentRequestId"],
        equals: document.id
      }
    }
  });
  expect(reviewerNotification).toBeTruthy();
  const reviewedDocument = await requestJson(request, hrCookie, `/api/groupware/document-requests/${document.id}/review`, "POST", {
    status: "APPROVED",
    reviewNote: "Playwright 전자결재 승인"
  });
  expect(reviewedDocument.status).toBe("APPROVED");
  const resolvedDocumentThread = await prisma.workThread.findUnique({
    where: {
      companyId_targetType_targetId: {
        companyId: employee.companyId,
        targetType: "DOCUMENT_REQUEST",
        targetId: document.id
      }
    }
  });
  expect(resolvedDocumentThread?.status).toBe("RESOLVED");
  const requesterNotification = await prisma.notification.findFirst({
    where: {
      userId: employee.id,
      type: "DOCUMENT_REQUEST",
      metadata: {
        path: ["documentRequestId"],
        equals: document.id
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  expect(requesterNotification?.title).toContain("승인");
});

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

async function requestMultipart(request, cookie, path, multipart) {
  const response = await request.fetch(path, {
    method: "POST",
    headers: {
      cookie
    },
    multipart
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
  const managerCookie = await loginApi(request, "manager@gamsi.kr");
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
  const manager = await prisma.user.findUniqueOrThrow({
    where: {
      email: "manager@gamsi.kr"
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
  const announcement = await requestMultipart(request, adminCookie, "/api/groupware/announcements", {
    title: announcementTitle,
    body: "전체 대상 읽음 확인 공지",
    audience: "ALL",
    category: "HR",
    isPinned: "true",
    allowComments: "true",
    attachments: {
      name: "notice.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("공지 첨부")
    }
  });
  expect(announcement.attachmentCount).toBe(1);
  await requestJson(request, employeeCookie, `/api/groupware/announcements/${announcement.id}/read`, "POST", {});
  await requestJson(request, employeeCookie, `/api/groupware/announcements/${announcement.id}/comments`, "POST", {
    body: "Playwright 공지 댓글"
  });
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
  const announcementAttachment = await prisma.announcementAttachment.findFirstOrThrow({
    where: {
      announcementId: announcement.id
    }
  });
  const announcementAttachmentDownload = await request.get(`${baseURL}/api/groupware/announcement-attachments/${announcementAttachment.id}`, {
    headers: {
      cookie: employeeCookie
    }
  });
  expect(announcementAttachmentDownload.ok()).toBeTruthy();
  expect(await announcementAttachmentDownload.text()).toContain("공지 첨부");
  await page.goto(`/dashboard?view=groupware&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(announcementTitle)).toBeVisible();
  await expect(page.getByText("Playwright 공지 댓글").first()).toBeVisible();
  await page.goto(`/dashboard?view=groupware&groupwareSearch=${encodeURIComponent(announcementTitle)}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(announcementTitle).first()).toBeVisible();
  await page.goto(`/dashboard?view=groupware&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });

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
  const document = await requestMultipart(request, employeeCookie, "/api/groupware/document-requests", {
    title: documentTitle,
    body: "장비 구매 비용 승인 요청",
    category: "EXPENSE",
    amount: "77000",
    reviewerId: hr.id,
    vendor: "Playwright 공급사",
    dueDate: "2026-05-15",
    budgetCode: "QA-77",
    attachments: {
      name: "expense.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("전자결재 첨부")
    }
  });
  expect(document.documentNumber).toContain("DOC-");
  expect(document.attachmentCount).toBe(1);
  const steps = await prisma.documentApprovalStep.findMany({
    where: {
      documentRequestId: document.id
    },
    orderBy: {
      stepOrder: "asc"
    }
  });
  expect(steps.map((step) => step.approverId)).toContain(manager.id);
  expect(steps.map((step) => step.approverId)).toContain(hr.id);
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
      userId: manager.id,
      type: "DOCUMENT_REQUEST",
      metadata: {
        path: ["documentRequestId"],
        equals: document.id
      }
    }
  });
  expect(reviewerNotification).toBeTruthy();
  const managerReviewedDocument = await requestJson(request, managerCookie, `/api/groupware/document-requests/${document.id}/review`, "POST", {
    status: "APPROVED",
    reviewNote: "Playwright 팀장 승인"
  });
  expect(managerReviewedDocument.status).toBe("PENDING");
  const hrReviewedDocument = await requestJson(request, hrCookie, `/api/groupware/document-requests/${document.id}/review`, "POST", {
    status: "APPROVED",
    reviewNote: "Playwright HR 승인"
  });
  expect(hrReviewedDocument.status).toBe("PENDING");
  const reviewedDocument = await requestJson(request, adminCookie, `/api/groupware/document-requests/${document.id}/review`, "POST", {
    status: "APPROVED",
    reviewNote: "Playwright 관리자 승인"
  });
  expect(reviewedDocument.status).toBe("APPROVED");
  const documentAttachment = await prisma.documentAttachment.findFirstOrThrow({
    where: {
      documentRequestId: document.id
    }
  });
  const documentAttachmentDownload = await request.get(`${baseURL}/api/groupware/document-attachments/${documentAttachment.id}`, {
    headers: {
      cookie: employeeCookie
    }
  });
  expect(documentAttachmentDownload.ok()).toBeTruthy();
  expect(await documentAttachmentDownload.text()).toContain("전자결재 첨부");
  const documentPdf = await request.get(`${baseURL}/api/groupware/document-requests/${document.id}/pdf`, {
    headers: {
      cookie: employeeCookie
    }
  });
  expect(documentPdf.ok()).toBeTruthy();
  expect(documentPdf.headers()["content-type"]).toContain("application/pdf");
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

  const library = await requestMultipart(request, adminCookie, "/api/groupware/library", {
    title: `Playwright 회사 규정 ${stamp}`,
    category: "POLICY",
    accessScope: "ALL",
    description: "Playwright 자료실 등록",
    note: "초판",
    file: {
      name: "policy.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("자료실 v1")
    }
  });
  expect(library.version.versionNo).toBe(1);
  const libraryV2 = await requestMultipart(request, adminCookie, "/api/groupware/library", {
    itemId: library.item.id,
    note: "개정",
    file: {
      name: "policy-v2.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("자료실 v2")
    }
  });
  expect(libraryV2.version.versionNo).toBe(2);
  const libraryDownload = await request.get(`${baseURL}/api/groupware/library/versions/${libraryV2.version.id}`, {
    headers: {
      cookie: employeeCookie
    }
  });
  expect(libraryDownload.ok()).toBeTruthy();
  expect(await libraryDownload.text()).toContain("자료실 v2");

  const notificationCenter = await requestJson(request, employeeCookie, "/api/notifications");
  expect(notificationCenter.groupwareSummary.payrollStatementIssues).toBeGreaterThanOrEqual(1);
  expect(notificationCenter.groupwareSummary.myApprovedDocuments).toBeGreaterThanOrEqual(1);
});

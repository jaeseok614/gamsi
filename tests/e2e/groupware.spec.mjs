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

async function groupwareActors(request) {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const employeeCookie = await loginApi(request, "employee@gamsi.kr");
  const hrCookie = await loginApi(request, "hr@gamsi.kr");
  const managerCookie = await loginApi(request, "manager@gamsi.kr");
  const fieldCookie = await loginApi(request, "field@gamsi.kr");
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
  const admin = await prisma.user.findUniqueOrThrow({
    where: {
      email: "admin@gamsi.kr"
    }
  });
  const field = await prisma.user.findUniqueOrThrow({
    where: {
      email: "field@gamsi.kr"
    }
  });

  return {
    adminCookie,
    employeeCookie,
    hrCookie,
    managerCookie,
    fieldCookie,
    admin,
    employee,
    hr,
    manager,
    field
  };
}

async function requestStatus(request, cookie, path, method = "GET", body) {
  const response = await request.fetch(path, {
    method,
    headers: {
      cookie,
      "content-type": "application/json"
    },
    data: body
  });
  return {
    ok: response.ok(),
    status: response.status(),
    body: await response.json().catch(() => ({}))
  };
}

async function expectAttachmentDownloadAudit(companyId, targetType, targetId) {
  await expect
    .poll(() =>
      prisma.auditLog.count({
        where: {
          companyId,
          action: "attachment.downloaded",
          targetType,
          targetId
        }
      })
    )
    .toBeGreaterThanOrEqual(1);
}

function watchReactKeyWarnings(page) {
  const warnings = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("Encountered two children with the same key")) {
      warnings.push(text);
    }
  });
  return () => expect(warnings).toEqual([]);
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("그룹웨어 핵심 탭과 기존 링크가 권한별로 렌더링된다", async ({ request }) => {
  const { adminCookie, hrCookie, managerCookie, employeeCookie } = await groupwareActors(request);
  const cookies = [adminCookie, hrCookie, managerCookie, employeeCookie];
  const tabs = ["overview", "announcements", "documents", "library", "operations"];

  for (const cookie of cookies) {
    for (const tab of tabs) {
      const response = await request.fetch(`/dashboard?view=groupware&groupwareTab=${tab}`, {
        headers: {
          cookie
        }
      });
      expect(response.ok()).toBeTruthy();
      const html = await response.text();
      expect(html).toContain("개요");
      expect(html).toContain("공지사항");
      expect(html).toContain("전자결재");
      expect(html).toContain("자료실");
      expect(html).toContain("급여·운영");
      expect(html).not.toContain("오류 정보를 기록했습니다");
    }
  }

  for (const legacyTab of ["board", "profile", "payroll"]) {
    const response = await request.fetch(`/dashboard?view=groupware&groupwareTab=${legacyTab}`, {
      headers: {
        cookie: adminCookie
      }
    });
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    expect(html).toContain(legacyTab === "board" ? "게시판" : legacyTab === "profile" ? "직원 메모" : "급여명세");
    expect(html).not.toContain("오류 정보를 기록했습니다");
  }
});

test("그룹웨어 공지 댓글 첨부 검색이 동작한다", async ({ page, request, baseURL }) => {
  const { adminCookie, employeeCookie, fieldCookie, employee } = await groupwareActors(request);
  const expectNoReactKeyWarnings = watchReactKeyWarnings(page);
  await addSessionCookie(page, adminCookie, baseURL);

  await page.goto(`/dashboard?view=groupware&groupwareTab=contacts&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "그룹웨어" })).toBeVisible();
  await expect(page.getByRole("link", { name: /개요/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /공지사항/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /전자결재/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /자료실/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /급여·운영/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "사내 직원 연락처" })).toBeVisible();
  await page.goto(`/dashboard?view=groupware&groupwareTab=announcements&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "공지사항" })).toBeVisible();

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
  expect(employeeAnnouncementNotification?.actionUrl).toContain(`groupwareAnnouncementId=${announcement.id}`);
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
  await expectAttachmentDownloadAudit(employee.companyId, "announcement_attachment", announcementAttachment.id);
  const teamOnlyAnnouncement = await requestMultipart(request, adminCookie, "/api/groupware/announcements", {
    title: `Playwright 팀 전용 공지 ${stamp}`,
    body: "다른 팀 직원은 첨부를 볼 수 없어야 합니다.",
    audience: "TEAM",
    teamId: employee.teamId,
    category: "HR",
    attachments: {
      name: "team-only-notice.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("팀 전용 공지 첨부")
    }
  });
  const teamOnlyAttachment = await prisma.announcementAttachment.findFirstOrThrow({
    where: {
      announcementId: teamOnlyAnnouncement.id
    }
  });
  const blockedTeamNoticeDownload = await request.get(`${baseURL}/api/groupware/announcement-attachments/${teamOnlyAttachment.id}`, {
    headers: {
      cookie: fieldCookie
    }
  });
  expect(blockedTeamNoticeDownload.ok()).toBeFalsy();
  await page.goto(`/dashboard?view=groupware&groupwareTab=announcements&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(announcementTitle)).toBeVisible();
  await expect(page.getByText("Playwright 공지 댓글").first()).toBeVisible();
  await page.goto(`/dashboard?view=groupware&groupwareSearch=${encodeURIComponent(announcementTitle)}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(announcementTitle).first()).toBeVisible();

  const boardTitle = `Playwright 그룹웨어 게시글 ${stamp}`;
  const boardPost = await requestJson(request, adminCookie, "/api/groupware/announcements", "POST", {
    title: boardTitle,
    body: "게시판 분리 확인",
    audience: "ALL",
    category: "TEAM",
    allowComments: true
  });
  expect(boardPost.category).toBe("TEAM");
  await page.goto(`/dashboard?view=groupware&groupwareTab=board&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "게시판" })).toBeVisible();
  await expect(page.locator("#groupware-board").getByText(boardTitle)).toBeVisible();
  await expect(page.locator("#groupware-board").getByText(announcementTitle)).not.toBeVisible();
  await page.goto(`/dashboard?view=groupware&groupwareSearch=${encodeURIComponent(boardTitle)}`, { waitUntil: "domcontentloaded" });
  const boardSearchResult = page.getByRole("link", { name: new RegExp(boardTitle) }).first();
  await expect(boardSearchResult).toBeVisible();
  await expect(boardSearchResult).toHaveAttribute("href", /groupwareTab=announcements/);
  await expect(boardSearchResult).toHaveAttribute("href", new RegExp(`groupwareAnnouncementId=${boardPost.id}`));

  await page.goto(`/dashboard?view=groupware&groupwareTab=operations`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "운영 로그" })).toBeVisible();
  await expect(page.getByText("게시물 등록").first()).toBeVisible();

  await page.goto(`/dashboard?view=groupware&groupwareTab=announcements&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });
  expectNoReactKeyWarnings();
});

test("그룹웨어 메모 실적 급여명세가 동작한다", async ({ page, request, baseURL }) => {
  const { adminCookie, employeeCookie, hrCookie, employee, hr, manager } = await groupwareActors(request);
  const stamp = Date.now();
  await prisma.payrollStatementIssue.deleteMany({
    where: {
      companyId: employee.companyId,
      userId: employee.id,
      month: kstMonth()
    }
  });
  await addSessionCookie(page, adminCookie, baseURL);
  await page.goto(`/dashboard?view=groupware&groupwareTab=profile&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });

  const memoText = `Playwright 그룹웨어 메모 ${Date.now()}`;
  await requestJson(request, adminCookie, "/api/groupware/profile-memos", "POST", {
    userId: employee.id,
    memo: memoText,
    assigneeId: manager.id,
    mentionUserIds: [hr.id]
  });
  await page.reload({ waitUntil: "domcontentloaded" });
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
  await page.goto(`/dashboard?view=groupware&groupwareTab=performance&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "실적관리" })).toBeVisible();
  await expect(page.getByText(goalTitle)).toBeVisible();

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
  await page.goto(`/dashboard?view=groupware&groupwareTab=payroll&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "급여명세 다운로드" })).toBeVisible();

  const notificationCenter = await requestJson(request, employeeCookie, "/api/notifications");
  expect(notificationCenter.groupwareSummary.payrollStatementIssues).toBeGreaterThanOrEqual(1);
});

test("권한별 그룹웨어 회귀와 전자결재 고도화 흐름이 동작한다", async ({ page, request, baseURL }) => {
  const { adminCookie, employeeCookie, hrCookie, employee, hr, manager } = await groupwareActors(request);
  const stamp = Date.now();

  const employeeNoticeAttempt = await requestStatus(request, employeeCookie, "/api/groupware/announcements", "POST", {
    title: `직원 공지 시도 ${stamp}`,
    body: "직원은 공지를 발행할 수 없어야 합니다.",
    audience: "ALL",
    category: "HR"
  });
  expect(employeeNoticeAttempt.ok).toBeFalsy();

  const employeeBoard = await requestJson(request, employeeCookie, "/api/groupware/announcements", "POST", {
    title: `직원 게시글 ${stamp}`,
    body: "직원 게시판 작성 회귀",
    audience: "ALL",
    category: "TEAM",
    allowComments: true
  });
  expect(employeeBoard.category).toBe("TEAM");

  const library = await requestMultipart(request, adminCookie, "/api/groupware/library", {
    title: `권한 테스트 자료 ${stamp}`,
    category: "POLICY",
    accessScope: "ALL",
    description: "직원 수정 차단 회귀",
    file: {
      name: "role-policy.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("권한 테스트 자료")
    }
  });
  const employeeLibraryPatch = await requestStatus(request, employeeCookie, `/api/groupware/library/${library.item.id}`, "PATCH", {
    title: "직원 수정 시도"
  });
  expect(employeeLibraryPatch.ok).toBeFalsy();

  const document = await requestMultipart(request, employeeCookie, "/api/groupware/document-requests", {
    title: `결재 고도화 ${stamp}`,
    body: "결재 의견, 대리 결재, 반려 후 재상신 회귀",
    category: "GENERAL",
    reviewerId: manager.id,
    approvalStepUserIds: manager.id,
    attachments: {
      name: "advanced-approval.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("전자결재 고도화 첨부")
    }
  });
  const firstStep = await prisma.documentApprovalStep.findFirstOrThrow({
    where: {
      documentRequestId: document.id
    },
    orderBy: {
      stepOrder: "asc"
    }
  });
  await requestJson(request, employeeCookie, `/api/groupware/document-requests/${document.id}/approval-line`, "PATCH", {
    stepId: firstStep.id,
    approverId: manager.id
  });
  const proxyReviewed = await requestJson(request, adminCookie, `/api/groupware/document-requests/${document.id}/review`, "POST", {
    status: "APPROVED",
    reviewNote: "관리자가 팀장 대신 대리 승인",
    delegateForUserId: manager.id
  });
  expect(proxyReviewed.status).toBe("APPROVED");
  const proxyAudit = await prisma.auditLog.findFirst({
    where: {
      companyId: employee.companyId,
      action: "document_request.delegated_reviewed",
      targetId: document.id
    }
  });
  expect(proxyAudit).toBeTruthy();

  const rejectedDocument = await requestMultipart(request, employeeCookie, "/api/groupware/document-requests", {
    title: `재상신 대상 ${stamp}`,
    body: "반려 사유 템플릿 후 재상신",
    category: "PURCHASE",
    reviewerId: hr.id,
    approvalStepUserIds: hr.id
  });
  const rejected = await requestJson(request, hrCookie, `/api/groupware/document-requests/${rejectedDocument.id}/review`, "POST", {
    status: "REJECTED",
    reviewNote: "증빙 자료가 부족합니다."
  });
  expect(rejected.status).toBe("REJECTED");
  const resubmitted = await requestJson(request, employeeCookie, `/api/groupware/document-requests/${rejectedDocument.id}/resubmit`, "POST", {});
  expect(resubmitted.status).toBe("PENDING");
  expect(resubmitted.documentNumber).not.toBe(rejectedDocument.documentNumber);

  const savedSearch = await requestJson(request, employeeCookie, "/api/groupware/search-presets", "POST", {
    name: "내 게시글",
    filters: {
      type: "BOARD",
      authorId: employee.id
    }
  });
  expect(savedSearch.presets.some((preset) => preset.name === "내 게시글")).toBeTruthy();

  await addSessionCookie(page, employeeCookie, baseURL);
  await page.goto(`/dashboard?view=groupware&groupwareTab=operations`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("운영 로그는 관리자, 인사 담당, 팀장 권한에서 확인할 수 있습니다.")).toBeVisible();
  await page.goto(`/dashboard?view=groupware&groupwareSearchType=BOARD&groupwareSearchAuthorId=${employee.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(employeeBoard.title).first()).toBeVisible();

  await addSessionCookie(page, adminCookie, baseURL);
  await page.goto(`/dashboard?view=groupware&groupwareTab=operations`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("대리 결재 처리").first()).toBeVisible();
});

test("그룹웨어 전자결재 PDF 첨부 자료실이 동작한다", async ({ request, baseURL }) => {
  test.setTimeout(120_000);
  const { adminCookie, employeeCookie, hrCookie, managerCookie, fieldCookie, employee, hr, manager } = await groupwareActors(request);
  const stamp = Date.now();
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
  await expectAttachmentDownloadAudit(employee.companyId, "document_attachment", documentAttachment.id);
  const blockedDocumentAttachmentDownload = await request.get(`${baseURL}/api/groupware/document-attachments/${documentAttachment.id}`, {
    headers: {
      cookie: fieldCookie
    }
  });
  expect(blockedDocumentAttachmentDownload.ok()).toBeFalsy();
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
  await expectAttachmentDownloadAudit(employee.companyId, "document_library_version", libraryV2.version.id);
  const hrOnlyLibrary = await requestMultipart(request, adminCookie, "/api/groupware/library", {
    title: `Playwright HR 전용 자료 ${stamp}`,
    category: "PAYROLL",
    accessScope: "HR",
    description: "직원 접근 차단 자료",
    file: {
      name: "hr-only.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("HR 전용 자료")
    }
  });
  const blockedHrLibraryDownload = await request.get(`${baseURL}/api/groupware/library/versions/${hrOnlyLibrary.version.id}`, {
    headers: {
      cookie: employeeCookie
    }
  });
  expect(blockedHrLibraryDownload.ok()).toBeFalsy();
  await expect
    .poll(() =>
      prisma.auditLog.count({
        where: {
          companyId: employee.companyId,
          action: "document_library.version.created",
          targetId: libraryV2.version.id
        }
      })
    )
    .toBeGreaterThanOrEqual(1);

  const notificationCenter = await requestJson(request, employeeCookie, "/api/notifications");
  expect(notificationCenter.groupwareSummary.myApprovedDocuments).toBeGreaterThanOrEqual(1);
});

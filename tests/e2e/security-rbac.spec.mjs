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

  return prisma.user.findUniqueOrThrow({
    where: {
      email
    }
  });
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

async function requestStatus(request, cookie, path, method = "GET", body) {
  const response = await request.fetch(path, {
    method,
    headers: {
      cookie,
      "content-type": "application/json"
    },
    data: body
  });
  return response.status();
}

async function postAdjustmentMultipart(request, cookie, fields) {
  return request.post("/api/approvals/adjustment", {
    headers: {
      cookie
    },
    multipart: fields
  });
}

async function createSecondCompanyUser(role, label) {
  const passwordHash = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@gamsi.kr" } })).passwordHash;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const company = await prisma.company.create({
    data: {
      name: `PW 격리 회사 ${stamp}`
    }
  });
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      name: `PW ${label}`,
      email: `pw-${label}-${stamp}@other.example`,
      passwordHash,
      role
    }
  });
  return { company, user };
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("직원은 관리자/리포트 API에 접근할 수 없다", async ({ request }) => {
  const employeeCookie = await loginApi(request, "employee@gamsi.kr");

  await expect(requestStatus(request, employeeCookie, "/api/admin/ops/status")).resolves.toBe(403);
  await expect(requestStatus(request, employeeCookie, "/api/admin/teams", "POST", { name: "blocked" })).resolves.toBe(403);
  await expect(requestStatus(request, employeeCookie, `/api/reports/payroll?month=${kstDate().slice(0, 7)}`)).resolves.toBe(403);
});

test("회사별 리포트와 첨부 파일은 다른 회사 사용자에게 노출되지 않는다", async ({ request }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const hrCookie = await loginApi(request, "hr@gamsi.kr");
  const attachmentOwner = await createTempEmployee(request, adminCookie, "attach-owner");
  const otherCompanyHr = await createSecondCompanyUser("HR", "other-hr");
  const otherCompanyCookie = await loginApi(request, otherCompanyHr.user.email);

  const uploadResponse = await postAdjustmentMultipart(request, await loginApi(request, attachmentOwner.email), {
    reason: "Playwright valid attachment proof",
    attachments: {
      name: "field-proof.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("field proof")
    }
  });
  expect(uploadResponse.ok()).toBeTruthy();
  const uploadedApproval = await uploadResponse.json();
  const attachment = await prisma.requestAttachment.findFirstOrThrow({
    where: {
      approvalRequestId: uploadedApproval.id
    }
  });

  const otherCompanyDownload = await request.fetch(`/api/attachments/${attachment.id}`, {
    headers: {
      cookie: otherCompanyCookie
    }
  });
  expect(otherCompanyDownload.status()).toBe(404);

  const ownerDownload = await request.fetch(`/api/attachments/${attachment.id}`, {
    headers: {
      cookie: await loginApi(request, attachmentOwner.email)
    }
  });
  expect(ownerDownload.ok()).toBeTruthy();

  const hrDownload = await request.fetch(`/api/attachments/${attachment.id}`, {
    headers: {
      cookie: hrCookie
    }
  });
  expect(hrDownload.ok()).toBeTruthy();

  const downloadAuditCount = await prisma.auditLog.count({
    where: {
      companyId: attachmentOwner.companyId,
      action: "attachment.downloaded",
      targetId: attachment.id
    }
  });
  expect(downloadAuditCount).toBeGreaterThanOrEqual(2);

  const announcement = await requestMultipart(request, adminCookie, "/api/groupware/announcements", {
    title: `PW RBAC 공지 ${Date.now()}`,
    body: "다른 회사에는 보이면 안 되는 공지",
    audience: "ALL",
    attachments: {
      name: "company-notice.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("main company notice")
    }
  });
  const announcementAttachment = await prisma.announcementAttachment.findFirstOrThrow({
    where: {
      announcementId: announcement.id
    }
  });
  const otherCompanyAnnouncementDownload = await request.fetch(`/api/groupware/announcement-attachments/${announcementAttachment.id}`, {
    headers: {
      cookie: otherCompanyCookie
    }
  });
  expect(otherCompanyAnnouncementDownload.status()).toBe(404);

  const document = await requestMultipart(request, await loginApi(request, attachmentOwner.email), "/api/groupware/document-requests", {
    title: `PW RBAC 문서 ${Date.now()}`,
    body: "다른 회사에는 보이면 안 되는 결재",
    category: "GENERAL",
    attachments: {
      name: "company-document.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("main company document")
    }
  });
  const documentAttachment = await prisma.documentAttachment.findFirstOrThrow({
    where: {
      documentRequestId: document.id
    }
  });
  const otherCompanyDocumentDownload = await request.fetch(`/api/groupware/document-attachments/${documentAttachment.id}`, {
    headers: {
      cookie: otherCompanyCookie
    }
  });
  expect(otherCompanyDocumentDownload.status()).toBe(404);

  const library = await requestMultipart(request, adminCookie, "/api/groupware/library", {
    title: `PW RBAC 자료 ${Date.now()}`,
    category: "POLICY",
    accessScope: "ALL",
    file: {
      name: "company-library.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("main company library")
    }
  });
  const otherCompanyLibraryDownload = await request.fetch(`/api/groupware/library/versions/${library.version.id}`, {
    headers: {
      cookie: otherCompanyCookie
    }
  });
  expect(otherCompanyLibraryDownload.status()).toBe(404);

  const mainCompanyReport = await requestJson(request, hrCookie, `/api/reports/payroll?month=${kstDate().slice(0, 7)}`);
  expect(mainCompanyReport.payrollRows.some((row) => row.user.email === otherCompanyHr.user.email)).toBeFalsy();

  const otherCompanyReport = await requestJson(request, otherCompanyCookie, `/api/reports/payroll?month=${kstDate().slice(0, 7)}`);
  expect(otherCompanyReport.payrollRows.some((row) => row.user.email === "admin@gamsi.kr")).toBeFalsy();
  expect(otherCompanyReport.payrollRows.some((row) => row.user.email === otherCompanyHr.user.email)).toBeTruthy();
});

test("그룹웨어 접근 권한과 다운로드 감사 로그가 역할과 팀 범위를 따른다", async ({ request }) => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@gamsi.kr" } });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const teamA = await prisma.team.create({
    data: {
      companyId: admin.companyId,
      name: `PW groupware A ${stamp}`
    }
  });
  const teamB = await prisma.team.create({
    data: {
      companyId: admin.companyId,
      name: `PW groupware B ${stamp}`
    }
  });
  const managerA = await prisma.user.create({
    data: {
      companyId: admin.companyId,
      teamId: teamA.id,
      name: `PW gw manager ${stamp}`,
      email: `pw-gw-manager-${stamp}@gamsi.kr`,
      passwordHash: admin.passwordHash,
      role: "MANAGER"
    }
  });
  await prisma.team.update({
    where: {
      id: teamA.id
    },
    data: {
      managerUserId: managerA.id
    }
  });
  const employeeA = await prisma.user.create({
    data: {
      companyId: admin.companyId,
      teamId: teamA.id,
      name: `PW gw employee A ${stamp}`,
      email: `pw-gw-employee-a-${stamp}@gamsi.kr`,
      passwordHash: admin.passwordHash,
      role: "EMPLOYEE"
    }
  });
  const employeeB = await prisma.user.create({
    data: {
      companyId: admin.companyId,
      teamId: teamB.id,
      name: `PW gw employee B ${stamp}`,
      email: `pw-gw-employee-b-${stamp}@gamsi.kr`,
      passwordHash: admin.passwordHash,
      role: "EMPLOYEE"
    }
  });

  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const hrCookie = await loginApi(request, "hr@gamsi.kr");
  const managerCookie = await loginApi(request, managerA.email);
  const employeeACookie = await loginApi(request, employeeA.email);
  const employeeBCookie = await loginApi(request, employeeB.email);

  await expect(
    requestStatus(request, employeeACookie, "/api/groupware/announcements", "POST", {
      title: "PW blocked company notice",
      body: "직원은 회사 공지를 등록할 수 없습니다.",
      category: "NOTICE",
      audience: "ALL"
    })
  ).resolves.toBe(400);
  await expect(
    requestStatus(request, managerCookie, "/api/groupware/announcements", "POST", {
      title: "PW blocked other team notice",
      body: "팀장은 자기 팀 밖 팀 공지를 등록할 수 없습니다.",
      category: "TEAM",
      audience: "TEAM",
      teamId: teamB.id
    })
  ).resolves.toBe(400);

  const teamAnnouncement = await requestMultipart(request, employeeACookie, "/api/groupware/announcements", {
    title: `PW 팀 게시글 ${stamp}`,
    body: "같은 팀만 첨부를 볼 수 있어야 합니다.",
    category: "TEAM",
    audience: "TEAM",
    teamId: teamA.id,
    allowComments: "true",
    attachments: {
      name: "team-only.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("team only")
    }
  });
  const teamAttachment = await prisma.announcementAttachment.findFirstOrThrow({
    where: {
      announcementId: teamAnnouncement.id
    }
  });
  const outsideTeamAnnouncementDownload = await request.fetch(`/api/groupware/announcement-attachments/${teamAttachment.id}`, {
    headers: {
      cookie: employeeBCookie
    }
  });
  expect(outsideTeamAnnouncementDownload.status()).toBe(404);
  const sameTeamAnnouncementDownload = await request.fetch(`/api/groupware/announcement-attachments/${teamAttachment.id}`, {
    headers: {
      cookie: employeeACookie
    }
  });
  expect(sameTeamAnnouncementDownload.ok()).toBeTruthy();
  await expect(
    prisma.auditLog.count({
      where: {
        companyId: admin.companyId,
        action: "attachment.downloaded",
        targetType: "announcement_attachment",
        targetId: teamAttachment.id
      }
    })
  ).resolves.toBeGreaterThanOrEqual(1);

  const document = await requestMultipart(request, employeeACookie, "/api/groupware/document-requests", {
    title: `PW 권한 문서 ${stamp}`,
    body: "요청자, 현재 결재자, HR/Admin만 첨부를 볼 수 있어야 합니다.",
    category: "GENERAL",
    reviewerId: managerA.id,
    attachments: {
      name: "document-private.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("document private")
    }
  });
  const documentAttachment = await prisma.documentAttachment.findFirstOrThrow({
    where: {
      documentRequestId: document.id
    }
  });
  const unrelatedDocumentDownload = await request.fetch(`/api/groupware/document-attachments/${documentAttachment.id}`, {
    headers: {
      cookie: employeeBCookie
    }
  });
  expect(unrelatedDocumentDownload.status()).toBe(404);
  const managerDocumentDownload = await request.fetch(`/api/groupware/document-attachments/${documentAttachment.id}`, {
    headers: {
      cookie: managerCookie
    }
  });
  expect(managerDocumentDownload.ok()).toBeTruthy();
  const hrDocumentDownload = await request.fetch(`/api/groupware/document-attachments/${documentAttachment.id}`, {
    headers: {
      cookie: hrCookie
    }
  });
  expect(hrDocumentDownload.ok()).toBeTruthy();
  await expect(
    prisma.auditLog.count({
      where: {
        companyId: admin.companyId,
        action: "attachment.downloaded",
        targetType: "document_attachment",
        targetId: documentAttachment.id
      }
    })
  ).resolves.toBeGreaterThanOrEqual(2);

  const hrLibrary = await requestMultipart(request, adminCookie, "/api/groupware/library", {
    title: `PW HR 자료 ${stamp}`,
    category: "PAYROLL",
    accessScope: "HR",
    file: {
      name: "hr-only.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hr only")
    }
  });
  const employeeHrLibraryDownload = await request.fetch(`/api/groupware/library/versions/${hrLibrary.version.id}`, {
    headers: {
      cookie: employeeACookie
    }
  });
  expect(employeeHrLibraryDownload.status()).toBe(404);
  const hrLibraryDownload = await request.fetch(`/api/groupware/library/versions/${hrLibrary.version.id}`, {
    headers: {
      cookie: hrCookie
    }
  });
  expect(hrLibraryDownload.ok()).toBeTruthy();

  const teamLibrary = await requestMultipart(request, managerCookie, "/api/groupware/library", {
    title: `PW 팀 자료 ${stamp}`,
    category: "POLICY",
    accessScope: "TEAM",
    teamId: teamA.id,
    file: {
      name: "team-library.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("team library")
    }
  });
  const outsideTeamLibraryDownload = await request.fetch(`/api/groupware/library/versions/${teamLibrary.version.id}`, {
    headers: {
      cookie: employeeBCookie
    }
  });
  expect(outsideTeamLibraryDownload.status()).toBe(404);
  const sameTeamLibraryDownload = await request.fetch(`/api/groupware/library/versions/${teamLibrary.version.id}`, {
    headers: {
      cookie: employeeACookie
    }
  });
  expect(sameTeamLibraryDownload.ok()).toBeTruthy();
  await expect(
    prisma.auditLog.count({
      where: {
        companyId: admin.companyId,
        action: "attachment.downloaded",
        targetType: "document_library_version",
        targetId: {
          in: [hrLibrary.version.id, teamLibrary.version.id]
        }
      }
    })
  ).resolves.toBeGreaterThanOrEqual(2);
});

test("보관기간이 지난 증빙 첨부는 일반 직원에게 차단되고 인사 담당은 조회할 수 있다", async ({ request }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const employee = await createTempEmployee(request, adminCookie, "retention");
  const employeeCookie = await loginApi(request, employee.email);
  const hrCookie = await loginApi(request, "hr@gamsi.kr");
  const uploadResponse = await postAdjustmentMultipart(request, employeeCookie, {
    reason: "Playwright retention proof",
    attachments: {
      name: "old-proof.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("old proof")
    }
  });
  expect(uploadResponse.ok()).toBeTruthy();
  const approval = await uploadResponse.json();
  const attachment = await prisma.requestAttachment.findFirstOrThrow({
    where: {
      approvalRequestId: approval.id
    }
  });
  await prisma.requestAttachment.update({
    where: {
      id: attachment.id
    },
    data: {
      createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
    }
  });

  const employeeDownload = await request.fetch(`/api/attachments/${attachment.id}`, {
    headers: {
      cookie: employeeCookie
    }
  });
  expect(employeeDownload.status()).toBe(410);

  const hrDownload = await request.fetch(`/api/attachments/${attachment.id}`, {
    headers: {
      cookie: hrCookie
    }
  });
  expect(hrDownload.ok()).toBeTruthy();
  expect(hrDownload.headers()["x-workguard-retention-days"]).toBe("365");
});

test("팀장은 자기 범위 밖 승인 요청을 조회하거나 처리할 수 없다", async ({ request }) => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@gamsi.kr" } });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const teamA = await prisma.team.create({
    data: {
      companyId: admin.companyId,
      name: `PW manager team ${stamp}`
    }
  });
  const teamB = await prisma.team.create({
    data: {
      companyId: admin.companyId,
      name: `PW other team ${stamp}`
    }
  });
  const manager = await prisma.user.create({
    data: {
      companyId: admin.companyId,
      teamId: teamA.id,
      name: `PW manager ${stamp}`,
      email: `pw-manager-${stamp}@gamsi.kr`,
      passwordHash: admin.passwordHash,
      role: "MANAGER"
    }
  });
  await prisma.team.update({
    where: {
      id: teamA.id
    },
    data: {
      managerUserId: manager.id
    }
  });
  const outsideEmployee = await prisma.user.create({
    data: {
      companyId: admin.companyId,
      teamId: teamB.id,
      name: `PW outside ${stamp}`,
      email: `pw-outside-${stamp}@gamsi.kr`,
      passwordHash: admin.passwordHash,
      role: "EMPLOYEE"
    }
  });
  const outsideApproval = await prisma.approvalRequest.create({
    data: {
      companyId: admin.companyId,
      requesterId: outsideEmployee.id,
      type: "LEAVE",
      leaveType: "OFFICIAL",
      leaveStartDate: new Date(`${kstDate()}T00:00:00.000Z`),
      leaveEndDate: new Date(`${kstDate()}T00:00:00.000Z`),
      leaveDuration: "FULL_DAY",
      reason: "outside manager scope"
    }
  });
  const outsideRisk = await prisma.riskSignal.create({
    data: {
      companyId: admin.companyId,
      userId: outsideEmployee.id,
      signature: `pw-outside-risk-${stamp}`,
      type: "BREAK_VIOLATION",
      level: "HIGH",
      title: "Outside team risk",
      message: "Manager must not process outside team risk",
      evidence: {}
    }
  });

  const managerCookie = await loginApi(request, manager.email);
  const inbox = await requestJson(request, managerCookie, "/api/manager/approvals");
  expect(inbox.approvals.some((approval) => approval.id === outsideApproval.id)).toBeFalsy();
  const riskDashboard = await requestJson(request, managerCookie, "/api/risks/dashboard");
  expect(riskDashboard.signals.some((risk) => risk.id === outsideRisk.id)).toBeFalsy();

  const approveStatus = await requestStatus(
    request,
    managerCookie,
    `/api/manager/approvals/${outsideApproval.id}/approve`,
    "POST",
    { reviewNote: "should not pass" }
  );
  expect(approveStatus).toBe(400);

  const unchangedApproval = await prisma.approvalRequest.findUniqueOrThrow({
    where: {
      id: outsideApproval.id
    }
  });
  expect(unchangedApproval.status).toBe("PENDING");

  const riskWorkflowStatus = await requestStatus(
    request,
    managerCookie,
    `/api/risks/${outsideRisk.id}/workflow`,
    "POST",
    {
      status: "RESOLVED",
      resolutionType: "MANUAL",
      resolutionNote: "should not pass"
    }
  );
  expect(riskWorkflowStatus).toBe(400);
});

test("첨부 업로드는 위험 확장자와 MIME 불일치를 차단한다", async ({ request }) => {
  const employeeCookie = await loginApi(request, "employee@gamsi.kr");

  const executable = await postAdjustmentMultipart(request, employeeCookie, {
    reason: "Playwright blocked executable",
    attachments: {
      name: "malware.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("MZ")
    }
  });
  expect(executable.status()).toBe(400);

  const mismatched = await postAdjustmentMultipart(request, employeeCookie, {
    reason: "Playwright blocked mismatched mime",
    attachments: {
      name: "proof.txt",
      mimeType: "application/x-msdownload",
      buffer: Buffer.from("not text")
    }
  });
  expect(mismatched.status()).toBe(400);

  const oversized = await postAdjustmentMultipart(request, employeeCookie, {
    reason: "Playwright blocked oversized file",
    attachments: {
      name: "too-large.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1)
    }
  });
  expect(oversized.status()).toBe(400);
});

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

async function createTempEmployee(request, adminCookie) {
  const stamp = Date.now();
  const email = `pw-workbox-${stamp}@gamsi.kr`;
  const invite = await requestJson(request, adminCookie, "/api/admin/invitations", "POST", {
    name: `PW 업무함 ${String(stamp).slice(-4)}`,
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

function findThreadByTarget(workbox, targetId) {
  return workbox.threads.find((thread) => thread.targetId === targetId) ?? null;
}

test("업무함 승인 스레드, 댓글 멘션, 읽음 처리, 해결 처리가 동작한다", async ({ request }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const hrCookie = await loginApi(request, "hr@gamsi.kr");
  await requestJson(request, adminCookie, "/api/admin/company/plan", "POST", {
    planTier: "ENTERPRISE",
    userLimit: 500
  });

  const tempEmployee = await createTempEmployee(request, adminCookie);
  const employeeCookie = await loginApi(request, tempEmployee.email);
  const me = await requestJson(request, employeeCookie, "/api/me");
  const leaveDate = addDays(kstDate(), 1);

  const leaveRequest = await requestJson(request, employeeCookie, "/api/approvals/leave", "POST", {
    leaveType: "OFFICIAL",
    startDate: leaveDate,
    endDate: leaveDate,
    duration: "FULL_DAY",
    requestedLeaveMinutes: 0,
    reason: "Playwright 업무함 휴가 요청"
  });

  const hrWorkbox = await requestJson(request, hrCookie, "/api/workbox?filter=approval");
  const approvalThread = findThreadByTarget(hrWorkbox, leaveRequest.id);
  expect(approvalThread).toBeTruthy();
  expect(approvalThread.targetType).toBe("APPROVAL_REQUEST");
  expect(approvalThread.status).toBe("OPEN");

  await requestJson(request, hrCookie, `/api/workbox/threads/${approvalThread.id}/comments`, "POST", {
    body: "Playwright 업무함 댓글과 멘션 확인",
    mentionUserIds: [me.user.id]
  });

  const employeeUnread = await requestJson(request, employeeCookie, "/api/workbox?filter=unread");
  expect(findThreadByTarget(employeeUnread, leaveRequest.id)).toBeTruthy();

  const employeeDetail = await requestJson(request, employeeCookie, `/api/workbox/threads/${approvalThread.id}`);
  expect(employeeDetail.comments.some((comment) => comment.body.includes("업무함 댓글과 멘션"))).toBeTruthy();

  const employeeUnreadAfterRead = await requestJson(request, employeeCookie, "/api/workbox?filter=unread");
  expect(findThreadByTarget(employeeUnreadAfterRead, leaveRequest.id)).toBeNull();

  await requestJson(request, hrCookie, "/api/manager/approvals/bulk", "POST", {
    approvalIds: [leaveRequest.id],
    action: "approve",
    reviewNote: "Playwright 업무함 자동 승인"
  });

  const resolvedWorkbox = await requestJson(request, hrCookie, `/api/workbox?filter=resolved&threadId=${approvalThread.id}`);
  expect(resolvedWorkbox.selectedThread.id).toBe(approvalThread.id);
  expect(resolvedWorkbox.selectedThread.status).toBe("RESOLVED");
});

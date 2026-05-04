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
  const email = `pw-qr-${stamp}@gamsi.kr`;
  const invite = await requestJson(request, adminCookie, "/api/admin/invitations", "POST", {
    name: `PW QR ${String(stamp).slice(-4)}`,
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

test("QR 발급, QR 출근, 재사용 실패, 증빙 ZIP 다운로드가 동작한다", async ({ page, request, baseURL }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  await requestJson(request, adminCookie, "/api/admin/company/plan", "POST", {
    planTier: "ENTERPRISE",
    userLimit: 500
  });

  const stamp = Date.now();
  const location = await requestJson(request, adminCookie, "/api/admin/work-locations", "POST", {
    name: `PW QR 현장 ${stamp}`,
    description: "Playwright QR 현장 테스트"
  });

  const adminUiLogin = await page.context().request.post(`${baseURL}/api/auth/login`, {
    data: {
      email: "admin@gamsi.kr",
      password
    }
  });
  expect(adminUiLogin.ok()).toBeTruthy();
  await page.goto("/admin/qr-display", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "출퇴근 QR 표시" })).toBeVisible();
  await expect(page.getByLabel("근무지")).toHaveValue(location.id);
  await expect(page.locator("code").filter({ hasText: "WG1:" }).first()).toBeVisible({ timeout: 15_000 });

  const tempEmployee = await createTempEmployee(request, adminCookie);
  const employeeCookie = await loginApi(request, tempEmployee.email);
  const me = await requestJson(request, employeeCookie, "/api/me");

  const issued = await requestJson(request, adminCookie, `/api/admin/work-locations/${location.id}/qr`, "POST", {
    purpose: "BOTH",
    ttlSeconds: 60
  });
  expect(issued.payload).toMatch(/^WG1:/);

  const checkIn = await request.fetch("/api/attendance/check-in", {
    method: "POST",
    headers: {
      cookie: employeeCookie,
      "content-type": "application/json"
    },
    data: {
      verification: {
        method: "qr",
        token: issued.token
      }
    }
  });
  expect(checkIn.ok()).toBeTruthy();
  const snapshot = await checkIn.json();
  expect(snapshot.session?.checkInAt).toBeTruthy();
  expect(snapshot.events.some((event) => event.source === "qr")).toBeTruthy();

  const reuse = await request.fetch("/api/attendance/check-in", {
    method: "POST",
    headers: {
      cookie: employeeCookie,
      "content-type": "application/json"
    },
    data: {
      verification: {
        method: "qr",
        token: issued.token
      }
    }
  });
  expect(reuse.ok()).toBeFalsy();
  expect(reuse.status()).toBe(400);
  await expect(reuse.text()).resolves.toContain("이미 사용된 QR");

  const month = kstDate().slice(0, 7);
  const evidenceZip = await request.get(`${baseURL}/api/reports/evidence-package?month=${month}&userId=${me.user.id}`, {
    headers: {
      cookie: adminCookie
    }
  });
  expect(evidenceZip.ok()).toBeTruthy();
  expect(evidenceZip.headers()["content-type"]).toContain("application/zip");
  const zipBody = await evidenceZip.body();
  expect(zipBody.length).toBeGreaterThan(200);
  expect(zipBody[0]).toBe(0x50);
  expect(zipBody[1]).toBe(0x4b);
});

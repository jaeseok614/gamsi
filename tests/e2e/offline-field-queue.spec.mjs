import { expect, test } from "@playwright/test";

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
  return { email };
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

async function queueItems(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("workguard-field-queue", 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("queue")) {
          db.createObjectStore("queue", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });

    return new Promise((resolve, reject) => {
      const transaction = db.transaction("queue", "readonly");
      const request = transaction.objectStore("queue").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  });
}

async function putQueuedCheckIn(page) {
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("workguard-field-queue", 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("queue")) {
          db.createObjectStore("queue", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });

    await new Promise((resolve, reject) => {
      const transaction = db.transaction("queue", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.objectStore("queue").put({
        id: `manual-${Date.now()}`,
        path: "/api/attendance/check-in",
        body: {},
        label: "출근 기록",
        createdAt: new Date().toISOString(),
        attempts: 0,
        dedupeKey: "/api/attendance/check-in:{}",
        status: "queued"
      });
    });
  });
}

test("오프라인 출근 큐가 온라인 전송되고 중복 충돌은 확인 필요 상태로 남는다", async ({ page, request, baseURL }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const employee = await createTempEmployee(request, adminCookie, "offline");
  const employeeCookie = await loginApi(request, employee.email);
  await addSessionCookie(page, employeeCookie, baseURL);

  await page.goto("/dashboard?view=employee", { waitUntil: "domcontentloaded" });
  await page.context().setOffline(true);
  await page.getByTestId("attendance-check-in").click();
  await expect.poll(() => queueItems(page).then((items) => items.length)).toBe(1);
  await expect(page.getByText(/대기 1건/).first()).toBeVisible();

  await page.context().setOffline(false);
  await expect
    .poll(async () => {
      const today = await requestJson(request, employeeCookie, "/api/attendance/today");
      return Boolean(today.session?.checkInAt);
    })
    .toBeTruthy();
  await expect.poll(() => queueItems(page).then((items) => items.length)).toBe(0);

  await putQueuedCheckIn(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(/대기 1건/).first()).toBeVisible();
  await page.getByRole("button", { name: "지금 동기화" }).click();
  await expect
    .poll(async () => {
      const items = await queueItems(page);
      return items[0]?.status;
    })
    .toBe("blocked");

  await page.goto("/dashboard?view=notifications", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "대기 비우기" }).click();
  await expect.poll(() => queueItems(page).then((items) => items.length)).toBe(0);
});

test("QR 출퇴근은 오프라인일 때 현장 큐에 저장하지 않는다", async ({ page, request, baseURL }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const employee = await createTempEmployee(request, adminCookie, "offline-qr");
  const employeeCookie = await loginApi(request, employee.email);
  await addSessionCookie(page, employeeCookie, baseURL);

  await page.goto("/dashboard?view=employee", { waitUntil: "domcontentloaded" });
  await page.context().setOffline(true);
  await page.locator("#attendance-qr-token").fill("WG1INVALIDTOKEN");
  await page.getByRole("button", { name: "QR 출근" }).click();
  await expect.poll(() => queueItems(page).then((items) => items.length)).toBe(0);
  await page.context().setOffline(false);
});

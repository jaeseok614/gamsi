import { expect, test } from "@playwright/test";

const password = "password123!";

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

async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ERR_ABORTED")) {
      throw error;
    }
  }
}

test("조직도, 직원 프로필, 근무 상태판이 연결된다", async ({ page, request, baseURL }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const organization = await requestJson(request, adminCookie, "/api/organization");
  expect(organization.stats.totalUsers).toBeGreaterThan(0);
  expect(organization.teams.length).toBeGreaterThan(0);

  const employee = organization.users.find((user) => user.email === "employee@gamsi.kr") ?? organization.users[0];
  const stamp = Date.now();
  const jobTitle = `조직도 QA ${String(stamp).slice(-4)}`;
  await requestJson(request, adminCookie, `/api/admin/users/${employee.id}`, "POST", {
    name: employee.name,
    email: employee.email,
    role: employee.role,
    teamId: employee.teamId,
    jobTitle,
    phoneNumber: "010-1999-0001",
    extensionNumber: "901",
    isActive: true
  });

  const filtered = await requestJson(request, adminCookie, `/api/organization?userId=${employee.id}&search=${encodeURIComponent(jobTitle)}`);
  expect(filtered.selectedUser.id).toBe(employee.id);
  expect(filtered.selectedUser.jobTitle).toBe(jobTitle);
  expect(filtered.selectedUser.phoneNumber).toBe("010-1999-0001");
  expect(filtered.users.some((user) => user.id === employee.id)).toBeTruthy();

  const uiLogin = await page.context().request.post(`${baseURL}/api/auth/login`, {
    data: {
      email: "admin@gamsi.kr",
      password
    }
  });
  expect(uiLogin.ok()).toBeTruthy();
  await safeGoto(page, `/dashboard?view=organization&orgUserId=${employee.id}&orgSearch=${encodeURIComponent(jobTitle)}`);
  await expect(page.getByRole("heading", { name: "조직도" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "근무 상태판" })).toBeVisible();
  await expect(page.getByText(jobTitle).first()).toBeVisible();
  await expect(page.getByText("010-1999-0001")).toBeVisible();
  await expect(page.getByText("901")).toBeVisible();
});

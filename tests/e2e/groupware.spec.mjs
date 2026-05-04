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

test("그룹웨어 연락처, 프로필 메모, 급여명세 다운로드가 동작한다", async ({ page, request, baseURL }) => {
  const adminCookie = await loginApi(request, "admin@gamsi.kr");
  const employee = await prisma.user.findUniqueOrThrow({
    where: {
      email: "employee@gamsi.kr"
    }
  });
  await addSessionCookie(page, adminCookie, baseURL);

  await page.goto(`/dashboard?view=groupware&orgUserId=${employee.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "그룹웨어" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "사내 직원 연락처" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "급여명세 다운로드" })).toBeVisible();
  await expect(page.getByText("employee@gamsi.kr").first()).toBeVisible();

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

  const csv = await request.get(`${baseURL}/api/payroll-statements/${kstMonth()}?format=csv&userId=${employee.id}`, {
    headers: {
      cookie: adminCookie
    }
  });
  expect(csv.ok()).toBeTruthy();
  expect(await csv.text()).toContain("급여명세 기초자료");
});

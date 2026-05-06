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

test("모바일 현장 첫 화면에서 출퇴근, QR, 신청, 하단 이동이 바로 보인다", async ({ page, request, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cookie = await loginApi(request, "employee@gamsi.kr");
  await page.context().addCookies([
    {
      name: cookie.split("=")[0],
      value: cookie.split("=").slice(1).join("="),
      url: baseURL
    }
  ]);

  await page.goto("/dashboard?view=employee", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".employee-mobile-focus")).toBeVisible();
  await expect(page.getByTestId("field-mobile-readiness")).toBeVisible();
  await expect(page.getByText("현장 기록")).toBeVisible();
  await expect(page.getByRole("link", { name: "QR" })).toBeVisible();
  await expect(page.getByTestId("attendance-check-in")).toBeVisible();
  await expect(page.getByTestId("attendance-check-out")).toBeVisible();
  await expect(page.locator("#employee-qr")).toBeVisible();
  await expect(page.getByRole("button", { name: "출근 QR 스캔" })).toBeVisible();
  await expect(page.getByRole("button", { name: "퇴근 QR 스캔" })).toBeVisible();
  await expect(page.locator(".mobile-nav")).toBeVisible();
});

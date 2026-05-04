const baseUrl = process.argv[2] ?? process.env.QA_BASE_URL ?? "http://localhost:3000";

async function expectOk(response, label) {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${label} 실패: ${response.status} ${response.statusText}\n${body}`);
  }
  return response;
}

async function expectJson(response, label) {
  const ok = await expectOk(response, label);
  return ok.json();
}

async function login(email, password) {
  const response = await expectOk(
    await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ email, password })
    }),
    `로그인(${email})`
  );

  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error(`로그인(${email}) 응답에 세션 쿠키가 없습니다.`);
  }

  return setCookie.split(";")[0];
}

async function authedFetch(cookie, path, init) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      cookie
    }
  });
}

async function main() {
  await expectOk(await fetch(`${baseUrl}/login`), "로그인 페이지");
  await expectOk(await fetch(`${baseUrl}/api/health`), "공용 헬스체크");

  const adminCookie = await login("admin@gamsi.kr", "password123!");
  const managerCookie = await login("manager@gamsi.kr", "password123!");
  const employeeCookie = await login("employee@gamsi.kr", "password123!");
  const employeeMe = await expectJson(await authedFetch(employeeCookie, "/api/me"), "직원 정보 조회");

  await expectOk(await authedFetch(adminCookie, "/dashboard"), "관리자 대시보드");
  await expectOk(await authedFetch(adminCookie, "/api/organization"), "조직도 API");
  await expectOk(await authedFetch(managerCookie, "/api/notifications"), "매니저 알림 API");
  await expectOk(await authedFetch(managerCookie, "/api/dashboard/personalization"), "매니저 개인화 API");
  await expectOk(
    await authedFetch(managerCookie, "/api/integrations/digest/preview", {
      method: "POST"
    }),
    "요약 알림 미리보기"
  );
  await expectOk(await authedFetch(adminCookie, "/api/admin/ops/status"), "운영 상태 조회");
  await expectOk(await authedFetch(adminCookie, "/api/admin/automation"), "운영 자동화 설정 조회");
  await expectOk(await authedFetch(adminCookie, "/api/admin/evidence"), "증빙 보안 설정 조회");
  await expectOk(await authedFetch(adminCookie, "/api/admin/onboarding"), "온보딩 요약 조회");
  await expectOk(
    await authedFetch(adminCookie, "/api/integrations/calendar/export?scope=company"),
    "회사 캘린더 내보내기"
  );
  await expectOk(await authedFetch(adminCookie, "/api/integrations/erp/export"), "ERP 내보내기");
  await expectOk(await authedFetch(adminCookie, "/api/reports/payroll/export"), "급여 내보내기");
  await expectOk(await authedFetch(employeeCookie, "/api/notifications/preferences"), "직원 알림 설정 조회");

  const pushConfig = await expectJson(
    await authedFetch(employeeCookie, "/api/notifications/push/public-key"),
    "웹 푸시 공개키 조회"
  );
  if (!pushConfig.enabled || typeof pushConfig.publicKey !== "string" || pushConfig.publicKey.length < 40) {
    throw new Error("웹 푸시 공개키가 활성화되어 있지 않습니다.");
  }

  const dummyEndpoint = `https://example.com/qa-push/${Date.now()}`;
  await expectOk(
    await authedFetch(employeeCookie, "/api/notifications/push/subscription", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        endpoint: dummyEndpoint,
        expirationTime: null,
        keys: {
          p256dh: "dummy-p256dh-key",
          auth: "dummy-auth-key"
        }
      })
    }),
    "웹 푸시 구독 저장"
  );
  await expectOk(
    await authedFetch(adminCookie, "/api/admin/integrations/test", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        channel: "web_push",
        userId: employeeMe.user.id
      })
    }),
    "웹 푸시 테스트 전송"
  );
  await expectOk(
    await authedFetch(adminCookie, "/api/admin/integrations/test", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        channel: "slack"
      })
    }),
    "Slack 테스트 전송"
  );
  await expectOk(
    await authedFetch(employeeCookie, "/api/notifications/push/subscription", {
      method: "DELETE",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        endpoint: dummyEndpoint
      })
    }),
    "웹 푸시 구독 삭제"
  );

  console.log(`Smoke checks passed against ${baseUrl}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

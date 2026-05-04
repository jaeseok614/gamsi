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

function firstCookie(setCookie) {
  if (!setCookie) {
    throw new Error("세션 쿠키가 없습니다.");
  }

  return setCookie.split(";")[0];
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

  return firstCookie(response.headers.get("set-cookie"));
}

async function authedFetch(cookie, path, init) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
      cookie
    }
  });
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

function addMonths(monthString, offset) {
  const date = new Date(`${monthString}-01T00:00:00+09:00`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return kstDate(date).slice(0, 7);
}

function weekStart(dateString) {
  const date = new Date(`${dateString}T12:00:00+09:00`);
  const day = date.getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  return addDays(dateString, -daysFromMonday);
}

async function findClosableMonth(cookie, baseMonth) {
  for (let offset = 1; offset <= 12; offset += 1) {
    const month = addMonths(baseMonth, offset);
    const report = await expectJson(
      await authedFetch(cookie, `/api/reports/payroll?month=${month}`),
      `${month} 급여 리포트 조회`
    );
    if (report.canClose) {
      return month;
    }
  }

  throw new Error("월 마감 가능한 테스트 월을 찾지 못했습니다.");
}

async function main() {
  await expectOk(await fetch(`${baseUrl}/login`), "로그인 페이지");

  const adminCookie = await login("admin@gamsi.kr", "password123!");
  const hrCookie = await login("hr@gamsi.kr", "password123!");
  const initialOpsStatus = await expectJson(
    await authedFetch(adminCookie, "/api/admin/ops/status"),
    "초기 운영 상태 확인"
  );
  if (!initialOpsStatus.automation || !initialOpsStatus.evidence || !initialOpsStatus.onboarding) {
    throw new Error("운영 상태 응답에 자동화/증빙/온보딩 데이터가 없습니다.");
  }

  const stamp = Date.now();
  const tempPassword = "password123!";
  const tempEmail = `qa-employee-${stamp}@gamsi.kr`;
  const tempName = `QA 직원 ${String(stamp).slice(-4)}`;
  const invite = await expectJson(
    await authedFetch(adminCookie, "/api/admin/invitations", {
      method: "POST",
      body: JSON.stringify({
        name: tempName,
        email: tempEmail,
        role: "EMPLOYEE"
      })
    }),
    "임시 직원 초대"
  );

  await expectJson(
    await fetch(`${baseUrl}/api/invitations/${invite.token}/accept`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        password: tempPassword
      })
    }),
    "임시 직원 초대 수락"
  );

  const employeeCookie = await login(tempEmail, tempPassword);
  const employeeMe = await expectJson(
    await authedFetch(employeeCookie, "/api/me"),
    "임시 직원 정보 조회"
  );
  const today = kstDate();
  const tomorrow = addDays(today, 1);
  const currentWeekStart = weekStart(today);
  const nextWeekStart = addDays(currentWeekStart, 7);
  const nextWeekEnd = addDays(nextWeekStart, 6);
  const boardSecondDate = addDays(nextWeekStart, 1);
  const sourceCopyDate = addDays(currentWeekStart, 1);
  const rangeStart = addDays(nextWeekStart, 2);
  const rangeEnd = addDays(nextWeekStart, 4);
  const copiedShiftName = "QA 주간 복사 근무";
  const recurringShiftName = "QA 반복 근무";
  const closableMonth = await findClosableMonth(adminCookie, today.slice(0, 7));

  const pushConfig = await expectJson(
    await authedFetch(employeeCookie, "/api/notifications/push/public-key"),
    "웹 푸시 공개키 조회"
  );
  if (!pushConfig.enabled || typeof pushConfig.publicKey !== "string" || pushConfig.publicKey.length < 40) {
    throw new Error("웹 푸시 공개키가 활성화되어 있지 않습니다.");
  }

  const dummyEndpoint = `https://example.com/qa-push/${stamp}`;
  await expectJson(
    await authedFetch(employeeCookie, "/api/notifications/push/subscription", {
      method: "POST",
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
  await expectJson(
    await authedFetch(employeeCookie, "/api/notifications/push/subscription", {
      method: "DELETE",
      body: JSON.stringify({
        endpoint: dummyEndpoint
      })
    }),
    "웹 푸시 구독 삭제"
  );

  const pruneEndpoint = `https://example.com/test-push/prune/${stamp}`;
  await expectJson(
    await authedFetch(employeeCookie, "/api/notifications/push/subscription", {
      method: "POST",
      body: JSON.stringify({
        endpoint: pruneEndpoint,
        expirationTime: null,
        keys: {
          p256dh: "dummy-p256dh-key",
          auth: "dummy-auth-key"
        }
      })
    }),
    "웹 푸시 prune 테스트 구독 저장"
  );
  const pruneResult = await expectJson(
    await authedFetch(adminCookie, "/api/admin/integrations/test", {
      method: "POST",
      body: JSON.stringify({
        channel: "web_push",
        userId: employeeMe.user.id
      })
    }),
    "웹 푸시 prune 테스트 전송"
  );
  if (!String(pruneResult.detail ?? "").includes("만료 정리")) {
    throw new Error(`웹 푸시 prune 결과가 예상과 다릅니다: ${pruneResult.detail}`);
  }
  const opsStatus = await expectJson(
    await authedFetch(adminCookie, "/api/admin/ops/status"),
    "운영 상태 확인"
  );
  if ((opsStatus.integrations?.metrics?.recentPrunedSubscriptions ?? 0) < 1) {
    throw new Error("운영 상태에 prune 메트릭이 반영되지 않았습니다.");
  }

  await expectJson(
    await authedFetch(adminCookie, "/api/admin/automation", {
      method: "POST",
      body: JSON.stringify({
        dailyDigestEnabled: true,
        failureAlertThreshold: 2,
        autoPruneEnabled: true,
        deadSubscriptionFailureCount: 2
      })
    }),
    "운영 자동화 설정 저장"
  );
  const automationRun = await expectJson(
    await authedFetch(adminCookie, "/api/admin/automation", {
      method: "POST",
      body: JSON.stringify({
        action: "run"
      })
    }),
    "운영 자동화 수동 실행"
  );
  if ((automationRun.companies?.[0]?.digest?.sent ?? 0) < 0) {
    throw new Error("운영 자동화 응답 형식이 올바르지 않습니다.");
  }

  const evidenceState = await expectJson(
    await authedFetch(adminCookie, "/api/admin/evidence"),
    "증빙 보안 설정 조회"
  );
  if (!evidenceState.settings || !evidenceState.summary) {
    throw new Error("증빙 보안 설정 응답이 올바르지 않습니다.");
  }
  await expectJson(
    await authedFetch(adminCookie, "/api/admin/evidence", {
      method: "POST",
      body: JSON.stringify({
        retentionDays: 180,
        managerScopedAccess: true
      })
    }),
    "증빙 보안 설정 저장"
  );

  const onboardingBefore = await expectJson(
    await authedFetch(adminCookie, "/api/admin/onboarding"),
    "온보딩 요약 조회"
  );
  if (!Array.isArray(onboardingBefore.steps) || onboardingBefore.steps.length === 0) {
    throw new Error("온보딩 단계 정보가 비어 있습니다.");
  }
  await expectJson(
    await authedFetch(adminCookie, "/api/admin/onboarding/sample-data", {
      method: "POST",
      body: "{}"
    }),
    "온보딩 샘플 데이터 주입"
  );
  const onboardingAfter = await expectJson(
    await authedFetch(adminCookie, "/api/admin/onboarding"),
    "온보딩 요약 재조회"
  );
  if (!onboardingAfter.sampleSeededAt) {
    throw new Error("온보딩 샘플 데이터 주입 결과가 반영되지 않았습니다.");
  }

  const boardPreview = await expectJson(
    await authedFetch(hrCookie, "/api/schedules/preview", {
      method: "POST",
      body: JSON.stringify({
        mode: "board_apply",
        entries: [
          { userId: employeeMe.user.id, workDate: nextWeekStart },
          { userId: employeeMe.user.id, workDate: boardSecondDate }
        ],
        startTime: "08:00",
        endTime: "17:00",
        breakMinutes: 60,
        shiftName: "QA 보드 근무",
        note: "QA 보드 적용"
      })
    }),
    "보드 스케줄 미리보기"
  );
  if ((boardPreview.total ?? 0) !== 2) {
    throw new Error(`보드 스케줄 미리보기 건수가 예상과 다릅니다: ${boardPreview.total}`);
  }
  await expectJson(
    await authedFetch(hrCookie, "/api/schedules", {
      method: "POST",
      body: JSON.stringify({
        mode: "board_apply",
        entries: [
          { userId: employeeMe.user.id, workDate: nextWeekStart },
          { userId: employeeMe.user.id, workDate: boardSecondDate }
        ],
        startTime: "08:00",
        endTime: "17:00",
        breakMinutes: 60,
        shiftName: "QA 보드 근무",
        note: "QA 보드 적용"
      })
    }),
    "보드 스케줄 적용"
  );
  const boardCalendar = await expectOk(
    await authedFetch(adminCookie, `/api/integrations/calendar/export?scope=company&from=${nextWeekStart}&to=${nextWeekEnd}`),
    "보드 스케줄 캘린더 확인"
  );
  if (!(await boardCalendar.text()).includes("QA 보드 근무")) {
    throw new Error("보드 스케줄 적용 결과가 캘린더에 보이지 않습니다.");
  }
  await expectJson(
    await authedFetch(hrCookie, "/api/schedules", {
      method: "POST",
      body: JSON.stringify({
        mode: "board_clear",
        entries: [
          { userId: employeeMe.user.id, workDate: nextWeekStart },
          { userId: employeeMe.user.id, workDate: boardSecondDate }
        ]
      })
    }),
    "보드 스케줄 삭제"
  );

  const sourceSchedule = await expectJson(
    await authedFetch(hrCookie, "/api/schedules", {
      method: "POST",
      body: JSON.stringify({
        mode: "single",
        userId: employeeMe.user.id,
        workDate: sourceCopyDate,
        startTime: "09:00",
        endTime: "18:00",
        breakMinutes: 60,
        shiftName: copiedShiftName,
        note: "QA 주간 복사 원본"
      })
    }),
    "주간 복사 원본 스케줄 등록"
  );
  if (sourceSchedule.total !== 1) {
    throw new Error(`원본 스케줄 등록 건수가 예상과 다릅니다: ${sourceSchedule.total}`);
  }

  const copiedSchedule = await expectJson(
    await authedFetch(hrCookie, "/api/schedules", {
      method: "POST",
      body: JSON.stringify({
        mode: "copy_week",
        userIds: [employeeMe.user.id],
        sourceWeekStart: currentWeekStart,
        targetWeekStart: nextWeekStart
      })
    }),
    "주간 스케줄 복사"
  );
  if (copiedSchedule.total < 1) {
    throw new Error("주간 스케줄 복사 결과가 비어 있습니다.");
  }

  const recurringSchedule = await expectJson(
    await authedFetch(hrCookie, "/api/schedules", {
      method: "POST",
      body: JSON.stringify({
        mode: "range",
        userIds: [employeeMe.user.id],
        startDate: rangeStart,
        endDate: rangeEnd,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        startTime: "10:00",
        endTime: "19:00",
        breakMinutes: 60,
        shiftName: recurringShiftName,
        note: "QA 반복 스케줄"
      })
    }),
    "반복 스케줄 등록"
  );
  if (recurringSchedule.total !== 3) {
    throw new Error(`반복 스케줄 등록 건수가 예상과 다릅니다: ${recurringSchedule.total}`);
  }

  const bulkPreview = await expectJson(
    await authedFetch(hrCookie, "/api/schedules/preview", {
      method: "POST",
      body: JSON.stringify({
        mode: "bulk_update",
        userIds: [employeeMe.user.id],
        startDate: nextWeekStart,
        endDate: nextWeekEnd,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        startTime: "11:00",
        endTime: "20:00",
        breakMinutes: 45,
        shiftName: "QA 일괄 수정 근무",
        note: "QA 일괄 수정"
      })
    }),
    "일괄 수정 미리보기"
  );
  if ((bulkPreview.updateCount ?? 0) < 1 || (bulkPreview.overwriteCount ?? 0) < 1) {
    throw new Error("일괄 수정 미리보기에 덮어쓰기 대상이 잡히지 않았습니다.");
  }

  const bulkUpdated = await expectJson(
    await authedFetch(hrCookie, "/api/schedules", {
      method: "POST",
      body: JSON.stringify({
        mode: "bulk_update",
        userIds: [employeeMe.user.id],
        startDate: nextWeekStart,
        endDate: nextWeekEnd,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        startTime: "11:00",
        endTime: "20:00",
        breakMinutes: 45,
        shiftName: "QA 일괄 수정 근무",
        note: "QA 일괄 수정"
      })
    }),
    "일괄 수정 적용"
  );
  if ((bulkUpdated.updated ?? 0) < 1) {
    throw new Error("일괄 수정 적용 결과가 비어 있습니다.");
  }

  const nextWeekCalendar = await expectOk(
    await authedFetch(adminCookie, `/api/integrations/calendar/export?scope=company&from=${nextWeekStart}&to=${nextWeekEnd}`),
    "다음 주 스케줄 캘린더 내보내기"
  );
  const nextWeekCalendarText = await nextWeekCalendar.text();
  if (!nextWeekCalendarText.includes("QA 일괄 수정 근무")) {
    throw new Error("일괄 수정 스케줄이 캘린더 내보내기 결과에 반영되지 않았습니다.");
  }

  const deletePreview = await expectJson(
    await authedFetch(hrCookie, "/api/schedules/preview", {
      method: "POST",
      body: JSON.stringify({
        mode: "bulk_delete",
        userIds: [employeeMe.user.id],
        startDate: nextWeekStart,
        endDate: nextWeekEnd,
        weekdays: [0, 1, 2, 3, 4, 5, 6]
      })
    }),
    "일괄 삭제 미리보기"
  );
  if ((deletePreview.deleteCount ?? 0) < 1) {
    throw new Error("일괄 삭제 미리보기에 삭제 대상이 없습니다.");
  }
  await expectJson(
    await authedFetch(hrCookie, "/api/schedules", {
      method: "POST",
      body: JSON.stringify({
        mode: "bulk_delete",
        userIds: [employeeMe.user.id],
        startDate: nextWeekStart,
        endDate: nextWeekEnd,
        weekdays: [0, 1, 2, 3, 4, 5, 6]
      })
    }),
    "일괄 삭제 적용"
  );
  const postDeleteCalendar = await expectOk(
    await authedFetch(adminCookie, `/api/integrations/calendar/export?scope=company&from=${nextWeekStart}&to=${nextWeekEnd}`),
    "일괄 삭제 후 캘린더 내보내기"
  );
  const postDeleteCalendarText = await postDeleteCalendar.text();
  if (postDeleteCalendarText.includes("QA 일괄 수정 근무")) {
    throw new Error("삭제한 스케줄이 캘린더 내보내기 결과에 남아 있습니다.");
  }

  const initialAttendance = await expectJson(
    await authedFetch(employeeCookie, "/api/attendance/today"),
    "초기 출근 상태 조회"
  );
  if (initialAttendance.session?.checkInAt) {
    throw new Error("회귀 테스트용 임시 직원에 이미 오늘 출근 기록이 있습니다.");
  }

  const checkedIn = await expectJson(
    await authedFetch(employeeCookie, "/api/attendance/check-in", {
      method: "POST",
      body: "{}"
    }),
    "출근"
  );
  if (!checkedIn.session?.checkInAt) {
    throw new Error("출근 후 세션이 열리지 않았습니다.");
  }

  const statusChanged = await expectJson(
    await authedFetch(employeeCookie, "/api/attendance/status", {
      method: "POST",
      body: JSON.stringify({
        status: "MEETING",
        reason: "QA 회귀 테스트 상태 변경"
      })
    }),
    "상태 변경"
  );
  if (statusChanged.latestStatus !== "MEETING") {
    throw new Error(`상태 변경 결과가 예상과 다릅니다: ${statusChanged.latestStatus}`);
  }

  const checkedOut = await expectJson(
    await authedFetch(employeeCookie, "/api/attendance/check-out", {
      method: "POST",
      body: "{}"
    }),
    "퇴근"
  );
  if (!checkedOut.session?.checkOutAt) {
    throw new Error("퇴근 후 세션이 닫히지 않았습니다.");
  }

  const leaveRequest = await expectJson(
    await authedFetch(employeeCookie, "/api/approvals/leave", {
      method: "POST",
      body: JSON.stringify({
        leaveType: "OFFICIAL",
        startDate: tomorrow,
        endDate: tomorrow,
        duration: "FULL_DAY",
        requestedLeaveMinutes: 0,
        reason: "QA 회귀 테스트 휴가 신청"
      })
    }),
    "휴가 신청"
  );

  const adjustmentRequest = await expectJson(
    await authedFetch(employeeCookie, "/api/approvals/adjustment", {
      method: "POST",
      body: JSON.stringify({
        adjustmentType: "GENERAL",
        reason: "QA 회귀 테스트 정정 요청"
      })
    }),
    "정정 신청"
  );

  const approvalInbox = await expectJson(
    await authedFetch(hrCookie, "/api/manager/approvals"),
    "인사 담당 승인함 조회"
  );
  const approvalIds = new Set((approvalInbox.approvals ?? []).map((approval) => approval.id));
  if (!approvalIds.has(leaveRequest.id) || !approvalIds.has(adjustmentRequest.id)) {
    throw new Error("방금 만든 요청이 승인함에 나타나지 않았습니다.");
  }

  await expectJson(
    await authedFetch(hrCookie, "/api/manager/approvals/bulk", {
      method: "POST",
      body: JSON.stringify({
        approvalIds: [leaveRequest.id],
        action: "approve",
        reviewNote: "QA 자동 승인"
      })
    }),
    "휴가 승인"
  );
  await expectJson(
    await authedFetch(hrCookie, "/api/manager/approvals/bulk", {
      method: "POST",
      body: JSON.stringify({
        approvalIds: [adjustmentRequest.id],
        action: "reject",
        reviewNote: "QA 자동 반려"
      })
    }),
    "정정 반려"
  );

  const resetRequest = await expectJson(
    await fetch(`${baseUrl}/api/auth/password/reset/request`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email: tempEmail
      })
    }),
    "비밀번호 재설정 요청"
  );
  if (typeof resetRequest.debugToken !== "string" || resetRequest.debugToken.length < 20) {
    throw new Error("개발용 비밀번호 재설정 디버그 토큰을 받지 못했습니다.");
  }

  const nextPassword = "password456!";
  await expectJson(
    await fetch(`${baseUrl}/api/auth/password/reset/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        token: resetRequest.debugToken,
        nextPassword
      })
    }),
    "비밀번호 재설정 완료"
  );

  const oldPasswordLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email: tempEmail,
      password: tempPassword
    })
  });
  if (oldPasswordLogin.ok) {
    throw new Error("비밀번호 재설정 후 이전 비밀번호 로그인이 여전히 성공했습니다.");
  }

  const freshCookie = await login(tempEmail, nextPassword);
  await login(tempEmail, nextPassword);
  const sessionList = await expectJson(
    await authedFetch(freshCookie, "/api/auth/sessions"),
    "활성 세션 조회"
  );
  if ((sessionList.sessions ?? []).length < 2) {
    throw new Error("세션 종료 테스트를 위한 복수 세션이 생성되지 않았습니다.");
  }
  const revokeTarget = sessionList.sessions.find((session) => !session.isCurrent);
  if (!revokeTarget) {
    throw new Error("종료할 다른 세션을 찾지 못했습니다.");
  }

  await expectJson(
    await authedFetch(freshCookie, `/api/auth/sessions/${revokeTarget.id}/revoke`, {
      method: "POST",
      body: "{}"
    }),
    "다른 세션 종료"
  );
  const afterSingleRevoke = await expectJson(
    await authedFetch(freshCookie, "/api/auth/sessions"),
    "세션 종료 후 조회"
  );
  if ((afterSingleRevoke.sessions ?? []).some((session) => session.id === revokeTarget.id)) {
    throw new Error("선택한 세션이 종료 후에도 남아 있습니다.");
  }

  await login(tempEmail, nextPassword);
  await expectJson(
    await authedFetch(freshCookie, "/api/auth/sessions/revoke-others", {
      method: "POST",
      body: "{}"
    }),
    "다른 기기 전체 로그아웃"
  );
  const afterRevokeOthers = await expectJson(
    await authedFetch(freshCookie, "/api/auth/sessions"),
    "다른 기기 전체 로그아웃 후 조회"
  );
  if ((afterRevokeOthers.sessions ?? []).length !== 1 || !afterRevokeOthers.sessions[0]?.isCurrent) {
    throw new Error("다른 기기 로그아웃 후 현재 세션만 남지 않았습니다.");
  }

  await expectJson(
    await authedFetch(adminCookie, "/api/reports/month-close", {
      method: "POST",
      body: JSON.stringify({
        month: closableMonth,
        action: "close",
        reason: "QA 자동 월 마감"
      })
    }),
    `${closableMonth} 월 마감`
  );
  await expectJson(
    await authedFetch(adminCookie, "/api/reports/month-close", {
      method: "POST",
      body: JSON.stringify({
        month: closableMonth,
        action: "applyPayroll",
        reason: "QA 급여 반영 점검"
      })
    }),
    "급여 반영 완료 표시"
  );
  await expectJson(
    await authedFetch(adminCookie, "/api/reports/month-close", {
      method: "POST",
      body: JSON.stringify({
        month: closableMonth,
        action: "markPayrollPending",
        reason: "QA 급여 반영 해제 점검"
      })
    }),
    "급여 반영 표시 해제"
  );
  const reopenRequest = await expectJson(
    await authedFetch(hrCookie, "/api/reports/month-close", {
      method: "POST",
      body: JSON.stringify({
        month: closableMonth,
        action: "requestReopen",
        reason: "QA 재오픈 요청"
      })
    }),
    "재오픈 요청"
  );
  await expectJson(
    await authedFetch(adminCookie, "/api/reports/month-close", {
      method: "POST",
      body: JSON.stringify({
        month: closableMonth,
        action: "approveReopen",
        requestId: reopenRequest.requestId,
        reason: "QA 재오픈 승인"
      })
    }),
    "재오픈 승인"
  );

  await expectOk(
    await authedFetch(adminCookie, "/api/integrations/digest/preview", {
      method: "POST",
      body: "{}"
    }),
    "요약 알림 미리보기"
  );
  await expectOk(
    await authedFetch(adminCookie, "/api/integrations/digest/send", {
      method: "POST",
      body: "{}"
    }),
    "요약 알림 전송 점검"
  );
  await expectOk(
    await authedFetch(adminCookie, `/api/integrations/calendar/export?scope=company&from=${today}&to=${tomorrow}`),
    "회사 캘린더 내보내기"
  );
  await expectOk(
    await authedFetch(adminCookie, `/api/integrations/erp/export?month=${closableMonth}`),
    "ERP 내보내기"
  );
  await expectOk(
    await authedFetch(adminCookie, `/api/reports/payroll/export?month=${closableMonth}&mapped=1`),
    "급여 내보내기"
  );

  console.log(`Regression checks passed against ${baseUrl}`);
  console.log(`Created temp employee ${tempEmail} and validated flows on ${today} / ${closableMonth}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

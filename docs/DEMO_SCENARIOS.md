# WorkGuard Demo and Runbook Scenarios

## 고객 시연 순서

1. 관리자 `admin@gamsi.kr`로 로그인한다.
2. `설정 > 회사`에서 회사명, 기본 근무시간, 주간 한도를 확인한다.
3. `설정 > 조직`에서 팀, 직원, 초대 링크를 보여준다.
4. `근로기록`에서 직원 출근, 퇴근, 상태 변경, QR 출퇴근 입력 흐름을 보여준다.
5. 네트워크 오프라인 상태를 만든 뒤 출근을 눌러 현장 전송 대기함에 저장되는지 확인한다.
6. 다시 온라인으로 전환해 대기 기록 동기화와 충돌 시 `확인 필요` 상태를 보여준다.
7. 직원이 누락 출퇴근 정정, 초과근로, 휴가를 신청한다.
8. 팀장 `manager@gamsi.kr`로 로그인해 승인함에서 승인/반려와 처리기한 상태를 보여준다.
9. 관리자 또는 인사 담당으로 `리스크`에서 주간 한도, 휴게 부족, 야간/휴일, 미승인 초과근로 리스크를 확인한다.
10. `리포트 > 급여`에서 야간/휴일/연장 가산, 월마감 blocker, CSV/PDF/증빙 패키지를 보여준다.
11. `그룹웨어`에서 공지, 팀 게시글, 전자결재, 자료실, 다운로드 감사 로그를 보여준다.
12. `설정 > 운영 관제`에서 클라이언트 오류, 연동 실패, 권한 매트릭스, 증빙 보안 설정을 확인한다.

## 관리자 초기 세팅 절차

1. 운영 첫 계정을 만든다.

```bash
npm run ops:bootstrap-admin -- admin@example.com 'StrongPassword123!' '초기 관리자' '회사명'
```

2. `.env.production`에 `DATABASE_URL`, `APP_BASE_URL`, `AUTH_SECRET`을 운영 값으로 설정한다.
3. 초대/비밀번호 재설정을 쓸 경우 `SMTP_*`를 설정한다.
4. 웹푸시를 쓸 경우 `npm run push:vapid`로 VAPID 키를 만들고 `WEB_PUSH_*`에 반영한다.
5. 운영 첨부파일은 `ATTACHMENT_STORAGE_DRIVER=s3`와 `S3_*`를 설정한다.
6. 관리자 화면에서 회사 정책, 팀, 직원, 근무지 QR, 증빙 보관기간을 설정한다.
7. 실제 운영 전 `npm run ops:deploy-rehearsal -- --base-url=https://your-domain.example --require-health`를 통과시킨다.

## 장애 대응 체크리스트

1. `/api/health`로 필수 상태를 확인한다.
2. 관리자 `설정 > 운영 관제`에서 최근 클라이언트 오류, 연동 실패, 자동화 실행 로그를 확인한다.
3. DB 장애라면 새 쓰기를 멈추고 최신 백업 위치를 확인한다.
4. 첨부파일 장애라면 S3 권한, 버킷, prefix, `ATTACHMENT_STORAGE_DRIVER` 값을 확인한다.
5. 알림 장애라면 SMTP/Web Push/Slack 설정과 최근 실패 로그를 확인한다.
6. 현장 출퇴근 장애라면 직원 화면의 전송 대기함과 `확인 필요` 충돌 항목을 확인한다.
7. 장애 조치 후 리스크 재계산, 월마감 리포트, 증빙 패키지 다운로드를 재검증한다.

## 백업/복구 리허설

1. 복구 리허설 전 현재 DB 백업을 만든다.

```bash
npm run db:backup:local
```

2. disposable DB를 준비하고 백업 파일을 복구한다.

```bash
DATABASE_URL="postgresql://workguard_restore:secret@localhost:5432/workguard_restore?schema=public" \
  npm run db:restore:local -- ./backups/workguard-local.sql
```

3. 복구 DB로 앱을 부팅해 `/api/health`가 `ok`인지 확인한다.
4. 첨부파일 백업이 있는 경우 `*.uploads.tar.gz`와 `*.manifest.json`의 파일 수를 비교한다.
5. 관리자 로그인, 급여 리포트, 자료실 다운로드, 증빙 패키지 생성까지 확인해야 리허설 완료로 본다.

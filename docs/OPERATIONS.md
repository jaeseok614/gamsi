# WorkGuard Operations Checklist

## 배포 전 필수 점검

- `npm run typecheck`, `npm run lint`, `npm run build`가 통과해야 한다.
- GitHub Actions `CI`가 통과해야 한다. CI는 PostgreSQL service, DB push/seed, smoke QA, Playwright E2E까지 실행한다.
- `npm run ops:deploy-rehearsal -- --base-url=https://your-domain.example --require-health`로 운영 환경변수, 백업/복구 도구, 빌드, 헬스체크를 함께 확인한다.
- Docker 기준 리허설은 `docker compose --profile app up --build app`으로 앱 컨테이너를 올린 뒤 `npm run ops:deploy-rehearsal -- --base-url=http://localhost:3000 --allow-local --require-health`를 실행한다.
- `npm run db:push`로 Prisma 스키마를 운영 DB에 반영한다.
- `DATABASE_URL`, `APP_BASE_URL`, `AUTH_SECRET`은 운영 값이어야 한다.
- `AUTH_SECRET`은 기본값이 아니고 32자 이상 무작위 문자열이어야 한다.
- HTTPS 운영 환경은 `AUTH_COOKIE_SECURE=true`여야 한다.
- `/api/health`는 외부 로드밸런서용으로 사용하고, 상세 원인은 관리자 `/api/admin/ops/status`에서 확인한다.
- 첫 Docker VPS 배포 절차는 [DEPLOYMENT.md](DEPLOYMENT.md)를 기준으로 한다.
- GitHub branch protection과 secrets 운영 기준은 [GITHUB_SETUP.md](GITHUB_SETUP.md)를 기준으로 한다.

## 권장 점검

- 초대/알림을 쓰는 환경은 `SMTP_*`를 설정한다.
- 웹푸시를 쓰는 환경은 `WEB_PUSH_SUBJECT`, `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`를 설정한다.
- 운영 첨부파일은 `ATTACHMENT_STORAGE_DRIVER=s3`와 `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`를 설정한다.
- S3 호환 저장소 리허설은 `docker compose --profile object-storage up -d minio minio-init`로 MinIO 버킷을 준비한 뒤 `npm run build`, `npm run qa:e2e:prepare`, `npm run object-storage:rehearsal` 순서로 업로드/다운로드/감사 로그를 확인한다.
- 관리자 설정의 `도입/배포 온보딩`에서 샘플 데이터 상태를 확인하고 운영 전 제거한다.
- 관리자 설정의 `현장 QR 출퇴근`에서 근무지를 등록하고 QR 발급/사용 로그를 확인한다.
- 현장 태블릿/PC에는 `/admin/qr-display`를 열어 60초 갱신 QR이 표시되는지 확인한다.
- 첨부/자료실 다운로드는 감사 로그 `attachment.downloaded`로 남는다. 운영 점검 때 관리자 설정의 `증빙 보안과 감사` 최근 다운로드와 DB 감사 로그를 함께 확인한다.
- 고객 시연, 관리자 초기 세팅, 장애 대응, 백업/복구 리허설 절차는 [DEMO_SCENARIOS.md](DEMO_SCENARIOS.md)에 정리했다.

## 백업/복구

```bash
npm run db:backup
npm run db:restore -- ./backups/workguard-YYYY-MM-DD.sql
```

백업/복구 스크립트는 `pg_dump`, `psql`, `DATABASE_URL`을 사용한다. 운영에서는 복구 전 별도 백업을 먼저 생성한다.

## Seed 정책

- `npm run db:seed`는 개발/데모용이다.
- 운영 초기 관리자 생성은 `npm run ops:bootstrap-admin -- admin@example.com 'StrongPassword123!' '초기 관리자' '회사명'`을 사용한다.
- 온보딩 샘플 데이터는 관리자 화면에서 주입/제거하고, 제거는 샘플 이메일과 `온보딩 샘플 데이터` 표식이 있는 데이터만 대상으로 한다.

## Turbopack/Next.js 경고 처리 기준

- 빌드 경고는 해결 가능한 설정 경고, 런타임 의존성 경고, 보류 경고로 분류한다.
- PDF 생성처럼 서버 전용 패키지는 `serverExternalPackages`에 둔다.
- 보류 경고는 영향 범위와 재현 명령을 이 문서에 추가한다.

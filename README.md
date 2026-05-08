# WorkGuard

워크가드는 한국형 노무 리스크 관리 SaaS MVP입니다. 직원 감시가 아니라 근로시간 기록, 초과근로 승인, 리스크 신호, 감사 로그, HR 리포트 흐름을 검증하는 웹앱입니다.

## Local Setup

```bash
npm install
docker compose up -d db
npm run db:push
npm run db:seed
npm run dev
```

Docker로 앱까지 한 번에 확인하려면 아래 명령을 사용합니다. 새 DB 볼륨이면 스키마 반영 후 데모 데이터를 자동으로 넣고, 기존 데이터가 있으면 seed를 건너뜁니다.

```bash
docker compose --profile app up -d app
```

호스트 3000번 포트가 이미 사용 중이면 `APP_PORT=3006 docker compose --profile app up -d app`처럼 바꿔서 실행할 수 있습니다.

Playwright E2E는 브라우저와 네트워크 제약을 피하도록 전용 Docker 프로필로 고정했습니다.

```bash
npm run qa:e2e:docker
```

앱은 기본적으로 `http://localhost:3000`에서 실행됩니다. 이미 사용 중인 포트가 있으면 Next.js가 다른 포트를 안내합니다. 첫 화면은 워크가드 랜딩페이지이며, `/login`에서 데모 계정으로 앱에 진입합니다.

## Demo Accounts

모든 계정의 비밀번호는 `password123!`입니다.

- `admin@gamsi.kr` - 회사 관리자
- `hr@gamsi.kr` - HR
- `manager@gamsi.kr` - 팀장
- `employee@gamsi.kr` - 직원
- `field@gamsi.kr` - 현장 직원

## Product Boundaries

MVP는 웹 체크인/체크아웃, 승인 기반 증빙, 규칙 기반 리스크 코멘트에 집중합니다. 스크린샷, 웹캠, 키 입력 상세 저장, 앱/웹사이트 감시, 몰래 설치형 에이전트는 포함하지 않습니다.

## Product Design

현재 MVP는 노무 리스크 관리의 핵심 흐름을 검증하는 버전입니다. 장기적으로는 시프티 수준의 쉬운 근태 UX 위에 한국형 법 위반 사전탐지, 스케줄/휴가/누락 수정, 모바일 현장 운영, 정책 자동 업데이트, ERP/급여 연동까지 확장합니다.

풀 제품 설계는 [docs/FULL_PRODUCT_DESIGN.md](docs/FULL_PRODUCT_DESIGN.md)에 정리되어 있습니다.
Phase 2 확장 계획은 [docs/PHASE_2_PLAN.md](docs/PHASE_2_PLAN.md)에 정리되어 있습니다.

## Implemented MVP Features

- 노무 리스크 대시보드와 규칙 기반 AI 코멘트
- 스케줄 등록/조회, 휴가 신청, 연차 잔액 계산, 출퇴근 누락 수정 요청
- 근로시간/노무 리스크 CSV 다운로드
- 노무 리스크 PDF 리포트 다운로드
- 월 마감 blocker 점검과 급여 export 미리보기
- 회사 설정, 팀 생성·수정·비활성화, 직원 수정·비활성화
- 직원 초대 링크, SMTP 초대 메일 발송, 초대 수락
- Next.js 16 기반 앱 라우터와 Prisma/PostgreSQL

## Invitation Email

초대 메일은 SMTP 환경변수가 설정되어 있을 때 발송됩니다. 설정이 없으면 초대 링크는 생성되고, 초대 상태에는 `not_configured`가 기록됩니다.

```bash
APP_BASE_URL="http://localhost:3006"
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="smtp-user"
SMTP_PASS="smtp-password"
SMTP_FROM="워크가드 <no-reply@example.com>"
```

## Web Push

브라우저 웹 푸시는 VAPID 키가 설정되어 있을 때 활성화됩니다. 로컬 개발에서는 `.env`에 개발용 키를 넣어두었고, 새 키가 필요하면 아래 명령으로 다시 생성할 수 있습니다.

```bash
npm run push:vapid
```

출력된 값을 `.env` 또는 배포 환경 변수에 반영하면 됩니다.

```bash
WEB_PUSH_SUBJECT="mailto:admin@example.com"
WEB_PUSH_VAPID_PUBLIC_KEY="..."
WEB_PUSH_VAPID_PRIVATE_KEY="..."
```

키가 설정되면 `/api/notifications/push/public-key`가 공개키를 노출하고, 브라우저는 해당 키로 push 구독을 생성합니다.

## Operations

- 관리자 설정의 `외부 연동` 카드에서 Slack 테스트, 웹푸시 테스트, 최근 실패 로그, 최근 클라이언트 오류를 함께 볼 수 있습니다.
- 배포 상태는 공용 `/api/health`, 관리자용 `/api/admin/ops/status`에서 확인할 수 있습니다.
- 관리자 설정의 `현장 QR 출퇴근`에서 근무지를 등록하고 60초짜리 QR 출퇴근 토큰을 발급할 수 있습니다.
- 직원별 월간 “노동청 제출용” 증빙 패키지는 인사 리포트 화면에서 PDF/CSV/첨부 ZIP으로 다운로드합니다.
- DB 백업/복구는 로컬과 운영 명령을 분리했습니다. 로컬은 `npm run db:backup:local`, `npm run db:restore:local -- ./backups/workguard-local.sql`을 사용합니다. 운영 복구는 `CONFIRM_RESTORE=production npm run db:restore:prod -- ./backups/workguard-production.sql`처럼 명시 확인이 필요합니다.
- 로컬 첨부파일 저장소를 쓰는 경우 백업 시 `*.uploads.tar.gz`와 `*.manifest.json`이 함께 생성되어 자료실/공지/결재/증빙 첨부파일 포함 여부를 확인할 수 있습니다.
- 데모 데이터 초기화는 로컬에서 `npm run db:reset-demo`를 사용합니다. 운영 환경에서는 기본적으로 차단됩니다.
- 현장 출퇴근 큐는 `IndexedDB + background sync`를 사용합니다. 서버 충돌이 난 항목은 자동 재전송하지 않고 `확인 필요` 상태로 남깁니다.
- 운영 체크리스트는 [docs/OPERATIONS.md](docs/OPERATIONS.md)에 정리되어 있습니다.
- 고객 시연과 관리자 초기 세팅, 장애 대응, 백업/복구 리허설은 [docs/DEMO_SCENARIOS.md](docs/DEMO_SCENARIOS.md)에 정리되어 있습니다.
- Docker VPS 배포 절차는 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)에 정리되어 있습니다.
- GitHub, 도메인, VPS가 정해진 뒤 진행할 후속 작업은 [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md)에 정리되어 있습니다.

## Bootstrap Admin

운영 환경에서 첫 관리자 계정을 빠르게 만들려면 아래 명령을 사용합니다.

```bash
npm run ops:bootstrap-admin -- admin@example.com 'StrongPassword123!' '초기 관리자' '회사명'
```

회사가 아직 없으면 함께 생성하고, 같은 이메일이 이미 있으면 관리자 권한과 비밀번호를 갱신합니다.

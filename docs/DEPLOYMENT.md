# WorkGuard Docker VPS Deployment

This runbook is the source of truth for the first production deployment path. It assumes a single Docker VPS, PostgreSQL, and HTTPS in front of the app.

## 1. Repository and CI

- Keep `main` protected and require the `CI` workflow before merging.
- CI runs `npm ci`, Prisma DB push/seed against a PostgreSQL service, `typecheck`, `lint`, production `build`, smoke QA, and Playwright E2E.
- Generated files, local secrets, backups, Playwright artifacts, and uploaded evidence are ignored by Git.

## 2. Production Environment

Copy `.env.production.example` to the VPS secret store or deployment environment and set real values.

Required:

- `DATABASE_URL`
- `AUTH_SECRET`
- `APP_BASE_URL`

Recommended:

- `SMTP_*` for invitations and password reset.
- `WEB_PUSH_*` from `npm run push:vapid` for browser push.

Production rules:

- `APP_BASE_URL` must be the public `https://` origin.
- `AUTH_SECRET` must be 32+ random characters and must not include any placeholder text.
- Do not commit `.env.production`.

## 3. Database Strategy

For the first controlled MVP deployment, `npm run db:push` is acceptable while schema ownership is still simple. Before real customer data accumulates, switch to migration-based deploys:

```bash
npx prisma migrate dev --name baseline
npx prisma migrate deploy
```

Until that migration cutover, run this before every production deploy:

```bash
npm run db:backup
npm run db:push
```

## 4. Backup and Restore Rehearsal

Create a backup from the production environment:

```bash
npm run db:backup
```

Restore it into a disposable database, never directly over production:

```bash
DATABASE_URL="postgresql://workguard_restore:secret@localhost:5432/workguard_restore?schema=public" \
  npm run db:restore -- ./backups/workguard-YYYY-MM-DD.sql
```

The rehearsal is complete only when the app can boot against the restored database and `/api/health` returns `ok`.

## 5. Deployment Rehearsal

Before changing production traffic, run:

```bash
npm run ops:deploy-rehearsal -- --base-url=https://workguard.example.com --require-health --docker-build
```

For local Docker rehearsal:

```bash
docker compose --profile app up --build app
npm run ops:deploy-rehearsal -- --base-url=http://localhost:3000 --allow-local --require-health
```

The rehearsal verifies required environment variables, backup tools, typecheck/lint/build, optional Docker image build, health, HTTPS expectations, PWA assets, and web push public-key exposure.

## 6. VPS Deploy Command

After the GitHub repository exists and the VPS has Docker, Docker Compose, Git, and SSH access configured:

```bash
DEPLOY_HOST="1.2.3.4" \
DEPLOY_USER="deploy" \
DEPLOY_PATH="/opt/workguard" \
DEPLOY_REPO="git@github.com:your-org/workguard.git" \
DEPLOY_BRANCH="main" \
DEPLOY_ENV_FILE=".env.production" \
npm run ops:deploy-vps
```

Optional SSH key:

```bash
DEPLOY_SSH_KEY="$HOME/.ssh/workguard_deploy" npm run ops:deploy-vps
```

The command pulls the selected branch on the VPS, copies the production env file to `.env`, builds the app image, runs `npm run db:push` inside the app container, and restarts the app profile.

## 7. HTTPS, PWA, and Web Push

Production verification checklist:

- The deployed origin redirects to HTTPS.
- `/manifest.webmanifest`, `/sw.js`, and `/offline.html` are reachable.
- The browser can install the PWA from `/dashboard`.
- `/api/notifications/push/public-key` returns `enabled: true` after VAPID keys are configured.
- A real browser can subscribe and receive a test notification from 관리자 설정.

## 8. Rollback

- Keep the previous Docker image tag available.
- Keep the latest verified SQL backup available before DB changes.
- Roll back app image first. Restore DB only if the deploy changed schema/data in a way the old image cannot read.

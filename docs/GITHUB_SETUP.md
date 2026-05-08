# WorkGuard GitHub Setup

## Repository

- Repository: `jaeseok614/gamsi`
- Default branch: `main`
- Remote URL: `git@github.com:jaeseok614/gamsi.git`

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`

The CI workflow runs on pushes and pull requests to `main`:

- Checks that secret env files are not tracked.
- Installs dependencies with `npm ci`.
- Runs Prisma DB push/seed against a PostgreSQL service.
- Runs `npm run typecheck`.
- Runs `npm run lint`.
- Runs `npm run build`.
- Runs smoke QA.
- Runs Playwright E2E.

No GitHub Actions secrets are required for CI. Test-only VAPID keys are generated during the workflow.

## Branch Protection

Recommended settings for `main`:

- Require a pull request before merging.
- Require status checks to pass before merging.
- Required status check: `CI / verify`.
- Require branches to be up to date before merging.
- Do not allow force pushes.
- Do not allow deletions.

## Secrets

Do not add local `.env` contents to GitHub. `.env`, `.env.production`, and `.env.*.local` are ignored and CI blocks them if they are accidentally tracked.

Only add deployment secrets when a deployment workflow is introduced. For the selected Docker VPS path, use these names:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_SSH_KEY`
- `PRODUCTION_ENV`

`PRODUCTION_ENV` should contain the full production env file generated from `.env.production.example`, including:

- `DATABASE_URL`
- `AUTH_SECRET`
- `AUTH_COOKIE_SECURE=true`
- `APP_BASE_URL=https://your-domain.example`
- Optional `SMTP_*`
- Optional `WEB_PUSH_*`
- Optional `ATTACHMENT_STORAGE_DRIVER=s3` and `S3_*`

Do not create secrets that are not consumed by a workflow.

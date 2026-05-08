# WorkGuard Releases

## v0.1.0

Initial validated MVP baseline.

Validation status:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Docker Playwright E2E: `30 passed`

Scope:

- WorkGuard MVP dashboard, attendance, approvals, risk reporting, groupware, QR evidence, offline field queue, and Docker E2E validation flow.
- GitHub Actions CI configured for push and pull request verification.
- Docker VPS selected as the first deployment path.

Release criteria:

- Git tag `v0.1.0` points to the validated baseline commit.
- GitHub `CI` should pass on `main`.
- Production deploy should not proceed until `APP_BASE_URL` uses HTTPS and `AUTH_COOKIE_SECURE=true`.

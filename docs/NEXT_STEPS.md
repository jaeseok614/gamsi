# WorkGuard Next Steps

## GitHub Status

Completed:

- GitHub repository created: `jaeseok614/gamsi`.
- Local repository connected to `git@github.com:jaeseok614/gamsi.git`.
- `main` is tracking `origin/main`.
- GitHub Actions CI is configured in `.github/workflows/ci.yml`.

Recommended repository settings are tracked in [GITHUB_SETUP.md](GITHUB_SETUP.md).

## Domain and VPS Deployment

- Decide production domain and configure HTTPS.
- Prepare production `.env` from `.env.production.example`.
- Provision the Docker VPS.
- Configure VPS SSH access for the deploy user.
- Run the VPS deploy command from `docs/DEPLOYMENT.md`.
- Run production rehearsal:

```bash
npm run ops:deploy-rehearsal -- --base-url=https://your-domain.example --require-health --docker-build
```

## Next Local Development Priorities

- Continue mobile field UX polish after more real device checks.
- Run an object-storage rehearsal against the selected S3-compatible provider.
- Add payroll and risk calculation cases from real customer payroll samples.
- Add GPS verification only after consent, retention, and privacy copy are finalized.

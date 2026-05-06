# WorkGuard Next Steps

## Later: GitHub, Domain, and VPS Deployment

These tasks are intentionally deferred until the GitHub account/repository name, production domain, and VPS target are decided.

- Decide GitHub account or organization name.
- Create the GitHub repository.
- Connect the local repository:

```bash
git remote add origin <github-repo-url>
git push -u origin main
```

- Confirm GitHub Actions CI runs on `main`.
- Decide production domain and configure HTTPS.
- Prepare production `.env` from `.env.production.example`.
- Provision or choose the Docker VPS.
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

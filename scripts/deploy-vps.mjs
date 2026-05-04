import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const env = process.env;

function required(name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function run(command, args, options = {}) {
  const child = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });

  if (child.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${child.status ?? "unknown"}`);
  }
}

const host = required("DEPLOY_HOST");
const user = required("DEPLOY_USER");
const path = required("DEPLOY_PATH");
const repo = required("DEPLOY_REPO");
const branch = env.DEPLOY_BRANCH?.trim() || "main";
const envFile = env.DEPLOY_ENV_FILE?.trim() || ".env.production";
const sshTarget = `${user}@${host}`;
const sshArgs = env.DEPLOY_SSH_KEY?.trim() ? ["-i", env.DEPLOY_SSH_KEY.trim()] : [];

if (!existsSync(envFile)) {
  throw new Error(`Deployment env file not found: ${envFile}`);
}

console.log(`Deploying ${repo}#${branch} to ${sshTarget}:${path}`);

run("ssh", [
  ...sshArgs,
  sshTarget,
  [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(path)}`,
    `if [ ! -d ${shellQuote(`${path}/.git`)} ]; then git clone --branch ${shellQuote(branch)} ${shellQuote(repo)} ${shellQuote(path)}; fi`,
    `cd ${shellQuote(path)}`,
    `git fetch origin ${shellQuote(branch)}`,
    `git checkout ${shellQuote(branch)}`,
    `git pull --ff-only origin ${shellQuote(branch)}`
  ].join("\n")
]);

run("scp", [...sshArgs, envFile, `${sshTarget}:${path}/.env`]);

run("ssh", [
  ...sshArgs,
  sshTarget,
  [
    "set -euo pipefail",
    `cd ${shellQuote(path)}`,
    "docker compose up -d db",
    "docker compose --profile app build app",
    "docker compose --profile app run --rm app npm run db:push",
    "docker compose --profile app up -d app",
    "docker compose --profile app ps"
  ].join("\n")
]);

console.log("VPS deploy completed. Run ops:deploy-rehearsal against the public HTTPS URL next.");

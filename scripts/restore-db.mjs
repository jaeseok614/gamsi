import { access } from "node:fs/promises";
import { spawn } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
const inputPath = process.argv[2];

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!inputPath) {
  console.error("Usage: npm run db:restore -- ./backups/workguard.sql");
  process.exit(1);
}

await access(inputPath).catch(() => {
  console.error(`Backup file not found: ${inputPath}`);
  process.exit(1);
});

const child = spawn("psql", [databaseUrl, "--file", inputPath], {
  stdio: "inherit"
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

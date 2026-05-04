import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const backupDir = path.join(process.cwd(), "backups");
await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = process.argv[2] ?? path.join(backupDir, `workguard-${stamp}.sql`);

const child = spawn("pg_dump", [databaseUrl, "--clean", "--if-exists", "--no-owner", "--file", outputPath], {
  stdio: "inherit"
});

child.on("exit", (code) => {
  if (code === 0) {
    console.log(`Backup written to ${outputPath}`);
  }
  process.exit(code ?? 1);
});

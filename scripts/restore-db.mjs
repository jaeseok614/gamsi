import { access, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL;
const inputPath = process.argv[2];
const explicitUploadArchivePath = process.argv[3];
const mode = process.env.BACKUP_MODE === "production" ? "production" : "local";
const uploadRoot =
  process.env.ATTACHMENT_UPLOAD_ROOT ||
  path.join(process.cwd(), "data", "uploads", "approval-attachments");
const storageDriver = (process.env.ATTACHMENT_STORAGE_DRIVER || "local").trim().toLowerCase();

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!inputPath) {
  console.error("Usage: npm run db:restore -- ./backups/workguard.sql [./backups/workguard.sql.uploads.tar.gz]");
  process.exit(1);
}

if (mode === "production" && process.env.CONFIRM_RESTORE !== "production") {
  console.error("Production restore is blocked. Re-run with CONFIRM_RESTORE=production after verifying the backup target.");
  process.exit(1);
}

async function exists(targetPath) {
  return access(targetPath).then(
    () => true,
    () => false
  );
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${code ?? 1}`));
    });
  });
}

await access(inputPath).catch(() => {
  console.error(`Backup file not found: ${inputPath}`);
  process.exit(1);
});

await run("psql", [databaseUrl, "--file", inputPath]);

if (storageDriver === "local") {
  const uploadArchivePath = explicitUploadArchivePath ?? `${inputPath}.uploads.tar.gz`;
  if (await exists(uploadArchivePath)) {
    await mkdir(uploadRoot, { recursive: true });
    await run("tar", ["-xzf", uploadArchivePath, "-C", uploadRoot]);
    console.log(`Attachment archive restored to ${uploadRoot}`);
  } else {
    console.log(`No local attachment archive found at ${uploadArchivePath}`);
  }
} else {
  console.log("Attachment storage driver is external. Restore database references here and restore bucket objects with storage tooling.");
}

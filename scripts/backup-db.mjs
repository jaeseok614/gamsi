import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();
const databaseUrl = process.env.DATABASE_URL;
const mode = process.env.BACKUP_MODE === "production" ? "production" : "local";
const uploadRoot =
  process.env.ATTACHMENT_UPLOAD_ROOT ||
  path.join(process.cwd(), "data", "uploads", "approval-attachments");
const storageDriver = (process.env.ATTACHMENT_STORAGE_DRIVER || "local").trim().toLowerCase();

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
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

async function exists(targetPath) {
  return access(targetPath).then(
    () => true,
    () => false
  );
}

async function attachmentCounts() {
  const [approval, announcement, document, libraryVersions] = await Promise.all([
    prisma.requestAttachment.count(),
    prisma.announcementAttachment.count(),
    prisma.documentAttachment.count(),
    prisma.documentLibraryVersion.count()
  ]);
  return {
    approval,
    announcement,
    document,
    libraryVersions,
    total: approval + announcement + document + libraryVersions
  };
}

const backupDir = path.join(process.cwd(), "backups");
await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = process.argv[2] ?? path.join(backupDir, `workguard-${mode}-${stamp}.sql`);
const uploadArchivePath = `${outputPath}.uploads.tar.gz`;
const manifestPath = `${outputPath}.manifest.json`;

try {
  await run("pg_dump", [databaseUrl, "--clean", "--if-exists", "--no-owner", "--file", outputPath]);

  const counts = await attachmentCounts();
  const manifest = {
    mode,
    database: outputPath,
    createdAt: new Date().toISOString(),
    attachmentStorageDriver: storageDriver,
    attachmentUploadRoot: uploadRoot,
    attachmentCounts: counts,
    localUploadArchive: null
  };

  if (storageDriver === "local" && await exists(uploadRoot)) {
    await run("tar", ["-czf", uploadArchivePath, "-C", uploadRoot, "."]);
    manifest.localUploadArchive = uploadArchivePath;
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Backup written to ${outputPath}`);
  console.log(`Backup manifest written to ${manifestPath}`);
  if (manifest.localUploadArchive) {
    console.log(`Attachment archive written to ${manifest.localUploadArchive}`);
  } else if (counts.total > 0 && storageDriver !== "local") {
    console.log("Attachment files use external object storage. Database references are included; object bucket backup must be handled by storage tooling.");
  } else {
    console.log("No local attachment archive was needed.");
  }
} finally {
  await prisma.$disconnect();
}

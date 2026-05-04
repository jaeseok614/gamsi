import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads", "approval-attachments");
const MAX_FILE_COUNT = 5;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "attachment";
}

function ensureSafeStoragePath(storagePath: string) {
  const absolutePath = path.resolve(UPLOAD_ROOT, storagePath);
  const rootPath = path.resolve(UPLOAD_ROOT);
  if (absolutePath !== rootPath && !absolutePath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error("잘못된 첨부 파일 경로입니다.");
  }

  return absolutePath;
}

export function formatFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)}KB`;
  }
  return `${sizeBytes}B`;
}

export async function saveApprovalAttachments(input: {
  companyId: string;
  approvalRequestId: string;
  uploadedById: string;
  files: File[];
}) {
  const files = input.files.filter((file) => file.size > 0);
  if (files.length === 0) {
    return [];
  }

  if (files.length > MAX_FILE_COUNT) {
    throw new Error(`첨부 파일은 최대 ${MAX_FILE_COUNT}개까지 업로드할 수 있습니다.`);
  }

  const requestDir = path.join(UPLOAD_ROOT, input.companyId, input.approvalRequestId);
  await fs.mkdir(requestDir, { recursive: true });

  return Promise.all(
    files.map(async (file) => {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(`${file.name} 파일이 너무 큽니다. 파일당 10MB 이하만 허용됩니다.`);
      }

      const safeName = sanitizeFileName(file.name);
      const storedName = `${Date.now()}-${randomBytes(4).toString("hex")}-${safeName}`;
      const absolutePath = path.join(requestDir, storedName);
      const relativePath = path.relative(UPLOAD_ROOT, absolutePath).split(path.sep).join("/");

      await fs.writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

      return prisma.requestAttachment.create({
        data: {
          companyId: input.companyId,
          approvalRequestId: input.approvalRequestId,
          uploadedById: input.uploadedById,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          storagePath: relativePath
        }
      });
    })
  );
}

export async function readStoredAttachment(storagePath: string) {
  const absolutePath = ensureSafeStoragePath(storagePath);
  const content = await fs.readFile(absolutePath);
  return {
    absolutePath,
    content
  };
}

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads", "approval-attachments");
const MAX_FILE_COUNT = 5;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const DANGEROUS_EXTENSIONS = new Set([
  ".app",
  ".bat",
  ".cmd",
  ".com",
  ".dll",
  ".exe",
  ".hta",
  ".html",
  ".jar",
  ".js",
  ".msi",
  ".ps1",
  ".scr",
  ".sh",
  ".vbs",
  ".wsf"
]);
const ALLOWED_ATTACHMENT_TYPES = new Map<string, Set<string>>([
  [".csv", new Set(["text/csv", "application/csv", "application/vnd.ms-excel", "application/octet-stream"])],
  [".doc", new Set(["application/msword", "application/octet-stream"])],
  [".docx", new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".jpg", new Set(["image/jpeg"])],
  [".pdf", new Set(["application/pdf"])],
  [".png", new Set(["image/png"])],
  [".txt", new Set(["text/plain", "application/octet-stream"])],
  [".webp", new Set(["image/webp"])],
  [".xls", new Set(["application/vnd.ms-excel", "application/octet-stream"])],
  [".xlsx", new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"])]
]);

export type AttachmentStorageAdapter = {
  write: (input: { directory: string; fileName: string; content: Buffer }) => Promise<{ storagePath: string }>;
  read: (storagePath: string) => Promise<{ absolutePath: string; content: Buffer }>;
};

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

export const localAttachmentStorage: AttachmentStorageAdapter = {
  async write(input) {
    const requestDir = path.join(UPLOAD_ROOT, input.directory);
    await fs.mkdir(requestDir, { recursive: true });
    const absolutePath = path.join(requestDir, input.fileName);
    const relativePath = path.relative(UPLOAD_ROOT, absolutePath).split(path.sep).join("/");
    await fs.writeFile(absolutePath, input.content);
    return {
      storagePath: relativePath
    };
  },
  async read(storagePath) {
    const absolutePath = ensureSafeStoragePath(storagePath);
    const content = await fs.readFile(absolutePath);
    return {
      absolutePath,
      content
    };
  }
};

export const attachmentStorage = localAttachmentStorage;

export function formatFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)}KB`;
  }
  return `${sizeBytes}B`;
}

function fileExtension(name: string) {
  return path.extname(name).toLowerCase();
}

function attachmentMimeType(file: File) {
  return (file.type || "application/octet-stream").toLowerCase();
}

export function validateApprovalAttachmentFiles(files: File[]) {
  const nonEmptyFiles = files.filter((file) => file.size > 0);
  if (nonEmptyFiles.length > MAX_FILE_COUNT) {
    throw new Error(`첨부 파일은 최대 ${MAX_FILE_COUNT}개까지 업로드할 수 있습니다.`);
  }

  for (const file of nonEmptyFiles) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`${file.name} 파일이 너무 큽니다. 파일당 ${formatFileSize(MAX_FILE_SIZE_BYTES)} 이하만 허용됩니다.`);
    }

    const extension = fileExtension(file.name);
    if (!extension || DANGEROUS_EXTENSIONS.has(extension)) {
      throw new Error(`${file.name} 파일 형식은 업로드할 수 없습니다.`);
    }

    const allowedTypes = ALLOWED_ATTACHMENT_TYPES.get(extension);
    if (!allowedTypes) {
      throw new Error(`${file.name} 파일 확장자는 허용되지 않습니다.`);
    }

    const mimeType = attachmentMimeType(file);
    if (!allowedTypes.has(mimeType)) {
      throw new Error(`${file.name} MIME 형식(${mimeType})은 ${extension} 파일로 허용되지 않습니다.`);
    }
  }

  return nonEmptyFiles;
}

export async function saveApprovalAttachments(input: {
  companyId: string;
  approvalRequestId: string;
  uploadedById: string;
  files: File[];
}) {
  const files = validateApprovalAttachmentFiles(input.files);
  if (files.length === 0) {
    return [];
  }

  return Promise.all(
    files.map(async (file) => {
      const safeName = sanitizeFileName(file.name);
      const storedName = `${Date.now()}-${randomBytes(4).toString("hex")}-${safeName}`;
      const stored = await attachmentStorage.write({
        directory: `${input.companyId}/${input.approvalRequestId}`,
        fileName: storedName,
        content: Buffer.from(await file.arrayBuffer())
      });

      return prisma.requestAttachment.create({
        data: {
          companyId: input.companyId,
          approvalRequestId: input.approvalRequestId,
          uploadedById: input.uploadedById,
          originalName: file.name,
          mimeType: attachmentMimeType(file),
          sizeBytes: file.size,
          storagePath: stored.storagePath
        }
      });
    })
  );
}

export async function readStoredAttachment(storagePath: string) {
  return attachmentStorage.read(storagePath);
}

import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";

const UPLOAD_ROOT = process.env.ATTACHMENT_UPLOAD_ROOT || path.join(process.cwd(), "data", "uploads", "approval-attachments");
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
  read: (storagePath: string) => Promise<{ absolutePath?: string; storagePath: string; content: Buffer }>;
};

type S3StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  forcePathStyle: boolean;
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
      storagePath,
      content
    };
  }
};

function attachmentStorageDriver() {
  return (process.env.ATTACHMENT_STORAGE_DRIVER || "local").trim().toLowerCase();
}

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} 환경변수를 설정하세요.`);
  }
  return value;
}

function s3StorageConfig(): S3StorageConfig {
  return {
    endpoint: readRequiredEnv("S3_ENDPOINT"),
    region: process.env.S3_REGION?.trim() || "ap-northeast-2",
    bucket: readRequiredEnv("S3_BUCKET"),
    accessKeyId: readRequiredEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: readRequiredEnv("S3_SECRET_ACCESS_KEY"),
    prefix: (process.env.S3_KEY_PREFIX || "").trim().replace(/^\/+|\/+$/g, ""),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() !== "false"
  };
}

function sha256Hex(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacSha256Hex(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function s3Timestamp(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8)
  };
}

function encodeS3Key(key: string) {
  return key
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function joinS3Key(...segments: string[]) {
  return segments
    .flatMap((segment) => segment.split("/"))
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function buildS3Url(config: S3StorageConfig, key: string) {
  const endpoint = new URL(config.endpoint);
  const basePath = endpoint.pathname.replace(/^\/+|\/+$/g, "");
  const encodedKey = encodeS3Key(key);
  const bucketPath = encodeURIComponent(config.bucket);

  if (config.forcePathStyle) {
    endpoint.pathname = `/${[basePath, bucketPath, encodedKey].filter(Boolean).join("/")}`;
    return endpoint;
  }

  endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
  endpoint.pathname = `/${[basePath, encodedKey].filter(Boolean).join("/")}`;
  return endpoint;
}

function signingKey(config: S3StorageConfig, dateStamp: string) {
  const kDate = hmacSha256(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, config.region);
  const kService = hmacSha256(kRegion, "s3");
  return hmacSha256(kService, "aws4_request");
}

function signedS3Request(input: {
  method: "GET" | "PUT";
  config: S3StorageConfig;
  key: string;
  content?: Buffer;
}) {
  const url = buildS3Url(input.config, input.key);
  const payloadHash = sha256Hex(input.content ?? "");
  const { amzDate, dateStamp } = s3Timestamp();
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    ""
  ].join("\n");
  const canonicalRequest = [
    input.method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/${input.config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmacSha256Hex(signingKey(input.config, dateStamp), stringToSign);

  return {
    url,
    headers: {
      authorization: [
        "AWS4-HMAC-SHA256",
        `Credential=${input.config.accessKeyId}/${credentialScope}`,
        `SignedHeaders=${signedHeaders}`,
        `Signature=${signature}`
      ].join(", "),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    }
  };
}

function parseS3StoragePath(storagePath: string, config: S3StorageConfig) {
  if (!storagePath.startsWith("s3://")) {
    return storagePath.replace(/^\/+/, "");
  }

  const url = new URL(storagePath);
  if (url.hostname !== config.bucket) {
    throw new Error("다른 버킷의 첨부 파일은 읽을 수 없습니다.");
  }
  return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
}

export const s3AttachmentStorage: AttachmentStorageAdapter = {
  async write(input) {
    const config = s3StorageConfig();
    const key = joinS3Key(config.prefix, input.directory, input.fileName);
    const request = signedS3Request({
      method: "PUT",
      config,
      key,
      content: input.content
    });
    const response = await fetch(request.url, {
      method: "PUT",
      headers: request.headers,
      body: input.content
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`첨부 파일을 객체 저장소에 저장하지 못했습니다. (${response.status}) ${detail}`.trim());
    }

    return {
      storagePath: `s3://${config.bucket}/${encodeS3Key(key)}`
    };
  },
  async read(storagePath) {
    const config = s3StorageConfig();
    const key = parseS3StoragePath(storagePath, config);
    const request = signedS3Request({
      method: "GET",
      config,
      key
    });
    const response = await fetch(request.url, {
      method: "GET",
      headers: request.headers
    });

    if (!response.ok) {
      throw new Error(`객체 저장소에서 첨부 파일을 읽지 못했습니다. (${response.status})`);
    }

    return {
      storagePath,
      content: Buffer.from(await response.arrayBuffer())
    };
  }
};

export const attachmentStorage = attachmentStorageDriver() === "s3" ? s3AttachmentStorage : localAttachmentStorage;

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

export async function saveDocumentAttachments(input: {
  companyId: string;
  documentRequestId: string;
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
        directory: `${input.companyId}/document-requests/${input.documentRequestId}`,
        fileName: storedName,
        content: Buffer.from(await file.arrayBuffer())
      });

      return prisma.documentAttachment.create({
        data: {
          companyId: input.companyId,
          documentRequestId: input.documentRequestId,
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

export async function saveAnnouncementAttachments(input: {
  companyId: string;
  announcementId: string;
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
        directory: `${input.companyId}/announcements/${input.announcementId}`,
        fileName: storedName,
        content: Buffer.from(await file.arrayBuffer())
      });

      return prisma.announcementAttachment.create({
        data: {
          companyId: input.companyId,
          announcementId: input.announcementId,
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

export async function saveDocumentLibraryVersionFile(input: {
  companyId: string;
  itemId: string;
  uploadedById: string;
  versionNo: number;
  note?: string | null;
  file: File;
}) {
  const [file] = validateApprovalAttachmentFiles([input.file]);
  if (!file) {
    throw new Error("자료실 파일을 첨부하세요.");
  }

  const safeName = sanitizeFileName(file.name);
  const storedName = `${Date.now()}-${randomBytes(4).toString("hex")}-${safeName}`;
  const stored = await attachmentStorage.write({
    directory: `${input.companyId}/library/${input.itemId}`,
    fileName: storedName,
    content: Buffer.from(await file.arrayBuffer())
  });

  return prisma.documentLibraryVersion.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      uploadedById: input.uploadedById,
      versionNo: input.versionNo,
      note: input.note?.trim() || null,
      originalName: file.name,
      mimeType: attachmentMimeType(file),
      sizeBytes: file.size,
      storagePath: stored.storagePath
    }
  });
}

export async function readStoredAttachment(storagePath: string) {
  if (storagePath.startsWith("s3://")) {
    return s3AttachmentStorage.read(storagePath);
  }

  return localAttachmentStorage.read(storagePath);
}

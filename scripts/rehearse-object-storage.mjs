import { spawn } from "node:child_process";

import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();
const password = process.env.OBJECT_STORAGE_REHEARSAL_PASSWORD ?? "password123!";
const port = process.env.OBJECT_STORAGE_REHEARSAL_PORT ?? "3010";
const baseUrl = process.env.OBJECT_STORAGE_REHEARSAL_BASE_URL ?? `http://localhost:${port}`;
const shouldStartApp = process.env.OBJECT_STORAGE_REHEARSAL_START_APP !== "false";
const bucket = process.env.S3_BUCKET || process.env.MINIO_BUCKET || "workguard-rehearsal";
const storageEnv = {
  ATTACHMENT_STORAGE_DRIVER: "s3",
  S3_ENDPOINT: process.env.S3_ENDPOINT || "http://127.0.0.1:9000",
  S3_REGION: process.env.S3_REGION || "ap-northeast-2",
  S3_BUCKET: bucket,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || process.env.MINIO_ROOT_USER || "minioadmin",
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || process.env.MINIO_ROOT_PASSWORD || "minioadmin123",
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE || "true",
  S3_KEY_PREFIX: process.env.S3_KEY_PREFIX || `rehearsal/${Date.now()}`
};

function firstCookie(setCookie) {
  if (!setCookie) {
    throw new Error("로그인 응답에 세션 쿠키가 없습니다.");
  }

  return setCookie.split(";")[0];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 120_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/api/health`, {}, 2_000);
      if (response.ok) {
        return;
      }
      lastError = new Error(`health responded ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw lastError ?? new Error("앱 헬스체크가 시간 안에 통과하지 못했습니다.");
}

async function login(email) {
  const response = await fetchWithTimeout(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email,
      password
    })
  });

  if (!response.ok) {
    throw new Error(`로그인 실패: ${response.status} ${await response.text()}`);
  }

  return firstCookie(response.headers.get("set-cookie"));
}

async function uploadLibraryFile(cookie) {
  const stamp = Date.now();
  const body = new FormData();
  body.set("title", `Object storage rehearsal ${stamp}`);
  body.set("category", "POLICY");
  body.set("accessScope", "ALL");
  body.set("description", "S3-compatible upload/download rehearsal");
  body.set("note", "object-storage rehearsal");
  body.set("file", new Blob(["object storage rehearsal\n"], { type: "text/plain" }), `object-storage-${stamp}.txt`);

  const response = await fetchWithTimeout(`${baseUrl}/api/groupware/library`, {
    method: "POST",
    headers: {
      cookie
    },
    body
  }, 30_000);

  if (!response.ok) {
    throw new Error(`자료실 업로드 실패: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  const storagePath = result.version?.storagePath;
  if (!storagePath?.startsWith(`s3://${bucket}/`)) {
    throw new Error(`객체 저장소 경로가 아닙니다: ${storagePath}`);
  }

  return result;
}

async function downloadLibraryFile(cookie, versionId) {
  const response = await fetchWithTimeout(`${baseUrl}/api/groupware/library/versions/${versionId}`, {
    headers: {
      cookie
    }
  }, 30_000);

  if (!response.ok) {
    throw new Error(`자료실 다운로드 실패: ${response.status} ${await response.text()}`);
  }

  const content = await response.text();
  if (!content.includes("object storage rehearsal")) {
    throw new Error("다운로드한 파일 내용이 업로드 내용과 다릅니다.");
  }
}

async function countDownloadAudit(versionId) {
  return prisma.auditLog.count({
    where: {
      action: "attachment.downloaded",
      targetType: "document_library_version",
      targetId: versionId
    }
  });
}

function startApp() {
  const app = spawn("npm", ["run", "start", "--", "-p", port], {
    env: {
      ...process.env,
      ...storageEnv,
      APP_BASE_URL: baseUrl
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const appendOutput = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-20_000);
  };
  app.stdout.on("data", appendOutput);
  app.stderr.on("data", appendOutput);

  return {
    output: () => output,
    stop: async () => {
      if (app.exitCode !== null || app.signalCode !== null) {
        return;
      }
      const exited = new Promise((resolve) => app.once("exit", resolve));
      if (app.exitCode !== null || app.signalCode !== null) {
        return;
      }
      const signalApp = (signal) => {
        try {
          if (process.platform !== "win32" && app.pid) {
            process.kill(-app.pid, signal);
          } else {
            app.kill(signal);
          }
        } catch (error) {
          if (error?.code !== "ESRCH") {
            throw error;
          }
        }
      };
      signalApp("SIGTERM");
      const stopped = await Promise.race([
        exited.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 5_000))
      ]);
      if (!stopped) {
        signalApp("SIGKILL");
        await exited;
      }
    }
  };
}

let appServer;
try {
  if (shouldStartApp) {
    appServer = startApp();
  }

  await waitForHealth();
  const adminCookie = await login("admin@gamsi.kr");
  const employeeCookie = await login("employee@gamsi.kr");
  const uploaded = await uploadLibraryFile(adminCookie);
  await downloadLibraryFile(employeeCookie, uploaded.version.id);
  const auditCount = await countDownloadAudit(uploaded.version.id);
  if (auditCount < 1) {
    throw new Error("자료실 다운로드 감사 로그가 남지 않았습니다.");
  }

  console.log(`Object storage rehearsal passed: ${uploaded.version.storagePath}`);
} catch (error) {
  if (appServer?.output()) {
    console.error(appServer.output());
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await appServer?.stop();
  await prisma.$disconnect();
  process.exit(process.exitCode ?? 0);
}

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const requireHealth = args.has("--require-health");
const allowLocal = args.has("--allow-local");
const checkDockerBuild = args.has("--docker-build");
const baseUrlArg = process.argv.find((arg) => arg.startsWith("--base-url="));
const baseUrl = baseUrlArg?.slice("--base-url=".length);
const normalizedBaseUrl = baseUrl?.replace(/\/$/, "");

function parseDotEnv(path) {
  if (!existsSync(path)) {
    return {};
  }

  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

const env = {
  ...parseDotEnv(".env"),
  ...process.env
};

const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
  const prefix = status === "pass" ? "PASS" : status === "warn" ? "WARN" : "FAIL";
  console.log(`[${prefix}] ${name} - ${detail}`);
}

function hasValue(key) {
  return Boolean(String(env[key] ?? "").trim());
}

function webPushConfigured() {
  return hasValue("WEB_PUSH_SUBJECT") && hasValue("WEB_PUSH_VAPID_PUBLIC_KEY") && hasValue("WEB_PUSH_VAPID_PRIVATE_KEY");
}

function run(command, argsForCommand, label, required = true) {
  const child = spawnSync(command, argsForCommand, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...env
    }
  });

  if (child.status === 0) {
    record(label, "pass", `${command} ${argsForCommand.join(" ")}`.trim());
    return true;
  }

  record(label, required ? "fail" : "warn", `${command} 종료 코드 ${child.status ?? "unknown"}`);
  return false;
}

function checkPostgresTool(command, label) {
  const host = spawnSync(command, ["--version"], {
    stdio: "ignore"
  });

  if (host.status === 0) {
    record(label, "pass", `${command} --version`);
    return;
  }

  const docker = spawnSync("docker", ["compose", "exec", "-T", "db", command, "--version"], {
    stdio: "ignore"
  });

  if (docker.status === 0) {
    record(label, "pass", `Docker db 컨테이너에서 ${command} 사용 가능`);
    return;
  }

  record(label, "warn", `${command}를 호스트나 Docker db 컨테이너에서 확인하지 못했습니다.`);
}

async function checkHealth() {
  if (!normalizedBaseUrl) {
    record("헬스체크", requireHealth ? "fail" : "warn", "--base-url이 없어 /api/health 호출을 건너뜁니다.");
    return;
  }

  try {
    const response = await fetch(`${normalizedBaseUrl}/api/health`);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      record("헬스체크", "fail", `/api/health ${response.status}`);
      return;
    }
    const degradedRequiredChecks = Array.isArray(body?.checks)
      ? body.checks.filter((check) => check?.severity === "required" && check?.status !== "ok")
      : [];
    if (degradedRequiredChecks.length > 0) {
      record(
        "헬스체크",
        requireHealth ? "fail" : "warn",
        `required degraded: ${degradedRequiredChecks.map((check) => check.label ?? check.key).join(", ")}`
      );
      return;
    }
    record(
      "헬스체크",
      body?.status === "ok" ? "pass" : "warn",
      body?.status === "ok" ? "/api/health status=ok" : "필수 항목은 정상, 권장 항목 경고 있음"
    );
  } catch (error) {
    record("헬스체크", requireHealth ? "fail" : "warn", error instanceof Error ? error.message : "호출 실패");
  }
}

async function fetchText(pathname, label, required = requireHealth) {
  if (!normalizedBaseUrl) {
    record(label, required ? "fail" : "warn", "--base-url이 없어 확인을 건너뜁니다.");
    return null;
  }

  try {
    const response = await fetch(`${normalizedBaseUrl}${pathname}`);
    if (!response.ok) {
      record(label, required ? "fail" : "warn", `${pathname} ${response.status}`);
      return null;
    }
    const body = await response.text();
    record(label, "pass", `${pathname} 응답 확인`);
    return body;
  } catch (error) {
    record(label, required ? "fail" : "warn", error instanceof Error ? error.message : "호출 실패");
    return null;
  }
}

async function fetchJson(pathname, label, required = requireHealth) {
  const body = await fetchText(pathname, label, required);
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    record(`${label} JSON`, required ? "fail" : "warn", "JSON 파싱 실패");
    return null;
  }
}

async function checkRuntimeSurface() {
  if (!normalizedBaseUrl) {
    record("런타임 표면 점검", requireHealth ? "fail" : "warn", "--base-url이 없어 HTTPS/PWA/Web Push 확인을 건너뜁니다.");
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedBaseUrl);
  } catch {
    record("배포 URL 형식", "fail", normalizedBaseUrl);
    return;
  }

  const isLocalHttp =
    parsedUrl.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(parsedUrl.hostname) && allowLocal;
  record(
    "HTTPS 배포 URL",
    parsedUrl.protocol === "https:" || isLocalHttp ? "pass" : "fail",
    isLocalHttp ? "로컬 HTTP 허용" : parsedUrl.origin
  );

  const manifest = await fetchJson("/manifest.webmanifest", "PWA manifest");
  if (manifest) {
    const hasRequiredManifestFields =
      typeof manifest.name === "string" &&
      manifest.start_url === "/dashboard" &&
      manifest.display === "standalone" &&
      Array.isArray(manifest.icons) &&
      manifest.icons.length >= 2;
    record(
      "PWA manifest 필수 필드",
      hasRequiredManifestFields ? "pass" : "fail",
      hasRequiredManifestFields ? "name/start_url/display/icons 확인" : "필수 필드가 부족합니다."
    );
  }

  const serviceWorker = await fetchText("/sw.js", "Service Worker");
  if (serviceWorker) {
    const hasOfflineQueue = serviceWorker.includes("workguard-field-queue") && serviceWorker.includes("sync");
    record(
      "Service Worker 오프라인 큐",
      hasOfflineQueue ? "pass" : "fail",
      hasOfflineQueue ? "IndexedDB/background sync 코드 확인" : "오프라인 큐 코드가 감지되지 않습니다."
    );
  }

  const offlinePage = await fetchText("/offline.html", "오프라인 페이지");
  if (offlinePage) {
    record(
      "오프라인 페이지 내용",
      offlinePage.includes("오프라인") || offlinePage.toLowerCase().includes("offline") ? "pass" : "warn",
      "offline 안내 문구 확인"
    );
  }

  const pushConfig = await fetchJson("/api/notifications/push/public-key", "Web Push 공개키", false);
  if (pushConfig) {
    const enabled = Boolean(pushConfig.enabled);
    const publicKey = typeof pushConfig.publicKey === "string" ? pushConfig.publicKey : "";
    const expected = webPushConfigured();
    record(
      "Web Push 런타임 설정",
      expected ? (enabled && publicKey.length > 40 ? "pass" : "fail") : "warn",
      expected
        ? enabled
          ? "공개키 노출 확인"
          : "환경변수는 있으나 공개키 API가 비활성입니다."
        : "VAPID 키가 없어 선택 기능으로 건너뜁니다."
    );
  }
}

function checkEnv() {
  for (const key of ["DATABASE_URL", "APP_BASE_URL", "AUTH_SECRET"]) {
    record(`환경변수 ${key}`, hasValue(key) ? "pass" : "fail", hasValue(key) ? "설정됨" : "누락됨");
  }

  const authSecret = String(env.AUTH_SECRET ?? "");
  const authIsDefault = authSecret === "local-dev-secret-change-before-production" || authSecret.includes("change-before-production");
  record(
    "AUTH_SECRET 운영값",
    authSecret && authSecret.length >= 32 && !authIsDefault ? "pass" : "fail",
    authSecret && authSecret.length >= 32 && !authIsDefault ? "32자 이상 운영값" : "기본값이거나 32자 미만"
  );

  const appBaseUrl = String(env.APP_BASE_URL ?? "");
  const appUrlIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(appBaseUrl);
  record(
    "APP_BASE_URL 운영 도메인",
    appBaseUrl && (!appUrlIsLocal || allowLocal) ? "pass" : "fail",
    appUrlIsLocal ? "localhost 값입니다." : appBaseUrl ? appBaseUrl : "누락됨"
  );

  const appUrlIsHttps = appBaseUrl.startsWith("https://");
  record(
    "APP_BASE_URL HTTPS",
    appUrlIsHttps || (allowLocal && appUrlIsLocal) ? "pass" : "fail",
    appUrlIsHttps ? "HTTPS origin" : allowLocal && appUrlIsLocal ? "로컬 HTTP 허용" : "운영에서는 https:// origin이어야 합니다."
  );

  record(
    "SMTP",
    hasValue("SMTP_HOST") && hasValue("SMTP_FROM") ? "pass" : "warn",
    hasValue("SMTP_HOST") && hasValue("SMTP_FROM") ? "메일 발송 설정 감지" : "SMTP_HOST/SMTP_FROM 미설정"
  );

  record(
    "Web Push",
    hasValue("WEB_PUSH_VAPID_PUBLIC_KEY") && hasValue("WEB_PUSH_VAPID_PRIVATE_KEY") ? "pass" : "warn",
    hasValue("WEB_PUSH_VAPID_PUBLIC_KEY") && hasValue("WEB_PUSH_VAPID_PRIVATE_KEY") ? "VAPID 키 감지" : "VAPID 키 미설정"
  );
}

async function main() {
  console.log("WorkGuard 배포 리허설을 시작합니다.");
  checkEnv();

  checkPostgresTool("pg_dump", "백업 명령 pg_dump");
  checkPostgresTool("psql", "복구 명령 psql");
  run("docker", ["compose", "version"], "Docker Compose", false);

  if (!skipBuild) {
    run("npm", ["run", "typecheck"], "TypeScript");
    run("npm", ["run", "lint"], "Lint");
    run("npm", ["run", "build"], "Next.js production build");
  }

  if (checkDockerBuild) {
    run("docker", ["compose", "--profile", "app", "build", "app"], "Docker 앱 이미지 빌드");
  } else {
    record("Docker 앱 이미지 빌드", "warn", "--docker-build 옵션을 주면 실제 앱 이미지를 빌드합니다.");
  }

  await checkHealth();
  await checkRuntimeSurface();

  const failed = results.filter((result) => result.status === "fail");
  const warned = results.filter((result) => result.status === "warn");
  console.log(`배포 리허설 완료: 실패 ${failed.length}건, 경고 ${warned.length}건`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

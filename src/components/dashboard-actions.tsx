"use client";

import {
  Archive,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  Clock,
  Copy,
  Download,
  FileText,
  Home,
  LogOut,
  Mail,
  MessageSquarePlus,
  Play,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  Square,
  Trash2,
  ThumbsDown,
  ThumbsUp,
  Upload,
  Users,
  Camera,
  Wifi,
  WifiOff
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { browserPermissionLabel, browserPermissionTone } from "@/lib/display-labels";
import {
  FIELD_QUEUE_SYNC_EVENT,
  clearFieldQueue,
  enqueueFieldQueueItem,
  flushFieldQueue,
  getFieldQueueMeta,
  listFieldQueue,
  registerFieldQueueBackgroundSync,
  removeFieldQueueItem,
  type FieldQueueItem
} from "@/lib/field-queue";

type DeferredPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

type BarcodeDetectorResult = {
  rawValue: string;
};

type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorInstance;

declare global {
  interface WindowEventMap {
    beforeinstallprompt: DeferredPromptEvent;
  }

  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

type StatusOption = {
  value: string;
  label: string;
};

type ManagedUserOption = {
  id: string;
  name: string;
  teamName?: string | null;
};

type ScheduleMode = "single" | "range" | "copy_week" | "bulk_update" | "bulk_delete";

type ScheduleTemplateItem = {
  id: string;
  name: string;
  mode: ScheduleMode;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  shiftName: string;
  note: string;
  weekdays: number[];
};

type SchedulePreview = {
  mode: ScheduleMode;
  total: number;
  userCount: number;
  createCount: number;
  updateCount: number;
  deleteCount: number;
  overwriteCount: number;
  fromDate: string;
  toDate: string;
  requiresConfirmation: boolean;
  summaryLine: string;
  rows: Array<{
    action: "create" | "update" | "delete";
    userId: string;
    workDate: string;
    shiftName: string;
    scheduledStartAt?: string;
    scheduledEndAt?: string;
    breakMinutes?: number;
    note?: string | null;
    previous?: {
      shiftName: string;
      scheduledStartAt: string;
      scheduledEndAt: string;
      breakMinutes: number;
      note?: string | null;
    };
  }>;
};

type NotificationCenterItem = {
  id: string;
  type?: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  metadata?: unknown;
  isRead?: boolean;
  readAt?: Date | string | null;
  archivedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

type NotificationReminder = {
  id: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  tone: "info" | "warning";
  category?: "APPROVAL" | "LEAVE" | "MISSING" | "MONTH_CLOSE";
};

type NotificationGroupwareSummary = {
  unreadAnnouncements: number;
  incomingDocuments: number;
  myPendingDocuments: number;
  myApprovedDocuments: number;
  myRejectedDocuments: number;
  assignedMemos: number;
  payrollStatementIssues: number;
};

type NotificationGroup = "ALL" | "APPROVAL" | "LEAVE" | "MISSING" | "MONTH_CLOSE" | "OTHER";

type ServerNotificationPreference = {
  emailEnabled: boolean;
  webPushEnabled: boolean;
  approvalPendingEmail: boolean;
  approvalReviewedEmail: boolean;
  leaveReminderEmail: boolean;
  missingRecordEmail: boolean;
  monthCloseEmail: boolean;
  schedulerDigestEnabled: boolean;
  browserPermission: string;
};

type NotificationLocalPreferenceState = {
  managerDailyDigestEnabled: boolean;
  approvalMuted: boolean;
  leaveMuted: boolean;
  missingRecordMuted: boolean;
  monthCloseMuted: boolean;
  dailyDigestMuted: boolean;
  approvalSnoozeUntil: string | Date | null;
  leaveSnoozeUntil: string | Date | null;
  missingRecordSnoozeUntil: string | Date | null;
  monthCloseSnoozeUntil: string | Date | null;
  dailyDigestSnoozeUntil: string | Date | null;
};

type NotificationPreferenceState = ServerNotificationPreference & NotificationLocalPreferenceState;
type MobileQuickApproval = {
  id: string;
  type: string;
  requesterName: string;
  ageLabel: string;
};
type AccountSessionItem = {
  id: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  lastSeenAt: Date | string;
  expiresAt: Date | string;
  createdAt: Date | string;
  isCurrent: boolean;
};
type DashboardViewRoute = "employee" | "groupware" | "organization" | "workbox" | "notifications" | "approvals" | "reports" | "risk" | "settings";

async function postJson(path: string, body?: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : "{}"
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "요청 처리에 실패했습니다.");
  }

  return response.json().catch(() => ({}));
}

function normalizeClockQrPayload(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    const token = url.searchParams.get("clockToken") ?? url.searchParams.get("token");
    if (token) {
      return normalizeClockQrPayload(token);
    }
  } catch {
    // QR payload can be a short WG1 token rather than a URL.
  }

  return trimmed
    .replace(/^WG(?:1)?:/i, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

async function postForm(path: string, body: FormData, options?: { onProgress?: (progress: number) => void }) {
  if (typeof window !== "undefined" && options?.onProgress) {
    await new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", path);
      request.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) {
          return;
        }
        options.onProgress?.(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))));
      });
      request.addEventListener("load", async () => {
        if (request.status >= 200 && request.status < 300) {
          options.onProgress?.(100);
          resolve();
          return;
        }

        try {
          const payload = JSON.parse(request.responseText) as { error?: string };
          reject(new Error(payload.error ?? "요청 처리에 실패했습니다."));
        } catch {
          reject(new Error("요청 처리에 실패했습니다."));
        }
      });
      request.addEventListener("error", () => reject(new Error("요청 처리에 실패했습니다.")));
      request.send(body);
    });
    return {};
  }

  const response = await fetch(path, {
    method: "POST",
    body
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "요청 처리에 실패했습니다.");
  }

  return response.json().catch(() => ({}));
}

function getObjectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function dashboardViewHref(
  view: DashboardViewRoute,
  params?: Record<string, string | null | undefined>,
  hash?: string
) {
  const search = new URLSearchParams();
  search.set("view", view);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        search.set(key, value);
      }
    }
  }

  return `/dashboard?${search.toString()}${hash ? `#${hash}` : ""}`;
}

function shiftDateString(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekStartDateString(dateString: string) {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  const day = date.getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  return date.toISOString().slice(0, 10);
}

function notificationGroupForType(type?: string): NotificationGroup {
  if (type === "APPROVAL_PENDING" || type === "APPROVAL_APPROVED" || type === "APPROVAL_REJECTED") {
    return "APPROVAL";
  }
  if (type === "LEAVE_STARTING") {
    return "LEAVE";
  }
  if (type === "MISSING_RECORD") {
    return "MISSING";
  }
  if (type === "MONTH_CLOSE") {
    return "MONTH_CLOSE";
  }
  return "OTHER";
}

function isApprovalPendingNotification(notification: NotificationCenterItem) {
  return notification.type === "APPROVAL_PENDING";
}

function buildMissingAdjustmentHrefFromMetadata(metadata: unknown) {
  const record = getObjectRecord(metadata);
  const params = new URLSearchParams();
  params.set("adjustmentSource", "notification");

  if (!record) {
    return dashboardViewHref("employee", Object.fromEntries(params.entries()), "missing-adjustment");
  }

  const adjustmentDate = typeof record.targetDate === "string" ? record.targetDate : null;
  const adjustmentType = typeof record.adjustmentType === "string" ? record.adjustmentType : null;
  const adjustmentTime = typeof record.requestedTime === "string" ? record.requestedTime : null;

  if (adjustmentDate) {
    params.set("adjustmentDate", adjustmentDate);
  }
  if (adjustmentType) {
    params.set("adjustmentType", adjustmentType);
  }
  if (adjustmentTime) {
    params.set("adjustmentTime", adjustmentTime);
  }

  return dashboardViewHref("employee", Object.fromEntries(params.entries()), "missing-adjustment");
}

function notificationActionHref(notification: NotificationCenterItem) {
  if (notification.type === "MISSING_RECORD") {
    return buildMissingAdjustmentHrefFromMetadata(notification.metadata) ?? notification.actionUrl ?? dashboardViewHref("employee", undefined, "missing-adjustment");
  }

  return notification.actionUrl ?? null;
}

function notificationActionLabel(notification: NotificationCenterItem) {
  if (notification.type === "MISSING_RECORD") {
    return "정정 요청으로 이동";
  }

  return "바로 가기";
}

function ageInDays(value?: Date | string | null) {
  if (!value) {
    return 0;
  }

  const createdAt = new Date(value).getTime();
  if (!Number.isFinite(createdAt)) {
    return 0;
  }

  return Math.floor((Date.now() - createdAt) / (24 * 60 * 60 * 1000));
}

function appendAttachments(formData: FormData, files: File[]) {
  for (const file of files) {
    formData.append("attachments", file);
  }
}

const ADJUSTMENT_DRAFT_KEY = "workguard:adjustment-draft";
const NOTIFICATION_LOCAL_PREFS_KEY = "workguard:notification-local-preferences";
const NOTIFICATION_ARCHIVE_KEY = "workguard:notification-archives";

type AdjustmentDraft = {
  adjustmentType: string;
  targetDate: string;
  requestedTime: string;
  reason: string;
  updatedAt: string;
};

type ArchivedNotificationSnapshot = NotificationCenterItem & {
  archivedAt: string;
};

function dispatchFieldModeSync() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(FIELD_QUEUE_SYNC_EVENT));
}

function readLocalStorageJson<T>(key: string, fallback: T) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson<T>(key: string, value: T) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
  dispatchFieldModeSync();
}

function readAdjustmentDraft() {
  return readLocalStorageJson<AdjustmentDraft | null>(ADJUSTMENT_DRAFT_KEY, null);
}

function writeAdjustmentDraft(draft: AdjustmentDraft | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!draft) {
    window.localStorage.removeItem(ADJUSTMENT_DRAFT_KEY);
    dispatchFieldModeSync();
    return;
  }

  writeLocalStorageJson(ADJUSTMENT_DRAFT_KEY, draft);
}

function createNotificationPreferenceState(
  preference: Partial<NotificationPreferenceState> | null | undefined,
  localPreference?: Partial<NotificationLocalPreferenceState> | null
): NotificationPreferenceState {
  return {
    emailEnabled: preference?.emailEnabled ?? true,
    webPushEnabled: preference?.webPushEnabled ?? false,
    approvalPendingEmail: preference?.approvalPendingEmail ?? true,
    approvalReviewedEmail: preference?.approvalReviewedEmail ?? true,
    leaveReminderEmail: preference?.leaveReminderEmail ?? true,
    missingRecordEmail: preference?.missingRecordEmail ?? true,
    monthCloseEmail: preference?.monthCloseEmail ?? true,
    schedulerDigestEnabled: preference?.schedulerDigestEnabled ?? true,
    browserPermission: preference?.browserPermission ?? "default",
    managerDailyDigestEnabled: localPreference?.managerDailyDigestEnabled ?? preference?.managerDailyDigestEnabled ?? true,
    approvalMuted: localPreference?.approvalMuted ?? preference?.approvalMuted ?? false,
    leaveMuted: localPreference?.leaveMuted ?? preference?.leaveMuted ?? false,
    missingRecordMuted: localPreference?.missingRecordMuted ?? preference?.missingRecordMuted ?? false,
    monthCloseMuted: localPreference?.monthCloseMuted ?? preference?.monthCloseMuted ?? false,
    dailyDigestMuted: localPreference?.dailyDigestMuted ?? preference?.dailyDigestMuted ?? false,
    approvalSnoozeUntil: localPreference?.approvalSnoozeUntil ?? preference?.approvalSnoozeUntil ?? null,
    leaveSnoozeUntil: localPreference?.leaveSnoozeUntil ?? preference?.leaveSnoozeUntil ?? null,
    missingRecordSnoozeUntil: localPreference?.missingRecordSnoozeUntil ?? preference?.missingRecordSnoozeUntil ?? null,
    monthCloseSnoozeUntil: localPreference?.monthCloseSnoozeUntil ?? preference?.monthCloseSnoozeUntil ?? null,
    dailyDigestSnoozeUntil: localPreference?.dailyDigestSnoozeUntil ?? preference?.dailyDigestSnoozeUntil ?? null
  };
}

function readNotificationLocalPreference() {
  return readLocalStorageJson<Partial<NotificationLocalPreferenceState>>(NOTIFICATION_LOCAL_PREFS_KEY, {});
}

function writeNotificationLocalPreference(preference: NotificationLocalPreferenceState) {
  writeLocalStorageJson(NOTIFICATION_LOCAL_PREFS_KEY, preference);
}

function readArchivedNotifications() {
  return readLocalStorageJson<ArchivedNotificationSnapshot[]>(NOTIFICATION_ARCHIVE_KEY, []);
}

function writeArchivedNotifications(notifications: ArchivedNotificationSnapshot[]) {
  writeLocalStorageJson(NOTIFICATION_ARCHIVE_KEY, notifications);
}

function notificationLocalCategoryForType(type?: string) {
  if (type === "APPROVAL_PENDING" || type === "APPROVAL_APPROVED" || type === "APPROVAL_REJECTED") {
    return "APPROVAL" as const;
  }
  if (type === "LEAVE_STARTING") {
    return "LEAVE" as const;
  }
  if (type === "MISSING_RECORD") {
    return "MISSING" as const;
  }
  if (type === "MONTH_CLOSE") {
    return "MONTH_CLOSE" as const;
  }
  return "OTHER" as const;
}

function notificationLocalCategoryForReminder(reminder: NotificationReminder) {
  if (reminder.id.startsWith("daily-digest-")) {
    return "DAILY_DIGEST" as const;
  }
  return reminder.category ?? "OTHER";
}

function notificationLocalDisplayGroup(reminder: NotificationReminder) {
  if (reminder.id.startsWith("daily-digest-")) {
    return "APPROVAL" as const;
  }
  return reminder.category ?? "OTHER";
}

function notificationLocalMuted(
  preference: NotificationLocalPreferenceState,
  category: "APPROVAL" | "LEAVE" | "MISSING" | "MONTH_CLOSE" | "DAILY_DIGEST" | "OTHER"
) {
  if (category === "APPROVAL") {
    return preference.approvalMuted;
  }
  if (category === "LEAVE") {
    return preference.leaveMuted;
  }
  if (category === "MISSING") {
    return preference.missingRecordMuted;
  }
  if (category === "MONTH_CLOSE") {
    return preference.monthCloseMuted;
  }
  if (category === "DAILY_DIGEST") {
    return !preference.managerDailyDigestEnabled || preference.dailyDigestMuted;
  }
  return false;
}

function notificationLocalSnoozeUntil(
  preference: NotificationLocalPreferenceState,
  category: "APPROVAL" | "LEAVE" | "MISSING" | "MONTH_CLOSE" | "DAILY_DIGEST" | "OTHER"
) {
  const value =
    category === "APPROVAL"
      ? preference.approvalSnoozeUntil
      : category === "LEAVE"
        ? preference.leaveSnoozeUntil
        : category === "MISSING"
          ? preference.missingRecordSnoozeUntil
          : category === "MONTH_CLOSE"
            ? preference.monthCloseSnoozeUntil
            : category === "DAILY_DIGEST"
              ? preference.dailyDigestSnoozeUntil
              : null;

  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isNotificationMutedLocally(
  preference: NotificationLocalPreferenceState,
  category: "APPROVAL" | "LEAVE" | "MISSING" | "MONTH_CLOSE" | "DAILY_DIGEST" | "OTHER"
) {
  if (notificationLocalMuted(preference, category)) {
    return true;
  }

  const snoozeUntil = notificationLocalSnoozeUntil(preference, category);
  return Boolean(snoozeUntil && snoozeUntil.getTime() > Date.now());
}

function pickNotificationLocalPreference(preference: NotificationPreferenceState): NotificationLocalPreferenceState {
  return {
    managerDailyDigestEnabled: preference.managerDailyDigestEnabled,
    approvalMuted: preference.approvalMuted,
    leaveMuted: preference.leaveMuted,
    missingRecordMuted: preference.missingRecordMuted,
    monthCloseMuted: preference.monthCloseMuted,
    dailyDigestMuted: preference.dailyDigestMuted,
    approvalSnoozeUntil: preference.approvalSnoozeUntil,
    leaveSnoozeUntil: preference.leaveSnoozeUntil,
    missingRecordSnoozeUntil: preference.missingRecordSnoozeUntil,
    monthCloseSnoozeUntil: preference.monthCloseSnoozeUntil,
    dailyDigestSnoozeUntil: preference.dailyDigestSnoozeUntil
  };
}

async function maybeCompressImage(file: File) {
  if (typeof window === "undefined" || !file.type.startsWith("image/") || file.size < 1_500_000) {
    return file;
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    return file;
  }

  const maxWidth = 1600;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.82);
  });

  if (!blob || blob.size >= file.size) {
    return file;
  }

  const nextName = file.name.replace(/\.[^.]+$/, "") || "mobile-photo";
  return new File([blob], `${nextName}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now()
  });
}

async function appendOptimizedAttachments(formData: FormData, files: File[]) {
  const optimizedFiles = await Promise.all(files.map((file) => maybeCompressImage(file)));
  appendAttachments(formData, optimizedFiles);
}

function queueRetrySummary(queue: FieldQueueItem[]) {
  const totalAttempts = queue.reduce((sum, item) => sum + item.attempts, 0);
  const lastRetried = queue
    .map((item) => item.lastAttemptAt ?? "")
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const latestError = [...queue].reverse().find((item) => item.lastError)?.lastError ?? null;

  return {
    totalAttempts,
    lastRetried,
    latestError
  };
}

function AttachmentField({
  inputId,
  files,
  onChange,
  helpText
}: {
  inputId: string;
  files: File[];
  onChange: (files: File[]) => void;
  helpText: string;
}) {
  const previewUrls = useMemo(
    () =>
      files
        .filter((file) => file.type.startsWith("image/"))
        .map((file) => ({
          name: file.name,
          url: URL.createObjectURL(file),
          type: file.type
        })),
    [files]
  );

  useEffect(() => {
    return () => {
      for (const file of previewUrls) {
        URL.revokeObjectURL(file.url);
      }
    };
  }, [previewUrls]);

  return (
    <div className="field">
      <label htmlFor={inputId}>첨부 파일</label>
      <input
        id={inputId}
        type="file"
        accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
        multiple
        onChange={(event) => onChange(Array.from(event.target.files ?? []))}
      />
      <p className="muted" style={{ margin: 0 }}>
        {files.length > 0 ? `${files.length}개 선택됨: ${files.map((file) => file.name).join(", ")}` : helpText}
      </p>
      {previewUrls.length > 0 ? (
        <div className="attachment-preview-grid">
          {previewUrls.map((file) => (
            <figure className="attachment-preview-card" key={`${file.name}-${file.url}`}>
              <Image src={file.url} alt={file.name} width={160} height={120} unoptimized />
              <figcaption>{file.name}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function useActionRefresh() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<void>, successMessage = "처리되었습니다.") {
    setMessage("");
    startTransition(async () => {
      try {
        await action();
        setMessage(successMessage);
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "요청 처리에 실패했습니다.");
      }
    });
  }

  return { isPending, message, run };
}

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className="button secondary"
      type="button"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await postJson("/api/auth/logout");
          router.push("/");
          router.refresh();
        });
      }}
    >
      <LogOut size={16} />
      로그아웃
    </button>
  );
}

function sessionDeviceLabel(userAgent?: string | null) {
  const value = (userAgent ?? "").toLowerCase();
  if (!value) {
    return "알 수 없는 기기";
  }
  if (value.includes("iphone")) {
    return "iPhone";
  }
  if (value.includes("ipad")) {
    return "iPad";
  }
  if (value.includes("android")) {
    return "Android";
  }
  if (value.includes("mac os")) {
    return "macOS";
  }
  if (value.includes("windows")) {
    return "Windows";
  }
  if (value.includes("linux")) {
    return "Linux";
  }
  return "브라우저 세션";
}

export function PasswordChangeForm() {
  const { isPending, message, run } = useActionRefresh();
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  return (
    <div className="inline-form">
      <div className="field">
        <label htmlFor="account-current-password">현재 비밀번호</label>
        <input
          id="account-current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="account-next-password">새 비밀번호</label>
          <input
            id="account-next-password"
            type="password"
            autoComplete="new-password"
            value={nextPassword}
            onChange={(event) => setNextPassword(event.target.value)}
            placeholder="8자 이상"
          />
        </div>
        <div className="field">
          <label htmlFor="account-next-password-confirm">새 비밀번호 확인</label>
          <input
            id="account-next-password-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>
      </div>
      <div className="actions-row">
        <button
          className="button"
          type="button"
          disabled={isPending}
          onClick={() => {
            run(
              async () => {
                if (nextPassword !== confirmPassword) {
                  throw new Error("새 비밀번호 확인이 일치하지 않습니다.");
                }

                await postJson("/api/auth/password/change", {
                  currentPassword,
                  nextPassword
                });
                setCurrentPassword("");
                setNextPassword("");
                setConfirmPassword("");
              },
              "비밀번호를 변경했고 다른 기기는 로그아웃했습니다."
            );
          }}
        >
          비밀번호 변경
        </button>
        <Link className="button secondary" href="/reset-password">
          재설정 링크 요청
        </Link>
      </div>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function ActiveSessionsPanel({ sessions }: { sessions: AccountSessionItem[] }) {
  const { isPending, message, run } = useActionRefresh();
  const otherSessions = sessions.filter((session) => !session.isCurrent);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="actions-row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>활성 세션</strong>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            현재 기기를 유지한 채 다른 브라우저와 기기를 로그아웃할 수 있습니다.
          </p>
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={isPending || otherSessions.length === 0}
          onClick={() => run(() => postJson("/api/auth/sessions/revoke-others"), "다른 기기를 모두 로그아웃했습니다.")}
        >
          다른 기기 로그아웃
        </button>
      </div>

      {sessions.length > 0 ? (
        <div className="stack" style={{ gap: 10 }}>
          {sessions.map((session) => (
            <div className="card" key={session.id} style={{ padding: 16 }}>
              <div className="actions-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <strong>{sessionDeviceLabel(session.userAgent)}</strong>
                  <p className="muted" style={{ margin: "8px 0 0" }}>
                    접속 IP {session.ipAddress ?? "-"} · 시작 {new Date(session.createdAt).toLocaleString("ko-KR")}
                  </p>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    마지막 활동 {new Date(session.lastSeenAt).toLocaleString("ko-KR")} · 만료{" "}
                    {new Date(session.expiresAt).toLocaleString("ko-KR")}
                  </p>
                </div>
                {session.isCurrent ? (
                  <span className="status-pill green">현재 세션</span>
                ) : (
                  <button
                    className="button secondary"
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () => postJson(`/api/auth/sessions/${session.id}/revoke`),
                        "선택한 세션을 종료했습니다."
                      )
                    }
                  >
                    종료
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">표시할 활성 세션이 없습니다.</div>
      )}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function FieldQueueStatusBar() {
  const [queueCount, setQueueCount] = useState(0);
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.navigator.onLine;
  });
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const attemptedInitialFlushRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncState = async () => {
      const [queue, meta] = await Promise.all([listFieldQueue().catch(() => []), getFieldQueueMeta().catch(() => ({ lastSyncAt: null }))]);
      setQueueCount(queue.length);
      setLastSyncAt(meta.lastSyncAt);
      setIsOnline(window.navigator.onLine);
    };

    const handleOnline = () => {
      void syncState();
      void handleFlushQueue(true);
    };

    const handleOffline = () => {
      void syncState();
      setMessage("오프라인 상태입니다. 출퇴근 기록은 기기에 임시 저장됩니다.");
    };

    const handleSyncEvent = () => {
      void syncState();
    };
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== "FIELD_QUEUE_SYNC_RESULT") {
        return;
      }
      void syncState();
      if (event.data.payload?.flushed > 0) {
        setMessage(`백그라운드 동기화로 기록 ${event.data.payload.flushed}건을 반영했습니다.`);
      }
    };

    void syncState();
    window.addEventListener("storage", handleSyncEvent);
    window.addEventListener(FIELD_QUEUE_SYNC_EVENT, handleSyncEvent as EventListener);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);

    void registerFieldQueueBackgroundSync();
    void listFieldQueue().then((queue) => {
      if (!attemptedInitialFlushRef.current && window.navigator.onLine && queue.length > 0) {
        attemptedInitialFlushRef.current = true;
        void handleFlushQueue(true);
      }
    });

    return () => {
      window.removeEventListener("storage", handleSyncEvent);
      window.removeEventListener(FIELD_QUEUE_SYNC_EVENT, handleSyncEvent as EventListener);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, []);

  async function handleFlushQueue(silent = false) {
    if (typeof window === "undefined") {
      return;
    }

    setIsSyncing(true);
    const result = await flushFieldQueue().catch(() => null);
    setIsSyncing(false);
    const [queue, meta] = await Promise.all([listFieldQueue().catch(() => []), getFieldQueueMeta().catch(() => ({ lastSyncAt: null }))]);
    setQueueCount(queue.length);
    setLastSyncAt(meta.lastSyncAt);

    if (!result) {
      if (!silent) {
        setMessage("대기 중인 출퇴근 기록을 동기화하지 못했습니다.");
      }
      return;
    }

    if (result.flushed > 0) {
      setMessage(
        result.blocked > 0
          ? `오프라인 기록 ${result.flushed}건을 반영했고, 충돌 ${result.blocked}건은 확인 대기 상태로 남겼습니다.`
          : `오프라인으로 저장한 기록 ${result.flushed}건을 서버에 반영했습니다.`
      );
      return;
    }

    if (!silent) {
      setMessage(
        result.blocked > 0
          ? `전송 충돌 ${result.blocked}건을 확인해 주세요. 나머지 대기 ${Math.max(0, result.remaining - result.blocked)}건`
          : result.remaining > 0
            ? `아직 전송 대기 기록 ${result.remaining}건이 남아 있습니다.`
          : "지금 동기화할 대기 기록이 없습니다."
      );
    }
  }

  if (!message && isOnline && queueCount === 0 && !isSyncing) {
    return null;
  }

  return (
    <div
      className="panel"
      style={{
        marginBottom: 18,
        background: isOnline ? "#f8fbff" : "#fff8eb",
        borderColor: isOnline ? "#dbeafe" : "#fde68a"
      }}
    >
      <div className="actions-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div className="stack" style={{ gap: 6 }}>
          <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isOnline ? <Wifi size={18} /> : <WifiOff size={18} />}
            현장 동기화 상태
          </strong>
          <p className="muted" style={{ margin: 0 }}>
            {isOnline
              ? queueCount > 0
                ? `오프라인에 저장된 기록 ${queueCount}건을 다시 보낼 준비가 되었습니다.`
                : "오프라인 전송 대기 기록이 없습니다."
              : "현재 오프라인입니다. 출근, 퇴근, 상태 변경은 기기에 먼저 저장됩니다."}
          </p>
          {lastSyncAt ? (
            <p className="muted" style={{ margin: 0 }}>
              마지막 동기화 {new Date(lastSyncAt).toLocaleString("ko-KR")}
            </p>
          ) : null}
          {message ? <p className="muted" style={{ margin: 0 }}>{message}</p> : null}
        </div>
        <div className="actions-row" style={{ justifyContent: "flex-end" }}>
          {queueCount > 0 ? <span className={`status-pill ${isOnline ? "yellow" : "gray"}`}>대기 {queueCount}건</span> : null}
          <button
            className="button secondary"
            type="button"
            disabled={!isOnline || isSyncing || queueCount === 0}
            onClick={() => void handleFlushQueue(false)}
          >
            {isSyncing ? <RefreshCw size={16} /> : <Upload size={16} />}
            {isSyncing ? "동기화 중" : "지금 동기화"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FieldMobileReadinessCard() {
  const [queueCount, setQueueCount] = useState(0);
  const [blockedCount, setBlockedCount] = useState(0);
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.navigator.onLine;
  });
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncState = async () => {
      const [queue, meta] = await Promise.all([listFieldQueue().catch(() => []), getFieldQueueMeta().catch(() => ({ lastSyncAt: null }))]);
      setQueueCount(queue.length);
      setBlockedCount(queue.filter((item) => item.status === "blocked").length);
      setLastSyncAt(meta.lastSyncAt);
      setIsOnline(window.navigator.onLine);
    };
    const handleOnline = () => {
      setIsOnline(true);
      void syncState();
    };
    const handleOffline = () => {
      setIsOnline(false);
      void syncState();
    };
    const handleSyncEvent = () => {
      void syncState();
    };
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "FIELD_QUEUE_SYNC_RESULT") {
        void syncState();
      }
    };

    void syncState();
    window.addEventListener("storage", handleSyncEvent);
    window.addEventListener(FIELD_QUEUE_SYNC_EVENT, handleSyncEvent as EventListener);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);

    return () => {
      window.removeEventListener("storage", handleSyncEvent);
      window.removeEventListener(FIELD_QUEUE_SYNC_EVENT, handleSyncEvent as EventListener);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, []);

  async function handleSyncNow() {
    if (!isOnline || queueCount === 0) {
      return;
    }

    setIsSyncing(true);
    await flushFieldQueue().catch(() => null);
    const [queue, meta] = await Promise.all([listFieldQueue().catch(() => []), getFieldQueueMeta().catch(() => ({ lastSyncAt: null }))]);
    setQueueCount(queue.length);
    setBlockedCount(queue.filter((item) => item.status === "blocked").length);
    setLastSyncAt(meta.lastSyncAt);
    setIsSyncing(false);
  }

  return (
    <div className="field-mobile-readiness" data-testid="field-mobile-readiness">
      <div>
        <span>{isOnline ? <Wifi size={15} /> : <WifiOff size={15} />} 현장 기록</span>
        <strong>{isOnline ? (queueCount > 0 ? `대기 ${queueCount}건` : "즉시 전송") : `기기 저장 ${queueCount}건`}</strong>
      </div>
      <div>
        <span>충돌</span>
        <strong>{blockedCount > 0 ? `${blockedCount}건` : "없음"}</strong>
      </div>
      <div>
        <span>동기화</span>
        <strong>{lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "-"}</strong>
      </div>
      <button
        className="button secondary"
        type="button"
        disabled={!isOnline || queueCount === 0 || isSyncing}
        onClick={() => void handleSyncNow()}
      >
        {isSyncing ? <RefreshCw size={15} /> : <Upload size={15} />}
        {isSyncing ? "전송 중" : "동기화"}
      </button>
    </div>
  );
}

export function AttendanceButtons({ canCheckIn, canCheckOut }: { canCheckIn: boolean; canCheckOut: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [qrToken, setQrToken] = useState("");
  const [scanMode, setScanMode] = useState<"check-in" | "check-out" | null>(null);
  const [isPending, startTransition] = useTransition();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);

  function stopScanner() {
    if (scanLoopRef.current) {
      window.cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanMode(null);
  }

  useEffect(
    () => () => {
      if (scanLoopRef.current) {
        window.cancelAnimationFrame(scanLoopRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    []
  );

  function runFieldAction(
    path: "/api/attendance/check-in" | "/api/attendance/check-out",
    successMessage: string,
    offlineLabel: string,
    body: Record<string, unknown> = {},
    options?: {
      allowOfflineQueue?: boolean;
    }
  ) {
    setMessage("");
    startTransition(async () => {
      try {
        if (typeof window !== "undefined" && !window.navigator.onLine && options?.allowOfflineQueue !== false) {
          const result = await enqueueFieldQueueItem({
            path,
            body,
            label: offlineLabel
          });
          setMessage(
            result.deduped
              ? `${offlineLabel}가 이미 전송 대기함에 있어 중복 저장하지 않았습니다.`
              : `오프라인 상태라 ${offlineLabel}를 전송 대기함에 저장했습니다. 대기 ${result.size}건`
          );
          return;
        }

        await postJson(path, body);
        setMessage(successMessage);
        setQrToken("");
        router.refresh();
      } catch (error) {
        if (typeof window !== "undefined" && options?.allowOfflineQueue !== false) {
          const result = await enqueueFieldQueueItem({
            path,
            body,
            label: offlineLabel
          });
          setMessage(
            result.deduped
              ? `${offlineLabel}가 이미 전송 대기함에 있어 중복 저장하지 않았습니다.`
              : `네트워크 문제로 ${offlineLabel}를 전송 대기함에 저장했습니다. 대기 ${result.size}건`
          );
          return;
        }

        setMessage(error instanceof Error ? error.message : "요청 처리에 실패했습니다.");
      }
    });
  }

  function submitQrAction(mode: "check-in" | "check-out", tokenValue = qrToken) {
    const token = normalizeClockQrPayload(tokenValue);
    if (!token) {
      setMessage("QR 토큰을 입력하거나 스캔하세요.");
      return;
    }

    runFieldAction(
      mode === "check-in" ? "/api/attendance/check-in" : "/api/attendance/check-out",
      mode === "check-in" ? "QR 출근 기록을 남겼습니다." : "QR 퇴근 기록을 남겼습니다.",
      mode === "check-in" ? "QR 출근 기록" : "QR 퇴근 기록",
      {
        verification: {
          method: "qr",
          token
        }
      },
      {
        allowOfflineQueue: false
      }
    );
  }

  async function startScanner(mode: "check-in" | "check-out") {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMessage("이 브라우저는 카메라 스캔을 지원하지 않습니다. QR 토큰을 직접 입력하세요.");
      return;
    }

    if (!window.BarcodeDetector) {
      setMessage("이 브라우저는 QR 자동 스캔을 지원하지 않습니다. QR 토큰을 직접 입력하세요.");
      return;
    }

    stopScanner();
    setScanMode(mode);
    setMessage("QR을 카메라 중앙에 맞춰주세요.");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment"
        }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!videoRef.current || !streamRef.current) {
          return;
        }
        const results = await detector.detect(videoRef.current).catch(() => []);
        const rawValue = results[0]?.rawValue;
        if (rawValue) {
          const token = normalizeClockQrPayload(rawValue);
          setQrToken(token);
          stopScanner();
          submitQrAction(mode, token);
          return;
        }
        scanLoopRef.current = window.requestAnimationFrame(tick);
      };
      scanLoopRef.current = window.requestAnimationFrame(tick);
    } catch (error) {
      stopScanner();
      setMessage(error instanceof Error ? error.message : "카메라를 열 수 없습니다.");
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="actions-row field-primary-actions">
        <button
          className="button"
          type="button"
          data-testid="attendance-check-in"
          disabled={!canCheckIn || isPending}
          onClick={() =>
            runFieldAction("/api/attendance/check-in", "출근 기록을 남겼습니다.", "출근 기록")
          }
        >
          <Play size={16} />
          출근하기
        </button>
        <button
          className="button secondary"
          type="button"
          data-testid="attendance-check-out"
          disabled={!canCheckOut || isPending}
          onClick={() =>
            runFieldAction("/api/attendance/check-out", "퇴근 기록을 남겼습니다.", "퇴근 기록")
          }
        >
          <Square size={16} />
          퇴근하기
        </button>
      </div>
      <div id="employee-qr" className="qr-attendance-panel">
        <div className="actions-row" style={{ justifyContent: "space-between" }}>
          <strong>
            <QrCode size={16} /> QR 출퇴근 인증
          </strong>
          {scanMode ? <span className="status-pill yellow">스캔 중</span> : <span className="status-pill gray">선택 인증</span>}
        </div>
        <div className="actions-row qr-token-actions">
          <div className="field" style={{ flex: "1 1 220px" }}>
            <label htmlFor="attendance-qr-token">QR 토큰</label>
            <input
              id="attendance-qr-token"
              value={qrToken}
              onChange={(event) => setQrToken(event.target.value.toUpperCase())}
              placeholder="WG1 토큰"
            />
          </div>
          <button
            className="button secondary"
            type="button"
            disabled={!canCheckIn || isPending}
            onClick={() => submitQrAction("check-in")}
            style={{ alignSelf: "flex-end" }}
          >
            <QrCode size={15} />
            QR 출근
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={!canCheckOut || isPending}
            onClick={() => submitQrAction("check-out")}
            style={{ alignSelf: "flex-end" }}
          >
            <QrCode size={15} />
            QR 퇴근
          </button>
        </div>
        <div className="actions-row qr-scan-actions">
          <button className="button secondary" type="button" disabled={!canCheckIn || isPending} onClick={() => void startScanner("check-in")}>
            <Camera size={15} />
            출근 QR 스캔
          </button>
          <button className="button secondary" type="button" disabled={!canCheckOut || isPending} onClick={() => void startScanner("check-out")}>
            <Camera size={15} />
            퇴근 QR 스캔
          </button>
          {scanMode ? (
            <button className="button secondary" type="button" onClick={stopScanner}>
              스캔 중지
            </button>
          ) : null}
        </div>
        {scanMode ? <video ref={videoRef} className="qr-scan-video" muted playsInline /> : null}
      </div>
      {message ? <p className="muted" aria-live="polite">{message}</p> : null}
    </div>
  );
}

export function StatusChangeForm({ options }: { options: StatusOption[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState("WORKING");
  const [reason, setReason] = useState("");

  function submitStatusChange() {
    setMessage("");
    const body = {
      status,
      reason
    };

    startTransition(async () => {
      try {
        if (typeof window !== "undefined" && !window.navigator.onLine) {
          const result = await enqueueFieldQueueItem({
            path: "/api/attendance/status",
            body,
            label: `상태 변경(${status})`
          });
          setMessage(
            result.deduped
              ? "같은 상태 변경 요청이 이미 전송 대기 중입니다."
              : `오프라인 상태라 상태 변경을 전송 대기함에 저장했습니다. 대기 ${result.size}건`
          );
          return;
        }

        await postJson("/api/attendance/status", body);
        setMessage("상태를 변경했습니다.");
        router.refresh();
      } catch (error) {
        if (typeof window !== "undefined") {
          const result = await enqueueFieldQueueItem({
            path: "/api/attendance/status",
            body,
            label: `상태 변경(${status})`
          });
          setMessage(
            result.deduped
              ? "같은 상태 변경 요청이 이미 전송 대기 중입니다."
              : `네트워크 문제로 상태 변경을 전송 대기함에 저장했습니다. 대기 ${result.size}건`
          );
          return;
        }

        setMessage(error instanceof Error ? error.message : "요청 처리에 실패했습니다.");
      }
    });
  }

  return (
    <div className="inline-form">
      <div className="field">
        <label htmlFor="status">현재 상태 선택</label>
        <select id="status" value={status} onChange={(event) => setStatus(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="status-reason">메모</label>
        <input
          id="status-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="회의, 외근, 휴게 사유"
        />
      </div>
      <button
        className="button secondary"
        type="button"
        data-testid="attendance-status-submit"
        disabled={isPending}
        onClick={submitStatusChange}
      >
        <Clock size={16} />
        상태 변경
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function OvertimeRequestForm({ defaultMinutes }: { defaultMinutes: number }) {
  const { isPending, message, run } = useActionRefresh();
  const [reason, setReason] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);

  return (
    <div className="inline-form">
      <div className="field">
        <label htmlFor="overtime-reason">초과근로 사유</label>
        <textarea
          id="overtime-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="배포, 장애 대응, 고객 요청 등 근로시간으로 인정되어야 하는 이유"
        />
      </div>
      <AttachmentField
        inputId="overtime-attachments"
        files={attachments}
        onChange={setAttachments}
        helpText="배포 로그, 장애 티켓, 고객 요청서 등 최대 5개 파일"
      />
      <button
        className="button"
        type="button"
        data-testid="overtime-request-submit"
        disabled={isPending || defaultMinutes <= 0}
        onClick={() =>
          run(
            async () => {
              const formData = new FormData();
              formData.set("reason", reason);
              formData.set("requestedMinutes", String(defaultMinutes));
              await appendOptimizedAttachments(formData, attachments);
              setUploadProgress(0);
              return postForm("/api/approvals/overtime", formData, {
                onProgress: setUploadProgress
              });
            },
            "초과근로 승인을 요청했습니다."
          )
        }
      >
        <Send size={16} />
        초과근로 요청
      </button>
      {uploadProgress > 0 ? <p className="muted">첨부 업로드 {uploadProgress}%</p> : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function LeaveRequestForm({
  defaultDate,
  allowHalfDay,
  allowHourly,
  hourlyLeaveUnitMinutes
}: {
  defaultDate: string;
  allowHalfDay: boolean;
  allowHourly: boolean;
  hourlyLeaveUnitMinutes: number;
}) {
  const { isPending, message, run } = useActionRefresh();
  const [leaveType, setLeaveType] = useState("ANNUAL");
  const [duration, setDuration] = useState("FULL_DAY");
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [requestedLeaveMinutes, setRequestedLeaveMinutes] = useState(String(hourlyLeaveUnitMinutes));
  const [reason, setReason] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);

  return (
    <div className="inline-form">
      <div className="field">
        <label htmlFor="leave-type">휴가 종류</label>
        <select id="leave-type" value={leaveType} onChange={(event) => setLeaveType(event.target.value)}>
          <option value="ANNUAL">연차</option>
          <option value="SICK">병가</option>
          <option value="OFFICIAL">공가</option>
          <option value="UNPAID">무급휴가</option>
        </select>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="leave-start-date">시작일</label>
          <input
            id="leave-start-date"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="leave-end-date">종료일</label>
          <input
            id="leave-end-date"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="leave-duration">단위</label>
        <select id="leave-duration" value={duration} onChange={(event) => setDuration(event.target.value)}>
          <option value="FULL_DAY">종일</option>
          {allowHalfDay ? <option value="HALF_DAY_AM">오전 반차</option> : null}
          {allowHalfDay ? <option value="HALF_DAY_PM">오후 반차</option> : null}
          {allowHourly ? <option value="HOURLY">시간차</option> : null}
        </select>
      </div>
      {duration === "HOURLY" ? (
        <div className="field">
          <label htmlFor="leave-requested-minutes">시간차 분량</label>
          <input
            id="leave-requested-minutes"
            inputMode="numeric"
            value={requestedLeaveMinutes}
            onChange={(event) => setRequestedLeaveMinutes(event.target.value)}
            placeholder={String(hourlyLeaveUnitMinutes)}
          />
          <p className="muted" style={{ margin: 0 }}>
            현재 정책 기준 {hourlyLeaveUnitMinutes}분 단위로 신청할 수 있습니다.
          </p>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="leave-reason">휴가 사유</label>
        <textarea
          id="leave-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="휴가 사유와 인수인계 메모를 적어주세요."
        />
      </div>
      <AttachmentField
        inputId="leave-attachments"
        files={attachments}
        onChange={setAttachments}
        helpText="휴가 신청서, 진단서, 공문 등을 최대 5개 파일로 첨부할 수 있습니다."
      />
      <button
        className="button secondary"
        type="button"
        data-testid="leave-request-submit"
        disabled={isPending}
        onClick={() =>
          run(
            async () => {
              const formData = new FormData();
              formData.set("leaveType", leaveType);
              formData.set("duration", duration);
              formData.set("startDate", startDate);
              formData.set("endDate", endDate);
              formData.set("requestedLeaveMinutes", requestedLeaveMinutes);
              formData.set("reason", reason);
              await appendOptimizedAttachments(formData, attachments);
              setUploadProgress(0);
              return postForm("/api/approvals/leave", formData, {
                onProgress: setUploadProgress
              });
            },
            "휴가 승인을 요청했습니다."
          )
        }
      >
        <CalendarClock size={16} />
        휴가 신청
      </button>
      {uploadProgress > 0 ? <p className="muted">첨부 업로드 {uploadProgress}%</p> : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function MissingClockAdjustmentForm({
  defaultDate,
  defaultAdjustmentType = "MISSING_CHECK_IN",
  defaultRequestedTime,
  defaultReason = "",
  autoFocusReason = false
}: {
  defaultDate: string;
  defaultAdjustmentType?: "MISSING_CHECK_IN" | "MISSING_CHECK_OUT";
  defaultRequestedTime?: string;
  defaultReason?: string;
  autoFocusReason?: boolean;
}) {
  const { isPending, message, run } = useActionRefresh();
  const [savedDraft] = useState<AdjustmentDraft | null>(() => (autoFocusReason ? null : readAdjustmentDraft()));
  const [adjustmentType, setAdjustmentType] = useState<"MISSING_CHECK_IN" | "MISSING_CHECK_OUT">(
    savedDraft?.adjustmentType === "MISSING_CHECK_OUT" ? "MISSING_CHECK_OUT" : defaultAdjustmentType
  );
  const [targetDate, setTargetDate] = useState(savedDraft?.targetDate || defaultDate);
  const [requestedTime, setRequestedTime] = useState(
    savedDraft?.requestedTime ||
      defaultRequestedTime ||
      (defaultAdjustmentType === "MISSING_CHECK_IN" ? "09:00" : "18:00")
  );
  const [reason, setReason] = useState(savedDraft?.reason || defaultReason);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(savedDraft?.updatedAt ?? null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!autoFocusReason) {
      return;
    }

    reasonRef.current?.focus();
    reasonRef.current?.setSelectionRange(reasonRef.current.value.length, reasonRef.current.value.length);
  }, [autoFocusReason]);

  useEffect(() => {
    const payload = {
      adjustmentType,
      targetDate,
      requestedTime,
      reason,
      updatedAt: new Date().toISOString()
    } satisfies AdjustmentDraft;

    writeAdjustmentDraft(payload);
  }, [adjustmentType, targetDate, requestedTime, reason]);

  function clearDraft() {
    writeAdjustmentDraft(null);
    setDraftSavedAt(null);
  }

  return (
    <div className="inline-form">
      <div className="field">
        <label htmlFor="adjustment-type">누락 종류</label>
        <select
          id="adjustment-type"
          value={adjustmentType}
          onChange={(event) => {
            const nextType = event.target.value as "MISSING_CHECK_IN" | "MISSING_CHECK_OUT";
            setAdjustmentType(nextType);
            setRequestedTime(nextType === "MISSING_CHECK_IN" ? "09:00" : "18:00");
            setDraftSavedAt(new Date().toISOString());
          }}
        >
          <option value="MISSING_CHECK_IN">출근 누락</option>
          <option value="MISSING_CHECK_OUT">퇴근 누락</option>
        </select>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="adjustment-date">대상 날짜</label>
          <input
            id="adjustment-date"
            type="date"
            value={targetDate}
            onChange={(event) => {
              setTargetDate(event.target.value);
              setDraftSavedAt(new Date().toISOString());
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="adjustment-time">기록할 시간</label>
          <input
            id="adjustment-time"
            type="time"
            value={requestedTime}
            onChange={(event) => {
              setRequestedTime(event.target.value);
              setDraftSavedAt(new Date().toISOString());
            }}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="adjustment-reason">정정 사유</label>
        <textarea
          ref={reasonRef}
          id="adjustment-reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setDraftSavedAt(new Date().toISOString());
          }}
          placeholder="현장 이동, 네트워크 오류 등 누락 사유를 적어주세요."
        />
      </div>
      <AttachmentField
        inputId="adjustment-attachments"
        files={attachments}
        onChange={setAttachments}
        helpText="현장 사진은 모바일 업로드 시 자동으로 경량화합니다. 증빙 파일은 최대 5개까지 첨부할 수 있습니다."
      />
      <div className="actions-row">
        <button className="button secondary" type="button" onClick={clearDraft}>
          <Archive size={16} />
          임시 저장 내용 삭제
        </button>
        {draftSavedAt ? <span className="muted">임시 저장됨 {new Date(draftSavedAt).toLocaleTimeString("ko-KR")}</span> : null}
      </div>
      <button
        className="button secondary"
        type="button"
        data-testid="adjustment-request-submit"
        disabled={isPending}
        onClick={() =>
          run(
            async () => {
              const formData = new FormData();
              formData.set("adjustmentType", adjustmentType);
              formData.set("targetDate", targetDate);
              formData.set("requestedTime", requestedTime);
              formData.set("reason", reason);
              await appendOptimizedAttachments(formData, attachments);
              setUploadProgress(0);
              await postForm("/api/approvals/adjustment", formData, {
                onProgress: setUploadProgress
              });
              clearDraft();
            },
            "출퇴근 누락 수정을 요청했습니다."
          )
        }
      >
        정정 요청
      </button>
      {uploadProgress > 0 ? <p className="muted">첨부 업로드 {uploadProgress}%</p> : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function LeaveRequestLifecycleButton({
  approvalId,
  mode
}: {
  approvalId: string;
  mode: "withdraw" | "cancel";
}) {
  const { isPending, message, run } = useActionRefresh();

  return (
    <div className="stack" style={{ gap: 8 }}>
      <button
        className="button secondary"
        type="button"
        disabled={isPending}
        onClick={() =>
          run(
            () => postJson(`/api/approvals/leave/${approvalId}/revoke`),
            mode === "withdraw" ? "휴가 신청을 철회했습니다." : "승인된 휴가를 취소했습니다."
          )
        }
      >
        <RotateCcw size={16} />
        {mode === "withdraw" ? "철회" : "취소"}
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function LeaveBalanceAdjustmentForm({
  managedUsers,
  defaultDate
}: {
  managedUsers: ManagedUserOption[];
  defaultDate: string;
}) {
  const { isPending, message, run } = useActionRefresh();
  const [userId, setUserId] = useState(managedUsers[0]?.id ?? "");
  const [effectiveDate, setEffectiveDate] = useState(defaultDate);
  const [deltaDays, setDeltaDays] = useState("1");
  const [reason, setReason] = useState("");

  return (
    <div className="inline-form">
      <div className="field">
        <label htmlFor="leave-adjust-user">대상 직원</label>
        <select id="leave-adjust-user" value={userId} onChange={(event) => setUserId(event.target.value)}>
          {managedUsers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
              {member.teamName ? ` · ${member.teamName}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="leave-adjust-date">적용일</label>
          <input
            id="leave-adjust-date"
            type="date"
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="leave-adjust-delta">조정 일수</label>
          <input
            id="leave-adjust-delta"
            type="number"
            step="0.25"
            value={deltaDays}
            onChange={(event) => setDeltaDays(event.target.value)}
            placeholder="1 또는 -0.5"
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="leave-adjust-reason">조정 사유</label>
        <textarea
          id="leave-adjust-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="잔액 정정, 이월 보정, 수기 조정 사유를 남겨주세요."
        />
      </div>
      <button
        className="button secondary"
        type="button"
        disabled={isPending || !userId}
        onClick={() =>
          run(
            () =>
              postJson("/api/leave-adjustments", {
                userId,
                effectiveDate,
                deltaDays: Number(deltaDays),
                reason
              }),
            "연차 잔액을 조정했습니다."
          )
        }
      >
        <CalendarClock size={16} />
        잔액 조정
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function LeaveBalanceAdjustmentRevokeButton({ auditLogId }: { auditLogId: string }) {
  const { isPending, message, run } = useActionRefresh();

  return (
    <div className="stack" style={{ gap: 6 }}>
      <button
        className="button secondary"
        type="button"
        disabled={isPending}
        onClick={() =>
          run(() => postJson(`/api/leave-adjustments/${auditLogId}/revoke`), "연차 수동 조정을 취소했습니다.")
        }
      >
        <RotateCcw size={16} />
        조정 취소
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function ScheduleCreateForm({
  managedUsers,
  defaultDate
}: {
  managedUsers: ManagedUserOption[];
  defaultDate: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const weekdayOptions = [
    { value: 1, label: "월" },
    { value: 2, label: "화" },
    { value: 3, label: "수" },
    { value: 4, label: "목" },
    { value: 5, label: "금" },
    { value: 6, label: "토" },
    { value: 0, label: "일" }
  ];
  const [mode, setMode] = useState<ScheduleMode>("single");
  const [userId, setUserId] = useState(managedUsers[0]?.id ?? "");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(managedUsers[0] ? [managedUsers[0].id] : []);
  const [workDate, setWorkDate] = useState(defaultDate);
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(shiftDateString(defaultDate, 6));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [breakMinutes, setBreakMinutes] = useState("60");
  const [shiftName, setShiftName] = useState("기본 근무");
  const [note, setNote] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [sourceWeekStart, setSourceWeekStart] = useState(weekStartDateString(shiftDateString(defaultDate, -7)));
  const [targetWeekStart, setTargetWeekStart] = useState(weekStartDateString(defaultDate));
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewRequestKey, setPreviewRequestKey] = useState("");
  const [templates, setTemplates] = useState<ScheduleTemplateItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");

  const applyPreviewRequired = mode !== "single";

  useEffect(() => {
    if (managedUsers.length === 0) {
      return;
    }

    void fetch("/api/schedules/templates")
      .then(async (response) => {
        if (!response.ok) {
          return { templates: [] };
        }
        return response.json() as Promise<{ templates: ScheduleTemplateItem[] }>;
      })
      .then((payload) => {
        setTemplates(payload.templates ?? []);
        setSelectedTemplateId((current) => current || payload.templates?.[0]?.id || "");
      })
      .catch(() => undefined);
  }, [managedUsers.length]);

  function toggleSelectedUser(userIdToToggle: string) {
    resetPreview();
    setSelectedUserIds((current) =>
      current.includes(userIdToToggle)
        ? current.filter((candidate) => candidate !== userIdToToggle)
        : [...current, userIdToToggle]
    );
  }

  function toggleWeekday(weekday: number) {
    resetPreview();
    setWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((candidate) => candidate !== weekday)
        : [...current, weekday].sort((left, right) => left - right)
    );
  }

  function resetPreview() {
    setPreview(null);
    setPreviewRequestKey("");
  }

  function templatePayload() {
    return {
      name: templateName.trim() || shiftName.trim() || "새 템플릿",
      mode,
      startTime,
      endTime,
      breakMinutes: Number(breakMinutes),
      shiftName,
      note,
      weekdays
    };
  }

  function buildRequestBody() {
    if (mode === "single") {
      return {
        mode,
        userId,
        workDate,
        startTime,
        endTime,
        breakMinutes: Number(breakMinutes),
        shiftName,
        note
      };
    }

    if (mode === "range") {
      return {
        mode,
        userIds: selectedUserIds,
        startDate,
        endDate,
        weekdays,
        startTime,
        endTime,
        breakMinutes: Number(breakMinutes),
        shiftName,
        note
      };
    }

    if (mode === "copy_week") {
      return {
        mode,
        userIds: selectedUserIds,
        sourceWeekStart,
        targetWeekStart
      };
    }

    if (mode === "bulk_update") {
      return {
        mode,
        userIds: selectedUserIds,
        startDate,
        endDate,
        weekdays,
        startTime,
        endTime,
        breakMinutes: Number(breakMinutes),
        shiftName,
        note
      };
    }

    return {
      mode,
      userIds: selectedUserIds,
      startDate,
      endDate,
      weekdays
    };
  }

  function successMessage(nextMode: ScheduleMode) {
    if (nextMode === "single") {
      return "스케줄을 저장했습니다.";
    }
    if (nextMode === "range") {
      return "반복 스케줄을 저장했습니다.";
    }
    if (nextMode === "copy_week") {
      return "주간 스케줄을 복사했습니다.";
    }
    if (nextMode === "bulk_update") {
      return "선택한 스케줄을 일괄 수정했습니다.";
    }
    return "선택한 스케줄을 일괄 삭제했습니다.";
  }

  function applyTemplate(templateId: string) {
    const template = templates.find((candidate) => candidate.id === templateId);
    if (!template) {
      return;
    }

    setMode(template.mode);
    setStartTime(template.startTime);
    setEndTime(template.endTime);
    setBreakMinutes(String(template.breakMinutes));
    setShiftName(template.shiftName);
    setNote(template.note);
    setWeekdays(template.weekdays.length > 0 ? template.weekdays : [1, 2, 3, 4, 5]);
    setTemplateName(template.name);
    resetPreview();
    setMessage(`템플릿 '${template.name}'을 적용했습니다.`);
  }

  function runPreview() {
    setMessage("");
    startTransition(async () => {
      try {
        const body = buildRequestBody();
        const result = (await postJson("/api/schedules/preview", body)) as SchedulePreview;
        setPreview(result);
        setPreviewRequestKey(JSON.stringify(body));
        setMessage(result.overwriteCount > 0 || result.deleteCount > 0 ? "덮어쓰기/삭제 범위를 확인했습니다." : "적용 전 요약을 확인했습니다.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "스케줄 미리보기에 실패했습니다.");
      }
    });
  }

  function submit() {
    setMessage("");
    startTransition(async () => {
      try {
        const body = buildRequestBody();
        if (applyPreviewRequired && previewRequestKey !== JSON.stringify(body)) {
          throw new Error("적용 전에 최신 조건으로 미리보기를 먼저 확인하세요.");
        }

        const result = (await postJson("/api/schedules", body)) as {
          summary?: SchedulePreview;
        };
        if (result.summary) {
          setPreview(result.summary);
          setPreviewRequestKey(JSON.stringify(body));
        }
        setMessage(successMessage(mode));
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "스케줄 저장에 실패했습니다.");
      }
    });
  }

  function saveTemplate() {
    setMessage("");
    startTransition(async () => {
      try {
        await postJson("/api/schedules/templates", templatePayload());
        const response = await fetch("/api/schedules/templates");
        const payload = (await response.json().catch(() => ({ templates: [] }))) as { templates: ScheduleTemplateItem[] };
        setTemplates(payload.templates ?? []);
        setSelectedTemplateId(payload.templates?.[0]?.id ?? "");
        setMessage("현재 스케줄 설정을 템플릿으로 저장했습니다.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "스케줄 템플릿 저장에 실패했습니다.");
      }
    });
  }

  function deleteTemplate() {
    if (!selectedTemplateId) {
      setMessage("삭제할 템플릿을 먼저 선택하세요.");
      return;
    }

    setMessage("");
    startTransition(async () => {
      try {
        const response = await fetch(`/api/schedules/templates?id=${selectedTemplateId}`, {
          method: "DELETE"
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "템플릿 삭제에 실패했습니다.");
        }

        const nextTemplates = templates.filter((template) => template.id !== selectedTemplateId);
        setTemplates(nextTemplates);
        setSelectedTemplateId(nextTemplates[0]?.id ?? "");
        setMessage("선택한 템플릿을 삭제했습니다.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "템플릿 삭제에 실패했습니다.");
      }
    });
  }

  return (
    <div className="inline-form">
      <div className="actions-row" style={{ flexWrap: "wrap" }}>
        <button
          className={mode === "single" ? "button" : "button secondary"}
          type="button"
          onClick={() => {
            resetPreview();
            setMode("single");
          }}
        >
          단건 등록
        </button>
        <button
          className={mode === "range" ? "button" : "button secondary"}
          type="button"
          onClick={() => {
            resetPreview();
            setMode("range");
          }}
        >
          반복 등록
        </button>
        <button
          className={mode === "copy_week" ? "button" : "button secondary"}
          type="button"
          onClick={() => {
            resetPreview();
            setMode("copy_week");
          }}
        >
          <Copy size={16} />
          주간 복사
        </button>
        <button
          className={mode === "bulk_update" ? "button" : "button secondary"}
          type="button"
          onClick={() => {
            resetPreview();
            setMode("bulk_update");
          }}
        >
          일괄 수정
        </button>
        <button
          className={mode === "bulk_delete" ? "button" : "button secondary"}
          type="button"
          onClick={() => {
            resetPreview();
            setMode("bulk_delete");
          }}
        >
          <Trash2 size={16} />
          일괄 삭제
        </button>
      </div>

      <div className="card">
        <div className="actions-row" style={{ justifyContent: "space-between" }}>
          <strong>스케줄 템플릿</strong>
          <span className="status-pill gray">{templates.length}개</span>
        </div>
        <div className="grid-2" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="schedule-template-select">저장된 템플릿</label>
            <select
              id="schedule-template-select"
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
            >
              <option value="">선택 안 함</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} · {template.mode}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="schedule-template-name">현재 설정 저장 이름</label>
            <input
              id="schedule-template-name"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="예: 평일 기본 근무, 주말 당직"
            />
          </div>
        </div>
        <div className="actions-row">
          <button
            className="button secondary"
            type="button"
            disabled={isPending || !selectedTemplateId}
            onClick={() => applyTemplate(selectedTemplateId)}
          >
            템플릿 적용
          </button>
          <button className="button secondary" type="button" disabled={isPending} onClick={saveTemplate}>
            <Save size={16} />
            현재 설정 저장
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={isPending || !selectedTemplateId}
            onClick={deleteTemplate}
          >
            <Trash2 size={16} />
            템플릿 삭제
          </button>
        </div>
      </div>

      {mode === "single" ? (
        <>
          <div className="field">
            <label htmlFor="schedule-user">대상 직원</label>
            <select
              id="schedule-user"
              value={userId}
              onChange={(event) => {
                resetPreview();
                setUserId(event.target.value);
              }}
            >
              {managedUsers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.teamName ? ` · ${member.teamName}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="schedule-date">근무일</label>
              <input
                id="schedule-date"
                type="date"
                value={workDate}
                onChange={(event) => {
                  resetPreview();
                  setWorkDate(event.target.value);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="schedule-shift">근무명</label>
              <input
                id="schedule-shift"
                value={shiftName}
                onChange={(event) => {
                  resetPreview();
                  setShiftName(event.target.value);
                }}
                placeholder="기본 근무"
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label>대상 직원</label>
            <div className="actions-row" style={{ marginBottom: 8 }}>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  resetPreview();
                  setSelectedUserIds(managedUsers.map((member) => member.id));
                }}
              >
                전체 선택
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  resetPreview();
                  setSelectedUserIds([]);
                }}
              >
                선택 해제
              </button>
              <span className="status-pill gray">선택 {selectedUserIds.length}명</span>
            </div>
            <div className="card" style={{ display: "grid", gap: 8, maxHeight: 220, overflowY: "auto" }}>
              {managedUsers.map((member) => (
                <label key={member.id} className="check-row" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={selectedUserIds.includes(member.id)}
                    onChange={() => toggleSelectedUser(member.id)}
                  />
                  {member.name}
                  {member.teamName ? ` · ${member.teamName}` : ""}
                </label>
              ))}
            </div>
          </div>

          {mode === "range" || mode === "bulk_update" || mode === "bulk_delete" ? (
            <>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="schedule-range-start">시작일</label>
                  <input
                    id="schedule-range-start"
                    type="date"
                    value={startDate}
                    onChange={(event) => {
                      resetPreview();
                      setStartDate(event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="schedule-range-end">종료일</label>
                  <input
                    id="schedule-range-end"
                    type="date"
                    value={endDate}
                    onChange={(event) => {
                      resetPreview();
                      setEndDate(event.target.value);
                    }}
                  />
                </div>
              </div>
              <div className="field">
                <label>반복 요일</label>
                <div className="actions-row" style={{ flexWrap: "wrap" }}>
                  {weekdayOptions.map((option) => (
                    <label key={option.value} className="check-row" style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={weekdays.includes(option.value)}
                        onChange={() => toggleWeekday(option.value)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
              {mode !== "bulk_delete" ? (
                <div className="field">
                  <label htmlFor="schedule-shift-range">
                    {mode === "bulk_update" ? "변경할 근무명" : "근무명"}
                  </label>
                  <input
                    id="schedule-shift-range"
                    value={shiftName}
                    onChange={(event) => {
                      setShiftName(event.target.value);
                      resetPreview();
                    }}
                    placeholder={mode === "bulk_update" ? "비워두면 기존 근무명 유지" : "기본 근무"}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="grid-2">
              <div className="field">
                <label htmlFor="schedule-copy-source-week">복사할 주 시작일</label>
                <input
                  id="schedule-copy-source-week"
                  type="date"
                  value={sourceWeekStart}
                  onChange={(event) => {
                    resetPreview();
                    setSourceWeekStart(event.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="schedule-copy-target-week">붙여넣을 주 시작일</label>
                <input
                  id="schedule-copy-target-week"
                  type="date"
                  value={targetWeekStart}
                  onChange={(event) => {
                    resetPreview();
                    setTargetWeekStart(event.target.value);
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}

      {mode === "copy_week" || mode === "bulk_delete" ? null : (
        <div className="grid-3">
          <div className="field">
            <label htmlFor="schedule-start">시작</label>
            <input
              id="schedule-start"
              type="time"
              value={startTime}
              onChange={(event) => {
                setStartTime(event.target.value);
                resetPreview();
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="schedule-end">종료</label>
            <input
              id="schedule-end"
              type="time"
              value={endTime}
              onChange={(event) => {
                setEndTime(event.target.value);
                resetPreview();
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="schedule-break">휴게(분)</label>
            <input
              id="schedule-break"
              type="number"
              min={0}
              max={180}
              value={breakMinutes}
              onChange={(event) => {
                setBreakMinutes(event.target.value);
                resetPreview();
              }}
            />
          </div>
        </div>
      )}
      {mode === "copy_week" || mode === "bulk_delete" ? null : (
        <div className="field">
          <label htmlFor="schedule-note">메모</label>
          <input
            id="schedule-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              resetPreview();
            }}
            placeholder={mode === "bulk_update" ? "비워두면 메모를 비웁니다." : "현장 방문, 재택, 교육 등"}
          />
        </div>
      )}
      <div className="actions-row">
        <button
          className="button secondary"
          type="button"
          disabled={isPending || managedUsers.length === 0}
          onClick={runPreview}
        >
          미리보기
        </button>
        <button
          className="button"
          type="button"
          disabled={isPending || managedUsers.length === 0}
          onClick={submit}
        >
          <CalendarClock size={16} />
          {mode === "single"
            ? "스케줄 저장"
            : mode === "range"
              ? "반복 스케줄 저장"
              : mode === "copy_week"
                ? "주간 스케줄 복사"
                : mode === "bulk_update"
                  ? "일괄 수정 적용"
                  : "일괄 삭제 적용"}
        </button>
      </div>
      {preview ? (
        <div className="card">
          <div className="actions-row" style={{ justifyContent: "space-between" }}>
            <strong>적용 전 요약</strong>
            <span className={`status-pill ${preview.requiresConfirmation ? "yellow" : "green"}`}>
              {preview.summaryLine}
            </span>
          </div>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            {preview.overwriteCount > 0
              ? `기존 스케줄 ${preview.overwriteCount}건을 덮어씁니다.`
              : preview.deleteCount > 0
                ? `선택한 스케줄 ${preview.deleteCount}건을 삭제합니다.`
                : "새 스케줄이 생성됩니다."}
          </p>
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            {preview.rows.map((row) => {
              const employee = managedUsers.find((member) => member.id === row.userId);
              return (
                <div key={`${row.userId}-${row.workDate}-${row.action}`} className="notification-card read">
                  <div>
                    <strong>
                      {employee?.name ?? row.userId} · {row.workDate} · {row.shiftName}
                    </strong>
                    <p className="muted" style={{ margin: "6px 0 0" }}>
                      {row.action === "create" ? "신규 등록" : row.action === "update" ? "기존 스케줄 수정" : "기존 스케줄 삭제"}
                      {row.previous
                        ? ` · 이전 ${row.previous.shiftName} ${new Date(row.previous.scheduledStartAt).toLocaleTimeString("ko-KR", {
                            hour: "2-digit",
                            minute: "2-digit"
                          })}~${new Date(row.previous.scheduledEndAt).toLocaleTimeString("ko-KR", {
                            hour: "2-digit",
                            minute: "2-digit"
                          })}`
                        : ""}
                    </p>
                  </div>
                  <span className={`status-pill ${row.action === "delete" ? "red" : row.action === "update" ? "yellow" : "green"}`}>
                    {row.action === "delete" ? "삭제" : row.action === "update" ? "수정" : "신규"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function ApprovalButtons({
  approvalId,
  initialReviewNote = "",
  idPrefix = "approval-review",
  templates = [],
  compact = false
}: {
  approvalId: string;
  initialReviewNote?: string;
  idPrefix?: string;
  templates?: string[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [reviewNote, setReviewNote] = useState(initialReviewNote);
  const [showReviewNote, setShowReviewNote] = useState(!compact);
  const fieldId = `${idPrefix}-${approvalId}`;

  function review(action: "approve" | "reject") {
    setMessage("");
    startTransition(async () => {
      try {
        const result = (await postJson(`/api/manager/approvals/${approvalId}/${action}`, {
          reviewNote
        })) as { resolvedRiskCount?: number };
        const suffix =
          action === "approve" && (result.resolvedRiskCount ?? 0) > 0
            ? ` 관련 리스크 ${result.resolvedRiskCount}건을 함께 해소했습니다.`
            : "";
        setMessage(`${action === "approve" ? "승인" : "반려"}했습니다.${suffix}`);
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "요청 처리에 실패했습니다.");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {showReviewNote ? (
        <div className="field">
          <label htmlFor={fieldId}>승인 메모</label>
          <textarea
            id={fieldId}
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="승인/반려 판단 근거와 후속 안내를 남겨주세요."
          />
        </div>
      ) : null}
      {templates.length > 0 ? (
        <div className="actions-row" style={{ flexWrap: "wrap" }}>
          {templates.map((template) => (
            <button
              key={template}
              className="button secondary"
              type="button"
              onClick={() => setReviewNote(template)}
            >
              {template.length > 20 ? `${template.slice(0, 20)}...` : template}
            </button>
          ))}
        </div>
      ) : null}
      {compact ? (
        <button className="button secondary" type="button" onClick={() => setShowReviewNote((current) => !current)}>
          {showReviewNote ? "메모 접기" : "메모 남기기"}
        </button>
      ) : null}
      <div className="actions-row">
        <button
          className="button"
          type="button"
          data-testid={`${idPrefix}-${approvalId}-approve`}
          disabled={isPending}
          onClick={() => review("approve")}
        >
          <ThumbsUp size={15} />
          승인
        </button>
        <button
          className="button danger"
          type="button"
          data-testid={`${idPrefix}-${approvalId}-reject`}
          disabled={isPending}
          onClick={() => review("reject")}
        >
          <ThumbsDown size={15} />
          반려
        </button>
      </div>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function RefreshRisksButton() {
  const { isPending, message, run } = useActionRefresh();

  return (
    <div className="stack" style={{ gap: 8 }}>
      <button
        className="button secondary"
        type="button"
        disabled={isPending}
        onClick={() => run(() => postJson("/api/risks/recalculate"), "리스크를 다시 계산했습니다.")}
      >
        <RefreshCw size={16} />
        리스크 재계산
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

async function showBrowserNotification(item: NotificationCenterItem) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.ready.catch(() => null);
    if (registration) {
      await registration.showNotification(item.title, {
        body: item.message,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: {
          actionUrl: item.actionUrl ?? dashboardViewHref("notifications")
        }
      });
      return;
    }
  }

  const notification = new Notification(item.title, {
    body: item.message,
    icon: "/icon-192.png"
  });
  notification.onclick = () => {
    window.location.href = item.actionUrl ?? dashboardViewHref("notifications");
  };
}

function decodeBase64Url(input: string) {
  const normalized = `${input}${"=".repeat((4 - (input.length % 4)) % 4)}`
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const raw = window.atob(normalized);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function fetchPushPublicKey() {
  const response = await fetch("/api/notifications/push/public-key", {
    cache: "no-store"
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as { enabled?: boolean; publicKey?: string | null } | null;
}

async function registerWebPushSubscription() {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return false;
  }

  const config = await fetchPushPublicKey();
  if (!config?.enabled || !config.publicKey) {
    return false;
  }

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) {
    return false;
  }

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(config.publicKey)
    });
  }

  const payload = subscription.toJSON();
  const response = await fetch("/api/notifications/push/subscription", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  }).catch(() => null);

  return Boolean(response?.ok);
}

async function unregisterWebPushSubscription() {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return;
  }

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) {
    return;
  }

  const subscription = await registration.pushManager.getSubscription().catch(() => null);
  if (!subscription) {
    return;
  }

  const endpoint = subscription.endpoint;
  await fetch("/api/notifications/push/subscription", {
    method: "DELETE",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      endpoint
    })
  }).catch(() => null);

  await subscription.unsubscribe().catch(() => undefined);
}

export function BrowserPushBridge({ enabled }: { enabled: boolean }) {
  const lastSeenRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    async function poll(initial: boolean) {
      if (Notification.permission !== "granted") {
        return;
      }

      const response = await fetch("/api/notifications", {
        cache: "no-store"
      }).catch(() => null);
      if (!response?.ok) {
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            notifications?: NotificationCenterItem[];
            preference?: NotificationPreferenceState;
          }
        | null;
      const notifications = payload?.notifications ?? [];
      if (notifications.length === 0 || cancelled) {
        return;
      }

      const newest = notifications
        .map((item) => (item.createdAt ? new Date(item.createdAt).getTime() : 0))
        .reduce((max, value) => Math.max(max, value), 0);

      if (!initial) {
        const localPreference =
          payload?.preference ?? createNotificationPreferenceState(null, readNotificationLocalPreference());
        const fresh = notifications.filter((item) => {
          if (item.isRead || !item.createdAt) {
            return false;
          }
          if (new Date(item.createdAt).getTime() <= lastSeenRef.current) {
            return false;
          }
          return !isNotificationMutedLocally(localPreference, notificationLocalCategoryForType(item.type));
        });

        for (const item of fresh.reverse()) {
          await showBrowserNotification(item);
        }
      }

      lastSeenRef.current = Math.max(lastSeenRef.current, newest);
    }

    async function syncPushChannel() {
      if (Notification.permission !== "granted") {
        await unregisterWebPushSubscription().catch(() => undefined);
        return false;
      }

      if (!enabled) {
        await unregisterWebPushSubscription().catch(() => undefined);
        return false;
      }

      return registerWebPushSubscription().catch(() => false);
    }

    void (async () => {
      const usingPush = await syncPushChannel();
      if (cancelled || usingPush || !enabled) {
        return;
      }

      await poll(true);
      if (cancelled) {
        return;
      }

      intervalId = window.setInterval(() => {
        void poll(false);
      }, 60_000);
    })();

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [enabled]);

  return null;
}

export function NotificationSettingsForm({
  preference,
  canRunScheduler
}: {
  preference: NotificationPreferenceState;
  canRunScheduler: boolean;
}) {
  const { isPending, message, run } = useActionRefresh();
  const [state, setState] = useState(preference);
  const [permissionMessage, setPermissionMessage] = useState("");

  function patch(next: Partial<NotificationPreferenceState>) {
    setState((current) => ({
      ...current,
      ...next
    }));
  }

  function setCategorySnooze(
    key:
      | "approvalSnoozeUntil"
      | "leaveSnoozeUntil"
      | "missingRecordSnoozeUntil"
      | "monthCloseSnoozeUntil"
      | "dailyDigestSnoozeUntil",
    hours: number
  ) {
    const next = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    patch({
      [key]: next
    } as Partial<NotificationPreferenceState>);
  }

  function clearCategorySnooze(
    key:
      | "approvalSnoozeUntil"
      | "leaveSnoozeUntil"
      | "missingRecordSnoozeUntil"
      | "monthCloseSnoozeUntil"
      | "dailyDigestSnoozeUntil"
  ) {
    patch({
      [key]: null
    } as Partial<NotificationPreferenceState>);
  }

  async function requestPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermissionMessage("이 브라우저에서는 알림 허용 요청을 사용할 수 없습니다.");
      return;
    }

    const permission = await Notification.requestPermission();
    patch({
      browserPermission: permission,
      webPushEnabled: permission === "granted" ? state.webPushEnabled || true : false
    });
    setPermissionMessage(
      permission === "granted"
        ? "브라우저 알림이 허용되었습니다."
        : `브라우저 알림 상태: ${browserPermissionLabel(permission)}`
    );
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="actions-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>
            <Mail size={20} /> 알림 채널 설정
          </h2>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            앱 내 알림을 기준으로 이메일과 브라우저 푸시 전달 여부를 제어합니다.
          </p>
        </div>
        <span className={`status-pill ${browserPermissionTone(state.browserPermission)}`}>
          브라우저 알림 {browserPermissionLabel(state.browserPermission)}
        </span>
      </div>

      <label className="check-row">
        <input type="checkbox" checked={state.emailEnabled} onChange={(event) => patch({ emailEnabled: event.target.checked })} />
        이메일 알림 사용
      </label>
      <label className="check-row">
        <input type="checkbox" checked={state.webPushEnabled} onChange={(event) => patch({ webPushEnabled: event.target.checked })} />
        브라우저 알림 받기
      </label>
      <label className="check-row">
        <input type="checkbox" checked={state.approvalPendingEmail} onChange={(event) => patch({ approvalPendingEmail: event.target.checked })} />
        승인 대기 메일
      </label>
      <label className="check-row">
        <input type="checkbox" checked={state.approvalReviewedEmail} onChange={(event) => patch({ approvalReviewedEmail: event.target.checked })} />
        승인/반려 결과 메일
      </label>
      <label className="check-row">
        <input type="checkbox" checked={state.leaveReminderEmail} onChange={(event) => patch({ leaveReminderEmail: event.target.checked })} />
        휴가 시작 전 메일
      </label>
      <label className="check-row">
        <input type="checkbox" checked={state.missingRecordEmail} onChange={(event) => patch({ missingRecordEmail: event.target.checked })} />
        출퇴근 누락 메일
      </label>
      <label className="check-row">
        <input type="checkbox" checked={state.monthCloseEmail} onChange={(event) => patch({ monthCloseEmail: event.target.checked })} />
        월 마감 메일
      </label>
      <label className="check-row">
        <input type="checkbox" checked={state.schedulerDigestEnabled} onChange={(event) => patch({ schedulerDigestEnabled: event.target.checked })} />
        자동 생성 알림 받기
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={state.managerDailyDigestEnabled}
          onChange={(event) => patch({ managerDailyDigestEnabled: event.target.checked })}
        />
        오늘 운영 요약 알림 받기
      </label>

      <div className="stack" style={{ gap: 10 }}>
        <strong>알림 종류별 설정</strong>
        {[
          {
            label: "승인 요청",
            muteKey: "approvalMuted",
            snoozeKey: "approvalSnoozeUntil",
            value: state.approvalSnoozeUntil
          },
          {
            label: "휴가",
            muteKey: "leaveMuted",
            snoozeKey: "leaveSnoozeUntil",
            value: state.leaveSnoozeUntil
          },
          {
            label: "출퇴근 누락",
            muteKey: "missingRecordMuted",
            snoozeKey: "missingRecordSnoozeUntil",
            value: state.missingRecordSnoozeUntil
          },
          {
            label: "월 마감",
            muteKey: "monthCloseMuted",
            snoozeKey: "monthCloseSnoozeUntil",
            value: state.monthCloseSnoozeUntil
          },
          {
            label: "운영 요약",
            muteKey: "dailyDigestMuted",
            snoozeKey: "dailyDigestSnoozeUntil",
            value: state.dailyDigestSnoozeUntil
          }
        ].map((row) => (
          <div className="card" key={row.label}>
            <div className="actions-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <label className="check-row" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={Boolean(state[row.muteKey as keyof NotificationPreferenceState])}
                  onChange={(event) =>
                    patch({
                      [row.muteKey]: event.target.checked
                    } as Partial<NotificationPreferenceState>)
                  }
                />
                {row.label} 알림 받지 않기
              </label>
              <span className="muted">
                {row.value ? `일시 중지 ~ ${new Date(row.value).toLocaleString("ko-KR")}` : "일시 중지 없음"}
              </span>
            </div>
            <div className="actions-row">
              <button className="button secondary" type="button" onClick={() => setCategorySnooze(row.snoozeKey as never, 8)}>
                8시간 멈춤
              </button>
              <button className="button secondary" type="button" onClick={() => setCategorySnooze(row.snoozeKey as never, 24)}>
                24시간 멈춤
              </button>
              <button className="button secondary" type="button" onClick={() => clearCategorySnooze(row.snoozeKey as never)}>
                다시 받기
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="actions-row">
        <button className="button secondary" type="button" onClick={() => void requestPermission()}>
          브라우저 알림 허용 요청
        </button>
        <button
          className="button"
          type="button"
          disabled={isPending}
          onClick={() =>
            run(
              async () => {
                writeNotificationLocalPreference(pickNotificationLocalPreference(state));
                return postJson("/api/notifications/preferences", {
                  ...state
                });
              },
              "알림 설정을 저장했습니다."
            )
          }
        >
          <Send size={15} />
          알림 설정 저장
        </button>
        {canRunScheduler ? (
          <button
            className="button secondary"
            type="button"
            disabled={isPending}
            onClick={() =>
              run(
                () => postJson("/api/internal/notifications/run"),
                "자동 리마인더를 실행했습니다."
              )
            }
          >
            <RefreshCw size={15} />
            리마인더 실행
          </button>
        ) : null}
      </div>

      {permissionMessage ? <p className="muted">{permissionMessage}</p> : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function NotificationCenter({
  unreadCount,
  notifications,
  reminders,
  groupwareSummary,
  preference,
  initialGroup = "ALL",
  initialShowUnreadOnly = false,
  archivedNotifications = [],
  archivedCount = 0
}: {
  unreadCount: number;
  notifications: NotificationCenterItem[];
  reminders: NotificationReminder[];
  groupwareSummary?: NotificationGroupwareSummary;
  preference: NotificationPreferenceState;
  initialGroup?: NotificationGroup;
  initialShowUnreadOnly?: boolean;
  archivedNotifications?: NotificationCenterItem[];
  archivedCount?: number;
}) {
  const router = useRouter();
  const [openNotificationId, setOpenNotificationId] = useState<string | null>(
    notifications.find((notification) => !notification.isRead)?.id ?? notifications[0]?.id ?? null
  );
  const [activeGroup, setActiveGroup] = useState<NotificationGroup>(initialGroup);
  const [showUnreadOnly, setShowUnreadOnly] = useState(initialShowUnreadOnly);
  const [showArchivedRead, setShowArchivedRead] = useState(false);
  const [showHiddenRead, setShowHiddenRead] = useState(false);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [localPreference, setLocalPreference] = useState<NotificationLocalPreferenceState>(() =>
    pickNotificationLocalPreference(preference)
  );
  const [localArchivedNotifications, setLocalArchivedNotifications] = useState<ArchivedNotificationSnapshot[]>(() =>
    readArchivedNotifications()
  );
  const [optimisticState, setOptimisticState] = useState<{
    baseVersion: string;
    readIds: string[];
    markAll: boolean;
  }>({
    baseVersion: "",
    readIds: [],
    markAll: false
  });
  const archivedSnapshots = [...localArchivedNotifications, ...archivedNotifications].filter(
    (notification, index, array) =>
      array.findIndex((candidate) => candidate.id === notification.id) === index
  );
  const archivedIds = new Set(archivedSnapshots.map((notification) => notification.id));
  const notificationVersion = `${unreadCount}:${notifications.map((notification) => `${notification.id}:${notification.isRead ? "1" : "0"}`).join("|")}`;
  const optimisticActive = optimisticState.baseVersion === notificationVersion;
  const optimisticReadIds = new Set(optimisticActive ? optimisticState.readIds : []);
  const items = notifications.map((notification) =>
    optimisticActive && (optimisticState.markAll || optimisticReadIds.has(notification.id))
      ? {
          ...notification,
          isRead: true
        }
      : notification
  );
  const activeItems = items.filter((notification) => !archivedIds.has(notification.id));
  const currentUnreadCount = optimisticActive
    ? optimisticState.markAll
      ? 0
      : Math.max(
          0,
          unreadCount -
            notifications.filter((notification) => !notification.isRead && optimisticReadIds.has(notification.id)).length
        )
    : unreadCount;
  const resolvedOpenNotificationId =
    openNotificationId && items.some((notification) => notification.id === openNotificationId)
      ? openNotificationId
      : items.find((notification) => !notification.isRead)?.id ?? items[0]?.id ?? null;

  const visibleReminders = reminders.filter((reminder) => {
    const displayGroup = notificationLocalDisplayGroup(reminder);
    const preferenceCategory = notificationLocalCategoryForReminder(reminder);
    const matchesGroup = activeGroup === "ALL" || displayGroup === activeGroup;
    return matchesGroup && !isNotificationMutedLocally(localPreference, preferenceCategory);
  });
  const filteredNotifications = activeItems.filter((notification) => {
    const matchesGroup = activeGroup === "ALL" || notificationGroupForType(notification.type) === activeGroup;
    const matchesUnread = !showUnreadOnly || !notification.isRead;
    return matchesGroup && matchesUnread && !isNotificationMutedLocally(localPreference, notificationLocalCategoryForType(notification.type));
  });
  const visibleNotifications = filteredNotifications.filter(
    (notification) => !notification.isRead || ageInDays(notification.createdAt) <= 7
  );
  const archivedReadNotifications = filteredNotifications.filter((notification) => {
    const ageDays = ageInDays(notification.createdAt);
    return Boolean(notification.isRead) && ageDays > 7 && ageDays <= 30;
  });
  const hiddenReadNotifications = filteredNotifications.filter(
    (notification) => Boolean(notification.isRead) && ageInDays(notification.createdAt) > 30
  );
  const groupedButtons: Array<{ key: NotificationGroup; label: string }> = [
    { key: "ALL", label: "전체" },
    { key: "APPROVAL", label: "승인" },
    { key: "LEAVE", label: "휴가" },
    { key: "MISSING", label: "누락" },
    { key: "MONTH_CLOSE", label: "월마감" },
    { key: "OTHER", label: "기타" }
  ];

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const sync = () => {
      setLocalPreference(pickNotificationLocalPreference(createNotificationPreferenceState(null, readNotificationLocalPreference())));
      setLocalArchivedNotifications(readArchivedNotifications());
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === NOTIFICATION_LOCAL_PREFS_KEY || event.key === NOTIFICATION_ARCHIVE_KEY) {
        sync();
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(FIELD_QUEUE_SYNC_EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(FIELD_QUEUE_SYNC_EVENT, sync);
    };
  }, []);

  function syncReadState(notificationId: string) {
    const didChange = items.some((notification) => notification.id === notificationId && !notification.isRead);
    if (!didChange) {
      return false;
    }

    setOptimisticState((current) => {
      const baseVersion = current.baseVersion === notificationVersion ? current.baseVersion : notificationVersion;
      const nextReadIds = new Set(baseVersion === current.baseVersion ? current.readIds : []);
      nextReadIds.add(notificationId);

      return {
        baseVersion,
        readIds: [...nextReadIds],
        markAll: baseVersion === current.baseVersion ? current.markAll : false
      };
    });

    return didChange;
  }

  function markNotificationAsRead(notificationId: string, successMessage?: string) {
    startTransition(async () => {
      try {
        const didChange = syncReadState(notificationId);
        await postJson(`/api/notifications/${notificationId}/read`);
        if (successMessage) {
          setMessage(successMessage);
        } else if (didChange) {
          setMessage("");
        }
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "요청 처리에 실패했습니다.");
      }
    });
  }

  function openNotification(notification: NotificationCenterItem) {
    setOpenNotificationId((current) => (current === notification.id ? null : notification.id));
    setMessage("");

    if (!notification.isRead) {
      markNotificationAsRead(notification.id);
    }
  }

  function openUnreadNotification() {
    const unread = items.find((notification) => !notification.isRead) ?? items[0];
    if (!unread) {
      return;
    }

    setOpenNotificationId(unread.id);
    if (!unread.isRead) {
      markNotificationAsRead(unread.id);
    }
  }

  function markAllRead() {
    setMessage("");
    startTransition(async () => {
      try {
        await postJson("/api/notifications/read-all");
        setOptimisticState({
          baseVersion: notificationVersion,
          readIds: [],
          markAll: true
        });
        setMessage("모든 알림을 읽음 처리했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "요청 처리에 실패했습니다.");
      }
    });
  }

  function archiveRead() {
    setMessage("");
    startTransition(async () => {
      try {
        const nextArchived = [
          ...items
            .filter((notification) => notification.isRead && !archivedIds.has(notification.id))
            .map((notification) => ({
              ...notification,
              archivedAt: new Date().toISOString()
            })),
          ...localArchivedNotifications
        ].filter(
          (notification, index, array) =>
            array.findIndex((candidate) => candidate.id === notification.id) === index
        );
        await postJson("/api/notifications/archive-read");
        writeArchivedNotifications(nextArchived);
        setLocalArchivedNotifications(nextArchived);
        setMessage("읽은 알림을 보관했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "요청 처리에 실패했습니다.");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="actions-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>
            <Bell size={20} /> 알림 센터
          </h2>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            승인, 스케줄 변경, 누락 리마인더를 앱 안과 이메일/브라우저 푸시로 함께 확인합니다.
          </p>
        </div>
        <div className="actions-row">
          <button
            className={`status-pill ${currentUnreadCount > 0 ? "yellow" : "gray"}`}
            type="button"
            disabled={items.length === 0}
            onClick={openUnreadNotification}
            style={{ border: "none", cursor: items.length > 0 ? "pointer" : "default" }}
          >
            읽지 않음 {currentUnreadCount}건
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={isPending || currentUnreadCount === 0}
            onClick={markAllRead}
          >
            모두 읽음
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={isPending || items.every((notification) => !notification.isRead)}
            onClick={archiveRead}
          >
            <Archive size={15} />
            읽은 알림 보관
          </button>
        </div>
      </div>

      {groupwareSummary ? (
        <div className="grid-4">
          <a className="quick-link-card" href="/dashboard?view=groupware#groupware-announcements">
            <Bell size={18} />
            <strong>미확인 공지</strong>
            <span className="muted">{groupwareSummary.unreadAnnouncements}건</span>
          </a>
          <a className="quick-link-card" href="/dashboard?view=groupware#groupware-documents">
            <FileText size={18} />
            <strong>받은 결재</strong>
            <span className="muted">{groupwareSummary.incomingDocuments}건</span>
          </a>
          <a className="quick-link-card" href="/dashboard?view=workbox">
            <MessageSquarePlus size={18} />
            <strong>담당 메모</strong>
            <span className="muted">{groupwareSummary.assignedMemos}건</span>
          </a>
          <a className="quick-link-card" href="/dashboard?view=groupware#groupware-payroll-statements">
            <Download size={18} />
            <strong>급여명세</strong>
            <span className="muted">{groupwareSummary.payrollStatementIssues}건</span>
          </a>
          <a className="quick-link-card" href="/dashboard?view=groupware#groupware-documents">
            <FileText size={18} />
            <strong>내 상신 대기</strong>
            <span className="muted">{groupwareSummary.myPendingDocuments}건</span>
          </a>
          <a className="quick-link-card" href="/dashboard?view=groupware#groupware-documents">
            <ThumbsUp size={18} />
            <strong>승인 완료</strong>
            <span className="muted">{groupwareSummary.myApprovedDocuments}건</span>
          </a>
          <a className="quick-link-card" href="/dashboard?view=groupware#groupware-documents">
            <ThumbsDown size={18} />
            <strong>반려</strong>
            <span className="muted">{groupwareSummary.myRejectedDocuments}건</span>
          </a>
        </div>
      ) : null}

      <div className="stack" style={{ gap: 10 }}>
        <div className="actions-row" style={{ flexWrap: "wrap" }}>
          {groupedButtons.map((group) => (
            <button
              key={group.key}
              className={`button ${activeGroup === group.key ? "" : "secondary"}`}
              type="button"
              onClick={() => setActiveGroup(group.key)}
            >
              {group.label}
            </button>
          ))}
        </div>
        <label className="check-row" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={showUnreadOnly}
            onChange={(event) => setShowUnreadOnly(event.target.checked)}
          />
          읽지 않음만 보기
        </label>
      </div>

      {visibleReminders.length > 0 ? (
        <div className="stack" style={{ gap: 10 }}>
          {visibleReminders.map((reminder) => (
            <div className={`notice-card ${reminder.tone}`} key={reminder.id}>
              <div>
                <strong>{reminder.title}</strong>
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  {reminder.message}
                </p>
              </div>
              {reminder.actionUrl ? (
                <a className="button secondary" href={reminder.actionUrl}>
                  바로 가기
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">이 분류에서 바로 대응할 리마인더는 없습니다.</div>
      )}

      {filteredNotifications.length > 0 || archivedNotifications.length > 0 || localArchivedNotifications.length > 0 ? (
        <div id="notifications-list" className="stack" style={{ gap: 10 }}>
          {visibleNotifications.map((notification) => {
            const isOpen = resolvedOpenNotificationId === notification.id;
            const metadata = getObjectRecord(notification.metadata);
            const approvalId = typeof metadata?.approvalId === "string" ? metadata.approvalId : null;
            const actionHref = notificationActionHref(notification);

            return (
              <div className={`notification-card ${notification.isRead ? "read" : "unread"}`} key={notification.id}>
                <button
                  type="button"
                  onClick={() => openNotification(notification)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    textAlign: "left",
                    cursor: "pointer"
                  }}
                >
                  <div className="actions-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div className="stack" style={{ gap: 6 }}>
                      <strong>{notification.title}</strong>
                      <span className={`status-pill ${notification.isRead ? "gray" : "yellow"}`}>
                        {notification.isRead ? "읽음" : "읽지 않음"}
                      </span>
                    </div>
                    {notification.createdAt ? (
                      <span className="muted">
                        {new Intl.DateTimeFormat("ko-KR", {
                          timeZone: "Asia/Seoul",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit"
                        }).format(new Date(notification.createdAt))}
                      </span>
                    ) : null}
                  </div>
                </button>
                {isOpen ? (
                  <div className="stack" style={{ gap: 10, marginTop: 12 }}>
                    <p className="muted" style={{ margin: 0 }}>
                      {notification.message}
                    </p>
                    <div className="actions-row">
                      {actionHref ? (
                        <a className="button secondary" href={actionHref}>
                          {notificationActionLabel(notification)}
                        </a>
                      ) : null}
                      {!notification.isRead ? (
                        <button
                          className="button secondary"
                          type="button"
                          disabled={isPending}
                          onClick={() => markNotificationAsRead(notification.id, "알림을 읽음 처리했습니다.")}
                        >
                          읽음 처리
                        </button>
                      ) : null}
                    </div>
                    {isApprovalPendingNotification(notification) && approvalId ? (
                      <div className="panel stack" style={{ background: "#fbfdff" }}>
                        <h3 style={{ margin: 0 }}>알림에서 바로 승인 처리</h3>
                        <p className="muted" style={{ margin: 0 }}>
                          요청 상세 패널로 이동하지 않고 여기서 바로 승인 또는 반려할 수 있습니다.
                        </p>
                        <ApprovalButtons approvalId={approvalId} idPrefix="notification-approval-review" />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          {archivedReadNotifications.length > 0 ? (
            <div className="card">
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>보관된 읽은 알림</strong>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    7일이 지난 읽은 알림은 기본으로 접어 둡니다.
                  </p>
                </div>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setShowArchivedRead((current) => !current)}
                >
                  {showArchivedRead ? "접기" : `${archivedReadNotifications.length}건 펼치기`}
                </button>
              </div>
            </div>
          ) : null}

          {showArchivedRead
            ? archivedReadNotifications.map((notification) => {
                const isOpen = resolvedOpenNotificationId === notification.id;
                const actionHref = notificationActionHref(notification);

                return (
                  <div className="notification-card read" key={notification.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(notification)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: 0,
                        border: "none",
                        background: "transparent",
                        textAlign: "left",
                        cursor: "pointer"
                      }}
                    >
                      <div className="actions-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div className="stack" style={{ gap: 6 }}>
                          <strong>{notification.title}</strong>
                          <span className="status-pill gray">읽음 · 보관</span>
                        </div>
                        {notification.createdAt ? (
                          <span className="muted">
                            {new Intl.DateTimeFormat("ko-KR", {
                              timeZone: "Asia/Seoul",
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit"
                            }).format(new Date(notification.createdAt))}
                          </span>
                        ) : null}
                      </div>
                    </button>
                    {isOpen ? (
                      <div className="stack" style={{ gap: 10, marginTop: 12 }}>
                        <p className="muted" style={{ margin: 0 }}>
                          {notification.message}
                        </p>
                        {actionHref ? (
                          <div className="actions-row">
                            <a className="button secondary" href={actionHref}>
                              {notificationActionLabel(notification)}
                            </a>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            : null}

          {hiddenReadNotifications.length > 0 ? (
            <div className="card">
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>30일 지난 읽은 알림</strong>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    30일이 지난 읽은 알림은 자동으로 숨깁니다.
                  </p>
                </div>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setShowHiddenRead((current) => !current)}
                >
                  {showHiddenRead ? "숨기기" : `${hiddenReadNotifications.length}건 보기`}
                </button>
              </div>
            </div>
          ) : null}

          {showHiddenRead
            ? hiddenReadNotifications.map((notification) => {
                const isOpen = resolvedOpenNotificationId === notification.id;
                const actionHref = notificationActionHref(notification);

                return (
                  <div className="notification-card read" key={notification.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(notification)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: 0,
                        border: "none",
                        background: "transparent",
                        textAlign: "left",
                        cursor: "pointer"
                      }}
                    >
                      <div className="actions-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div className="stack" style={{ gap: 6 }}>
                          <strong>{notification.title}</strong>
                          <span className="status-pill gray">읽음 · 30일 경과</span>
                        </div>
                        {notification.createdAt ? (
                          <span className="muted">
                            {new Intl.DateTimeFormat("ko-KR", {
                              timeZone: "Asia/Seoul",
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit"
                            }).format(new Date(notification.createdAt))}
                          </span>
                        ) : null}
                      </div>
                    </button>
                    {isOpen ? (
                      <div className="stack" style={{ gap: 10, marginTop: 12 }}>
                        <p className="muted" style={{ margin: 0 }}>
                          {notification.message}
                        </p>
                        {actionHref ? (
                          <div className="actions-row">
                            <a className="button secondary" href={actionHref}>
                              {notificationActionLabel(notification)}
                            </a>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            : null}

          {archivedSnapshots.length > 0 ? (
            <div className="card">
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>수동 보관 알림</strong>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    읽은 뒤 일괄 보관한 알림입니다.
                  </p>
                </div>
                <span className="status-pill gray">{archivedSnapshots.length || archivedCount}건</span>
              </div>
              <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                {archivedSnapshots.slice(0, 5).map((notification) => (
                  <div className="notification-card read" key={`archived-${notification.id}`}>
                    <strong>{notification.title}</strong>
                    <p className="muted" style={{ margin: "6px 0 0" }}>
                      {notification.message}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty">이 조건에 맞는 알림이 없습니다.</div>
      )}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function PwaInstallCard({
  showApprovals,
  showReports,
  quickApprovals = []
}: {
  showApprovals: boolean;
  showReports: boolean;
  quickApprovals?: MobileQuickApproval[];
}) {
  const [promptEvent, setPromptEvent] = useState<DeferredPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  });
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.navigator.onLine;
  });
  const [message, setMessage] = useState("");
  const [queueCount, setQueueCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [queueItems, setQueueItems] = useState<FieldQueueItem[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleBeforeInstallPrompt = (event: DeferredPromptEvent) => {
      event.preventDefault();
      setPromptEvent(event);
    };

    const handleInstalled = () => {
      setPromptEvent(null);
      setIsStandalone(true);
      setMessage("앱이 설치되었습니다.");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncState = async () => {
      const [queue, meta] = await Promise.all([listFieldQueue().catch(() => []), getFieldQueueMeta().catch(() => ({ lastSyncAt: null }))]);
      setQueueItems(queue);
      setQueueCount(queue.length);
      setLastSyncAt(meta.lastSyncAt);
      setDraftUpdatedAt(readAdjustmentDraft()?.updatedAt ?? null);
    };

    const handleOnline = () => {
      setIsOnline(true);
      void handleFlushQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    const handleSyncEvent = () => {
      void syncState();
    };
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== "FIELD_QUEUE_SYNC_RESULT") {
        return;
      }
      void syncState();
      if (event.data.payload?.flushed > 0) {
        setMessage(`백그라운드 동기화로 ${event.data.payload.flushed}건을 전송했습니다.`);
      }
    };

    void syncState();
    window.addEventListener("storage", handleSyncEvent);
    window.addEventListener(FIELD_QUEUE_SYNC_EVENT, handleSyncEvent as EventListener);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);
    void registerFieldQueueBackgroundSync();

    return () => {
      window.removeEventListener("storage", handleSyncEvent);
      window.removeEventListener(FIELD_QUEUE_SYNC_EVENT, handleSyncEvent as EventListener);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, []);

  async function handleInstall() {
    if (!promptEvent) {
      setMessage("브라우저 메뉴에서 '홈 화면에 추가'를 선택하면 설치할 수 있습니다.");
      return;
    }

    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") {
      setMessage("설치를 진행했습니다.");
    } else {
      setMessage("설치를 나중에 다시 시도할 수 있습니다.");
    }
    setPromptEvent(null);
  }

  async function handleFlushQueue() {
    setSyncing(true);
    const result = await flushFieldQueue().catch(() => null);
    setSyncing(false);

    if (!result) {
      setMessage("대기 중인 기록을 보내지 못했습니다.");
      return;
    }

    const [queue, meta] = await Promise.all([listFieldQueue().catch(() => []), getFieldQueueMeta().catch(() => ({ lastSyncAt: null }))]);
    setQueueItems(queue);
    setQueueCount(queue.length);
    setLastSyncAt(meta.lastSyncAt);

    if (result.flushed > 0) {
      setMessage(
        result.blocked > 0
          ? `대기 기록 ${result.flushed}건을 보냈고, 충돌 ${result.blocked}건은 확인 대기 상태로 남겼습니다.`
          : `대기 중이던 기록 ${result.flushed}건을 보냈습니다.`
      );
      return;
    }

    if (result.remaining === 0) {
      setMessage("지금 바로 보낼 대기 기록이 없습니다.");
      return;
    }

    setMessage(
      result.blocked > 0
        ? `전송 충돌 ${result.blocked}건을 확인해 주세요. 나머지 대기 ${Math.max(0, result.remaining - result.blocked)}건`
        : `아직 보내지 못한 기록이 ${result.remaining}건 남아 있습니다.`
    );
  }

  async function handleRemoveQueuedItem(itemId: string) {
    const remaining = await removeFieldQueueItem(itemId);
    setQueueItems(await listFieldQueue().catch(() => []));
    setQueueCount(remaining);
    setMessage(`선택한 대기 기록을 삭제했습니다. 남은 대기 ${remaining}건`);
  }

  async function handleClearQueue() {
    await clearFieldQueue();
    setQueueItems([]);
    setQueueCount(0);
    setMessage("전송 대기 기록을 모두 비웠습니다.");
  }

  const retrySummary = queueRetrySummary(queueItems);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="actions-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>
            <Smartphone size={20} /> 모바일 앱 모드
          </h2>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            홈 화면 설치와 하단 빠른 이동을 지원해 한 손으로 출퇴근, 신청, 승인까지 처리합니다.
          </p>
        </div>
        <span className={`status-pill ${isStandalone ? "green" : "gray"}`}>{isStandalone ? "앱처럼 사용 중" : "브라우저에서 사용 중"}</span>
      </div>
      <div className={`notice-card ${isOnline ? "info" : "warning"}`}>
        <div>
          <strong>{isOnline ? "온라인 상태" : "오프라인 상태"}</strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            {isOnline
              ? queueCount > 0
                ? `전송 대기 기록 ${queueCount}건을 지금 보낼 수 있습니다.`
                : "출퇴근과 신청 기록이 서버와 정상 연결되어 있습니다."
              : `출근, 퇴근, 상태 변경은 전송 대기함에 보관됩니다. 현재 대기 ${queueCount}건`}
          </p>
        </div>
        <div className="actions-row">
          <button className="button secondary" type="button" disabled={syncing || queueCount === 0} onClick={() => void handleFlushQueue()}>
            <Upload size={16} />
            대기 기록 보내기
          </button>
          {queueCount > 0 ? (
            <button className="button secondary" type="button" onClick={handleClearQueue}>
              <Trash2 size={16} />
              대기 비우기
            </button>
          ) : null}
        </div>
      </div>

      <div className="quick-link-grid">
        <Link className="quick-link-card" href={dashboardViewHref("employee")}>
          <Home size={18} />
          <strong>근로기록</strong>
          <span className="muted">출근/퇴근과 상태 변경</span>
        </Link>
        <Link className="quick-link-card" href={dashboardViewHref("notifications")}>
          <Bell size={18} />
          <strong>알림</strong>
          <span className="muted">승인, 누락, 휴가 시작 전 알림</span>
        </Link>
        {showApprovals ? (
          <Link className="quick-link-card" href={dashboardViewHref("approvals")}>
            <BriefcaseBusiness size={18} />
            <strong>승인함</strong>
            <span className="muted">모바일 승인과 반려 처리</span>
          </Link>
        ) : null}
        {showReports ? (
          <Link className="quick-link-card" href={dashboardViewHref("reports")}>
            <FileText size={18} />
            <strong>리포트</strong>
            <span className="muted">월 마감과 급여 내보내기</span>
          </Link>
        ) : null}
      </div>

      <div className="actions-row">
        <button className="button" type="button" onClick={() => void handleInstall()}>
          <Download size={16} />
          앱 설치
        </button>
        <button className="button secondary" type="button" disabled={syncing} onClick={() => void handleFlushQueue()}>
          <Upload size={16} />
          대기 기록 보내기
        </button>
        <a className="button secondary" href="/offline.html">
          오프라인 사용 안내
        </a>
      </div>
      <div className="grid-3">
        <div className="metric">
          <span>나중에 보낼 기록</span>
          <strong>{queueCount}건</strong>
        </div>
        <div className="metric">
          <span>마지막 동기화</span>
          <strong style={{ fontSize: 18 }}>
            {lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString("ko-KR") : "-"}
          </strong>
        </div>
        <div className="metric">
          <span>저장한 정정 요청</span>
          <strong style={{ fontSize: 18 }}>
            {draftUpdatedAt ? new Date(draftUpdatedAt).toLocaleTimeString("ko-KR") : "없음"}
          </strong>
        </div>
      </div>
      <div className="grid-3">
        <div className="metric">
          <span>재전송 시도</span>
          <strong style={{ fontSize: 18 }}>{retrySummary.totalAttempts}회</strong>
        </div>
        <div className="metric">
          <span>마지막 재시도</span>
          <strong style={{ fontSize: 18 }}>
            {retrySummary.lastRetried ? new Date(retrySummary.lastRetried).toLocaleTimeString("ko-KR") : "-"}
          </strong>
        </div>
        <div className="metric">
          <span>최근 전송 오류</span>
          <strong style={{ fontSize: 16 }}>{retrySummary.latestError ?? "없음"}</strong>
        </div>
      </div>
      <div className="card">
        <strong>오프라인 사용 방식</strong>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          오프라인일 때 출근/퇴근/상태 변경은 IndexedDB 대기열에 저장하고, 브라우저가 지원하면 background sync로 자동 전송을 재시도합니다. 서버 충돌이 생긴 기록은 확인 대기 상태로 남겨 중복 제출을 막습니다.
        </p>
      </div>
      {queueItems.length > 0 ? (
        <div className="card">
          <div className="actions-row" style={{ justifyContent: "space-between" }}>
            <strong>대기 중인 기록</strong>
            <span className="status-pill gray">{queueItems.length}건</span>
          </div>
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            {queueItems.slice(0, 6).map((item) => (
              <div key={item.id} className="notification-card read">
                <div>
                  <strong>
                    {item.label} {item.status === "blocked" ? "· 확인 필요" : ""}
                  </strong>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    생성 {new Date(item.createdAt).toLocaleString("ko-KR")} · 재시도 {item.attempts}회
                    {item.lastError ? ` · 최근 오류: ${item.lastError}` : ""}
                  </p>
                </div>
                <div className="actions-row">
                  <span className={`status-pill ${item.status === "blocked" ? "red" : "gray"}`}>
                    {item.status === "blocked" ? "충돌" : "대기"}
                  </span>
                  <button className="button secondary" type="button" onClick={() => void handleRemoveQueuedItem(item.id)}>
                    <Trash2 size={15} />
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {showApprovals && quickApprovals.length > 0 ? (
        <div className="card">
          <strong>모바일 빠른 승인</strong>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            바깥에서도 오래된 승인 요청을 바로 처리합니다.
          </p>
          <div className="stack" style={{ gap: 10, marginTop: 12 }}>
            {quickApprovals.map((approval) => (
              <div className="notification-card unread" key={approval.id}>
                <strong>
                  {approval.requesterName} · {approval.type}
                </strong>
                <p className="muted" style={{ margin: "6px 0 0" }}>대기 {approval.ageLabel}</p>
                <div style={{ marginTop: 10 }}>
                  <ApprovalButtons
                    approvalId={approval.id}
                    idPrefix="mobile-quick-approval"
                    initialReviewNote="모바일 빠른 승인 처리"
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function DashboardMobileNav({
  activeView,
  showApprovals,
  showReports,
  showSettings,
  unreadCount,
  workboxUnreadCount = 0
}: {
  activeView: string;
  showApprovals: boolean;
  showReports: boolean;
  showSettings: boolean;
  unreadCount: number;
  workboxUnreadCount?: number;
}) {
  if (!showApprovals && !showReports) {
    return (
      <nav className="mobile-nav" aria-label="모바일 대시보드 메뉴">
        <Link href={dashboardViewHref("employee")} aria-current={activeView === "employee" ? "page" : undefined}>
          <Home size={16} />
          <span>홈</span>
        </Link>
        <Link href={dashboardViewHref("organization")} aria-current={activeView === "organization" ? "page" : undefined}>
          <Users size={16} />
          <span>조직</span>
        </Link>
        <Link href={dashboardViewHref("groupware")} aria-current={activeView === "groupware" ? "page" : undefined}>
          <BriefcaseBusiness size={16} />
          <span>그룹</span>
        </Link>
        <Link href={dashboardViewHref("workbox")} aria-current={activeView === "workbox" ? "page" : undefined}>
          <BriefcaseBusiness size={16} />
          <span>업무</span>
          {workboxUnreadCount > 0 ? <small>{workboxUnreadCount}</small> : null}
        </Link>
        <Link href={dashboardViewHref("notifications")} aria-current={activeView === "notifications" ? "page" : undefined}>
          <Bell size={16} />
          <span>알림</span>
          {unreadCount > 0 ? <small>{unreadCount}</small> : null}
        </Link>
        <Link href={dashboardViewHref("employee", undefined, "employee-requests")}>
          <CalendarClock size={16} />
          <span>신청</span>
        </Link>
        <Link href={dashboardViewHref("employee", undefined, "employee-events")}>
          <Archive size={16} />
          <span>내역</span>
        </Link>
      </nav>
    );
  }

  return (
    <nav className="mobile-nav" aria-label="모바일 대시보드 메뉴">
      <Link href={dashboardViewHref("employee")} aria-current={activeView === "employee" ? "page" : undefined}>
        <Home size={16} />
        <span>기록</span>
      </Link>
      <Link href={dashboardViewHref("organization")} aria-current={activeView === "organization" ? "page" : undefined}>
        <Users size={16} />
        <span>조직</span>
      </Link>
      <Link href={dashboardViewHref("groupware")} aria-current={activeView === "groupware" ? "page" : undefined}>
        <BriefcaseBusiness size={16} />
        <span>그룹</span>
      </Link>
      <Link href={dashboardViewHref("workbox")} aria-current={activeView === "workbox" ? "page" : undefined}>
        <BriefcaseBusiness size={16} />
        <span>업무</span>
        {workboxUnreadCount > 0 ? <small>{workboxUnreadCount}</small> : null}
      </Link>
      <Link href={dashboardViewHref("notifications")} aria-current={activeView === "notifications" ? "page" : undefined}>
        <Bell size={16} />
        <span>알림</span>
        {unreadCount > 0 ? <small>{unreadCount}</small> : null}
      </Link>
      {showApprovals ? (
        <Link href={dashboardViewHref("approvals")} aria-current={activeView === "approvals" ? "page" : undefined}>
          <BriefcaseBusiness size={16} />
          <span>승인</span>
        </Link>
      ) : null}
      {showReports ? (
        <Link href={dashboardViewHref("reports")} aria-current={activeView === "reports" ? "page" : undefined}>
          <FileText size={16} />
          <span>리포트</span>
        </Link>
      ) : null}
      {showSettings ? (
        <Link href={dashboardViewHref("settings")} aria-current={activeView === "settings" ? "page" : undefined}>
          <ShieldCheck size={16} />
          <span>설정</span>
        </Link>
      ) : null}
    </nav>
  );
}

type MonthCloseBlockerSummary = {
  pendingApprovals: number;
  pendingLeaveApprovals: number;
  pendingAdjustmentApprovals: number;
  openSessions: number;
  unresolvedOvertime: number;
  missingRecordRisks: number;
  scheduleMismatchSessions: number;
  leaveBalanceDeficitUsers: number;
};

function monthCloseBlockerItems(summary: MonthCloseBlockerSummary) {
  return [
    {
      key: "pendingApprovals",
      label: "승인 대기",
      value: summary.pendingApprovals,
      description: "휴가, 정정, 초과근로 요청이 남아 있으면 월 마감 전에 먼저 판단해야 합니다.",
      nextStep: "승인함에서 요청을 승인하거나 반려하세요.",
      href: dashboardViewHref("reports", undefined, "month-close-blocker-pending-approvals")
    },
    {
      key: "pendingLeaveApprovals",
      label: "휴가 대기",
      value: summary.pendingLeaveApprovals,
      description: "휴가 승인 대기는 연차 차감과 월 급여 계산에 바로 영향을 줍니다.",
      nextStep: "휴가 요청을 먼저 처리한 뒤 마감을 진행하세요.",
      href: dashboardViewHref("reports", undefined, "month-close-blocker-pending-approvals")
    },
    {
      key: "pendingAdjustmentApprovals",
      label: "정정 대기",
      value: summary.pendingAdjustmentApprovals,
      description: "정정 승인 전에는 실제 출퇴근 시간이 확정되지 않습니다.",
      nextStep: "근태 정정 요청의 증빙과 시간을 확인하세요.",
      href: dashboardViewHref("reports", undefined, "month-close-blocker-pending-approvals")
    },
    {
      key: "openSessions",
      label: "미종결 세션",
      value: summary.openSessions,
      description: "퇴근이 닫히지 않은 세션은 실제 근로시간과 연장근무를 왜곡합니다.",
      nextStep: "당일 기록과 누락 정정을 먼저 마무리하세요.",
      href: dashboardViewHref("reports", undefined, "month-close-blocker-open-sessions")
    },
    {
      key: "unresolvedOvertime",
      label: "미승인 연장",
      value: summary.unresolvedOvertime,
      description: "연장근무가 승인되지 않으면 급여 반영 기준이 달라질 수 있습니다.",
      nextStep: "초과근로 요청과 실제 세션 시간을 같이 확인하세요.",
      href: dashboardViewHref("reports", undefined, "month-close-blocker-open-sessions")
    },
    {
      key: "missingRecordRisks",
      label: "누락 리스크",
      value: summary.missingRecordRisks,
      description: "출퇴근 누락 리스크는 월 마감 후 감사 대응에서 가장 먼저 문제가 됩니다.",
      nextStep: "누락 정정 요청 또는 현장 증빙 확보가 필요합니다.",
      href: dashboardViewHref("reports", undefined, "month-close-blocker-missing-records")
    },
    {
      key: "scheduleMismatchSessions",
      label: "스케줄 이탈",
      value: summary.scheduleMismatchSessions,
      description: "계획 대비 실제 근무가 크게 다르면 정산과 리스크 판정이 달라집니다.",
      nextStep: "스케줄 수정 또는 승인 메모를 남겨 기준을 맞추세요.",
      href: dashboardViewHref("reports", undefined, "month-close-blocker-missing-records")
    },
    {
      key: "leaveBalanceDeficitUsers",
      label: "연차 부족 인원",
      value: summary.leaveBalanceDeficitUsers,
      description: "연차 잔액 부족은 차감 기준과 정산 결과를 다시 확인해야 하는 신호입니다.",
      nextStep: "수동 조정 또는 휴가 승인 내역 검토가 필요합니다.",
      href: dashboardViewHref("reports", undefined, "month-close-blocker-leave-deficit")
    }
  ];
}

export function MonthCloseActions({
  month,
  actorRole,
  status,
  payrollSyncStatus,
  canClose,
  blockerSummary,
  lockReason,
  pendingReopenRequest
}: {
  month: string;
  actorRole: string;
  status: "OPEN" | "CLOSED";
  payrollSyncStatus: "PENDING" | "APPLIED";
  canClose: boolean;
  blockerSummary: MonthCloseBlockerSummary;
  lockReason?: string | null;
  pendingReopenRequest?: {
    requestId: string;
    reason: string;
    requestedByName: string | null;
    requestedAt: Date;
  } | null;
}) {
  const { isPending, message, run } = useActionRefresh();
  const [reason, setReason] = useState("");
  const canDirectReopen = actorRole === "ADMIN";
  const blockerItems = monthCloseBlockerItems(blockerSummary);
  const firstOpenBlocker = blockerItems.find((item) => item.value > 0) ?? null;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card">
        <strong>{status === "CLOSED" ? "재오픈 진행 순서" : "월 마감 진행 순서"}</strong>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          {status === "CLOSED"
            ? canDirectReopen
              ? "1. 재오픈 사유를 적습니다. 2. 바로 재오픈하거나 요청을 승인/반려합니다. 3. 수정이 끝나면 다시 월 마감을 진행합니다."
              : "1. 재오픈 요청 사유를 적습니다. 2. 재오픈 요청을 보냅니다. 3. 관리자 승인 후 수정을 진행합니다."
            : "1. 아래 확인 항목을 모두 0건으로 맞춥니다. 2. 마감 메모를 남깁니다. 3. 월 마감을 확정합니다."}
        </p>
      </div>
      <div className="card">
        <strong>{status === "CLOSED" ? "재오픈 시 영향" : "마감 후 영향"}</strong>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          {status === "CLOSED"
            ? "재오픈하면 출퇴근 기록, 승인, 스케줄 수정이 다시 가능해지고 급여 반영 상태는 다시 점검 대상으로 돌아갑니다."
            : "월 마감을 확정하면 해당 월의 출퇴근 수정, 새 승인 요청, 스케줄 변경이 잠기고 내보내기와 이력 조회 중심으로 전환됩니다."}
        </p>
      </div>

      <div className="grid-4">
        {blockerItems.map((item) => (
          <a className="metric interactive-card" key={item.label} href={item.href} style={{ textDecoration: "none", color: "inherit" }}>
            <span>{item.label}</span>
            <strong style={{ fontSize: 22 }}>{item.value}</strong>
          </a>
        ))}
      </div>
      <div className="card">
        <strong>마감 전 체크리스트</strong>
        <div className="stack" style={{ gap: 10, marginTop: 12 }}>
          {blockerItems.map((item) => (
            <a
              className="notification-card read"
              key={`month-close-check-${item.key}`}
              href={item.href}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div>
                <strong>
                  {item.label} · {item.value}건
                </strong>
                <p className="muted" style={{ margin: "6px 0 0" }}>{item.description}</p>
                <p className="muted" style={{ margin: "6px 0 0" }}>다음 조치: {item.nextStep}</p>
              </div>
              <span className={`status-pill ${item.value === 0 ? "green" : "yellow"}`}>
                {item.value === 0 ? "정리됨" : "확인 필요"}
              </span>
            </a>
          ))}
        </div>
      </div>

      {status === "CLOSED" ? (
        <>
          <div className="field">
            <label htmlFor={`month-close-reopen-${month}`}>{canDirectReopen ? "재오픈 사유" : "재오픈 요청 사유"}</label>
            <textarea
              id={`month-close-reopen-${month}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                canDirectReopen
                  ? "정산 수정, 누락 보정 등 재오픈 이유를 남겨주세요."
                  : "왜 다시 열어야 하는지 관리자에게 전달할 내용을 적어주세요."
              }
            />
          </div>
          {!canDirectReopen && !pendingReopenRequest ? (
            <p className="muted" style={{ margin: 0 }}>
              직접 재오픈은 관리자만 할 수 있습니다. 필요한 경우 사유를 적고 재오픈 요청을 보내세요.
            </p>
          ) : null}
          {pendingReopenRequest ? (
            <div className="card">
              <strong>재오픈 승인 대기</strong>
              <p className="muted" style={{ margin: "8px 0 0" }}>
                {pendingReopenRequest.requestedByName ?? "요청자"} · {new Date(pendingReopenRequest.requestedAt).toLocaleString("ko-KR")}
              </p>
              <p style={{ marginBottom: 0 }}>{pendingReopenRequest.reason}</p>
            </div>
          ) : null}
          {canDirectReopen ? (
            pendingReopenRequest ? (
              <div className="actions-row">
                <button
                  className="button"
                  type="button"
                  data-testid="month-close-approve-reopen"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      () =>
                        postJson("/api/reports/month-close", {
                          month,
                          action: "approveReopen",
                          requestId: pendingReopenRequest.requestId,
                          reason
                        }),
                      "재오픈 요청을 승인했습니다."
                    )
                  }
                >
                  재오픈 승인
                </button>
                <button
                  className="button danger"
                  type="button"
                  data-testid="month-close-reject-reopen"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      () =>
                        postJson("/api/reports/month-close", {
                          month,
                          action: "rejectReopen",
                          requestId: pendingReopenRequest.requestId,
                          reason
                        }),
                      "재오픈 요청을 반려했습니다."
                    )
                  }
                >
                  재오픈 반려
                </button>
              </div>
            ) : (
              <button
                className="button secondary"
                type="button"
                data-testid="month-close-direct-reopen"
                disabled={isPending || reason.trim().length === 0}
                onClick={() =>
                  run(
                    () =>
                      postJson("/api/reports/month-close", {
                        month,
                        action: "reopen",
                        reason
                      }),
                    "월 마감을 재오픈했습니다."
                  )
                }
              >
                바로 재오픈
              </button>
            )
          ) : pendingReopenRequest ? null : (
            <button
              className="button secondary"
              type="button"
              data-testid="month-close-request-reopen"
              disabled={isPending || reason.trim().length === 0}
              onClick={() =>
                run(
                  () =>
                      postJson("/api/reports/month-close", {
                        month,
                        action: "requestReopen",
                        reason
                      }),
                    "재오픈 요청을 등록했습니다."
                  )
              }
            >
              재오픈 요청 보내기
            </button>
          )}
          <button
            className="button"
            type="button"
            data-testid="month-close-payroll-toggle"
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                      postJson("/api/reports/month-close", {
                        month,
                        action: payrollSyncStatus === "APPLIED" ? "markPayrollPending" : "applyPayroll",
                        reason
                      }),
                payrollSyncStatus === "APPLIED" ? "급여 반영 완료 표시를 해제했습니다." : "급여 반영 완료로 표시했습니다."
              )
            }
          >
            {payrollSyncStatus === "APPLIED" ? "급여 반영 표시 해제" : "급여 반영 완료로 표시"}
          </button>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor={`month-close-lock-${month}`}>마감 메모</label>
            <textarea
              id={`month-close-lock-${month}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={lockReason ?? "마감 기준, 최종 확인 메모를 남겨주세요."}
            />
          </div>
          <button
            className="button"
            type="button"
            data-testid="month-close-confirm"
            disabled={isPending || !canClose}
            onClick={() =>
              run(
                () =>
                  postJson("/api/reports/month-close", {
                    month,
                    action: "close",
                    reason
                  }),
                "월 마감을 확정했습니다."
              )
            }
          >
            월 마감 확정
          </button>
        </>
      )}

      {!canClose && status !== "CLOSED" ? (
        <div className="empty">
          {firstOpenBlocker
            ? `${firstOpenBlocker.label} ${firstOpenBlocker.value}건이 남아 있어 아직 월 마감을 확정할 수 없습니다.`
            : "위 확인 항목이 모두 0건이 되면 월 마감을 확정할 수 있습니다."}
        </div>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

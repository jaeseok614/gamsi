import {
  AnnouncementAudience,
  DocumentApprovalStepStatus,
  DocumentRequestStatus,
  NotificationType,
  PayrollStatementStatus,
  PerformanceOwnerType,
  Prisma,
  Role,
  WorkThreadTargetType,
  type User
} from "@/generated/prisma";

import { canManage, canViewReports } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import {
  announcementCategoryLabel,
  documentCategoryLabel,
  documentStatusLabel,
  libraryCategoryLabel,
  payrollStatementStatusLabel,
  workThreadStatusLabel
} from "@/lib/display-labels";
import { getManagedUsers } from "@/lib/manager";
import { createNotifications } from "@/lib/notifications";
import { getPayrollStatement } from "@/lib/payroll-statements";
import { prisma } from "@/lib/prisma";
import { getAuditPayloadRecord, getLatestAuditSnapshot, writeAuditSnapshot } from "@/lib/settings-store";
import { getKstDateString } from "@/lib/time";
import { ensureWorkThreadForDocumentRequest } from "@/lib/workbox";

type Actor = Pick<User, "id" | "companyId" | "role" | "teamId" | "name">;
type GroupwareSearchResult = {
  type: "USER" | "ANNOUNCEMENT" | "MEMO" | "DOCUMENT" | "PAYROLL" | "LIBRARY";
  label: string;
  title: string;
  description: string;
  href: string;
};
type GroupwareSearchType = "ALL" | "USER" | "ANNOUNCEMENT" | "BOARD" | "MEMO" | "DOCUMENT" | "PAYROLL" | "LIBRARY";
type GroupwareSearchFilters = {
  search?: string | null;
  type?: string | null;
  category?: string | null;
  authorId?: string | null;
  from?: string | null;
  to?: string | null;
};
type GroupwareOperationFilters = {
  action?: string | null;
  actorId?: string | null;
  from?: string | null;
  to?: string | null;
};
type GroupwareLibraryStatus = "ACTIVE" | "ARCHIVED";
type NormalizedGroupwareSearchFilters = {
  search: string;
  type: GroupwareSearchType;
  category: string;
  authorId: string;
  from: string;
  to: string;
};
type GroupwareSearchPreset = {
  id: string;
  name: string;
  filters: NormalizedGroupwareSearchFilters;
};
type GroupwareRecentSearch = NormalizedGroupwareSearchFilters & {
  id: string;
  label: string;
  searchedAt: string;
};
type GroupwareSearchPreferences = {
  presets: GroupwareSearchPreset[];
  recentSearches: GroupwareRecentSearch[];
};

function addMonths(monthString: string, offset: number) {
  const [year, month] = monthString.split("-").map(Number);
  const monthIndex = year * 12 + (month - 1) + offset;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = (monthIndex % 12 + 12) % 12 + 1;
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}`;
}

export async function canCreateProfileMemo(actor: Actor, targetUserId: string) {
  if (actor.role === "ADMIN" || actor.role === "HR" || actor.id === targetUserId) {
    return true;
  }

  if (!canManage(actor.role)) {
    return false;
  }

  const managedUsers = await getManagedUsers(actor);
  return managedUsers.some((user) => user.id === targetUserId);
}

async function visibleProfileMemoUserIds(actor: Actor) {
  if (actor.role === "ADMIN" || actor.role === "HR") {
    const users = await prisma.user.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true
      },
      select: {
        id: true
      }
    });
    return new Set(users.map((user) => user.id));
  }

  if (canManage(actor.role)) {
    const managedUsers = await getManagedUsers(actor);
    return new Set([actor.id, ...managedUsers.map((user) => user.id)]);
  }

  return new Set([actor.id]);
}

function assertManagerOrAbove(actor: Actor) {
  if (!canManage(actor.role)) {
    throw new Error("관리자, 인사 담당 또는 팀장 권한이 필요합니다.");
  }
}

async function managedUserIds(actor: Actor) {
  if (actor.role === "ADMIN" || actor.role === "HR") {
    const users = await prisma.user.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true
      },
      select: {
        id: true
      }
    });
    return users.map((user) => user.id);
  }

  if (!canManage(actor.role)) {
    return [actor.id];
  }

  const users = await getManagedUsers(actor);
  return [actor.id, ...users.map((user) => user.id)];
}

async function visibleTeamIds(actor: Actor) {
  if (actor.role === "ADMIN" || actor.role === "HR") {
    const teams = await prisma.team.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true
      },
      select: {
        id: true
      }
    });
    return teams.map((team) => team.id);
  }

  if (!canManage(actor.role)) {
    return actor.teamId ? [actor.teamId] : [];
  }

  const teams = await prisma.team.findMany({
    where: {
      companyId: actor.companyId,
      isActive: true,
      OR: [{ managerUserId: actor.id }, actor.teamId ? { id: actor.teamId } : { id: "__none__" }]
    },
    select: {
      id: true
    }
  });
  return teams.map((team) => team.id);
}

async function announcementRecipientIds(actor: Actor, input: { audience: AnnouncementAudience; teamId?: string | null }) {
  const where =
    input.audience === AnnouncementAudience.TEAM
      ? {
          companyId: actor.companyId,
          isActive: true,
          teamId: input.teamId ?? "__none__"
        }
      : {
          companyId: actor.companyId,
          isActive: true
        };
  const users = await prisma.user.findMany({
    where,
    select: {
      id: true
    }
  });
  return users.map((user) => user.id);
}

function normalizeAnnouncementCategory(value?: string | null) {
  const category = value?.trim().toUpperCase();
  if (category === "RESOURCE" || category === "TEAM" || category === "HR") {
    return category;
  }
  return "NOTICE";
}

function normalizeDocumentCategory(value?: string | null) {
  const category = value?.trim().toUpperCase();
  if (category === "EXPENSE" || category === "PURCHASE") {
    return category;
  }
  return "GENERAL";
}

function normalizeLibraryCategory(value?: string | null) {
  const category = value?.trim().toUpperCase();
  if (category === "CONTRACT" || category === "LEAVE" || category === "PAYROLL" || category === "FORM") {
    return category;
  }
  return "POLICY";
}

function normalizeLibraryAccessScope(value?: string | null) {
  const scope = value?.trim().toUpperCase();
  if (scope === "TEAM" || scope === "HR") {
    return scope;
  }
  return "ALL";
}

function parseOptionalDateTime(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseSearchDate(value?: string | null, endOfDay = false) {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (endOfDay) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function searchDateRange(input: Pick<GroupwareSearchFilters, "from" | "to">) {
  const gte = parseSearchDate(input.from);
  const lte = parseSearchDate(input.to, true);
  return {
    ...(gte ? { gte } : {}),
    ...(lte ? { lte } : {})
  };
}

function operationDateRange(input: Pick<GroupwareOperationFilters, "from" | "to">) {
  const gte = parseSearchDate(input.from);
  const lte = parseSearchDate(input.to, true);
  return {
    ...(gte ? { gte } : {}),
    ...(lte ? { lte } : {})
  };
}

function normalizeSearchType(value?: string | null): GroupwareSearchType {
  const type = value?.trim().toUpperCase();
  if (type === "USER" || type === "ANNOUNCEMENT" || type === "BOARD" || type === "MEMO" || type === "DOCUMENT" || type === "PAYROLL" || type === "LIBRARY") {
    return type;
  }
  return "ALL";
}

function normalizeLibraryStatus(value?: string | null): GroupwareLibraryStatus {
  return value?.trim().toUpperCase() === "ARCHIVED" ? "ARCHIVED" : "ACTIVE";
}

function normalizeGroupwareSearchFilters(filters?: GroupwareSearchFilters | null): NormalizedGroupwareSearchFilters {
  return {
    search: filters?.search?.trim() ?? "",
    type: normalizeSearchType(filters?.type),
    category: filters?.category?.trim().toUpperCase() || "ALL",
    authorId: filters?.authorId?.trim() || "",
    from: filters?.from?.trim() || "",
    to: filters?.to?.trim() || ""
  };
}

function hasMeaningfulSearchFilters(filters: NormalizedGroupwareSearchFilters) {
  return Boolean(
    filters.search.length >= 2 ||
      filters.type !== "ALL" ||
      (filters.category && filters.category !== "ALL") ||
      filters.authorId ||
      filters.from ||
      filters.to
  );
}

function csvEscape(value: unknown) {
  const text = value instanceof Date ? value.toISOString() : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRows(rows: unknown[][]) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function isPublishedAnnouncement(announcement: { publishAt?: Date | null }) {
  return !announcement.publishAt || announcement.publishAt <= new Date();
}

const announcementExpiryAction = "announcement.expiry.saved";
const libraryPinAction = "document_library.pin.saved";
const libraryArchiveAction = "document_library.archive.saved";
const libraryVersionVisibilityAction = "document_library.version.visibility.saved";
const libraryAccessDeniedAction = "document_library.access.denied";
const groupwareAuditAlertAction = "groupware.audit_alert.sent";
const documentApprovalLineChangedAction = "document_request.approval_line.changed";
const documentReviewedAction = "document_request.reviewed";
const documentDelegatedReviewedAction = "document_request.delegated_reviewed";
const documentResubmittedAction = "document_request.resubmitted";
const groupwareSearchPreferenceAction = "groupware.search.preferences.saved";
const groupwareOperationActions = [
  "announcement.created",
  "announcement.updated",
  "announcement.deleted",
  "announcement.reminded",
  "announcement_comment.deleted",
  announcementExpiryAction,
  libraryPinAction,
  libraryArchiveAction,
  libraryVersionVisibilityAction,
  libraryAccessDeniedAction,
  groupwareAuditAlertAction,
  "document_library.version.created",
  "document_library.item.updated",
  documentApprovalLineChangedAction,
  documentReviewedAction,
  documentDelegatedReviewedAction,
  documentResubmittedAction
] as const;
const groupwareAttachmentDownloadTargets = [
  "announcement_attachment",
  "document_attachment",
  "document_library_version"
] as const;

function groupwareDashboardHref(params: {
  tab: "announcements" | "library" | "documents" | "operations";
  announcementId?: string | null;
  libraryItemId?: string | null;
  documentId?: string | null;
  hash: string;
}) {
  const search = new URLSearchParams();
  search.set("view", "groupware");
  search.set("groupwareTab", params.tab);
  if (params.announcementId) {
    search.set("groupwareAnnouncementId", params.announcementId);
  }
  if (params.libraryItemId) {
    search.set("groupwareLibraryItemId", params.libraryItemId);
  }
  if (params.documentId) {
    search.set("groupwareDocumentId", params.documentId);
  }
  return `/dashboard?${search.toString()}#${params.hash}`;
}

function parseAuditDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function saveAnnouncementExpiry(actor: Actor, announcementId: string, expiresAt: Date | null) {
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: announcementExpiryAction,
    targetType: "announcement",
    targetId: announcementId,
    payload: {
      expiresAt: expiresAt ? expiresAt.toISOString() : null
    }
  });
}

async function getAnnouncementExpiryMap(companyId: string, announcementIds: string[]) {
  if (announcementIds.length === 0) {
    return new Map<string, Date | null>();
  }
  const rows = await prisma.auditLog.findMany({
    where: {
      companyId,
      action: announcementExpiryAction,
      targetType: "announcement",
      targetId: {
        in: announcementIds
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  const expiresAtByAnnouncementId = new Map<string, Date | null>();
  for (const row of rows) {
    if (!expiresAtByAnnouncementId.has(row.targetId)) {
      expiresAtByAnnouncementId.set(row.targetId, parseAuditDate(getAuditPayloadRecord(row.payload)?.expiresAt));
    }
  }
  return expiresAtByAnnouncementId;
}

async function saveLibraryPin(actor: Actor, itemId: string, isPinned: boolean, title?: string | null) {
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: libraryPinAction,
    targetType: "document_library_item",
    targetId: itemId,
    payload: {
      isPinned,
      title: title ?? null
    }
  });
}

async function getLibraryPinMap(companyId: string, itemIds: string[]) {
  if (itemIds.length === 0) {
    return new Map<string, boolean>();
  }
  const rows = await prisma.auditLog.findMany({
    where: {
      companyId,
      action: libraryPinAction,
      targetType: "document_library_item",
      targetId: {
        in: itemIds
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  const pinnedByItemId = new Map<string, boolean>();
  for (const row of rows) {
    if (!pinnedByItemId.has(row.targetId)) {
      pinnedByItemId.set(row.targetId, getAuditPayloadRecord(row.payload)?.isPinned === true);
    }
  }
  return pinnedByItemId;
}

async function saveLibraryArchive(actor: Actor, itemId: string, isArchived: boolean, title?: string | null) {
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: libraryArchiveAction,
    targetType: "document_library_item",
    targetId: itemId,
    payload: {
      isArchived,
      title: title ?? null
    }
  });
}

async function getLibraryArchiveMap(companyId: string, itemIds: string[]) {
  if (itemIds.length === 0) {
    return new Map<string, boolean>();
  }
  const rows = await prisma.auditLog.findMany({
    where: {
      companyId,
      action: libraryArchiveAction,
      targetType: "document_library_item",
      targetId: {
        in: itemIds
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  const archivedByItemId = new Map<string, boolean>();
  for (const row of rows) {
    if (!archivedByItemId.has(row.targetId)) {
      archivedByItemId.set(row.targetId, getAuditPayloadRecord(row.payload)?.isArchived === true);
    }
  }
  return archivedByItemId;
}

async function saveLibraryVersionVisibility(actor: Actor, versionId: string, isHidden: boolean, title?: string | null) {
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: libraryVersionVisibilityAction,
    targetType: "document_library_version",
    targetId: versionId,
    payload: {
      isHidden,
      title: title ?? null
    }
  });
}

async function getLibraryVersionHiddenMap(companyId: string, versionIds: string[]) {
  if (versionIds.length === 0) {
    return new Map<string, boolean>();
  }
  const rows = await prisma.auditLog.findMany({
    where: {
      companyId,
      action: libraryVersionVisibilityAction,
      targetType: "document_library_version",
      targetId: {
        in: versionIds
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  const hiddenByVersionId = new Map<string, boolean>();
  for (const row of rows) {
    if (!hiddenByVersionId.has(row.targetId)) {
      hiddenByVersionId.set(row.targetId, getAuditPayloadRecord(row.payload)?.isHidden === true);
    }
  }
  return hiddenByVersionId;
}

function announcementGroupwareHref(category?: string | null, announcementId?: string | null) {
  return category === "TEAM"
    ? groupwareDashboardHref({
        tab: "announcements",
        announcementId,
        hash: "groupware-board"
      })
    : groupwareDashboardHref({
        tab: "announcements",
        announcementId,
        hash: "groupware-announcements"
      });
}

function libraryGroupwareHref(itemId?: string | null) {
  return groupwareDashboardHref({
    tab: "library",
    libraryItemId: itemId,
    hash: "groupware-library"
  });
}

function documentGroupwareHref(documentId?: string | null) {
  return groupwareDashboardHref({
    tab: "documents",
    documentId,
    hash: "groupware-documents"
  });
}

function searchPresetId() {
  return `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseSearchPreferenceFilters(value: unknown): NormalizedGroupwareSearchFilters {
  const record = getAuditPayloadRecord(value);
  return normalizeGroupwareSearchFilters({
    search: typeof record?.search === "string" ? record.search : "",
    type: typeof record?.type === "string" ? record.type : "ALL",
    category: typeof record?.category === "string" ? record.category : "ALL",
    authorId: typeof record?.authorId === "string" ? record.authorId : "",
    from: typeof record?.from === "string" ? record.from : "",
    to: typeof record?.to === "string" ? record.to : ""
  });
}

function parseGroupwareSearchPreferences(payload: unknown): GroupwareSearchPreferences {
  const record = getAuditPayloadRecord(payload);
  const presets = Array.isArray(record?.presets)
    ? record.presets
        .map((entry) => {
          const item = getAuditPayloadRecord(entry);
          const id = typeof item?.id === "string" && item.id.trim() ? item.id.trim() : "";
          const name = typeof item?.name === "string" && item.name.trim() ? item.name.trim() : "";
          if (!id || !name) {
            return null;
          }
          return {
            id,
            name,
            filters: parseSearchPreferenceFilters(item?.filters)
          } satisfies GroupwareSearchPreset;
        })
        .filter((entry): entry is GroupwareSearchPreset => Boolean(entry))
        .slice(0, 10)
    : [];
  const recentSearches = Array.isArray(record?.recentSearches)
    ? record.recentSearches
        .map((entry) => {
          const item = getAuditPayloadRecord(entry);
          const id = typeof item?.id === "string" && item.id.trim() ? item.id.trim() : "";
          const label = typeof item?.label === "string" && item.label.trim() ? item.label.trim() : "";
          const searchedAt = typeof item?.searchedAt === "string" && item.searchedAt.trim() ? item.searchedAt.trim() : "";
          if (!id || !label || !searchedAt) {
            return null;
          }
          return {
            id,
            label,
            searchedAt,
            ...parseSearchPreferenceFilters(item)
          } satisfies GroupwareRecentSearch;
        })
        .filter((entry): entry is GroupwareRecentSearch => Boolean(entry))
        .slice(0, 8)
    : [];

  return {
    presets,
    recentSearches
  };
}

async function getGroupwareSearchPreferences(actor: Actor): Promise<GroupwareSearchPreferences> {
  const latest = await getLatestAuditSnapshot({
    companyId: actor.companyId,
    action: groupwareSearchPreferenceAction,
    targetType: "groupware_search_preferences",
    targetId: actor.id
  });
  return parseGroupwareSearchPreferences(latest?.payload);
}

async function writeGroupwareSearchPreferences(actor: Actor, preferences: GroupwareSearchPreferences) {
  await writeAuditSnapshot({
    actor,
    action: groupwareSearchPreferenceAction,
    targetType: "groupware_search_preferences",
    targetId: actor.id,
    payload: {
      presets: preferences.presets,
      recentSearches: preferences.recentSearches
    }
  });
}

function groupwareSearchLabel(filters: NormalizedGroupwareSearchFilters) {
  const parts = [
    filters.search || null,
    filters.type !== "ALL" ? filters.type : null,
    filters.category !== "ALL" ? filters.category : null,
    filters.authorId ? "작성자 지정" : null,
    filters.from || filters.to ? `${filters.from || "시작"}~${filters.to || "종료"}` : null
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ") || "필터 검색";
}

async function recordGroupwareRecentSearch(actor: Actor, filters: NormalizedGroupwareSearchFilters) {
  if (!hasMeaningfulSearchFilters(filters)) {
    return;
  }

  const preferences = await getGroupwareSearchPreferences(actor);
  const fingerprint = JSON.stringify(filters);
  const currentFirst = preferences.recentSearches[0];
  if (currentFirst && JSON.stringify({
    search: currentFirst.search,
    type: currentFirst.type,
    category: currentFirst.category,
    authorId: currentFirst.authorId,
    from: currentFirst.from,
    to: currentFirst.to
  }) === fingerprint) {
    return;
  }

  await writeGroupwareSearchPreferences(actor, {
    presets: preferences.presets,
    recentSearches: [
      {
        ...filters,
        id: searchPresetId(),
        label: groupwareSearchLabel(filters),
        searchedAt: new Date().toISOString()
      },
      ...preferences.recentSearches.filter((recent) => JSON.stringify({
        search: recent.search,
        type: recent.type,
        category: recent.category,
        authorId: recent.authorId,
        from: recent.from,
        to: recent.to
      }) !== fingerprint)
    ].slice(0, 8)
  });
}

export async function saveGroupwareSearchPreset(actor: Actor, input: {
  name?: string | null;
  filters?: GroupwareSearchFilters | null;
}) {
  const name = input.name?.trim() || "저장한 검색";
  const filters = normalizeGroupwareSearchFilters(input.filters);
  if (!hasMeaningfulSearchFilters(filters)) {
    throw new Error("저장할 검색 조건을 먼저 입력하세요.");
  }
  const preferences = await getGroupwareSearchPreferences(actor);
  const nextPresets = [
    {
      id: searchPresetId(),
      name: name.slice(0, 40),
      filters
    },
    ...preferences.presets
  ].slice(0, 10);
  const next = {
    presets: nextPresets,
    recentSearches: preferences.recentSearches
  };
  await writeGroupwareSearchPreferences(actor, next);
  return next;
}

export async function deleteGroupwareSearchPreset(actor: Actor, presetId: string) {
  const preferences = await getGroupwareSearchPreferences(actor);
  const next = {
    presets: preferences.presets.filter((preset) => preset.id !== presetId),
    recentSearches: preferences.recentSearches
  };
  await writeGroupwareSearchPreferences(actor, next);
  return next;
}

async function markGroupwareDetailNotificationsRead(actor: Actor, input: {
  announcementId?: string | null;
  libraryItemId?: string | null;
  documentId?: string | null;
}) {
  const conditions: Prisma.NotificationWhereInput[] = [];
  if (input.announcementId) {
    conditions.push({
      metadata: {
        path: ["announcementId"],
        equals: input.announcementId
      }
    });
  }
  if (input.libraryItemId) {
    conditions.push({
      metadata: {
        path: ["libraryItemId"],
        equals: input.libraryItemId
      }
    });
  }
  if (input.documentId) {
    conditions.push({
      metadata: {
        path: ["documentRequestId"],
        equals: input.documentId
      }
    });
  }
  if (conditions.length === 0) {
    return;
  }

  await prisma.notification.updateMany({
    where: {
      companyId: actor.companyId,
      userId: actor.id,
      isRead: false,
      OR: conditions
    },
    data: {
      isRead: true,
      readAt: new Date()
    }
  });
}

function payloadString(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function groupwareOperationLabel(action: string) {
  const labels: Record<string, string> = {
    "announcement.created": "게시물 등록",
    "announcement.updated": "게시물 수정",
    "announcement.deleted": "게시물 삭제",
    "announcement.reminded": "미확인 재알림",
    "announcement_comment.deleted": "댓글 삭제",
    [announcementExpiryAction]: "공지 만료일 변경",
    [libraryPinAction]: "자료 중요 표시 변경",
    [libraryArchiveAction]: "자료 보관 상태 변경",
    [libraryVersionVisibilityAction]: "자료 버전 공개 상태 변경",
    [libraryAccessDeniedAction]: "자료 접근 차단",
    [groupwareAuditAlertAction]: "운영 알림 발송",
    "document_library.version.created": "자료 등록",
    "document_library.item.updated": "자료 정보 수정",
    [documentApprovalLineChangedAction]: "결재선 변경",
    [documentReviewedAction]: "전자결재 처리",
    [documentDelegatedReviewedAction]: "대리 결재 처리",
    [documentResubmittedAction]: "전자결재 재상신",
    "attachment.downloaded": "파일 다운로드"
  };
  return labels[action] ?? action;
}

function groupwareOperationDetail(input: {
  action: string;
  targetType: string;
  targetId: string;
  payload: Prisma.JsonValue | null;
}) {
  const payload = getAuditPayloadRecord(input.payload);
  const title = payloadString(payload, "title") ?? payloadString(payload, "announcementTitle");
  const originalName = payloadString(payload, "originalName");

  if (input.action === "attachment.downloaded") {
    const sourceType = payloadString(payload, "sourceType");
    if (sourceType === "document_library") {
      return originalName ? `자료실 파일 ${originalName}` : "자료실 파일 다운로드";
    }
    if (sourceType === "document_request") {
      return originalName ? `전자결재 첨부 ${originalName}` : "전자결재 첨부 다운로드";
    }
    return originalName ? `첨부파일 ${originalName}` : "첨부파일 다운로드";
  }

  if (input.action === announcementExpiryAction) {
    const expiresAt = payloadString(payload, "expiresAt");
    return expiresAt ? `만료일 ${expiresAt.slice(0, 10)} 설정` : "만료일 해제";
  }

  if (input.action === libraryPinAction) {
    return payload?.isPinned === true ? "중요 자료로 표시" : "중요 표시 해제";
  }

  if (input.action === libraryArchiveAction) {
    return payload?.isArchived === true ? `${title ?? "자료"} 보관 처리` : `${title ?? "자료"} 보관 해제`;
  }

  if (input.action === libraryVersionVisibilityAction) {
    return payload?.isHidden === true ? `${title ?? "자료 버전"} 숨김` : `${title ?? "자료 버전"} 복구`;
  }

  if (input.action === libraryAccessDeniedAction) {
    const reason = payloadString(payload, "reason");
    const userName = payloadString(payload, "userName");
    return `${title ?? "자료"} 접근 차단${userName ? ` · ${userName}` : ""}${reason ? ` · ${reason}` : ""}`;
  }

  if (input.action === groupwareAuditAlertAction) {
    return payloadString(payload, "message") ?? payloadString(payload, "title") ?? "운영 알림을 발송했습니다.";
  }

  if (input.action === documentApprovalLineChangedAction) {
    return `${title ?? "전자결재"} · ${payloadString(payload, "stepLabel") ?? "결재선"} 변경`;
  }

  if (input.action === documentReviewedAction || input.action === documentDelegatedReviewedAction) {
    const status = payloadString(payload, "status");
    const delegateName = payloadString(payload, "delegateName");
    return `${title ?? "전자결재"} · ${status === "APPROVED" ? "승인" : "반려"}${delegateName ? ` · ${delegateName} 대신 처리` : ""}`;
  }

  if (input.action === documentResubmittedAction) {
    const newDocumentNumber = payloadString(payload, "newDocumentNumber");
    return `${title ?? "전자결재"} 재상신${newDocumentNumber ? ` · ${newDocumentNumber}` : ""}`;
  }

  if (input.action === "announcement.reminded") {
    const unreadCount = typeof payload?.unreadCount === "number" ? payload.unreadCount : null;
    return `${title ?? "게시물"}${unreadCount !== null ? ` · 대상 ${unreadCount}명` : ""}`;
  }

  if (input.action === "announcement_comment.deleted") {
    const bodyPreview = payloadString(payload, "bodyPreview");
    return `${title ?? "게시물"}${bodyPreview ? ` · ${bodyPreview}` : ""}`;
  }

  if (input.action === "document_library.version.created") {
    const versionNo = typeof payload?.versionNo === "number" ? payload.versionNo : null;
    return `${title ?? "자료"}${versionNo ? ` · v${versionNo}` : ""}${originalName ? ` · ${originalName}` : ""}`;
  }

  if (input.action === "document_library.item.updated") {
    return `${title ?? "자료"} 정보 수정`;
  }

  return title ?? input.targetId;
}

function groupwareOperationWhere(actor: Actor, filters?: GroupwareOperationFilters) {
  const action = filters?.action?.trim();
  const actorId = filters?.actorId?.trim();
  const createdAt = operationDateRange({
    from: filters?.from,
    to: filters?.to
  });
  return {
    companyId: actor.companyId,
    ...(action && action !== "ALL" ? { action } : {}),
    ...(actorId ? { actorUserId: actorId } : {}),
    ...(createdAt.gte || createdAt.lte ? { createdAt } : {}),
    OR: [
      {
        action: {
          in: [...groupwareOperationActions]
        }
      },
      {
        action: "attachment.downloaded",
        targetType: {
          in: [...groupwareAttachmentDownloadTargets]
        }
      }
    ]
  } satisfies Prisma.AuditLogWhereInput;
}

async function getGroupwareOperationRows(actor: Actor, filters?: GroupwareOperationFilters, take = 50) {
  if (!canManage(actor.role)) {
    return [];
  }
  return prisma.auditLog.findMany({
    where: groupwareOperationWhere(actor, filters),
    include: {
      actor: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take
  });
}

function mapGroupwareOperationRow(row: Awaited<ReturnType<typeof getGroupwareOperationRows>>[number]) {
  return {
    id: row.id,
    action: row.action,
    label: groupwareOperationLabel(row.action),
    detail: groupwareOperationDetail({
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      payload: row.payload
    }),
    targetType: row.targetType,
    targetId: row.targetId,
    actor: row.actor,
    createdAt: row.createdAt
  };
}

async function groupwareAuditAlertRecipientIds(companyId: string) {
  const users = await prisma.user.findMany({
    where: {
      companyId,
      isActive: true,
      role: {
        in: [Role.ADMIN, Role.HR]
      }
    },
    select: {
      id: true
    }
  });
  return users.map((user) => user.id);
}

async function sendGroupwareAuditAlert(input: {
  companyId: string;
  actorUserId?: string | null;
  alertType: string;
  targetType: string;
  targetId: string;
  title: string;
  message: string;
  actionUrl: string;
  payload?: Prisma.JsonObject;
}) {
  const today = getKstDateString();
  const alertTargetId = `${input.alertType}:${input.targetId}:${today}`;
  const existing = await prisma.auditLog.findFirst({
    where: {
      companyId: input.companyId,
      action: groupwareAuditAlertAction,
      targetType: input.targetType,
      targetId: alertTargetId
    }
  });
  if (existing) {
    return false;
  }

  const recipientIds = await groupwareAuditAlertRecipientIds(input.companyId);
  await createNotifications({
    companyId: input.companyId,
    userIds: recipientIds,
    type: NotificationType.ANNOUNCEMENT,
    title: input.title,
    message: input.message,
    actionUrl: input.actionUrl,
    metadata: {
      alertType: input.alertType,
      targetType: input.targetType,
      targetId: input.targetId,
      ...(input.payload ?? {})
    } satisfies Prisma.JsonObject
  });
  await writeAuditLog({
    companyId: input.companyId,
    actorUserId: input.actorUserId ?? null,
    action: groupwareAuditAlertAction,
    targetType: input.targetType,
    targetId: alertTargetId,
    payload: {
      alertType: input.alertType,
      title: input.title,
      message: input.message,
      targetId: input.targetId,
      actionUrl: input.actionUrl,
      ...(input.payload ?? {})
    }
  });
  return true;
}

export async function notifyExcessiveLibraryDownloads(actor: Actor, itemId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await prisma.auditLog.count({
    where: {
      companyId: actor.companyId,
      actorUserId: actor.id,
      action: "attachment.downloaded",
      targetType: "document_library_version",
      createdAt: {
        gte: since
      },
      payload: {
        path: ["sourceId"],
        equals: itemId
      }
    }
  });
  if (count < 5) {
    return false;
  }

  const item = await prisma.documentLibraryItem.findFirst({
    where: {
      id: itemId,
      companyId: actor.companyId
    },
    select: {
      title: true
    }
  });
  return sendGroupwareAuditAlert({
    companyId: actor.companyId,
    actorUserId: actor.id,
    alertType: "library_download_spike",
    targetType: "document_library_item",
    targetId: `${itemId}:${actor.id}`,
    title: "자료실 다운로드 집중 발생",
    message: `${actor.name}님이 24시간 안에 ${item?.title ?? "자료"}를 ${count}회 다운로드했습니다.`,
    actionUrl: libraryGroupwareHref(itemId),
    payload: {
      itemId,
      title: item?.title ?? null,
      userId: actor.id,
      userName: actor.name,
      count
    }
  });
}

export async function exportGroupwareOperationLogsCsv(actor: Actor, filters?: GroupwareOperationFilters) {
  assertManagerOrAbove(actor);
  const rows = await getGroupwareOperationRows(actor, filters, 1000);
  return csvRows([
    ["일시", "행위자", "권한", "작업", "상세", "대상유형", "대상ID"],
    ...rows.map((row) => {
      const mapped = mapGroupwareOperationRow(row);
      return [
        mapped.createdAt,
        mapped.actor?.name ?? "시스템",
        mapped.actor?.role ?? "",
        mapped.label,
        mapped.detail,
        mapped.targetType,
        mapped.targetId
      ];
    })
  ]);
}

export async function exportLibraryDownloadLogsCsv(actor: Actor, input?: { itemId?: string | null }) {
  assertManagerOrAbove(actor);
  const itemId = input?.itemId?.trim();
  const versionRows = await prisma.documentLibraryVersion.findMany({
    where: {
      companyId: actor.companyId,
      ...(itemId ? { itemId } : {}),
      item: {
        is: visibleLibraryWhere(actor)
      }
    },
    include: {
      item: true
    },
    take: 1000
  });
  const versionById = new Map(versionRows.map((version) => [version.id, version]));
  const rows = versionRows.length
    ? await prisma.auditLog.findMany({
        where: {
          companyId: actor.companyId,
          action: "attachment.downloaded",
          targetType: "document_library_version",
          targetId: {
            in: versionRows.map((version) => version.id)
          }
        },
        include: {
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 5000
      })
    : [];
  return csvRows([
    ["다운로드일시", "자료명", "버전", "파일명", "다운로드 사용자", "이메일", "권한"],
    ...rows.map((row) => {
      const version = versionById.get(row.targetId);
      const payload = getAuditPayloadRecord(row.payload);
      return [
        row.createdAt,
        version?.item.title ?? "",
        version ? `v${version.versionNo}` : "",
        payloadString(payload, "originalName") ?? version?.originalName ?? "",
        row.actor?.name ?? "시스템",
        row.actor?.email ?? "",
        row.actor?.role ?? ""
      ];
    })
  ]);
}

async function dispatchAnnouncementNotifications(announcementId: string) {
  const announcement = await prisma.announcement.findUnique({
    where: {
      id: announcementId
    }
  });
  if (!announcement || !isPublishedAnnouncement(announcement) || announcement.emailStatus === "sent") {
    return;
  }

  const recipientIds = await announcementRecipientIds(
    {
      id: announcement.authorId,
      companyId: announcement.companyId,
      role: Role.ADMIN,
      teamId: null,
      name: ""
    },
    {
      audience: announcement.audience,
      teamId: announcement.teamId
    }
  );

  await createNotifications({
    companyId: announcement.companyId,
    userIds: recipientIds,
    type: NotificationType.ANNOUNCEMENT,
    title: `${announcement.category === "TEAM" ? "새 게시글" : "새 공지"}: ${announcement.title}`,
    message: announcement.body.slice(0, 140),
    actionUrl: announcementGroupwareHref(announcement.category, announcement.id),
    metadata: {
      announcementId: announcement.id,
      audience: announcement.audience,
      teamId: announcement.teamId,
      category: announcement.category
    } satisfies Prisma.JsonObject
  });
  await prisma.announcement.update({
    where: {
      id: announcement.id
    },
    data: {
      emailStatus: "sent"
    }
  });
}

async function publishDueAnnouncements(companyId: string) {
  const dueAnnouncements = await prisma.announcement.findMany({
    where: {
      companyId,
      emailStatus: "scheduled",
      OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }]
    },
    select: {
      id: true
    },
    take: 20
  });
  await Promise.all(dueAnnouncements.map((announcement) => dispatchAnnouncementNotifications(announcement.id)));
}

export async function createAnnouncement(actor: Actor, input: {
  title: string;
  body: string;
  audience?: string | null;
  teamId?: string | null;
  isPinned?: boolean;
  category?: string | null;
  allowComments?: boolean;
  publishAt?: string | null;
  expiresAt?: string | null;
}) {
  const category = normalizeAnnouncementCategory(input.category);
  if (category !== "TEAM") {
    assertManagerOrAbove(actor);
  }

  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 2) {
    throw new Error(category === "TEAM" ? "게시글 제목을 입력하세요." : "공지 제목을 입력하세요.");
  }
  if (body.length < 2) {
    throw new Error(category === "TEAM" ? "게시글 내용을 입력하세요." : "공지 내용을 입력하세요.");
  }

  const audience = input.audience === "TEAM" ? AnnouncementAudience.TEAM : AnnouncementAudience.ALL;
  const teamId = audience === AnnouncementAudience.TEAM ? input.teamId?.trim() || null : null;
  if (audience === AnnouncementAudience.TEAM) {
    const allowedTeamIds = await visibleTeamIds(actor);
    if (!teamId || !allowedTeamIds.includes(teamId)) {
      throw new Error("공지 대상 팀을 확인하세요.");
    }
  }

  const publishAt = parseOptionalDateTime(input.publishAt);
  const expiresAt = parseOptionalDateTime(input.expiresAt);
  if (publishAt && expiresAt && expiresAt <= publishAt) {
    throw new Error("만료일은 발행일 이후로 설정하세요.");
  }
  const shouldPublishNow = !publishAt || publishAt <= new Date();
  const announcement = await prisma.announcement.create({
    data: {
      companyId: actor.companyId,
      authorId: actor.id,
      audience,
      teamId,
      category,
      title,
      body,
      isPinned: canManage(actor.role) ? Boolean(input.isPinned) : false,
      allowComments: Boolean(input.allowComments),
      publishAt,
      emailStatus: shouldPublishNow ? "not_sent" : "scheduled"
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      },
      team: true,
      attachments: true,
      comments: true
    }
  });
  if (expiresAt) {
    await saveAnnouncementExpiry(actor, announcement.id, expiresAt);
  }
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "announcement.created",
    targetType: "announcement",
    targetId: announcement.id,
    payload: {
      title: announcement.title,
      category: announcement.category,
      audience: announcement.audience,
      teamId: announcement.teamId,
      isPinned: announcement.isPinned,
      publishAt: announcement.publishAt?.toISOString() ?? null,
      expiresAt: expiresAt?.toISOString() ?? null
    }
  });
  await prisma.announcementRead.upsert({
    where: {
      announcementId_userId: {
        announcementId: announcement.id,
        userId: actor.id
      }
    },
    update: {
      readAt: new Date()
    },
    create: {
      companyId: actor.companyId,
      announcementId: announcement.id,
      userId: actor.id
    }
  });
  if (shouldPublishNow) {
    await dispatchAnnouncementNotifications(announcement.id);
  }

  return announcement;
}

function visibleAnnouncementWhere(actor: Actor) {
  return {
    companyId: actor.companyId,
    OR: [
      {
        AND: [
          {
            OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }]
          },
          {
            OR: [
              { audience: AnnouncementAudience.ALL },
              actor.teamId
                ? {
                    audience: AnnouncementAudience.TEAM,
                    teamId: actor.teamId
                  }
                : { id: "__none__" }
            ]
          }
        ]
      },
      { authorId: actor.id },
      canManage(actor.role) ? { id: { not: "__none__" } } : { id: "__none__" }
    ]
  } satisfies Prisma.AnnouncementWhereInput;
}

export async function markAnnouncementRead(actor: Actor, announcementId: string) {
  const announcement = await prisma.announcement.findFirst({
    where: {
      id: announcementId,
      ...visibleAnnouncementWhere(actor)
    }
  });
  if (!announcement) {
    throw new Error("공지사항을 찾을 수 없습니다.");
  }

  return prisma.announcementRead.upsert({
    where: {
      announcementId_userId: {
        announcementId,
        userId: actor.id
      }
    },
    update: {
      readAt: new Date()
    },
    create: {
      companyId: actor.companyId,
      announcementId,
      userId: actor.id
    }
  });
}

export async function createAnnouncementComment(actor: Actor, input: {
  announcementId: string;
  body: string;
}) {
  const body = input.body.trim();
  if (body.length < 2) {
    throw new Error("댓글 내용을 입력하세요.");
  }

  const announcement = await prisma.announcement.findFirst({
    where: {
      id: input.announcementId,
      ...visibleAnnouncementWhere(actor)
    }
  });
  if (!announcement || !announcement.allowComments) {
    throw new Error("댓글을 남길 수 없는 공지입니다.");
  }

  const comment = await prisma.announcementComment.create({
    data: {
      companyId: actor.companyId,
      announcementId: announcement.id,
      authorId: actor.id,
      body
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      }
    }
  });

  const notifyUserIds = [announcement.authorId].filter((userId) => userId !== actor.id);
  await createNotifications({
    companyId: actor.companyId,
    userIds: notifyUserIds,
    type: NotificationType.ANNOUNCEMENT,
    title: `${announcement.category === "TEAM" ? "게시글" : "공지"} 댓글이 등록되었습니다`,
    message: `${actor.name}: ${body.slice(0, 120)}`,
    actionUrl: announcementGroupwareHref(announcement.category, announcement.id),
    metadata: {
      announcementId: announcement.id,
      commentId: comment.id,
      category: announcement.category
    } satisfies Prisma.JsonObject
  });

  return comment;
}

function canModifyAnnouncement(actor: Actor, announcement: { authorId: string; category: string }) {
  return canManage(actor.role) || (announcement.category === "TEAM" && announcement.authorId === actor.id);
}

export async function updateAnnouncement(actor: Actor, input: {
  announcementId: string;
  title?: string | null;
  body?: string | null;
  allowComments?: boolean | null;
  isPinned?: boolean | null;
  expiresAt?: string | null;
}) {
  const announcement = await prisma.announcement.findFirst({
    where: {
      id: input.announcementId,
      companyId: actor.companyId
    }
  });
  if (!announcement || !canModifyAnnouncement(actor, announcement)) {
    throw new Error("게시물을 수정할 권한이 없습니다.");
  }

  const title = input.title?.trim();
  const body = input.body?.trim();
  if (title !== undefined && title.length < 2) {
    throw new Error(announcement.category === "TEAM" ? "게시글 제목을 입력하세요." : "공지 제목을 입력하세요.");
  }
  if (body !== undefined && body.length < 2) {
    throw new Error(announcement.category === "TEAM" ? "게시글 내용을 입력하세요." : "공지 내용을 입력하세요.");
  }

  const expiresAt = input.expiresAt === undefined ? undefined : parseOptionalDateTime(input.expiresAt);
  if (expiresAt && announcement.publishAt && expiresAt <= announcement.publishAt) {
    throw new Error("만료일은 발행일 이후로 설정하세요.");
  }

  const updated = await prisma.announcement.update({
    where: {
      id: announcement.id
    },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(typeof input.allowComments === "boolean" ? { allowComments: input.allowComments } : {}),
      ...(canManage(actor.role) && typeof input.isPinned === "boolean" ? { isPinned: input.isPinned } : {})
    }
  });
  if (expiresAt !== undefined) {
    await saveAnnouncementExpiry(actor, announcement.id, expiresAt);
  }
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "announcement.updated",
    targetType: "announcement",
    targetId: announcement.id,
    payload: {
      title: updated.title,
      category: updated.category,
      updatedFields: [
        title !== undefined ? "title" : null,
        body !== undefined ? "body" : null,
        typeof input.allowComments === "boolean" ? "allowComments" : null,
        canManage(actor.role) && typeof input.isPinned === "boolean" ? "isPinned" : null,
        expiresAt !== undefined ? "expiresAt" : null
      ].filter((value): value is string => Boolean(value))
    }
  });
  return updated;
}

export async function deleteAnnouncement(actor: Actor, announcementId: string) {
  const announcement = await prisma.announcement.findFirst({
    where: {
      id: announcementId,
      companyId: actor.companyId
    }
  });
  if (!announcement || !canModifyAnnouncement(actor, announcement)) {
    throw new Error("게시물을 삭제할 권한이 없습니다.");
  }

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "announcement.deleted",
    targetType: "announcement",
    targetId: announcement.id,
    payload: {
      title: announcement.title,
      category: announcement.category
    }
  });
  await prisma.announcement.delete({
    where: {
      id: announcement.id
    }
  });
  return {
    ok: true
  };
}

export async function deleteAnnouncementComment(actor: Actor, input: {
  announcementId: string;
  commentId: string;
}) {
  const comment = await prisma.announcementComment.findFirst({
    where: {
      id: input.commentId,
      announcementId: input.announcementId,
      companyId: actor.companyId,
      deletedAt: null
    },
    include: {
      announcement: true
    }
  });
  if (!comment || (!canManage(actor.role) && comment.authorId !== actor.id)) {
    throw new Error("댓글을 삭제할 권한이 없습니다.");
  }

  await prisma.announcementComment.update({
    where: {
      id: comment.id
    },
    data: {
      deletedAt: new Date()
    }
  });
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "announcement_comment.deleted",
    targetType: "announcement_comment",
    targetId: comment.id,
    payload: {
      announcementId: comment.announcementId,
      announcementTitle: comment.announcement.title,
      commentId: comment.id,
      authorId: comment.authorId,
      bodyPreview: comment.body.slice(0, 80)
    }
  });
  return {
    ok: true
  };
}

export async function remindAnnouncementUnread(actor: Actor, announcementId: string) {
  if (!canManage(actor.role)) {
    throw new Error("미확인 재알림 권한이 필요합니다.");
  }
  const announcement = await prisma.announcement.findFirst({
    where: {
      id: announcementId,
      companyId: actor.companyId
    },
    include: {
      reads: true
    }
  });
  const expiresAt = announcement ? (await getAnnouncementExpiryMap(actor.companyId, [announcement.id])).get(announcement.id) ?? null : null;
  if (!announcement || !isPublishedAnnouncement(announcement) || (expiresAt && expiresAt <= new Date())) {
    throw new Error("재알림을 보낼 수 없는 게시물입니다.");
  }

  const recipients = await announcementRecipientIds(actor, {
    audience: announcement.audience,
    teamId: announcement.teamId
  });
  const readUserIds = new Set(announcement.reads.map((read) => read.userId));
  const unreadUserIds = recipients.filter((userId) => !readUserIds.has(userId));
  await createNotifications({
    companyId: actor.companyId,
    userIds: unreadUserIds,
    type: NotificationType.ANNOUNCEMENT,
    title: announcement.category === "TEAM" ? "게시글 확인 요청" : "공지 확인 요청",
    message: announcement.title,
    actionUrl: announcementGroupwareHref(announcement.category, announcement.id),
    metadata: {
      announcementId: announcement.id,
      remind: true
    } satisfies Prisma.JsonObject
  });
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "announcement.reminded",
    targetType: "announcement",
    targetId: announcement.id,
    payload: {
      title: announcement.title,
      category: announcement.category,
      unreadCount: unreadUserIds.length
    }
  });

  return {
    count: unreadUserIds.length
  };
}

async function notifyStaleUnreadAnnouncements(actor: Actor) {
  if (!canManage(actor.role)) {
    return;
  }

  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const candidates = await prisma.announcement.findMany({
    where: {
      companyId: actor.companyId,
      category: {
        not: "TEAM"
      },
      OR: [{ publishAt: null }, { publishAt: { lte: cutoff } }]
    },
    include: {
      reads: true
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 20
  });
  const expiresAtById = await getAnnouncementExpiryMap(
    actor.companyId,
    candidates.map((candidate) => candidate.id)
  );

  for (const announcement of candidates) {
    const expiresAt = expiresAtById.get(announcement.id) ?? null;
    if (expiresAt && expiresAt <= new Date()) {
      continue;
    }
    const recipients = await announcementRecipientIds(actor, {
      audience: announcement.audience,
      teamId: announcement.teamId
    });
    const readUserIds = new Set(announcement.reads.map((read) => read.userId));
    const unreadCount = recipients.filter((userId) => !readUserIds.has(userId)).length;
    if (unreadCount === 0) {
      continue;
    }
    await sendGroupwareAuditAlert({
      companyId: actor.companyId,
      actorUserId: actor.id,
      alertType: "announcement_stale_unread",
      targetType: "announcement",
      targetId: announcement.id,
      title: "장기 미확인 공지 점검",
      message: `${announcement.title} 공지를 3일 이상 확인하지 않은 직원이 ${unreadCount}명 있습니다.`,
      actionUrl: announcementGroupwareHref(announcement.category, announcement.id),
      payload: {
        announcementId: announcement.id,
        title: announcement.title,
        unreadCount
      }
    });
  }
}

async function runGroupwareAuditAutomations(actor: Actor) {
  await notifyStaleUnreadAnnouncements(actor);
}

export async function createPerformanceGoal(actor: Actor, input: {
  ownerType?: string | null;
  userId?: string | null;
  teamId?: string | null;
  month: string;
  title: string;
  unit?: string | null;
  targetValue: number;
  actualValue?: number;
  note?: string | null;
}) {
  assertManagerOrAbove(actor);

  const ownerType = input.ownerType === "TEAM" ? PerformanceOwnerType.TEAM : PerformanceOwnerType.USER;
  const month = input.month.trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("실적 목표 월을 확인하세요.");
  }
  const title = input.title.trim();
  if (title.length < 2) {
    throw new Error("실적 목표명을 입력하세요.");
  }
  if (!Number.isFinite(input.targetValue) || input.targetValue <= 0) {
    throw new Error("목표값은 0보다 커야 합니다.");
  }

  let userId: string | null = null;
  let teamId: string | null = null;
  if (ownerType === PerformanceOwnerType.USER) {
    userId = input.userId?.trim() || null;
    const allowedUserIds = await managedUserIds(actor);
    if (!userId || !allowedUserIds.includes(userId)) {
      throw new Error("실적 대상 직원을 확인하세요.");
    }
  } else {
    teamId = input.teamId?.trim() || null;
    const allowedTeamIds = await visibleTeamIds(actor);
    if (!teamId || !allowedTeamIds.includes(teamId)) {
      throw new Error("실적 대상 팀을 확인하세요.");
    }
  }

  return prisma.performanceGoal.create({
    data: {
      companyId: actor.companyId,
      ownerType,
      userId,
      teamId,
      month,
      title,
      unit: input.unit?.trim() || "건",
      targetValue: input.targetValue,
      actualValue: Number.isFinite(input.actualValue) ? input.actualValue ?? 0 : 0,
      note: input.note?.trim() || null,
      createdById: actor.id
    }
  });
}

export async function updatePerformanceGoal(actor: Actor, input: {
  id: string;
  actualValue?: number;
  evaluationMemo?: string | null;
}) {
  const goal = await prisma.performanceGoal.findFirst({
    where: {
      id: input.id,
      companyId: actor.companyId
    }
  });
  if (!goal) {
    throw new Error("실적 목표를 찾을 수 없습니다.");
  }

  const allowedUserIds = await managedUserIds(actor);
  const allowedTeamIds = await visibleTeamIds(actor);
  const canEdit =
    actor.role === "ADMIN" ||
    actor.role === "HR" ||
    goal.createdById === actor.id ||
    (goal.userId ? allowedUserIds.includes(goal.userId) : false) ||
    (goal.teamId ? allowedTeamIds.includes(goal.teamId) : false);
  if (!canEdit) {
    throw new Error("실적 목표를 수정할 권한이 없습니다.");
  }

  return prisma.performanceGoal.update({
    where: {
      id: goal.id
    },
    data: {
      actualValue: Number.isFinite(input.actualValue) ? input.actualValue : goal.actualValue,
      evaluationMemo: input.evaluationMemo?.trim() || goal.evaluationMemo,
      reviewedById: input.evaluationMemo ? actor.id : goal.reviewedById,
      reviewedAt: input.evaluationMemo ? new Date() : goal.reviewedAt
    }
  });
}

export async function issuePayrollStatements(actor: Actor, input: {
  month: string;
  userIds?: string[];
  status?: string | null;
  note?: string | null;
}) {
  if (!canViewReports(actor.role)) {
    throw new Error("급여명세 발행은 인사 담당 또는 관리자만 가능합니다.");
  }
  const month = input.month.trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("급여명세 월을 확인하세요.");
  }
  const users = await prisma.user.findMany({
    where: {
      companyId: actor.companyId,
      isActive: true,
      ...(input.userIds?.length
        ? {
            id: {
              in: input.userIds
            }
          }
        : {})
    },
    select: {
      id: true,
      name: true
    },
    take: 200
  });
  const status = input.status === "LOCKED" ? PayrollStatementStatus.LOCKED : PayrollStatementStatus.PUBLISHED;
  const now = new Date();
  const issues = [];
  for (const user of users) {
    const statement = await getPayrollStatement(actor, {
      month,
      userId: user.id,
      bypassIssueCheck: true
    });
    const issue = await prisma.payrollStatementIssue.upsert({
      where: {
        companyId_userId_month: {
          companyId: actor.companyId,
          userId: user.id,
          month
        }
      },
      update: {
        status,
        snapshot: {
          payableEquivalentMinutes: statement.row.payableEquivalentMinutes,
          calculatedWorkMinutes: statement.row.calculatedWorkMinutes,
          closeStatus: statement.row.closeStatus,
          policyVersion: statement.policy.version
        } satisfies Prisma.JsonObject,
        note: input.note?.trim() || null,
        issuedById: actor.id,
        issuedAt: now,
        lockedById: status === PayrollStatementStatus.LOCKED ? actor.id : null,
        lockedAt: status === PayrollStatementStatus.LOCKED ? now : null
      },
      create: {
        companyId: actor.companyId,
        userId: user.id,
        month,
        status,
        snapshot: {
          payableEquivalentMinutes: statement.row.payableEquivalentMinutes,
          calculatedWorkMinutes: statement.row.calculatedWorkMinutes,
          closeStatus: statement.row.closeStatus,
          policyVersion: statement.policy.version
        } satisfies Prisma.JsonObject,
        note: input.note?.trim() || null,
        issuedById: actor.id,
        issuedAt: now,
        lockedById: status === PayrollStatementStatus.LOCKED ? actor.id : null,
        lockedAt: status === PayrollStatementStatus.LOCKED ? now : null
      }
    });
    issues.push(issue);
  }

  await createNotifications({
    companyId: actor.companyId,
    userIds: users.map((user) => user.id),
    type: NotificationType.PAYROLL_STATEMENT,
    title: `${month} 급여명세가 발행되었습니다`,
    message: "그룹웨어 급여명세 탭에서 PDF 또는 CSV로 내려받을 수 있습니다.",
    actionUrl: "/dashboard?view=groupware&groupwareTab=operations#groupware-payroll-statements",
    metadata: {
      month,
      issueCount: issues.length
    } satisfies Prisma.JsonObject
  });

  return {
    count: issues.length,
    issues
  };
}

async function defaultDocumentReviewer(actor: Actor) {
  const users = await prisma.user.findMany({
    where: {
      companyId: actor.companyId,
      isActive: true,
      OR: [
        { role: "ADMIN" },
        { role: "HR" },
        actor.teamId
          ? {
              managedTeams: {
                some: {
                  id: actor.teamId
                }
              }
            }
          : { id: "__none__" }
      ]
    },
    select: {
      id: true
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }]
  });
  return users.find((user) => user.id !== actor.id)?.id ?? null;
}

async function generateDocumentNumber(companyId: string) {
  const month = getKstDateString().slice(0, 7).replace("-", "");
  const count = await prisma.documentRequest.count({
    where: {
      companyId,
      documentNumber: {
        startsWith: `DOC-${month}-`
      }
    }
  });
  return `DOC-${month}-${String(count + 1).padStart(4, "0")}`;
}

async function findFirstRoleUser(companyId: string, role: Role) {
  return prisma.user.findFirst({
    where: {
      companyId,
      role,
      isActive: true
    },
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      role: true
    }
  });
}

async function buildDocumentApprovalSteps(actor: Actor, fallbackReviewerId?: string | null, explicitApproverIds?: string[]) {
  const normalizedExplicitIds = [...new Set((explicitApproverIds ?? []).map((id) => id.trim()).filter(Boolean))];
  if (normalizedExplicitIds.length > 0) {
    const approvers = await prisma.user.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true,
        id: {
          in: normalizedExplicitIds
        },
        role: {
          in: [Role.ADMIN, Role.HR, Role.MANAGER]
        }
      },
      select: {
        id: true,
        role: true
      }
    });
    const approverById = new Map(approvers.map((approver) => [approver.id, approver]));
    const steps = normalizedExplicitIds
      .map((approverId, index) => {
        const approver = approverById.get(approverId);
        if (!approver || approver.id === actor.id) {
          return null;
        }
        return {
          label: `${index + 1}차 결재`,
          approverId: approver.id,
          approverRole: approver.role
        };
      })
      .filter((step): step is { label: string; approverId: string; approverRole: Role } => Boolean(step));
    if (steps.length > 0) {
      return steps;
    }
  }

  const requester = await prisma.user.findUnique({
    where: {
      id: actor.id
    },
    include: {
      team: {
        include: {
          manager: {
            select: {
              id: true,
              role: true
            }
          }
        }
      }
    }
  });
  const hr = await findFirstRoleUser(actor.companyId, Role.HR);
  const admin = await findFirstRoleUser(actor.companyId, Role.ADMIN);
  const fallback = fallbackReviewerId
    ? await prisma.user.findFirst({
        where: {
          id: fallbackReviewerId,
          companyId: actor.companyId,
          isActive: true,
          role: {
            in: [Role.ADMIN, Role.HR, Role.MANAGER]
          }
        },
        select: {
          id: true,
          role: true
        }
      })
    : null;

  const candidates = [
    requester?.team?.manager
      ? {
          label: "팀장 결재",
          approverId: requester.team.manager.id,
          approverRole: Role.MANAGER
        }
      : null,
    hr
      ? {
          label: "인사 검토",
          approverId: hr.id,
          approverRole: Role.HR
        }
      : null,
    admin
      ? {
          label: "관리자 승인",
          approverId: admin.id,
          approverRole: Role.ADMIN
        }
      : null,
    fallback
      ? {
          label: "지정 결재자",
          approverId: fallback.id,
          approverRole: fallback.role
        }
      : null
  ];
  const seen = new Set<string>();
  const steps = candidates.filter((candidate): candidate is { label: string; approverId: string; approverRole: Role } => {
    if (!candidate || candidate.approverId === actor.id || seen.has(candidate.approverId)) {
      return false;
    }
    seen.add(candidate.approverId);
    return true;
  });

  if (steps.length > 0) {
    return steps;
  }

  const fallbackId = await defaultDocumentReviewer(actor);
  if (!fallbackId) {
    return [];
  }

  const fallbackUser = await prisma.user.findUnique({
    where: {
      id: fallbackId
    },
    select: {
      id: true,
      role: true
    }
  });
  return fallbackUser
    ? [
        {
          label: "기본 결재자",
          approverId: fallbackUser.id,
          approverRole: fallbackUser.role
        }
      ]
    : [];
}

async function notifyDocumentAssignee(documentId: string) {
  const document = await prisma.documentRequest.findUnique({
    where: {
      id: documentId
    },
    include: {
      requester: true,
      reviewer: true
    }
  });
  if (!document || !document.reviewerId || document.status !== DocumentRequestStatus.PENDING) {
    return;
  }

  await ensureWorkThreadForDocumentRequest(document.id);
  await createNotifications({
    companyId: document.companyId,
    userIds: [document.reviewerId],
    type: NotificationType.DOCUMENT_REQUEST,
    title: `${document.requester.name}님의 전자결재 요청`,
    message: `${document.documentNumber ?? "문서번호 미정"} · ${documentCategoryLabel(document.category)} · ${document.title}`,
    actionUrl: documentGroupwareHref(document.id),
    metadata: {
      documentRequestId: document.id,
      documentNumber: document.documentNumber
    } satisfies Prisma.JsonObject
  });
}

export async function createDocumentRequest(actor: Actor, input: {
  title: string;
  body: string;
  category?: string | null;
  amount?: number | null;
  reviewerId?: string | null;
  approvalStepUserIds?: string[];
  formData?: Prisma.JsonObject | null;
}) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 2) {
    throw new Error("결재 제목을 입력하세요.");
  }
  if (body.length < 2) {
    throw new Error("결재 내용을 입력하세요.");
  }

  const steps = await buildDocumentApprovalSteps(actor, input.reviewerId?.trim() || null, input.approvalStepUserIds);
  const firstStep = steps[0] ?? null;
  if (!firstStep) {
    throw new Error("결재선을 만들 수 없습니다. 팀장, 인사 담당 또는 관리자를 먼저 등록하세요.");
  }

  const document = await prisma.documentRequest.create({
    data: {
      companyId: actor.companyId,
      requesterId: actor.id,
      reviewerId: firstStep.approverId,
      documentNumber: await generateDocumentNumber(actor.companyId),
      category: normalizeDocumentCategory(input.category),
      title,
      body,
      amount: Number.isFinite(input.amount) ? input.amount : null,
      formData: input.formData ?? Prisma.JsonNull,
      approvalSteps: {
        create: steps.map((step, index) => ({
          companyId: actor.companyId,
          stepOrder: index + 1,
          label: step.label,
          approverId: step.approverId,
          approverRole: step.approverRole
        }))
      }
    },
    include: {
      requester: true,
      reviewer: true,
      approvalSteps: {
        include: {
          approver: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },
        orderBy: {
          stepOrder: "asc"
        }
      },
      attachments: true
    }
  });
  await ensureWorkThreadForDocumentRequest(document.id);
  await notifyDocumentAssignee(document.id);

  return document;
}

export async function reviewDocumentRequest(actor: Actor, input: {
  id: string;
  status: string;
  reviewNote?: string | null;
  delegateForUserId?: string | null;
}) {
  if (!canManage(actor.role)) {
    throw new Error("전자결재 처리 권한이 필요합니다.");
  }
  const document = await prisma.documentRequest.findFirst({
    where: {
      id: input.id,
      companyId: actor.companyId
    },
    include: {
      approvalSteps: {
        include: {
          approver: true
        },
        orderBy: {
          stepOrder: "asc"
        }
      }
    }
  });
  if (!document) {
    throw new Error("전자결재 문서를 찾을 수 없습니다.");
  }
  if (document.status !== DocumentRequestStatus.PENDING) {
    throw new Error("이미 처리된 전자결재 문서입니다.");
  }

  const currentStep = document.approvalSteps.find((step) => step.status === DocumentApprovalStepStatus.PENDING);
  if (!currentStep) {
    throw new Error("처리할 결재 단계가 없습니다.");
  }
  const delegateForUserId = input.delegateForUserId?.trim() || null;
  const delegateUser = delegateForUserId
    ? await prisma.user.findFirst({
        where: {
          id: delegateForUserId,
          companyId: actor.companyId,
          isActive: true
        },
        select: {
          id: true,
          name: true,
          role: true
        }
      })
    : null;
  if (delegateForUserId && !delegateUser) {
    throw new Error("대리 결재 대상자를 확인하세요.");
  }
  const isDelegateReview = Boolean(delegateUser && delegateUser.id !== actor.id);
  if (isDelegateReview && delegateUser?.id !== currentStep.approverId) {
    throw new Error("현재 결재자 대신 처리하는 경우에만 대리 결재할 수 있습니다.");
  }
  const canReview =
    actor.role === "ADMIN" ||
    currentStep.approverId === actor.id ||
    (actor.role === "HR" && currentStep.approverRole === Role.HR) ||
    (isDelegateReview && canManage(actor.role));
  if (!canReview) {
    throw new Error("담당 결재 문서만 처리할 수 있습니다.");
  }

  const reviewNote = input.reviewNote?.trim() || null;
  const action = isDelegateReview ? documentDelegatedReviewedAction : documentReviewedAction;
  const auditPayload = {
    title: document.title,
    documentNumber: document.documentNumber,
    stepId: currentStep.id,
    stepLabel: currentStep.label,
    status: input.status === "APPROVED" ? "APPROVED" : "REJECTED",
    reviewNote,
    delegateUserId: delegateUser?.id ?? null,
    delegateName: delegateUser?.name ?? null
  } satisfies Prisma.JsonObject;
  if (input.status !== "APPROVED") {
    await prisma.documentApprovalStep.update({
      where: {
        id: currentStep.id
      },
      data: {
        status: DocumentApprovalStepStatus.REJECTED,
        reviewNote,
        reviewedAt: new Date()
      }
    });
    const rejected = await prisma.documentRequest.update({
      where: {
        id: document.id
      },
      data: {
        status: DocumentRequestStatus.REJECTED,
        reviewerId: actor.id,
        reviewNote,
        reviewedAt: new Date()
      }
    });
    await writeAuditLog({
      companyId: actor.companyId,
      actorUserId: actor.id,
      action,
      targetType: "document_request",
      targetId: document.id,
      payload: auditPayload
    });
    await ensureWorkThreadForDocumentRequest(document.id);
    await createNotifications({
      companyId: actor.companyId,
      userIds: [document.requesterId],
      type: NotificationType.DOCUMENT_REQUEST,
      title: "전자결재가 반려되었습니다",
      message: `${document.documentNumber ?? ""} ${document.title} · ${reviewNote || actor.name}`,
      actionUrl: documentGroupwareHref(document.id),
      metadata: {
        documentRequestId: document.id,
        status: DocumentRequestStatus.REJECTED
      } satisfies Prisma.JsonObject
    });
    return rejected;
  }

  await prisma.documentApprovalStep.update({
    where: {
      id: currentStep.id
    },
    data: {
      status: DocumentApprovalStepStatus.APPROVED,
      reviewNote,
      reviewedAt: new Date()
    }
  });
  const nextStep = document.approvalSteps.find((step) => step.stepOrder > currentStep.stepOrder && step.status === DocumentApprovalStepStatus.PENDING);
  const isFinalApproved = !nextStep;
  const updated = await prisma.documentRequest.update({
    where: {
      id: document.id
    },
    data: {
      status: isFinalApproved ? DocumentRequestStatus.APPROVED : DocumentRequestStatus.PENDING,
      reviewerId: isFinalApproved ? actor.id : nextStep.approverId,
      reviewNote: isFinalApproved ? reviewNote : document.reviewNote,
      reviewedAt: isFinalApproved ? new Date() : null
    }
  });
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action,
    targetType: "document_request",
    targetId: document.id,
    payload: auditPayload
  });
  await ensureWorkThreadForDocumentRequest(document.id);
  await createNotifications({
    companyId: actor.companyId,
    userIds: [document.requesterId],
    type: NotificationType.DOCUMENT_REQUEST,
    title: isFinalApproved ? "전자결재가 승인되었습니다" : "전자결재 단계가 승인되었습니다",
    message: `${document.documentNumber ?? ""} ${document.title} · ${currentStep.label}`,
    actionUrl: documentGroupwareHref(document.id),
    metadata: {
      documentRequestId: document.id,
      status: updated.status
    } satisfies Prisma.JsonObject
  });
  if (!isFinalApproved) {
    await notifyDocumentAssignee(document.id);
  }
  return updated;
}

export async function updateDocumentApprovalLine(actor: Actor, input: {
  documentId: string;
  stepId: string;
  approverId: string;
}) {
  const document = await prisma.documentRequest.findFirst({
    where: {
      id: input.documentId,
      companyId: actor.companyId
    },
    include: {
      approvalSteps: {
        orderBy: {
          stepOrder: "asc"
        }
      }
    }
  });
  if (!document) {
    throw new Error("전자결재 문서를 찾을 수 없습니다.");
  }
  if (document.status !== DocumentRequestStatus.PENDING) {
    throw new Error("진행 중인 전자결재만 결재선을 변경할 수 있습니다.");
  }
  if (!canManage(actor.role) && document.requesterId !== actor.id) {
    throw new Error("결재선 변경 권한이 없습니다.");
  }
  if (!canManage(actor.role) && document.approvalSteps.some((step) => step.status !== DocumentApprovalStepStatus.PENDING)) {
    throw new Error("결재가 시작된 문서는 관리자만 결재선을 변경할 수 있습니다.");
  }

  const step = document.approvalSteps.find((approvalStep) => approvalStep.id === input.stepId);
  if (!step || step.status !== DocumentApprovalStepStatus.PENDING) {
    throw new Error("변경할 수 있는 결재 단계를 찾을 수 없습니다.");
  }
  const approver = await prisma.user.findFirst({
    where: {
      id: input.approverId,
      companyId: actor.companyId,
      isActive: true,
      role: {
        in: [Role.ADMIN, Role.HR, Role.MANAGER]
      }
    },
    select: {
      id: true,
      name: true,
      role: true
    }
  });
  if (!approver || approver.id === document.requesterId) {
    throw new Error("결재자로 지정할 수 없는 사용자입니다.");
  }

  const updatedStep = await prisma.documentApprovalStep.update({
    where: {
      id: step.id
    },
    data: {
      approverId: approver.id,
      approverRole: approver.role
    }
  });
  const currentStep = document.approvalSteps.find((approvalStep) => approvalStep.status === DocumentApprovalStepStatus.PENDING);
  if (currentStep?.id === step.id) {
    await prisma.documentRequest.update({
      where: {
        id: document.id
      },
      data: {
        reviewerId: approver.id
      }
    });
    await notifyDocumentAssignee(document.id);
  }
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: documentApprovalLineChangedAction,
    targetType: "document_request",
    targetId: document.id,
    payload: {
      title: document.title,
      documentNumber: document.documentNumber,
      stepId: step.id,
      stepLabel: step.label,
      previousApproverId: step.approverId,
      nextApproverId: approver.id,
      nextApproverName: approver.name
    }
  });
  return updatedStep;
}

export async function resubmitDocumentRequest(actor: Actor, documentId: string) {
  const document = await prisma.documentRequest.findFirst({
    where: {
      id: documentId,
      companyId: actor.companyId,
      requesterId: actor.id
    },
    include: {
      approvalSteps: {
        orderBy: {
          stepOrder: "asc"
        }
      },
      attachments: true
    }
  });
  if (!document) {
    throw new Error("재상신할 전자결재 문서를 찾을 수 없습니다.");
  }
  if (document.status !== DocumentRequestStatus.REJECTED) {
    throw new Error("반려된 전자결재만 재상신할 수 있습니다.");
  }

  const formData = getAuditPayloadRecord(document.formData) as Prisma.JsonObject | null;
  const resubmitted = await createDocumentRequest(actor, {
    title: `${document.title} 재상신`,
    body: document.body,
    category: document.category,
    amount: document.amount,
    reviewerId: document.reviewerId,
    approvalStepUserIds: document.approvalSteps.map((step) => step.approverId).filter((id): id is string => Boolean(id)),
    formData
  });
  if (document.attachments.length > 0) {
    await prisma.documentAttachment.createMany({
      data: document.attachments.map((attachment) => ({
        companyId: actor.companyId,
        documentRequestId: resubmitted.id,
        uploadedById: actor.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        storagePath: attachment.storagePath
      }))
    });
  }
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: documentResubmittedAction,
    targetType: "document_request",
    targetId: document.id,
    payload: {
      title: document.title,
      documentNumber: document.documentNumber,
      newDocumentId: resubmitted.id,
      newDocumentNumber: resubmitted.documentNumber
    }
  });
  return {
    ...resubmitted,
    attachmentCount: document.attachments.length
  };
}

function visibleDocumentWhere(actor: Actor) {
  return {
    companyId: actor.companyId,
    OR: [
      { requesterId: actor.id },
      { reviewerId: actor.id },
      canViewReports(actor.role) ? { id: { not: "__none__" } } : { id: "__none__" }
    ]
  } satisfies Prisma.DocumentRequestWhereInput;
}

function visibleLibraryWhere(actor: Actor) {
  return {
    companyId: actor.companyId,
    OR: [
      { accessScope: "ALL" },
      actor.teamId ? { accessScope: "TEAM", teamId: actor.teamId } : { id: "__none__" },
      canViewReports(actor.role) ? { accessScope: "HR" } : { id: "__none__" },
      canManage(actor.role) ? { createdById: actor.id } : { id: "__none__" }
    ]
  } satisfies Prisma.DocumentLibraryItemWhereInput;
}

function libraryItemAccessibleByUser(
  item: { accessScope: string; teamId?: string | null; createdById: string },
  user: Pick<User, "id" | "role" | "teamId">
) {
  if (item.accessScope === "ALL") {
    return true;
  }
  if (item.accessScope === "TEAM") {
    return Boolean(user.teamId && user.teamId === item.teamId);
  }
  if (item.accessScope === "HR") {
    return canViewReports(user.role);
  }
  return canManage(user.role) && item.createdById === user.id;
}

function libraryAccessReason(
  item: { accessScope: string; teamId?: string | null; createdById: string },
  user: Pick<User, "id" | "role" | "teamId">
) {
  if (libraryItemAccessibleByUser(item, user)) {
    if (item.accessScope === "ALL") {
      return "전체 공개 자료입니다.";
    }
    if (item.accessScope === "TEAM") {
      return "사용자 부서와 자료 공개 부서가 일치합니다.";
    }
    if (item.accessScope === "HR") {
      return "인사/관리자 공개 자료에 접근할 수 있는 권한입니다.";
    }
    return "직접 등록한 자료입니다.";
  }
  if (item.accessScope === "TEAM") {
    return "사용자 부서가 자료 공개 부서와 다릅니다.";
  }
  if (item.accessScope === "HR") {
    return "인사/관리자 공개 자료입니다.";
  }
  return "자료 접근 권한이 없습니다.";
}

export async function getDocumentRequestForActor(actor: Actor, documentRequestId: string) {
  const document = await prisma.documentRequest.findFirst({
    where: {
      id: documentRequestId,
      ...visibleDocumentWhere(actor)
    },
    include: {
      requester: {
        include: {
          team: true
        }
      },
      reviewer: true,
      approvalSteps: {
        include: {
          approver: true
        },
        orderBy: {
          stepOrder: "asc"
        }
      },
      attachments: {
        include: {
          uploadedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });
  if (!document) {
    throw new Error("전자결재 문서를 찾을 수 없습니다.");
  }
  return document;
}

export async function getDocumentAttachmentForActor(actor: Actor, attachmentId: string) {
  const attachment = await prisma.documentAttachment.findFirst({
    where: {
      id: attachmentId,
      companyId: actor.companyId,
      documentRequest: {
        is: visibleDocumentWhere(actor)
      }
    },
    include: {
      documentRequest: {
        select: {
          requesterId: true
        }
      }
    }
  });
  if (!attachment) {
    throw new Error("첨부 파일을 찾을 수 없습니다.");
  }
  return attachment;
}

export async function getAnnouncementAttachmentForActor(actor: Actor, attachmentId: string) {
  const attachment = await prisma.announcementAttachment.findFirst({
    where: {
      id: attachmentId,
      companyId: actor.companyId,
      announcement: {
        is: visibleAnnouncementWhere(actor)
      }
    },
    include: {
      announcement: {
        select: {
          authorId: true
        }
      }
    }
  });
  if (!attachment) {
    throw new Error("첨부 파일을 찾을 수 없습니다.");
  }
  return attachment;
}

export async function createDocumentLibraryVersion(actor: Actor, input: {
  itemId?: string | null;
  title: string;
  category?: string | null;
  accessScope?: string | null;
  teamId?: string | null;
  description?: string | null;
  isPinned?: boolean | null;
  note?: string | null;
}) {
  if (!canManage(actor.role)) {
    throw new Error("자료실 등록 권한이 필요합니다.");
  }
  const title = input.title.trim();
  if (!input.itemId && title.length < 2) {
    throw new Error("자료 제목을 입력하세요.");
  }

  const accessScope = normalizeLibraryAccessScope(input.accessScope);
  const teamId = accessScope === "TEAM" ? input.teamId?.trim() || actor.teamId : null;
  if (accessScope === "TEAM") {
    const allowedTeamIds = await visibleTeamIds(actor);
    if (!teamId || !allowedTeamIds.includes(teamId)) {
      throw new Error("자료 공개 부서를 확인하세요.");
    }
  }

  if (input.itemId) {
    const item = await prisma.documentLibraryItem.findFirst({
      where: {
        id: input.itemId,
        companyId: actor.companyId
      },
      include: {
        versions: {
          orderBy: {
            versionNo: "desc"
          },
          take: 1
        }
      }
    });
    if (!item) {
      throw new Error("자료를 찾을 수 없습니다.");
    }
    return {
      item,
      nextVersionNo: (item.versions[0]?.versionNo ?? 0) + 1
    };
  }

  const item = await prisma.documentLibraryItem.create({
    data: {
      companyId: actor.companyId,
      createdById: actor.id,
      title,
      category: normalizeLibraryCategory(input.category),
      accessScope,
      teamId,
      description: input.description?.trim() || null
    }
  });
  if (input.isPinned) {
    await saveLibraryPin(actor, item.id, true, item.title);
  }
  return {
    item,
    nextVersionNo: 1
  };
}

export async function updateDocumentLibraryItem(actor: Actor, input: {
  itemId: string;
  title?: string | null;
  category?: string | null;
  accessScope?: string | null;
  teamId?: string | null;
  description?: string | null;
  isPinned?: boolean | null;
  isArchived?: boolean | null;
}) {
  if (!canManage(actor.role)) {
    throw new Error("자료실 수정 권한이 필요합니다.");
  }
  const item = await prisma.documentLibraryItem.findFirst({
    where: {
      id: input.itemId,
      companyId: actor.companyId
    }
  });
  if (!item) {
    throw new Error("자료를 찾을 수 없습니다.");
  }

  const nextAccessScope = input.accessScope === undefined ? item.accessScope : normalizeLibraryAccessScope(input.accessScope);
  const nextTeamId =
    nextAccessScope === "TEAM"
      ? input.teamId?.trim() || item.teamId || actor.teamId
      : null;
  if (nextAccessScope === "TEAM") {
    const allowedTeamIds = await visibleTeamIds(actor);
    if (!nextTeamId || !allowedTeamIds.includes(nextTeamId)) {
      throw new Error("자료 공개 부서를 확인하세요.");
    }
  }

  const title = input.title?.trim();
  if (title !== undefined && title.length < 2) {
    throw new Error("자료 제목을 입력하세요.");
  }

  const updated = await prisma.documentLibraryItem.update({
    where: {
      id: item.id
    },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(input.category !== undefined ? { category: normalizeLibraryCategory(input.category) } : {}),
      ...(input.accessScope !== undefined || input.teamId !== undefined ? { accessScope: nextAccessScope, teamId: nextTeamId } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {})
    }
  });

  if (typeof input.isPinned === "boolean") {
    await saveLibraryPin(actor, item.id, input.isPinned, updated.title);
  }
  if (typeof input.isArchived === "boolean") {
    await saveLibraryArchive(actor, item.id, input.isArchived, updated.title);
  }
  if (title !== undefined || input.category !== undefined || input.accessScope !== undefined || input.teamId !== undefined || input.description !== undefined) {
    await writeAuditLog({
      companyId: actor.companyId,
      actorUserId: actor.id,
      action: "document_library.item.updated",
      targetType: "document_library_item",
      targetId: item.id,
      payload: {
        title: updated.title,
        category: updated.category,
        accessScope: updated.accessScope,
        teamId: updated.teamId
      }
    });
  }

  return updated;
}

export async function updateDocumentLibraryVersionVisibility(actor: Actor, input: {
  itemId: string;
  versionId: string;
  isHidden: boolean;
}) {
  if (!canManage(actor.role)) {
    throw new Error("자료실 수정 권한이 필요합니다.");
  }
  const version = await prisma.documentLibraryVersion.findFirst({
    where: {
      id: input.versionId,
      itemId: input.itemId,
      companyId: actor.companyId
    },
    include: {
      item: true
    }
  });
  if (!version) {
    throw new Error("자료실 버전을 찾을 수 없습니다.");
  }

  await saveLibraryVersionVisibility(actor, version.id, input.isHidden, `${version.item.title} v${version.versionNo}`);
  return {
    ok: true
  };
}

export async function getDocumentLibraryVersionForActor(actor: Actor, versionId: string) {
  const version = await prisma.documentLibraryVersion.findFirst({
    where: {
      id: versionId,
      companyId: actor.companyId,
      item: {
        is: visibleLibraryWhere(actor)
      }
    },
    include: {
      item: true
    }
  });
  if (!version) {
    throw new Error("자료실 파일을 찾을 수 없습니다.");
  }
  const isHidden = (await getLibraryVersionHiddenMap(actor.companyId, [version.id])).get(version.id) ?? false;
  const isArchived = (await getLibraryArchiveMap(actor.companyId, [version.itemId])).get(version.itemId) ?? false;
  if ((isHidden || isArchived) && !canManage(actor.role)) {
    const reason = isArchived ? "보관 자료" : "숨김 버전";
    await writeAuditLog({
      companyId: actor.companyId,
      actorUserId: actor.id,
      action: libraryAccessDeniedAction,
      targetType: "document_library_version",
      targetId: version.id,
      payload: {
        title: version.item.title,
        itemId: version.itemId,
        versionNo: version.versionNo,
        userId: actor.id,
        userName: actor.name,
        reason
      }
    });
    await sendGroupwareAuditAlert({
      companyId: actor.companyId,
      actorUserId: actor.id,
      alertType: "library_archived_access_attempt",
      targetType: "document_library_version",
      targetId: `${version.id}:${actor.id}`,
      title: "비공개 자료 접근 시도",
      message: `${actor.name}님이 ${reason}인 ${version.item.title} v${version.versionNo}에 접근하려고 했습니다.`,
      actionUrl: libraryGroupwareHref(version.itemId),
      payload: {
        itemId: version.itemId,
        versionId: version.id,
        title: version.item.title,
        userId: actor.id,
        userName: actor.name,
        reason
      }
    });
    throw new Error("공개되지 않은 자료실 파일입니다.");
  }
  return version;
}

async function getGroupwareSearchResults(actor: Actor, filters: GroupwareSearchFilters) {
  const normalizedFilters = normalizeGroupwareSearchFilters(filters);
  if (!hasMeaningfulSearchFilters(normalizedFilters)) {
    return [] as GroupwareSearchResult[];
  }

  const keyword = normalizedFilters.search;
  const hasKeyword = keyword.length >= 2;
  const searchType = normalizedFilters.type;
  const rawCategoryFilter = normalizedFilters.category;
  const categoryFilter = rawCategoryFilter && rawCategoryFilter !== "ALL" ? rawCategoryFilter : null;
  const authorId = normalizedFilters.authorId || null;
  const dateRange = searchDateRange(filters);
  const hasDateRange = Boolean(dateRange.gte || dateRange.lte);
  const includeType = (...types: GroupwareSearchType[]) => searchType === "ALL" || types.includes(searchType);
  const visibleUserIds = await visibleProfileMemoUserIds(actor);
  const [users, announcements, memoThreads, documents, payrollIssues, libraryItems] = await Promise.all([
    includeType("USER") && hasKeyword && !categoryFilter && !authorId && !hasDateRange
      ? prisma.user.findMany({
          where: {
            companyId: actor.companyId,
            isActive: true,
            id: {
              in: [...visibleUserIds]
            },
            OR: [
              { name: { contains: keyword, mode: "insensitive" } },
              { email: { contains: keyword, mode: "insensitive" } },
              { jobTitle: { contains: keyword, mode: "insensitive" } },
              { extensionNumber: { contains: keyword, mode: "insensitive" } }
            ]
          },
          include: {
            team: true
          },
          take: 5
        })
      : Promise.resolve([]),
    includeType("ANNOUNCEMENT", "BOARD")
      ? prisma.announcement.findMany({
          where: {
            AND: [
              visibleAnnouncementWhere(actor),
              searchType === "BOARD" ? { category: "TEAM" } : searchType === "ANNOUNCEMENT" ? { category: { not: "TEAM" } } : {},
              categoryFilter ? { category: categoryFilter } : {},
              authorId ? { authorId } : {},
              hasDateRange ? { createdAt: dateRange } : {},
              hasKeyword
                ? {
                OR: [
                  { title: { contains: keyword, mode: "insensitive" as const } },
                  { body: { contains: keyword, mode: "insensitive" as const } },
                  { category: { contains: keyword, mode: "insensitive" as const } }
                ]
              }
                : {}
            ]
          },
          take: 5,
          orderBy: {
            createdAt: "desc"
          }
        })
      : Promise.resolve([]),
    includeType("MEMO") && !categoryFilter
      ? prisma.workThread.findMany({
          where: {
            companyId: actor.companyId,
            targetType: WorkThreadTargetType.USER_PROFILE,
            targetId: {
              in: [...visibleUserIds]
            },
            ...(authorId ? { createdById: authorId } : {}),
            ...(hasDateRange ? { updatedAt: dateRange } : {}),
            ...(hasKeyword
              ? {
                  OR: [
                    { title: { contains: keyword, mode: "insensitive" } },
                    {
                      comments: {
                        some: {
                          body: { contains: keyword, mode: "insensitive" },
                          deletedAt: null
                        }
                      }
                    }
                  ]
                }
              : {})
          },
          take: 5,
          orderBy: {
            updatedAt: "desc"
          }
        })
      : Promise.resolve([]),
    includeType("DOCUMENT")
      ? prisma.documentRequest.findMany({
          where: {
            AND: [
              visibleDocumentWhere(actor),
              categoryFilter ? { category: normalizeDocumentCategory(categoryFilter) } : {},
              authorId ? { requesterId: authorId } : {},
              hasDateRange ? { createdAt: dateRange } : {},
              hasKeyword
                ? {
                    OR: [
                      { documentNumber: { contains: keyword, mode: "insensitive" as const } },
                      { title: { contains: keyword, mode: "insensitive" as const } },
                      { body: { contains: keyword, mode: "insensitive" as const } },
                      { category: { contains: keyword, mode: "insensitive" as const } }
                    ]
                  }
                : {}
            ]
          },
          include: {
            requester: true
          },
          take: 5,
          orderBy: {
            createdAt: "desc"
          }
        })
      : Promise.resolve([]),
    includeType("PAYROLL") && !categoryFilter
      ? prisma.payrollStatementIssue.findMany({
          where: {
            companyId: actor.companyId,
            ...(canViewReports(actor.role) ? {} : { userId: actor.id }),
            ...(authorId ? { userId: authorId } : {}),
            ...(hasDateRange ? { issuedAt: dateRange } : {}),
            ...(hasKeyword
              ? {
                  OR: [
                    { month: { contains: keyword, mode: "insensitive" } },
                    { user: { name: { contains: keyword, mode: "insensitive" } } },
                    { note: { contains: keyword, mode: "insensitive" } }
                  ]
                }
              : {})
          },
          include: {
            user: true
          },
          take: 5,
          orderBy: {
            issuedAt: "desc"
          }
        })
      : Promise.resolve([]),
    includeType("LIBRARY")
      ? prisma.documentLibraryItem.findMany({
          where: {
            AND: [
              visibleLibraryWhere(actor),
              categoryFilter ? { category: normalizeLibraryCategory(categoryFilter) } : {},
              authorId ? { createdById: authorId } : {},
              hasDateRange ? { updatedAt: dateRange } : {},
              hasKeyword
                ? {
                OR: [
                  { title: { contains: keyword, mode: "insensitive" as const } },
                  { description: { contains: keyword, mode: "insensitive" as const } },
                  { category: { contains: keyword, mode: "insensitive" as const } }
                ]
              }
                : {}
            ]
          },
          include: {
            versions: {
              orderBy: {
                versionNo: "desc"
              },
              take: 1
            }
          },
          take: 5,
          orderBy: {
            updatedAt: "desc"
          }
        })
      : Promise.resolve([])
  ]);
  const libraryArchivedByItemId = await getLibraryArchiveMap(
    actor.companyId,
    libraryItems.map((item) => item.id)
  );
  const visibleLibraryItems = libraryItems.filter((item) => !libraryArchivedByItemId.get(item.id));

  return [
    ...users.map((user) => ({
      type: "USER" as const,
      label: "직원",
      title: user.name,
      description: `${user.team?.name ?? "소속 없음"} · ${user.email}`,
      href: `/dashboard?view=groupware&groupwareTab=operations&orgUserId=${user.id}`
    })),
    ...announcements.map((announcement) => ({
      type: "ANNOUNCEMENT" as const,
      label: announcement.category === "TEAM" ? "게시판" : "공지",
      title: announcement.title,
      description: `${announcementCategoryLabel(announcement.category)} · ${announcement.body.slice(0, 80)}`,
      href: announcementGroupwareHref(announcement.category, announcement.id)
    })),
    ...memoThreads.map((thread) => ({
      type: "MEMO" as const,
      label: "메모",
      title: thread.title,
      description: `${workThreadStatusLabel(thread.status)} 메모`,
      href: `/dashboard?view=workbox&workThreadId=${thread.id}`
    })),
    ...documents.map((document) => ({
      type: "DOCUMENT" as const,
      label: "전자결재",
      title: `${document.documentNumber ?? ""} ${document.title}`.trim(),
      description: `${document.requester.name} · ${documentStatusLabel(document.status)}`,
      href: documentGroupwareHref(document.id)
    })),
    ...payrollIssues.map((issue) => ({
      type: "PAYROLL" as const,
      label: "급여명세",
      title: `${issue.month} · ${issue.user.name}`,
      description: payrollStatementStatusLabel(issue.status),
      href: "/dashboard?view=groupware&groupwareTab=operations#groupware-payroll-statements"
    })),
    ...visibleLibraryItems.map((item) => ({
      type: "LIBRARY" as const,
      label: "자료실",
      title: item.title,
      description: `${libraryCategoryLabel(item.category)} · 버전 ${item.versions[0]?.versionNo ?? 0}`,
      href: libraryGroupwareHref(item.id)
    }))
  ].slice(0, 20);
}

export async function getGroupwareDashboard(actor: Actor, input?: {
  search?: string | null;
  searchType?: string | null;
  searchCategory?: string | null;
  searchAuthorId?: string | null;
  searchFrom?: string | null;
  searchTo?: string | null;
  operationAction?: string | null;
  operationActorId?: string | null;
  operationFrom?: string | null;
  operationTo?: string | null;
  libraryStatus?: string | null;
  libraryPermissionUserId?: string | null;
  announcementId?: string | null;
  libraryItemId?: string | null;
  documentId?: string | null;
}) {
  await publishDueAnnouncements(actor.companyId);
  const normalizedSearchFilters = normalizeGroupwareSearchFilters({
    search: input?.search,
    type: input?.searchType,
    category: input?.searchCategory,
    authorId: input?.searchAuthorId,
    from: input?.searchFrom,
    to: input?.searchTo
  });
  await Promise.all([
    runGroupwareAuditAutomations(actor),
    recordGroupwareRecentSearch(actor, normalizedSearchFilters)
  ]);
  const visibleUserIds = await visibleProfileMemoUserIds(actor);
  const allowedUserIds = await managedUserIds(actor);
  const allowedTeamIds = await visibleTeamIds(actor);
  const canManageGroupware = canManage(actor.role);
  const canViewPayrollForOthers = canViewReports(actor.role);
  const requestedAnnouncementId = input?.announcementId?.trim() || null;
  const requestedLibraryItemId = input?.libraryItemId?.trim() || null;
  const requestedDocumentId = input?.documentId?.trim() || null;
  const libraryStatus = normalizeLibraryStatus(input?.libraryStatus);
  await markGroupwareDetailNotificationsRead(actor, {
    announcementId: requestedAnnouncementId,
    libraryItemId: requestedLibraryItemId,
    documentId: requestedDocumentId
  });
  const memoThreads = await prisma.workThread.findMany({
    where: {
      companyId: actor.companyId,
      targetType: WorkThreadTargetType.USER_PROFILE,
      OR: [
        {
          targetId: {
            in: [...visibleUserIds]
          }
        },
        { assigneeId: actor.id },
        { createdById: actor.id }
      ]
    },
    include: {
      assignee: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      },
      comments: {
        where: {
          deletedAt: null
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      }
    },
    orderBy: [{ status: "asc" }, { lastCommentAt: "desc" }, { updatedAt: "desc" }],
    take: 40
  });
  const targetUsers = await prisma.user.findMany({
    where: {
      companyId: actor.companyId,
      id: {
        in: memoThreads.map((thread) => thread.targetId)
      }
    },
    include: {
      team: true
    }
  });
  const targetUserById = new Map(targetUsers.map((user) => [user.id, user]));
  const profileMemoThreads = memoThreads.map((thread) => ({
    id: thread.id,
    targetUserId: thread.targetId,
    title: thread.title,
    status: thread.status,
    assignee: thread.assignee,
    createdBy: thread.createdBy,
    lastCommentAt: thread.lastCommentAt,
    updatedAt: thread.updatedAt,
    lastComment: thread.comments[0] ?? null,
    targetUser: targetUserById.get(thread.targetId) ?? null,
    href: `/dashboard?view=workbox&workThreadId=${thread.id}`
  }));
  const memoStatsByUser = profileMemoThreads.reduce<Array<{
    userId: string;
    openCount: number;
    lastCommentAt: Date | null;
  }>>((acc, thread) => {
    const current = acc.find((item) => item.userId === thread.targetUserId);
    if (!current) {
      acc.push({
        userId: thread.targetUserId,
        openCount: thread.status === "OPEN" ? 1 : 0,
        lastCommentAt: thread.lastCommentAt
      });
      return acc;
    }
    current.openCount += thread.status === "OPEN" ? 1 : 0;
    if (thread.lastCommentAt && (!current.lastCommentAt || thread.lastCommentAt > current.lastCommentAt)) {
      current.lastCommentAt = thread.lastCommentAt;
    }
    return acc;
  }, []);
  const currentMonth = getKstDateString().slice(0, 7);
  const announcementInclude = {
    author: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true
      }
    },
    team: true,
    reads: {
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    },
    attachments: {
      orderBy: {
        createdAt: "desc"
      }
    },
    comments: {
      where: {
        deletedAt: null
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 3
    },
    _count: {
      select: {
        reads: true,
        comments: true
      }
    }
  } satisfies Prisma.AnnouncementInclude;
  const announcementOrderBy = [{ isPinned: "desc" }, { createdAt: "desc" }] satisfies Prisma.AnnouncementOrderByWithRelationInput[];
  const libraryItemInclude = {
    team: true,
    createdBy: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true
      }
    },
    versions: {
      include: {
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: {
        versionNo: "desc"
      },
      take: 12
    }
  } satisfies Prisma.DocumentLibraryItemInclude;
  const documentRequestInclude = {
    requester: {
      include: {
        team: true
      }
    },
    reviewer: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true
      }
    },
    approvalSteps: {
      include: {
        approver: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: {
        stepOrder: "asc"
      }
    },
    attachments: {
      include: {
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    }
  } satisfies Prisma.DocumentRequestInclude;
  const [noticeAnnouncementRows, boardAnnouncementRows, selectedAnnouncementRow, performanceGoals, payrollIssues, documentRequests, selectedDocumentRow, libraryItemRows, selectedLibraryItemRow, searchResults, operationRows, searchPreferences] = await Promise.all([
    prisma.announcement.findMany({
      where: {
        AND: [visibleAnnouncementWhere(actor), { category: { not: "TEAM" } }]
      },
      include: announcementInclude,
      orderBy: announcementOrderBy,
      take: 12
    }),
    prisma.announcement.findMany({
      where: {
        AND: [visibleAnnouncementWhere(actor), { category: "TEAM" }]
      },
      include: announcementInclude,
      orderBy: announcementOrderBy,
      take: 12
    }),
    requestedAnnouncementId
      ? prisma.announcement.findFirst({
          where: {
            id: requestedAnnouncementId,
            ...visibleAnnouncementWhere(actor)
          },
          include: announcementInclude
        })
      : Promise.resolve(null),
    prisma.performanceGoal.findMany({
      where: {
        companyId: actor.companyId,
        month: currentMonth,
        OR: [
          {
            userId: {
              in: allowedUserIds
            }
          },
          {
            teamId: {
              in: allowedTeamIds
            }
          },
          { createdById: actor.id }
        ]
      },
      include: {
        user: {
          include: {
            team: true
          }
        },
        team: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 12
    }),
    prisma.payrollStatementIssue.findMany({
      where: {
        companyId: actor.companyId,
        month: {
          in: Array.from({ length: 6 }, (_, index) => addMonths(currentMonth, -index))
        },
        ...(canViewReports(actor.role)
          ? {}
          : {
              userId: actor.id
            })
      },
      include: {
        user: {
          include: {
            team: true
          }
        },
        issuedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: [{ month: "desc" }, { issuedAt: "desc" }],
      take: 40
    }),
    prisma.documentRequest.findMany({
      where: visibleDocumentWhere(actor),
      include: documentRequestInclude,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 12
    }),
    requestedDocumentId
      ? prisma.documentRequest.findFirst({
          where: {
            id: requestedDocumentId,
            ...visibleDocumentWhere(actor)
          },
          include: documentRequestInclude
        })
      : Promise.resolve(null),
    prisma.documentLibraryItem.findMany({
      where: visibleLibraryWhere(actor),
      include: libraryItemInclude,
      orderBy: [{ updatedAt: "desc" }],
      take: 12
    }),
    requestedLibraryItemId
      ? prisma.documentLibraryItem.findFirst({
          where: {
            id: requestedLibraryItemId,
            ...visibleLibraryWhere(actor)
          },
          include: libraryItemInclude
        })
      : Promise.resolve(null),
    getGroupwareSearchResults(actor, {
      search: input?.search,
      type: input?.searchType,
      category: input?.searchCategory,
      authorId: input?.searchAuthorId,
      from: input?.searchFrom,
      to: input?.searchTo
    }),
    getGroupwareOperationRows(actor, {
      action: input?.operationAction,
      actorId: input?.operationActorId,
      from: input?.operationFrom,
      to: input?.operationTo
    }),
    getGroupwareSearchPreferences(actor)
  ]);
  const announcements = [...noticeAnnouncementRows, ...boardAnnouncementRows];
  if (selectedAnnouncementRow && !announcements.some((announcement) => announcement.id === selectedAnnouncementRow.id)) {
    announcements.push(selectedAnnouncementRow);
  }
  const visibleDocumentRequests = [...documentRequests];
  if (selectedDocumentRow && !visibleDocumentRequests.some((document) => document.id === selectedDocumentRow.id)) {
    visibleDocumentRequests.push(selectedDocumentRow);
  }
  const libraryItems = [...libraryItemRows];
  if (selectedLibraryItemRow && !libraryItems.some((item) => item.id === selectedLibraryItemRow.id)) {
    libraryItems.push(selectedLibraryItemRow);
  }
  const libraryArchivedByItemId = await getLibraryArchiveMap(
    actor.companyId,
    libraryItems.map((item) => item.id)
  );
  const visibleLibraryItems = libraryItems.filter((item) => {
    const isArchived = libraryArchivedByItemId.get(item.id) ?? false;
    if (libraryStatus === "ARCHIVED") {
      return canManageGroupware && isArchived;
    }
    return !isArchived || (canManageGroupware && item.id === requestedLibraryItemId);
  });
  const announcementExpiresAtById = await getAnnouncementExpiryMap(
    actor.companyId,
    announcements.map((announcement) => announcement.id)
  );
  const visibleAnnouncements = announcements.filter((announcement) => {
    const expiresAt = announcementExpiresAtById.get(announcement.id) ?? null;
    return canManageGroupware || announcement.authorId === actor.id || !expiresAt || expiresAt > new Date();
  });
  const libraryPinnedByItemId = await getLibraryPinMap(
    actor.companyId,
    visibleLibraryItems.map((item) => item.id)
  );
  const libraryVersionIds = visibleLibraryItems.flatMap((item) => item.versions.map((version) => version.id));
  const libraryVersionHiddenById = await getLibraryVersionHiddenMap(actor.companyId, libraryVersionIds);
  const libraryDownloadRows = libraryVersionIds.length
    ? await prisma.auditLog.findMany({
        where: {
          companyId: actor.companyId,
          action: "attachment.downloaded",
          targetType: "document_library_version",
          targetId: {
            in: libraryVersionIds
          }
        },
        select: {
          id: true,
          targetId: true,
          createdAt: true,
          payload: true,
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      })
    : [];
  const libraryDownloadCountByVersionId = libraryDownloadRows.reduce<Map<string, number>>((acc, row) => {
    acc.set(row.targetId, (acc.get(row.targetId) ?? 0) + 1);
    return acc;
  }, new Map());
  const libraryItemIdByVersionId = new Map(
    visibleLibraryItems.flatMap((item) => item.versions.map((version) => [version.id, item.id] as const))
  );
  const libraryDownloadCountByItemId = libraryDownloadRows.reduce<Map<string, number>>((acc, row) => {
    const itemId = libraryItemIdByVersionId.get(row.targetId);
    if (itemId) {
      acc.set(itemId, (acc.get(itemId) ?? 0) + 1);
    }
    return acc;
  }, new Map());
  const libraryDownloadLogsByItemId = libraryDownloadRows.reduce<Map<string, Array<{
    id: string;
    versionId: string;
    createdAt: Date;
    actor: {
      id: string;
      name: string;
      email: string;
      role: Role;
    } | null;
    originalName: string;
  }>>>((acc, row) => {
    const itemId = libraryItemIdByVersionId.get(row.targetId);
    if (!itemId) {
      return acc;
    }
    const payload = getAuditPayloadRecord(row.payload);
    const current = acc.get(itemId) ?? [];
    current.push({
      id: row.id,
      versionId: row.targetId,
      createdAt: row.createdAt,
      actor: row.actor,
      originalName: payloadString(payload, "originalName") ?? "파일"
    });
    acc.set(itemId, current);
    return acc;
  }, new Map());
  const libraryAccessUsers = canManageGroupware && visibleLibraryItems.length > 0
    ? await prisma.user.findMany({
        where: {
          companyId: actor.companyId,
          isActive: true
        },
        include: {
          team: true
        },
        orderBy: {
          name: "asc"
        },
        take: 300
      })
    : [];
  const libraryAccessPreviewByItemId = new Map(
    visibleLibraryItems.map((item) => {
      const users = libraryAccessUsers.filter((user) => libraryItemAccessibleByUser(item, user));
      return [
        item.id,
        {
          totalCount: users.length,
          sampleUsers: users.slice(0, 8).map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            teamName: user.team?.name ?? null
          }))
        }
      ] as const;
    })
  );
  const libraryPermissionUserId = input?.libraryPermissionUserId?.trim() || null;
  const libraryPermissionUser = libraryPermissionUserId
    ? await prisma.user.findFirst({
        where: {
          id: libraryPermissionUserId,
          companyId: actor.companyId,
          isActive: true
        },
        include: {
          team: true
        }
      })
    : null;
  const documentThreads = await prisma.workThread.findMany({
    where: {
      companyId: actor.companyId,
      targetType: WorkThreadTargetType.DOCUMENT_REQUEST,
      targetId: {
        in: visibleDocumentRequests.map((document) => document.id)
      }
    },
    include: {
      comments: {
        where: {
          deletedAt: null
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      },
      _count: {
        select: {
          comments: true
        }
      }
    }
  });
  const documentThreadByTargetId = new Map(documentThreads.map((thread) => [thread.targetId, thread]));
  const announcementStats = await Promise.all(
    visibleAnnouncements.map(async (announcement) => {
      const recipients = await announcementRecipientIds(actor, {
        audience: announcement.audience,
        teamId: announcement.teamId
      });
      const readUserIds = new Set(announcement.reads.map((read) => read.userId));
      const unreadUsers = recipients.filter((userId) => !readUserIds.has(userId));
      const unreadUserRows = unreadUsers.length
        ? await prisma.user.findMany({
            where: {
              id: {
                in: unreadUsers
              }
            },
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            },
            take: 8
          })
        : [];
      return {
        announcementId: announcement.id,
        recipientCount: recipients.length,
        readCount: readUserIds.size,
        unreadCount: unreadUsers.length,
        unreadUsers: unreadUserRows
      };
    })
  );
  const announcementStatById = new Map(announcementStats.map((stat) => [stat.announcementId, stat]));
  const announcementReminderRows = visibleAnnouncements.length
    ? await prisma.auditLog.findMany({
        where: {
          companyId: actor.companyId,
          action: "announcement.reminded",
          targetType: "announcement",
          targetId: {
            in: visibleAnnouncements.map((announcement) => announcement.id)
          }
        },
        include: {
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 100
      })
    : [];
  const announcementReminderLogsById = announcementReminderRows.reduce<Map<string, Array<{
    id: string;
    actor: {
      id: string;
      name: string;
      email: string;
      role: Role;
    } | null;
    createdAt: Date;
    unreadCount: number | null;
  }>>>((acc, row) => {
    const payload = getAuditPayloadRecord(row.payload);
    const current = acc.get(row.targetId) ?? [];
    current.push({
      id: row.id,
      actor: row.actor,
      createdAt: row.createdAt,
      unreadCount: typeof payload?.unreadCount === "number" ? payload.unreadCount : null
    });
    acc.set(row.targetId, current);
    return acc;
  }, new Map());
  const relatedNotificationConditions: Prisma.NotificationWhereInput[] = [];
  if (requestedAnnouncementId) {
    relatedNotificationConditions.push({
      metadata: {
        path: ["announcementId"],
        equals: requestedAnnouncementId
      }
    });
  }
  if (requestedLibraryItemId) {
    relatedNotificationConditions.push({
      metadata: {
        path: ["libraryItemId"],
        equals: requestedLibraryItemId
      }
    });
  }
  if (requestedDocumentId) {
    relatedNotificationConditions.push({
      metadata: {
        path: ["documentRequestId"],
        equals: requestedDocumentId
      }
    });
  }
  const relatedNotifications = relatedNotificationConditions.length
    ? await prisma.notification.findMany({
        where: {
          companyId: actor.companyId,
          userId: actor.id,
          OR: relatedNotificationConditions
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 8
      })
    : [];
  const taskNotificationRows = await prisma.notification.findMany({
    where: {
      companyId: actor.companyId,
      userId: actor.id,
      isRead: false,
      archivedAt: null,
      type: {
        in: [
          NotificationType.WORKBOX_COMMENT,
          NotificationType.WORKBOX_MENTION,
          NotificationType.WORKBOX_ASSIGNED,
          NotificationType.PAYROLL_STATEMENT,
          NotificationType.DOCUMENT_REQUEST
        ]
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 12
  });
  const downloadedLibraryVersionIdsByActor = new Set(
    libraryDownloadRows.filter((row) => row.actor?.id === actor.id).map((row) => row.targetId)
  );
  const recentLibraryCutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const libraryReviewTasks = visibleLibraryItems
    .flatMap((item) => {
      const visibleVersions = item.versions
        .map((version) => ({
          ...version,
          isHidden: libraryVersionHiddenById.get(version.id) ?? false
        }))
        .filter((version) => canManageGroupware || !version.isHidden);
      const latestVersion = visibleVersions[0] ?? null;
      if (
        !latestVersion ||
        item.createdById === actor.id ||
        latestVersion.createdAt < recentLibraryCutoff ||
        downloadedLibraryVersionIdsByActor.has(latestVersion.id)
      ) {
        return [];
      }
      return [
        {
          id: `library-review-${latestVersion.id}`,
          type: "library" as const,
          label: libraryPinnedByItemId.get(item.id) ? "중요 자료 확인" : "자료 확인 요청",
          title: item.title,
          detail: `${libraryCategoryLabel(item.category)} · ${latestVersion.originalName}`,
          href: libraryGroupwareHref(item.id),
          tone: libraryPinnedByItemId.get(item.id) ? "yellow" : "gray",
          createdAt: latestVersion.createdAt,
          priority: libraryPinnedByItemId.get(item.id) ? 2 : 1
        }
      ];
    })
    .slice(0, 6);
  const taskInbox = [
    ...visibleAnnouncements
      .filter((announcement) => {
        const expiresAt = announcementExpiresAtById.get(announcement.id) ?? null;
        return isPublishedAnnouncement(announcement) && !announcement.reads.some((read) => read.userId === actor.id) && (!expiresAt || expiresAt > new Date());
      })
      .slice(0, 6)
      .map((announcement) => ({
        id: `announcement-${announcement.id}`,
        type: announcement.category === "TEAM" ? "board" as const : "announcement" as const,
        label: announcement.category === "TEAM" ? "읽지 않은 게시글" : "읽지 않은 공지",
        title: announcement.title,
        detail: `${announcement.author.name} · ${announcementCategoryLabel(announcement.category)}`,
        href: announcementGroupwareHref(announcement.category, announcement.id),
        tone: announcement.isPinned ? "yellow" : "gray",
        createdAt: announcement.publishAt ?? announcement.createdAt,
        priority: announcement.isPinned ? 3 : 2
      })),
    ...visibleDocumentRequests
      .filter((document) => {
        if (document.status !== DocumentRequestStatus.PENDING) {
          return false;
        }
        return (
          document.reviewerId === actor.id ||
          document.approvalSteps.some((step) => step.status === DocumentApprovalStepStatus.PENDING && step.approverId === actor.id) ||
          (canManageGroupware && document.requesterId !== actor.id)
        );
      })
      .slice(0, 6)
      .map((document) => ({
        id: `document-${document.id}`,
        type: "document" as const,
        label: document.requesterId === actor.id ? "상신 결재 진행 중" : "승인 대기 결재",
        title: document.title,
        detail: `${document.documentNumber ?? "문서번호 대기"} · ${document.requester.name}`,
        href: documentGroupwareHref(document.id),
        tone: document.requesterId === actor.id ? "gray" : "yellow",
        createdAt: document.createdAt,
        priority: document.requesterId === actor.id ? 1 : 3
      })),
    ...taskNotificationRows.map((notification) => {
      const isPayroll = notification.type === NotificationType.PAYROLL_STATEMENT;
      const isDocument = notification.type === NotificationType.DOCUMENT_REQUEST;
      const isMention = notification.type === NotificationType.WORKBOX_MENTION;
      return {
        id: `notification-${notification.id}`,
        type: isPayroll ? "payroll" as const : isDocument ? "document" as const : "memo" as const,
        label: isPayroll ? "새 급여명세" : isDocument ? "전자결재 알림" : isMention ? "내 멘션" : "댓글/담당 메모",
        title: notification.title,
        detail: notification.message,
        href: notification.actionUrl ?? "/dashboard?view=notifications",
        tone: isMention || isDocument ? "yellow" : "gray",
        createdAt: notification.createdAt,
        priority: isMention || isDocument ? 3 : 2
      };
    }),
    ...libraryReviewTasks
  ]
    .sort((left, right) => right.priority - left.priority || right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 12);

  return {
    profileMemoThreads,
    memoStatsByUser,
    taskInbox,
    payrollMonths: Array.from({ length: 6 }, (_, index) => addMonths(currentMonth, -index)),
    currentMonth,
    announcements: visibleAnnouncements.map((announcement) => {
      const expiresAt = announcementExpiresAtById.get(announcement.id) ?? null;
      return {
      ...announcement,
      isReadByViewer: announcement.reads.some((read) => read.userId === actor.id),
      readStats: announcementStatById.get(announcement.id) ?? {
        announcementId: announcement.id,
        recipientCount: 0,
        readCount: 0,
        unreadCount: 0,
        unreadUsers: []
      },
      isPublished: isPublishedAnnouncement(announcement),
      expiresAt,
      isExpired: Boolean(expiresAt && expiresAt <= new Date()),
      reminderLogs: announcementReminderLogsById.get(announcement.id) ?? []
      };
    }),
    unreadAnnouncementCount: visibleAnnouncements.filter((announcement) => isPublishedAnnouncement(announcement) && !announcement.reads.some((read) => read.userId === actor.id)).length,
    performanceGoals,
    payrollIssues,
    documentRequests: visibleDocumentRequests.map((document) => ({
      ...document,
      workThread: documentThreadByTargetId.get(document.id) ?? null
    })),
    libraryItems: visibleLibraryItems.map((item) => ({
      ...item,
      isPinned: libraryPinnedByItemId.get(item.id) ?? false,
      isArchived: libraryArchivedByItemId.get(item.id) ?? false,
      accessPreview: libraryAccessPreviewByItemId.get(item.id) ?? {
        totalCount: 0,
        sampleUsers: []
      },
      permissionTest: libraryPermissionUser
        ? {
            user: {
              id: libraryPermissionUser.id,
              name: libraryPermissionUser.name,
              email: libraryPermissionUser.email,
              role: libraryPermissionUser.role,
              teamName: libraryPermissionUser.team?.name ?? null
            },
            canAccess: libraryItemAccessibleByUser(item, libraryPermissionUser),
            reason: libraryAccessReason(item, libraryPermissionUser)
          }
        : null,
      downloadCount: libraryDownloadCountByItemId.get(item.id) ?? 0,
      downloadLogs: (libraryDownloadLogsByItemId.get(item.id) ?? []).slice(0, 10),
      versions: item.versions
        .map((version) => ({
          ...version,
          isHidden: libraryVersionHiddenById.get(version.id) ?? false,
          downloadCount: libraryDownloadCountByVersionId.get(version.id) ?? 0
        }))
        .filter((version) => canManageGroupware || !version.isHidden)
    })).sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || right.updatedAt.getTime() - left.updatedAt.getTime()),
    searchQuery: normalizedSearchFilters.search,
    searchFilters: {
      type: normalizedSearchFilters.type,
      category: normalizedSearchFilters.category,
      authorId: normalizedSearchFilters.authorId,
      from: normalizedSearchFilters.from,
      to: normalizedSearchFilters.to
    },
    searchResults,
    searchPreferences,
    operationFilters: {
      action: input?.operationAction?.trim() || "ALL",
      actorId: input?.operationActorId?.trim() || "",
      from: input?.operationFrom?.trim() || "",
      to: input?.operationTo?.trim() || ""
    },
    operationActions: [
      "ALL",
      ...groupwareOperationActions,
      "attachment.downloaded"
    ],
    operationLogs: operationRows.map(mapGroupwareOperationRow),
    libraryFilters: {
      status: libraryStatus,
      permissionUserId: libraryPermissionUserId ?? ""
    },
    relatedNotifications: relatedNotifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      message: notification.message,
      isRead: notification.isRead,
      readAt: notification.readAt,
      createdAt: notification.createdAt
    })),
    canManageGroupware,
    viewerRole: actor.role,
    canViewPayrollForOthers
  };
}

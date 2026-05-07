import { AnnouncementAudience, DocumentApprovalStepStatus, type Role, type User } from "@/generated/prisma";

import { canManage, canViewReports } from "@/lib/auth";
import { roleLabel } from "@/lib/display-labels";
import { prisma } from "@/lib/prisma";

type MatrixUser = Pick<User, "id" | "name" | "email" | "role" | "teamId"> & {
  team?: {
    id: string;
    name: string;
  } | null;
};

type ResourceCheck = {
  id: string;
  type: "announcement" | "board" | "library" | "document" | "payroll" | "operations";
  typeLabel: string;
  title: string;
  scope: string;
  canAccess: boolean;
  reason: string;
  href: string;
  updatedAt: Date;
};

const announcementExpiryAction = "announcement.expiry.saved";
const libraryArchiveAction = "document_library.archive.saved";
const libraryVersionVisibilityAction = "document_library.version.visibility.saved";

function dashboardHref(params: Record<string, string | null | undefined>, hash?: string) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  return `/dashboard?${search.toString()}${hash ? `#${hash}` : ""}`;
}

function readPayloadDate(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readPayloadBoolean(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  return (payload as Record<string, unknown>)[key] === true;
}

function roleCapability(role: Role, key: string) {
  const manager = canManage(role);
  const reports = canViewReports(role);
  const admin = role === "ADMIN";

  const cells: Record<string, { level: "full" | "limited" | "own" | "none"; detail: string }> = {
    notice: manager
      ? { level: "full", detail: "전체/팀 공지 조회와 등록 가능" }
      : { level: "limited", detail: "공개 또는 소속 팀 공지 조회" },
    board: { level: "full", detail: manager ? "게시판 조회와 운영 가능" : "게시글 작성과 공개/팀 게시글 조회" },
    library: reports
      ? { level: "full", detail: "전체/팀/HR 자료 조회 가능" }
      : role === "MANAGER"
        ? { level: "limited", detail: "전체/소속 팀 자료, 직접 등록 자료 조회" }
        : { level: "limited", detail: "전체/소속 팀 자료 조회" },
    document: reports
      ? { level: "full", detail: "전체 전자결재 조회와 처리 가능" }
      : role === "MANAGER"
        ? { level: "limited", detail: "본인 요청, 검토/승인 담당 문서 조회" }
        : { level: "own", detail: "본인 요청 문서와 결재 담당 문서 조회" },
    payroll: reports
      ? { level: "full", detail: "전체 급여명세 발행/조회 가능" }
      : { level: "own", detail: "본인 급여명세만 조회" },
    operations: manager
      ? { level: admin ? "full" : "limited", detail: admin ? "전체 운영 로그와 설정 접근" : "그룹웨어 운영 로그 조회" }
      : { level: "none", detail: "운영 로그 접근 불가" }
  };

  return cells[key] ?? { level: "none", detail: "-" };
}

function canAccessAnnouncement(
  announcement: {
    authorId: string;
    audience: AnnouncementAudience;
    teamId: string | null;
    publishAt: Date | null;
  },
  user: MatrixUser,
  expiresAt: Date | null
) {
  if (canManage(user.role) || announcement.authorId === user.id) {
    return { canAccess: true, reason: "운영 권한 또는 작성자 권한으로 조회됩니다." };
  }
  if (announcement.publishAt && announcement.publishAt > new Date()) {
    return { canAccess: false, reason: "아직 게시 전인 예약 게시물입니다." };
  }
  if (expiresAt && expiresAt <= new Date()) {
    return { canAccess: false, reason: "만료된 게시물입니다." };
  }
  if (announcement.audience === AnnouncementAudience.ALL) {
    return { canAccess: true, reason: "전체 공개 게시물입니다." };
  }
  if (announcement.teamId && user.teamId === announcement.teamId) {
    return { canAccess: true, reason: "사용자 소속 팀 대상 게시물입니다." };
  }
  return { canAccess: false, reason: "사용자 소속 팀과 게시물 대상 팀이 다릅니다." };
}

function canAccessLibrary(
  item: {
    accessScope: string;
    teamId: string | null;
    createdById: string;
  },
  user: MatrixUser,
  isArchived: boolean,
  latestVersionHidden: boolean
) {
  if ((isArchived || latestVersionHidden) && !canManage(user.role)) {
    return {
      canAccess: false,
      reason: isArchived ? "보관 처리된 자료는 운영 권한만 조회합니다." : "숨김 버전은 운영 권한만 조회합니다."
    };
  }
  if (item.accessScope === "ALL") {
    return { canAccess: true, reason: "전체 공개 자료입니다." };
  }
  if (item.accessScope === "TEAM") {
    return user.teamId && user.teamId === item.teamId
      ? { canAccess: true, reason: "사용자 소속 팀과 자료 공개 팀이 일치합니다." }
      : { canAccess: false, reason: "사용자 소속 팀과 자료 공개 팀이 다릅니다." };
  }
  if (item.accessScope === "HR") {
    return canViewReports(user.role)
      ? { canAccess: true, reason: "HR/관리자 공개 자료를 볼 수 있는 역할입니다." }
      : { canAccess: false, reason: "HR/관리자 전용 자료입니다." };
  }
  return canManage(user.role) && item.createdById === user.id
    ? { canAccess: true, reason: "직접 등록한 자료입니다." }
    : { canAccess: false, reason: "자료 공개 범위에 포함되지 않습니다." };
}

function canAccessDocument(
  document: {
    requesterId: string;
    reviewerId: string | null;
    approvalSteps: Array<{ approverId: string | null }>;
  },
  user: MatrixUser
) {
  if (canViewReports(user.role)) {
    return { canAccess: true, reason: "HR/관리자는 전체 전자결재를 조회합니다." };
  }
  if (document.requesterId === user.id) {
    return { canAccess: true, reason: "본인이 상신한 문서입니다." };
  }
  if (document.reviewerId === user.id || document.approvalSteps.some((step) => step.approverId === user.id)) {
    return { canAccess: true, reason: "검토자 또는 결재선에 포함된 문서입니다." };
  }
  return { canAccess: false, reason: "상신자, 검토자, 결재선에 포함되지 않습니다." };
}

export async function getPermissionMatrixSummary(companyId: string, selectedUserId?: string | null) {
  const users = await prisma.user.findMany({
    where: {
      companyId,
      isActive: true
    },
    include: {
      team: true
    },
    orderBy: [{ role: "asc" }, { team: { name: "asc" } }, { name: "asc" }]
  });
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? users.find((user) => user.role === "EMPLOYEE") ?? users[0] ?? null;

  const roleRows = (["ADMIN", "HR", "MANAGER", "EMPLOYEE"] as Role[]).map((role) => ({
    role,
    label: roleLabel(role),
    capabilities: [
      { key: "notice", label: "공지", ...roleCapability(role, "notice") },
      { key: "board", label: "게시판", ...roleCapability(role, "board") },
      { key: "library", label: "자료실", ...roleCapability(role, "library") },
      { key: "document", label: "전자결재", ...roleCapability(role, "document") },
      { key: "payroll", label: "급여", ...roleCapability(role, "payroll") },
      { key: "operations", label: "운영 로그", ...roleCapability(role, "operations") }
    ]
  }));

  if (!selectedUser) {
    return {
      roleRows,
      selectedUser: null,
      resourceChecks: [],
      totals: {
        total: 0,
        accessible: 0,
        blocked: 0
      }
    };
  }

  const [announcements, libraryItems, documents, payrollIssues, recentOperation, expiryRows, archiveRows] = await Promise.all([
    prisma.announcement.findMany({
      where: {
        companyId
      },
      include: {
        team: true
      },
      orderBy: [{ createdAt: "desc" }],
      take: 8
    }),
    prisma.documentLibraryItem.findMany({
      where: {
        companyId
      },
      include: {
        team: true,
        versions: {
          orderBy: {
            versionNo: "desc"
          },
          take: 1
        }
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 8
    }),
    prisma.documentRequest.findMany({
      where: {
        companyId
      },
      include: {
        requester: true,
        reviewer: true,
        approvalSteps: {
          where: {
            status: DocumentApprovalStepStatus.PENDING
          }
        }
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 8
    }),
    prisma.payrollStatementIssue.findMany({
      where: {
        companyId
      },
      include: {
        user: true
      },
      orderBy: [{ month: "desc" }, { issuedAt: "desc" }],
      take: 8
    }),
    prisma.auditLog.findFirst({
      where: {
        companyId,
        OR: [
          { action: { startsWith: "ops." } },
          { action: { startsWith: "document_library." } },
          { action: { startsWith: "announcement." } },
          { action: "attachment.downloaded" }
        ]
      },
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.auditLog.findMany({
      where: {
        companyId,
        action: announcementExpiryAction,
        targetType: "announcement"
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 80
    }),
    prisma.auditLog.findMany({
      where: {
        companyId,
        action: {
          in: [libraryArchiveAction, libraryVersionVisibilityAction]
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 120
    })
  ]);

  const expiresAtByAnnouncementId = new Map<string, Date | null>();
  for (const row of expiryRows) {
    if (!expiresAtByAnnouncementId.has(row.targetId)) {
      expiresAtByAnnouncementId.set(row.targetId, readPayloadDate(row.payload, "expiresAt"));
    }
  }
  const archivedByItemId = new Map<string, boolean>();
  const hiddenByVersionId = new Map<string, boolean>();
  for (const row of archiveRows) {
    if (row.action === libraryArchiveAction && !archivedByItemId.has(row.targetId)) {
      archivedByItemId.set(row.targetId, readPayloadBoolean(row.payload, "isArchived"));
    }
    if (row.action === libraryVersionVisibilityAction && !hiddenByVersionId.has(row.targetId)) {
      hiddenByVersionId.set(row.targetId, readPayloadBoolean(row.payload, "isHidden"));
    }
  }

  const resourceChecks: ResourceCheck[] = [
    ...announcements.map((announcement) => {
      const result = canAccessAnnouncement(
        announcement,
        selectedUser,
        expiresAtByAnnouncementId.get(announcement.id) ?? null
      );
      const isBoard = announcement.category === "TEAM";
      return {
        id: `announcement-${announcement.id}`,
        type: isBoard ? "board" : "announcement",
        typeLabel: isBoard ? "게시판" : "공지",
        title: announcement.title,
        scope: announcement.audience === "TEAM" ? announcement.team?.name ?? "팀 지정 없음" : "전체",
        canAccess: result.canAccess,
        reason: result.reason,
        href: dashboardHref(
          {
            view: "groupware",
            groupwareTab: "announcements",
            groupwareAnnouncementId: announcement.id
          },
          isBoard ? "groupware-board" : "groupware-announcements"
        ),
        updatedAt: announcement.updatedAt
      } satisfies ResourceCheck;
    }),
    ...libraryItems.map((item) => {
      const latestVersion = item.versions[0] ?? null;
      const result = canAccessLibrary(
        item,
        selectedUser,
        archivedByItemId.get(item.id) ?? false,
        latestVersion ? hiddenByVersionId.get(latestVersion.id) ?? false : false
      );
      return {
        id: `library-${item.id}`,
        type: "library",
        typeLabel: "자료실",
        title: item.title,
        scope: item.accessScope === "TEAM" ? item.team?.name ?? "팀 지정 없음" : item.accessScope === "HR" ? "HR/관리자" : "전체",
        canAccess: result.canAccess,
        reason: result.reason,
        href: dashboardHref(
          {
            view: "groupware",
            groupwareTab: "library",
            groupwareLibraryItemId: item.id
          },
          "groupware-library"
        ),
        updatedAt: item.updatedAt
      } satisfies ResourceCheck;
    }),
    ...documents.map((document) => {
      const result = canAccessDocument(document, selectedUser);
      return {
        id: `document-${document.id}`,
        type: "document",
        typeLabel: "전자결재",
        title: document.title,
        scope: `${document.requester.name} 상신${document.reviewer ? ` · 검토 ${document.reviewer.name}` : ""}`,
        canAccess: result.canAccess,
        reason: result.reason,
        href: dashboardHref(
          {
            view: "groupware",
            groupwareTab: "documents",
            groupwareDocumentId: document.id
          },
          "groupware-documents"
        ),
        updatedAt: document.updatedAt
      } satisfies ResourceCheck;
    }),
    ...payrollIssues.map((issue) => {
      const canAccess = canViewReports(selectedUser.role) || issue.userId === selectedUser.id;
      return {
        id: `payroll-${issue.id}`,
        type: "payroll",
        typeLabel: "급여",
        title: `${issue.month} ${issue.user.name} 급여명세`,
        scope: issue.userId === selectedUser.id ? "본인" : "타 직원",
        canAccess,
        reason: canAccess ? "본인 급여명세이거나 HR/관리자 권한입니다." : "타 직원 급여명세는 HR/관리자만 조회합니다.",
        href: dashboardHref(
          {
            view: "groupware",
            groupwareTab: "operations",
            orgUserId: issue.userId
          },
          "groupware-payroll-statements"
        ),
        updatedAt: issue.updatedAt
      } satisfies ResourceCheck;
    }),
    {
      id: "operations-live",
      type: "operations" as const,
      typeLabel: "운영 로그",
      title: recentOperation ? "최근 운영 로그" : "운영 로그",
      scope: "그룹웨어/배포/첨부 감사",
      canAccess: canManage(selectedUser.role),
      reason: canManage(selectedUser.role) ? "팀장 이상 역할은 운영 로그 탭을 조회합니다." : "직원 역할은 운영 로그를 조회하지 않습니다.",
      href: dashboardHref(
        {
          view: "groupware",
          groupwareTab: "operations"
        },
        "groupware-operations"
      ),
      updatedAt: recentOperation?.createdAt ?? new Date()
    } satisfies ResourceCheck
  ].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

  return {
    roleRows,
    selectedUser: {
      id: selectedUser.id,
      name: selectedUser.name,
      email: selectedUser.email,
      role: selectedUser.role,
      teamName: selectedUser.team?.name ?? null
    },
    resourceChecks,
    totals: {
      total: resourceChecks.length,
      accessible: resourceChecks.filter((item) => item.canAccess).length,
      blocked: resourceChecks.filter((item) => !item.canAccess).length
    }
  };
}

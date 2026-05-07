import { Bell, BriefcaseBusiness, Download, FileText, FolderOpen, History, Mail, MessageSquareText, Paperclip, Phone, Search, Target, Users } from "lucide-react";
import Link from "next/link";

import {
  AnnouncementForm,
  AnnouncementCommentForm,
  AnnouncementCommentDeleteButton,
  AnnouncementManageActions,
  AnnouncementReadButton,
  DocumentApprovalLineActions,
  DocumentLibraryForm,
  DocumentLibraryManageActions,
  DocumentRequestForm,
  DocumentResubmitButton,
  DocumentReviewButtons,
  GroupwareSearchPresetActions,
  PayrollIssueForm,
  PerformanceGoalForm,
  PerformanceGoalUpdateForm,
  ProfileMemoForm
} from "@/components/groupware-actions";
import {
  announcementCategoryLabel,
  documentCategoryLabel,
  documentStatusLabel,
  documentStatusTone,
  libraryCategoryLabel,
  libraryScopeLabel,
  payrollStatementStatusLabel,
  roleLabel,
  workThreadStatusLabel,
  workThreadStatusTone
} from "@/lib/display-labels";
import type { getGroupwareDashboard } from "@/lib/groupware";
import type { getOrganizationDashboard } from "@/lib/organization";
import { formatKstDateTime } from "@/lib/time";
import { canPreviewAttachment } from "@/lib/uploads";

type GroupwareSummary = Awaited<ReturnType<typeof getGroupwareDashboard>>;
type OrganizationSummary = Awaited<ReturnType<typeof getOrganizationDashboard>>;

type GroupwareUserOption = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type GroupwareTab =
  | "overview"
  | "announcements"
  | "documents"
  | "library"
  | "operations";
type NoticeFilter = "ALL" | "UNREAD" | "READ" | "SCHEDULED" | "EXPIRED";

function groupwareHref(params?: {
  tab?: GroupwareTab;
  userId?: string | null;
  teamId?: string | null;
  search?: string | null;
  groupwareSearch?: string | null;
  searchType?: string | null;
  searchCategory?: string | null;
  searchAuthorId?: string | null;
  searchFrom?: string | null;
  searchTo?: string | null;
  noticeFilter?: string | null;
  libraryCategory?: string | null;
  librarySearch?: string | null;
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
  const search = new URLSearchParams();
  search.set("view", "groupware");
  if (params?.tab) {
    search.set("groupwareTab", params.tab);
  }
  if (params?.userId) {
    search.set("orgUserId", params.userId);
  }
  if (params?.teamId) {
    search.set("orgTeamId", params.teamId);
  }
  if (params?.search) {
    search.set("orgSearch", params.search);
  }
  if (params?.groupwareSearch) {
    search.set("groupwareSearch", params.groupwareSearch);
  }
  if (params?.searchType) {
    search.set("groupwareSearchType", params.searchType);
  }
  if (params?.searchCategory) {
    search.set("groupwareSearchCategory", params.searchCategory);
  }
  if (params?.searchAuthorId) {
    search.set("groupwareSearchAuthorId", params.searchAuthorId);
  }
  if (params?.searchFrom) {
    search.set("groupwareSearchFrom", params.searchFrom);
  }
  if (params?.searchTo) {
    search.set("groupwareSearchTo", params.searchTo);
  }
  if (params?.noticeFilter) {
    search.set("groupwareNoticeFilter", params.noticeFilter);
  }
  if (params?.libraryCategory) {
    search.set("groupwareLibraryCategory", params.libraryCategory);
  }
  if (params?.librarySearch) {
    search.set("groupwareLibrarySearch", params.librarySearch);
  }
  if (params?.operationAction) {
    search.set("groupwareOperationAction", params.operationAction);
  }
  if (params?.operationActorId) {
    search.set("groupwareOperationActorId", params.operationActorId);
  }
  if (params?.operationFrom) {
    search.set("groupwareOperationFrom", params.operationFrom);
  }
  if (params?.operationTo) {
    search.set("groupwareOperationTo", params.operationTo);
  }
  if (params?.libraryStatus) {
    search.set("groupwareLibraryStatus", params.libraryStatus);
  }
  if (params?.libraryPermissionUserId) {
    search.set("groupwareLibraryPermissionUserId", params.libraryPermissionUserId);
  }
  if (params?.announcementId) {
    search.set("groupwareAnnouncementId", params.announcementId);
  }
  if (params?.libraryItemId) {
    search.set("groupwareLibraryItemId", params.libraryItemId);
  }
  if (params?.documentId) {
    search.set("groupwareDocumentId", params.documentId);
  }
  return `/dashboard?${search.toString()}`;
}

function payrollStatementHref(month: string, format: "pdf" | "csv", userId?: string | null) {
  const search = new URLSearchParams();
  search.set("format", format);
  if (userId) {
    search.set("userId", userId);
  }
  return `/api/payroll-statements/${month}?${search.toString()}`;
}

function contactActionPhone(phone?: string | null) {
  if (!phone) {
    return null;
  }
  return `tel:${phone.replace(/[^0-9+]/g, "")}`;
}

function performanceProgress(actualValue: number, targetValue: number) {
  if (targetValue <= 0) {
    return 0;
  }
  return Math.min(999, Math.round((actualValue / targetValue) * 100));
}

function operationActionLabel(action: string) {
  const labels: Record<string, string> = {
    ALL: "전체",
    "announcement.created": "게시물 등록",
    "announcement.updated": "게시물 수정",
    "announcement.deleted": "게시물 삭제",
    "announcement.reminded": "미확인 재알림",
    "announcement_comment.deleted": "댓글 삭제",
    "announcement.expiry.saved": "공지 만료일 변경",
    "document_library.pin.saved": "자료 중요 표시 변경",
    "document_library.archive.saved": "자료 보관 상태 변경",
    "document_library.version.visibility.saved": "자료 버전 공개 상태 변경",
    "document_library.access.denied": "자료 접근 차단",
    "groupware.audit_alert.sent": "운영 알림 발송",
    "document_library.version.created": "자료 등록",
    "document_library.item.updated": "자료 정보 수정",
    "document_request.approval_line.changed": "결재선 변경",
    "document_request.reviewed": "전자결재 처리",
    "document_request.delegated_reviewed": "대리 결재 처리",
    "document_request.resubmitted": "전자결재 재상신",
    "attachment.downloaded": "파일 다운로드"
  };
  return labels[action] ?? action;
}

export function GroupwarePanel({
  organization,
  groupware,
  mentionableUsers,
  assignableUsers,
  viewerId,
  activeTab,
  noticeFilter,
  libraryCategoryFilter,
  librarySearch,
  selectedAnnouncementId,
  selectedLibraryItemId,
  selectedDocumentId
}: {
  organization: OrganizationSummary;
  groupware: GroupwareSummary;
  mentionableUsers: GroupwareUserOption[];
  assignableUsers: GroupwareUserOption[];
  viewerId: string;
  activeTab: GroupwareTab;
  noticeFilter: string;
  libraryCategoryFilter: string;
  librarySearch: string;
  selectedAnnouncementId: string;
  selectedLibraryItemId: string;
  selectedDocumentId: string;
}) {
  const selected = organization.selectedUser;
  const selectedMemoStat = selected ? groupware.memoStatsByUser.find((item) => item.userId === selected.id) : null;
  const openProfileMemos = groupware.profileMemoThreads.filter((thread) => thread.status === "OPEN");
  const selectedProfileMemos = selected
    ? groupware.profileMemoThreads.filter((thread) => thread.targetUserId === selected.id).slice(0, 5)
    : [];
  const payrollTargetUserId = groupware.canViewPayrollForOthers ? selected?.id : viewerId;
  const visibleContacts = organization.users.slice(0, 18);
  const contactOptions = organization.users.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role
  }));
  const pendingDocuments = groupware.documentRequests.filter((document) => document.status === "PENDING");
  const boardAnnouncements = groupware.announcements.filter((announcement) => announcement.category === "TEAM");
  const noticeBaseAnnouncements = groupware.announcements.filter((announcement) => announcement.category !== "TEAM");
  const normalizedNoticeFilter = (["ALL", "UNREAD", "READ", "SCHEDULED", "EXPIRED"] as const).includes(noticeFilter as NoticeFilter)
    ? (noticeFilter as NoticeFilter)
    : "ALL";
  const noticeAnnouncements = noticeBaseAnnouncements.filter((announcement) => {
    if (normalizedNoticeFilter === "UNREAD") {
      return announcement.isPublished && !announcement.isExpired && !announcement.isReadByViewer;
    }
    if (normalizedNoticeFilter === "READ") {
      return announcement.isPublished && !announcement.isExpired && announcement.isReadByViewer;
    }
    if (normalizedNoticeFilter === "SCHEDULED") {
      return !announcement.isPublished;
    }
    if (normalizedNoticeFilter === "EXPIRED") {
      return announcement.isExpired;
    }
    return true;
  });
  const normalizedLibraryCategory = ["ALL", "POLICY", "CONTRACT", "LEAVE", "PAYROLL", "FORM"].includes(libraryCategoryFilter)
    ? libraryCategoryFilter
    : "ALL";
  const normalizedLibrarySearch = librarySearch.trim().toLowerCase();
  const filteredLibraryItems = groupware.libraryItems.filter((item) => {
    const matchesCategory = normalizedLibraryCategory === "ALL" || item.category === normalizedLibraryCategory;
    const matchesSearch =
      !normalizedLibrarySearch ||
      item.title.toLowerCase().includes(normalizedLibrarySearch) ||
      (item.description ?? "").toLowerCase().includes(normalizedLibrarySearch) ||
      item.versions.some((version) => version.originalName.toLowerCase().includes(normalizedLibrarySearch));
    return matchesCategory && matchesSearch;
  });
  const selectedAnnouncement = selectedAnnouncementId
    ? groupware.announcements.find((announcement) => announcement.id === selectedAnnouncementId) ?? null
    : null;
  const activeSelectedAnnouncement = selectedAnnouncement && activeTab === "announcements" ? selectedAnnouncement : null;
  const activeSelectedNotice = activeSelectedAnnouncement?.category === "TEAM" ? null : activeSelectedAnnouncement;
  const activeSelectedBoardPost = activeSelectedAnnouncement?.category === "TEAM" ? activeSelectedAnnouncement : null;
  const selectedLibraryItem = selectedLibraryItemId
    ? groupware.libraryItems.find((item) => item.id === selectedLibraryItemId) ?? null
    : null;
  const selectedDocument = selectedDocumentId
    ? groupware.documentRequests.find((document) => document.id === selectedDocumentId) ?? null
    : null;
  const roleAccessItems =
    groupware.viewerRole === "ADMIN"
      ? ["전체 공지/게시판 운영", "모든 자료 범위", "운영 로그", "급여/전자결재 관리"]
      : groupware.viewerRole === "HR"
        ? ["인사 공지 운영", "인사/전체 자료", "운영 로그", "급여명세 발행"]
        : groupware.viewerRole === "MANAGER"
          ? ["팀 공지와 게시판 운영", "팀 자료와 직접 등록 자료", "팀 운영 로그", "팀 실적/결재 관리"]
          : ["공지 확인", "게시판 작성", "공개 자료 열람", "본인 급여명세"];
  const unreadNoticeCount = noticeBaseAnnouncements.filter((announcement) => !announcement.isReadByViewer && announcement.isPublished && !announcement.isExpired).length;
  const unreadBoardCount = boardAnnouncements.filter((announcement) => !announcement.isReadByViewer && announcement.isPublished).length;
  const tabs: Array<{ key: GroupwareTab; label: string; count?: number }> = [
    { key: "overview", label: "개요" },
    { key: "announcements", label: "공지사항", count: unreadNoticeCount + unreadBoardCount },
    { key: "documents", label: "전자결재", count: pendingDocuments.length },
    { key: "library", label: "자료실", count: groupware.libraryItems.length },
    { key: "operations", label: "급여·운영", count: openProfileMemos.length + groupware.payrollIssues.length }
  ];
  const groupwareTabHref = (tab: GroupwareTab) =>
    groupwareHref({
      tab,
      userId: tab === "operations" ? selected?.id ?? viewerId : undefined,
      teamId: tab === "operations" ? organization.filters.teamId : undefined,
      search: tab === "operations" ? organization.filters.search : undefined,
      noticeFilter: tab === "announcements" ? normalizedNoticeFilter : undefined,
      libraryCategory: tab === "library" ? normalizedLibraryCategory : undefined,
      librarySearch: tab === "library" ? librarySearch : undefined
    });
  const libraryHref = (itemId?: string | null) =>
    `${groupwareHref({
      tab: "library",
      libraryItemId: itemId,
      libraryCategory: normalizedLibraryCategory,
      librarySearch: librarySearch,
      libraryStatus: groupware.libraryFilters.status,
      libraryPermissionUserId: groupware.libraryFilters.permissionUserId
    })}#groupware-library`;
  const documentHref = (documentId?: string | null) =>
    `${groupwareHref({
      tab: "documents",
      documentId
    })}#groupware-documents`;
  const operationExportHref = `/api/groupware/operations/export?${new URLSearchParams({
    action: groupware.operationFilters.action,
    actorId: groupware.operationFilters.actorId,
    from: groupware.operationFilters.from,
    to: groupware.operationFilters.to
  }).toString()}`;
  const libraryDownloadExportHref = (itemId?: string | null) =>
    `/api/groupware/library/downloads/export?${new URLSearchParams(itemId ? { itemId } : {}).toString()}`;
  const searchHref = (filters: {
    search?: string | null;
    type?: string | null;
    category?: string | null;
    authorId?: string | null;
    from?: string | null;
    to?: string | null;
  }) =>
    groupwareHref({
      groupwareSearch: filters.search,
      searchType: filters.type,
      searchCategory: filters.category,
      searchAuthorId: filters.authorId,
      searchFrom: filters.from,
      searchTo: filters.to
    });
  const weekStartDate = new Date();
  weekStartDate.setDate(weekStartDate.getDate() - ((weekStartDate.getDay() + 6) % 7));
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const currentSearchFilters = {
    search: groupware.searchQuery,
    type: groupware.searchFilters.type,
    category: groupware.searchFilters.category,
    authorId: groupware.searchFilters.authorId,
    from: groupware.searchFilters.from,
    to: groupware.searchFilters.to
  };
  const hasActiveGroupwareSearch = Boolean(
    currentSearchFilters.search ||
      currentSearchFilters.type !== "ALL" ||
      currentSearchFilters.category !== "ALL" ||
      currentSearchFilters.authorId ||
      currentSearchFilters.from ||
      currentSearchFilters.to
  );
  const quickSearches = [
    {
      label: "내가 작성한 글",
      href: searchHref({ type: "BOARD", authorId: viewerId })
    },
    {
      label: "내 부서 자료",
      href: searchHref({ type: "LIBRARY" })
    },
    {
      label: "이번 주 결재",
      href: searchHref({ type: "DOCUMENT", from: weekStart })
    }
  ];
  const attachmentLinks = (
    attachments: Array<{ id: string; originalName: string; mimeType: string }>,
    basePath: string
  ) => (
    <div className="actions-row" style={{ marginTop: 8 }}>
      {attachments.map((attachment) => {
        const href = `${basePath}/${attachment.id}`;
        return (
          <span className="actions-row" key={attachment.id}>
            {canPreviewAttachment(attachment) ? (
              <a className="button secondary" href={`${href}?preview=1`} target="_blank" rel="noreferrer">
                미리보기
              </a>
            ) : null}
            <a className="button secondary" href={href}>
              <Paperclip size={14} />
              {attachment.originalName}
            </a>
          </span>
        );
      })}
    </div>
  );
  const announcementCards = (items: typeof groupware.announcements, emptyMessage: string, variant: "list" | "detail" = "list") =>
    items.length > 0 ? (
      <div className="stack" style={{ gap: 8 }}>
        {items.map((announcement) => {
          const isBoardAnnouncement = announcement.category === "TEAM";
          const isOwnAnnouncement = announcement.author.id === viewerId;
          const canEditAnnouncement = groupware.canManageGroupware || (isBoardAnnouncement && isOwnAnnouncement);
          const announcementAnchor = isBoardAnnouncement ? "groupware-board" : "groupware-announcements";
          const detailHref = `${groupwareHref({
            tab: "announcements",
            announcementId: announcement.id,
            noticeFilter: isBoardAnnouncement ? undefined : normalizedNoticeFilter
          })}#${announcementAnchor}`;
          const listHref = `${groupwareHref({
            tab: "announcements",
            noticeFilter: isBoardAnnouncement ? undefined : normalizedNoticeFilter
          })}#${announcementAnchor}`;
          return (
          <div
            id={`groupware-announcement-${announcement.id}`}
            className={`notification-card groupware-card ${variant === "detail" ? "groupware-detail-card" : ""} ${announcement.isReadByViewer ? "read" : "unread"}`}
            key={announcement.id}
          >
            <div className="groupware-card-main">
              <div className="actions-row groupware-card-title">
                {variant === "detail" ? (
                  <h3 style={{ margin: 0 }}>{announcement.title}</h3>
                ) : (
                  <strong>{announcement.title}</strong>
                )}
                <span className="status-pill gray">{announcementCategoryLabel(announcement.category)}</span>
                <span className="status-pill gray">{announcement.audience === "TEAM" ? announcement.team?.name ?? "팀" : "전체"}</span>
                {isOwnAnnouncement ? <span className="status-pill green">내 글</span> : null}
                {announcement.isPinned ? <span className="status-pill yellow">고정</span> : null}
                {!announcement.isPublished ? <span className="status-pill yellow">예약</span> : null}
                {announcement.isExpired ? <span className="status-pill red">만료</span> : null}
              </div>
              <p className="muted" style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
                {announcement.body}
              </p>
              {announcement.attachments.length > 0 ? attachmentLinks(announcement.attachments, "/api/groupware/announcement-attachments") : null}
              <p className="muted" style={{ margin: "6px 0 0" }}>
                {announcement.author.name} · 읽음 {announcement.readStats.readCount}/{announcement.readStats.recipientCount}명 · 미확인 {announcement.readStats.unreadCount}명 · {formatKstDateTime(announcement.publishAt ?? announcement.createdAt)}
                {announcement.expiresAt ? ` · 만료 ${formatKstDateTime(announcement.expiresAt)}` : ""}
              </p>
              {groupware.canManageGroupware && announcement.readStats.unreadUsers.length > 0 ? (
                <p className="muted" style={{ margin: "6px 0 0" }}>
                  미확인: {announcement.readStats.unreadUsers.map((user) => user.name).join(", ")}
                </p>
              ) : null}
              {variant === "detail" && groupware.relatedNotifications.length > 0 ? (
                <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                  <strong>관련 알림</strong>
                  {groupware.relatedNotifications.map((notification) => (
                    <div className="groupware-operation-log" key={notification.id}>
                      <strong>{notification.title}</strong>
                      <span className={`status-pill ${notification.isRead ? "gray" : "yellow"}`}>
                        {notification.isRead ? "읽음" : "읽지 않음"}
                      </span>
                      <span className="muted">{notification.readAt ? formatKstDateTime(notification.readAt) : formatKstDateTime(notification.createdAt)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {variant === "detail" && groupware.canManageGroupware && announcement.reminderLogs.length > 0 ? (
                <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                  <strong>재알림 이력</strong>
                  {announcement.reminderLogs.map((log) => (
                    <div className="groupware-operation-log" key={log.id}>
                      <strong>{log.actor?.name ?? "시스템"}</strong>
                      <span className="muted">대상 {log.unreadCount ?? 0}명</span>
                      <span className="muted">{formatKstDateTime(log.createdAt)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {announcement.comments.length > 0 ? (
                <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                  {announcement.comments.map((comment) => (
                    <div className="actions-row" key={comment.id} style={{ justifyContent: "space-between" }}>
                      <p className="muted" style={{ margin: 0 }}>
                        {comment.author.name}: {comment.body}
                      </p>
                      {(groupware.canManageGroupware || comment.author.id === viewerId) ? (
                        <AnnouncementCommentDeleteButton announcementId={announcement.id} commentId={comment.id} />
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {announcement.allowComments ? <AnnouncementCommentForm announcementId={announcement.id} /> : null}
              <div className="actions-row groupware-card-actions">
                <Link className="button secondary" href={variant === "detail" ? listHref : detailHref}>
                  {variant === "detail" ? "목록" : "상세"}
                </Link>
              </div>
              <AnnouncementManageActions
                announcement={{
                  id: announcement.id,
                  title: announcement.title,
                  body: announcement.body,
                  allowComments: announcement.allowComments,
                  isPinned: announcement.isPinned,
                  expiresAt: announcement.expiresAt ? announcement.expiresAt.toISOString().slice(0, 16) : null,
                  unreadCount: announcement.readStats.unreadCount
                }}
                canEdit={canEditAnnouncement}
                canDelete={canEditAnnouncement}
                canPin={groupware.canManageGroupware}
                canRemind={groupware.canManageGroupware && announcement.isPublished && !announcement.isExpired}
                isBoard={isBoardAnnouncement}
              />
            </div>
            <AnnouncementReadButton announcementId={announcement.id} isRead={announcement.isReadByViewer} />
          </div>
          );
        })}
      </div>
    ) : (
      <div className="empty">{emptyMessage}</div>
    );

  return (
    <div className="stack" style={{ gap: 18 }}>
      <nav className="dashboard-tabs" aria-label="그룹웨어 하위 메뉴">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={groupwareTabHref(tab.key)}
            aria-current={activeTab === tab.key ? "page" : undefined}
          >
            {tab.label}
            {typeof tab.count === "number" ? <span>{tab.count}</span> : null}
          </Link>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <>
          <div className="grid-4">
            <div className="metric">
              <span>공지 미읽음</span>
              <strong>{unreadNoticeCount}건</strong>
            </div>
            <div className="metric">
              <span>결재 대기</span>
              <strong>{pendingDocuments.length}건</strong>
            </div>
            <div className="metric">
              <span>자료실</span>
              <strong>{groupware.libraryItems.length}건</strong>
            </div>
            <div className="metric">
              <span>미결 메모</span>
              <strong>{openProfileMemos.length}건</strong>
            </div>
          </div>

          <div className="panel groupware-access-panel">
            <div>
              <span className="status-pill gray">{roleLabel(groupware.viewerRole)}</span>
              <strong style={{ display: "block", marginTop: 8 }}>권한별 그룹웨어 화면</strong>
            </div>
            <div className="actions-row">
              {roleAccessItems.map((item) => (
                <span className="status-pill gray" key={item}>{item}</span>
              ))}
            </div>
          </div>

          <div className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>내가 처리해야 할 것</h2>
              <span className="status-pill gray">
                {groupware.taskInbox.length}건
              </span>
            </div>
            <div className="grid-4">
              <Link className="quick-link-card" href={`${groupwareHref({ tab: "announcements", noticeFilter: "UNREAD" })}#groupware-announcements`}>
                <Bell size={18} />
                <strong>미확인 공지</strong>
                <span className="muted">{unreadNoticeCount}건</span>
              </Link>
              <Link className="quick-link-card" href={`${groupwareHref({ tab: "documents" })}#groupware-documents`}>
                <FileText size={18} />
                <strong>전자결재 대기</strong>
                <span className="muted">{pendingDocuments.length}건</span>
              </Link>
              <Link className="quick-link-card" href={`${groupwareHref({ tab: "operations" })}#groupware-memos`}>
                <MessageSquareText size={18} />
                <strong>담당 메모</strong>
                <span className="muted">{openProfileMemos.length}건</span>
              </Link>
              <Link className="quick-link-card" href={`${groupwareHref({ tab: "operations" })}#groupware-payroll-statements`}>
                <Download size={18} />
                <strong>급여명세</strong>
                <span className="muted">{groupware.payrollIssues.length}건</span>
              </Link>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {groupware.taskInbox.length > 0 ? (
                groupware.taskInbox.map((task) => {
                  const TaskIcon =
                    task.type === "document"
                      ? FileText
                      : task.type === "library"
                        ? FolderOpen
                        : task.type === "payroll"
                          ? Download
                          : task.type === "memo"
                            ? MessageSquareText
                            : Bell;
                  return (
                    <Link className="notification-card read" href={task.href} key={task.id} style={{ textDecoration: "none" }}>
                      <div className="actions-row" style={{ gap: 10, alignItems: "flex-start" }}>
                        <TaskIcon size={17} />
                        <div>
                          <span className={`status-pill ${task.tone}`}>{task.label}</span>
                          <strong style={{ display: "block", marginTop: 6 }}>{task.title}</strong>
                          <p className="muted" style={{ margin: "6px 0 0" }}>
                            {task.detail} · {formatKstDateTime(task.createdAt)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <div className="empty">지금 바로 처리할 그룹웨어 항목이 없습니다.</div>
              )}
            </div>
          </div>

      <div className="groupware-mobile-quick-actions">
        <Link className="button secondary" href={`${groupwareHref({ tab: "announcements", noticeFilter: "UNREAD" })}#groupware-announcements`}>
          공지 확인
        </Link>
        <Link className="button secondary" href={`${groupwareHref({ tab: "announcements" })}#groupware-board`}>
          게시글 작성
        </Link>
        <Link className="button secondary" href={`${groupwareHref({ tab: "library" })}#groupware-library`}>
          자료 검색
        </Link>
        <Link className="button secondary" href={`${groupwareHref({ tab: "documents" })}#groupware-documents`}>
          결재 확인
        </Link>
        <Link className="button secondary" href={`${groupwareHref({ tab: "operations" })}#groupware-payroll-statements`}>
          급여명세
        </Link>
      </div>

      <form action="/dashboard" className="panel inline-form">
        <input type="hidden" name="view" value="groupware" />
        <div className="grid-4">
          <div className="field">
            <label htmlFor="groupware-integrated-search">통합 검색</label>
            <input id="groupware-integrated-search" name="groupwareSearch" defaultValue={groupware.searchQuery} placeholder="직원, 공지, 게시글, 메모, 결재, 급여명세, 자료" />
          </div>
          <div className="field">
            <label htmlFor="groupware-search-type">결과 유형</label>
            <select id="groupware-search-type" name="groupwareSearchType" defaultValue={groupware.searchFilters.type}>
              <option value="ALL">전체</option>
              <option value="ANNOUNCEMENT">공지사항</option>
              <option value="BOARD">게시판</option>
              <option value="LIBRARY">자료실</option>
              <option value="USER">직원</option>
              <option value="DOCUMENT">전자결재</option>
              <option value="PAYROLL">급여명세</option>
              <option value="MEMO">메모</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="groupware-search-category">분류</label>
            <select id="groupware-search-category" name="groupwareSearchCategory" defaultValue={groupware.searchFilters.category}>
              <option value="ALL">전체</option>
              <option value="NOTICE">공지</option>
              <option value="HR">인사 안내</option>
              <option value="TEAM">게시판</option>
              <option value="POLICY">회사 규정</option>
              <option value="CONTRACT">계약서</option>
              <option value="LEAVE">휴가 정책</option>
              <option value="PAYROLL">급여 안내</option>
              <option value="FORM">서식</option>
              <option value="GENERAL">일반 품의</option>
              <option value="EXPENSE">지출결의</option>
              <option value="PURCHASE">구매요청</option>
            </select>
          </div>
          <button className="button" type="submit" style={{ alignSelf: "end" }}>
            <Search size={16} />
            검색
          </button>
        </div>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="groupware-search-author">작성자/대상</label>
            <select id="groupware-search-author" name="groupwareSearchAuthorId" defaultValue={groupware.searchFilters.authorId}>
              <option value="">전체</option>
              {contactOptions.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="groupware-search-from">시작일</label>
            <input id="groupware-search-from" name="groupwareSearchFrom" type="date" defaultValue={groupware.searchFilters.from} />
          </div>
          <div className="field">
            <label htmlFor="groupware-search-to">종료일</label>
            <input id="groupware-search-to" name="groupwareSearchTo" type="date" defaultValue={groupware.searchFilters.to} />
          </div>
        </div>
        <div className="groupware-search-presets">
          <div className="actions-row">
            {quickSearches.map((quick) => (
              <Link className="button secondary" href={quick.href} key={quick.label}>
                {quick.label}
              </Link>
            ))}
          </div>
          {groupware.searchPreferences.presets.length > 0 ? (
            <div className="actions-row">
              {groupware.searchPreferences.presets.map((preset) => (
                <Link className="button secondary" href={searchHref(preset.filters)} key={preset.id}>
                  {preset.name}
                </Link>
              ))}
            </div>
          ) : null}
          {groupware.searchPreferences.recentSearches.length > 0 ? (
            <div className="actions-row">
              {groupware.searchPreferences.recentSearches.slice(0, 4).map((recent) => (
                <Link className="status-pill gray" href={searchHref(recent)} key={recent.id} style={{ textDecoration: "none" }}>
                  최근: {recent.label}
                </Link>
              ))}
            </div>
          ) : null}
          <GroupwareSearchPresetActions
            currentFilters={currentSearchFilters}
            presets={groupware.searchPreferences.presets.map((preset) => ({ id: preset.id, name: preset.name }))}
          />
        </div>
        {hasActiveGroupwareSearch ? (
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            {groupware.searchResults.length > 0 ? (
              groupware.searchResults.map((result, index) => (
                <Link className="notification-card read" href={result.href} key={`${result.type}-${index}`} style={{ textDecoration: "none" }}>
                  <div>
                    <span className="status-pill gray">{result.label}</span>
                    <strong style={{ display: "block", marginTop: 6 }}>{result.title}</strong>
                    <p className="muted" style={{ margin: "6px 0 0" }}>{result.description}</p>
                  </div>
                </Link>
              ))
            ) : (
              <div className="empty">검색 결과가 없습니다.</div>
            )}
          </div>
        ) : null}
      </form>

          <div className="grid-3">
            <div className="panel stack">
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>공지사항</h2>
                <Link className="status-pill gray" href={groupwareTabHref("announcements")}>
                  열기
                </Link>
              </div>
              {noticeAnnouncements.slice(0, 3).map((announcement) => (
                <Link
                  className="notification-card read"
                  href={`${groupwareHref({ tab: "announcements", announcementId: announcement.id })}#groupware-announcements`}
                  key={announcement.id}
                  style={{ textDecoration: "none" }}
                >
                  <div>
                    <strong>{announcement.title}</strong>
                    <p className="muted" style={{ margin: "6px 0 0" }}>
                      {announcement.author.name} · {formatKstDateTime(announcement.publishAt ?? announcement.createdAt)}
                    </p>
                  </div>
                </Link>
              ))}
              {noticeAnnouncements.length === 0 ? <div className="empty">확인할 공지가 없습니다.</div> : null}
            </div>

            <div className="panel stack">
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>전자결재</h2>
                <Link className="status-pill gray" href={groupwareTabHref("documents")}>
                  열기
                </Link>
              </div>
              {pendingDocuments.slice(0, 3).map((document) => (
                <Link className="notification-card read" href={documentHref(document.id)} key={document.id} style={{ textDecoration: "none" }}>
                  <div>
                    <strong>{document.documentNumber ?? "문서번호 미정"} · {document.title}</strong>
                    <p className="muted" style={{ margin: "6px 0 0" }}>
                      요청 {document.requester.name} · 현재 결재 {document.reviewer?.name ?? "미지정"}
                    </p>
                  </div>
                </Link>
              ))}
              {pendingDocuments.length === 0 ? <div className="empty">대기 중인 전자결재가 없습니다.</div> : null}
            </div>

            <div className="panel stack">
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>자료실</h2>
                <Link className="status-pill gray" href={groupwareTabHref("library")}>
                  열기
                </Link>
              </div>
              {groupware.libraryItems.slice(0, 3).map((item) => (
                <Link className="notification-card read" href={libraryHref(item.id)} key={item.id} style={{ textDecoration: "none" }}>
                  <div>
                    <strong>{item.title}</strong>
                    <p className="muted" style={{ margin: "6px 0 0" }}>
                      {libraryCategoryLabel(item.category)} · v{item.versions[0]?.versionNo ?? 1}
                    </p>
                  </div>
                </Link>
              ))}
              {groupware.libraryItems.length === 0 ? <div className="empty">등록된 자료가 없습니다.</div> : null}
            </div>
          </div>

        </>
      ) : null}

      {activeTab === "operations" ? (
        <nav className="groupware-section-nav" aria-label="급여·운영 섹션">
          <a href="#groupware-contacts">연락처</a>
          <a href="#groupware-profile">직원 메모</a>
          <a href="#groupware-performance">실적</a>
          <a href="#groupware-payroll-statements">급여명세</a>
          {groupware.canManageGroupware ? <a href="#groupware-operations">운영 로그</a> : null}
          <a href="#groupware-memos">메모함</a>
        </nav>
      ) : null}

      {activeTab === "operations" ? (
      <form action="/dashboard" className="panel inline-form">
        <input type="hidden" name="view" value="groupware" />
        <input type="hidden" name="groupwareTab" value={activeTab} />
        <div className="grid-4">
          <div className="field">
            <label htmlFor="groupware-search">연락처 검색</label>
            <input id="groupware-search" name="orgSearch" defaultValue={organization.filters.search} placeholder="이름, 부서, 직책, 이메일, 내선" />
          </div>
          <div className="field">
            <label htmlFor="groupware-team">부서</label>
            <select id="groupware-team" name="orgTeamId" defaultValue={organization.filters.teamId}>
              <option value="">전체 부서</option>
              {organization.selectableTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="groupware-status">근무상태</label>
            <select id="groupware-status" name="orgStatus" defaultValue={organization.filters.status}>
              <option value="ALL">전체</option>
              <option value="WORKING">근무중</option>
              <option value="AWAY">자리비움</option>
              <option value="LEAVE">휴가</option>
              <option value="OFFLINE">오프라인</option>
            </select>
          </div>
          <button className="button secondary" type="submit" style={{ alignSelf: "end" }}>
            <Search size={16} />
            검색
          </button>
        </div>
      </form>
      ) : null}

      <div className="stack">
        {activeTab === "announcements" ? (
          <div id="groupware-announcements" className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <div>
                <h2 style={{ margin: 0 }}>
                  <Bell size={20} /> 공지사항
                </h2>
                <p className="muted" style={{ margin: "6px 0 0" }}>회사 공식 안내와 인사 공지를 확인합니다.</p>
              </div>
              <span className="status-pill gray">공식 공지 {noticeAnnouncements.length}건</span>
            </div>
            <nav className="groupware-section-nav" aria-label="공지사항 내부 섹션">
              <a href="#groupware-announcements">공지</a>
              <a href="#groupware-board">게시판</a>
            </nav>
            <form action="/dashboard" className="inline-form">
              <input type="hidden" name="view" value="groupware" />
              <input type="hidden" name="groupwareTab" value="announcements" />
              {selected ? <input type="hidden" name="orgUserId" value={selected.id} /> : null}
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="groupware-notice-filter">공지 필터</label>
                  <select id="groupware-notice-filter" name="groupwareNoticeFilter" defaultValue={normalizedNoticeFilter}>
                    <option value="ALL">전체</option>
                    <option value="UNREAD">미읽음</option>
                    <option value="READ">읽음</option>
                    <option value="SCHEDULED">예약 발행</option>
                    <option value="EXPIRED">만료</option>
                  </select>
                </div>
                <button className="button secondary" type="submit" style={{ alignSelf: "end" }}>
                  적용
                </button>
              </div>
            </form>
            {groupware.canManageGroupware ? (
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <AnnouncementForm teams={organization.selectableTeams} mode="announcement" canManage={groupware.canManageGroupware} />
              </div>
            ) : null}
            {activeSelectedNotice ? announcementCards([activeSelectedNotice], "선택한 공지사항을 찾을 수 없습니다.", "detail") : null}
            {selectedAnnouncementId && !selectedAnnouncement && activeTab === "announcements" ? (
              <div className="empty">선택한 공지사항을 찾을 수 없거나 접근 권한이 없습니다.</div>
            ) : null}
            {announcementCards(
              noticeAnnouncements.filter((announcement) => announcement.id !== activeSelectedNotice?.id),
              "등록된 공지사항이 없습니다."
            )}
          </div>
        ) : null}

        {activeTab === "announcements" ? (
          <div id="groupware-board" className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <div>
                <h2 style={{ margin: 0 }}>
                  <MessageSquareText size={20} /> 게시판
                </h2>
                <p className="muted" style={{ margin: "6px 0 0" }}>팀 공유 글과 구성원 게시글을 공지와 분리해 봅니다.</p>
              </div>
              <span className="status-pill gray">게시글 {boardAnnouncements.length}건</span>
            </div>
            <div className="panel stack" style={{ background: "#fbfdff" }}>
              <AnnouncementForm teams={organization.selectableTeams} mode="board" canManage={groupware.canManageGroupware} />
            </div>
            {activeSelectedBoardPost ? announcementCards([activeSelectedBoardPost], "선택한 게시글을 찾을 수 없습니다.", "detail") : null}
            {announcementCards(
              boardAnnouncements.filter((announcement) => announcement.id !== activeSelectedBoardPost?.id),
              "등록된 게시글이 없습니다."
            )}
          </div>
        ) : null}

        {activeTab === "operations" ? (
          <div id="groupware-contacts" className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>
                <Users size={20} /> 사내 직원 연락처
              </h2>
              <span className="status-pill gray">{visibleContacts.length}명</span>
            </div>
            {visibleContacts.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>직원</th>
                      <th>부서</th>
                      <th>상태</th>
                      <th>연락</th>
                      <th>메모</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleContacts.map((member) => {
                      const memoStat = groupware.memoStatsByUser.find((item) => item.userId === member.id);
                      const phoneHref = contactActionPhone(member.phoneNumber);
                      return (
                        <tr key={member.id}>
                          <td>
                            <Link href={groupwareHref({ tab: "operations", userId: member.id, teamId: organization.filters.teamId, search: organization.filters.search })}>{member.name}</Link>
                            <br />
                            <span className="muted">{member.jobTitle || roleLabel(member.role)}</span>
                          </td>
                          <td>{member.team?.name ?? "소속 없음"}</td>
                          <td>
                            <span className={`status-pill ${member.statusTone}`}>{member.latestStatusLabel}</span>
                          </td>
                          <td>
                            <div className="actions-row">
                              <a className="button secondary" href={`mailto:${member.email}`}>
                                <Mail size={14} />
                                메일
                              </a>
                              {phoneHref ? (
                                <a className="button secondary" href={phoneHref}>
                                  <Phone size={14} />
                                  전화
                                </a>
                              ) : null}
                            </div>
                            <span className="muted">{member.extensionNumber ? `내선 ${member.extensionNumber}` : member.email}</span>
                          </td>
                          <td>
                            <Link className="button secondary" href={groupwareHref({ tab: "operations", userId: member.id })}>
                              <MessageSquareText size={14} />
                              {memoStat?.openCount ? `미결 ${memoStat.openCount}` : "메모"}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">조건에 맞는 직원 연락처가 없습니다.</div>
            )}
          </div>
        ) : null}

        {activeTab === "operations" ? (
          <section id="groupware-profile" className="panel stack">
            {selected ? (
              <>
                <div className="employee-profile-header">
                  <div className="avatar-mark">{selected.name.slice(0, 1)}</div>
                  <div>
                    <h2 style={{ margin: 0 }}>{selected.name}</h2>
                    <p className="muted" style={{ margin: "6px 0 0" }}>
                      {selected.team?.name ?? "소속 없음"} · {selected.jobTitle || roleLabel(selected.role)}
                    </p>
                  </div>
                  <span className={`status-pill ${selected.statusTone}`}>{selected.latestStatusLabel}</span>
                </div>
                <div className="grid-3">
                  <a className="quick-link-card" href={`mailto:${selected.email}`}>
                    <Mail size={18} />
                    <strong>메일</strong>
                    <span className="muted">{selected.email}</span>
                  </a>
                  {contactActionPhone(selected.phoneNumber) ? (
                    <a className="quick-link-card" href={contactActionPhone(selected.phoneNumber) ?? "#"}>
                      <Phone size={18} />
                      <strong>전화</strong>
                      <span className="muted">{selected.phoneNumber}</span>
                    </a>
                  ) : (
                    <div className="quick-link-card">
                      <Phone size={18} />
                      <strong>전화</strong>
                      <span className="muted">-</span>
                    </div>
                  )}
                  <div className="quick-link-card">
                    <BriefcaseBusiness size={18} />
                    <strong>내선</strong>
                    <span className="muted">{selected.extensionNumber ?? "-"}</span>
                  </div>
                </div>
                <div className="panel stack" style={{ background: "#fbfdff" }}>
                  <div className="actions-row" style={{ justifyContent: "space-between" }}>
                    <h3 style={{ margin: 0 }}>미결건 메모</h3>
                    <span className="status-pill gray">{selectedMemoStat?.openCount ?? 0}건</span>
                  </div>
                  <ProfileMemoForm
                    targetUserId={selected.id}
                    mentionableUsers={mentionableUsers}
                    assignableUsers={assignableUsers}
                  />
                </div>
                {selectedProfileMemos.length > 0 ? (
                  <div className="stack" style={{ gap: 8 }}>
                    {selectedProfileMemos.map((thread) => (
                      <Link className="notification-card read" href={thread.href} key={thread.id} style={{ textDecoration: "none" }}>
                        <div>
                          <strong>{thread.title}</strong>
                          <p className="muted" style={{ margin: "6px 0 0" }}>
                            {thread.lastComment?.body ?? "메모 내용 없음"}
                          </p>
                          <p className="muted" style={{ margin: "6px 0 0" }}>
                            담당 {thread.assignee?.name ?? "미지정"} · {thread.lastCommentAt ? formatKstDateTime(thread.lastCommentAt) : formatKstDateTime(thread.updatedAt)}
                          </p>
                        </div>
                        <span className={`status-pill ${workThreadStatusTone(thread.status)}`}>
                          {workThreadStatusLabel(thread.status)}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty">직원을 선택하면 연락처와 메모를 확인할 수 있습니다.</div>
            )}
          </section>
        ) : null}

        {activeTab === "operations" ? (
          <section id="groupware-performance" className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>
                <Target size={20} /> 실적관리
              </h2>
              <span className="status-pill gray">{groupware.performanceGoals.length}건</span>
            </div>
            {groupware.canManageGroupware ? (
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <PerformanceGoalForm currentMonth={groupware.currentMonth} users={contactOptions} teams={organization.selectableTeams} />
              </div>
            ) : null}
            {groupware.performanceGoals.length > 0 ? (
              <div className="stack" style={{ gap: 8 }}>
                {groupware.performanceGoals.map((goal) => (
                  <div className="notification-card read" key={goal.id}>
                    <div>
                      <strong>{goal.title}</strong>
                      <p className="muted" style={{ margin: "6px 0 0" }}>
                        {(goal.user?.name ?? goal.team?.name) || "대상 없음"} · {goal.actualValue}/{goal.targetValue} {goal.unit} · {performanceProgress(goal.actualValue, goal.targetValue)}%
                      </p>
                      {goal.evaluationMemo ? (
                        <p className="muted" style={{ margin: "6px 0 0" }}>{goal.evaluationMemo}</p>
                      ) : null}
                    </div>
                    <PerformanceGoalUpdateForm goalId={goal.id} currentActual={goal.actualValue} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">이번 달 실적 목표가 없습니다.</div>
            )}
          </section>
        ) : null}

        {activeTab === "operations" ? (
          <section id="groupware-payroll-statements" className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>급여명세 다운로드</h2>
              <span className="status-pill gray">{payrollTargetUserId === viewerId ? "본인" : selected?.name}</span>
            </div>
            {groupware.canViewPayrollForOthers ? (
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <PayrollIssueForm currentMonth={groupware.currentMonth} users={contactOptions} />
              </div>
            ) : null}
            {groupware.payrollIssues.length > 0 ? (
              <div className="stack" style={{ gap: 8 }}>
                {groupware.payrollIssues.slice(0, 6).map((issue) => (
                  <div className="notification-card read" key={issue.id}>
                    <div>
                      <strong>{issue.month} · {issue.user.name}</strong>
                      <p className="muted" style={{ margin: "6px 0 0" }}>
                        {payrollStatementStatusLabel(issue.status)} · {issue.issuedBy?.name ?? "-"} · {formatKstDateTime(issue.issuedAt)}
                      </p>
                    </div>
                    <div className="actions-row">
                      <a className="button secondary" href={payrollStatementHref(issue.month, "pdf", groupware.canViewPayrollForOthers ? issue.userId : undefined)}>
                        PDF
                      </a>
                      <a className="button secondary" href={payrollStatementHref(issue.month, "csv", groupware.canViewPayrollForOthers ? issue.userId : undefined)}>
                        CSV
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {groupware.canViewPayrollForOthers ? (
              <div className="stack" style={{ gap: 8 }}>
                {groupware.payrollMonths.map((month) => (
                  <div className="notification-card read" key={month}>
                    <div>
                      <strong>{month} 미리보기</strong>
                      <p className="muted" style={{ margin: "6px 0 0" }}>인사 검토용 PDF · CSV</p>
                    </div>
                    <div className="actions-row">
                      <a className="button secondary" href={payrollStatementHref(month, "pdf", payrollTargetUserId)}>
                        PDF
                      </a>
                      <a className="button secondary" href={payrollStatementHref(month, "csv", payrollTargetUserId)}>
                        CSV
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : groupware.payrollIssues.length === 0 ? (
              <div className="empty">아직 발행된 급여명세가 없습니다.</div>
            ) : null}
          </section>
        ) : null}

        {activeTab === "documents" ? (
          <section id="groupware-documents" className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>
                <FileText size={20} /> 전자결재
              </h2>
              <span className="status-pill gray">대기 {pendingDocuments.length}건</span>
            </div>
            <DocumentRequestForm reviewers={assignableUsers} />
            {selectedDocument ? (
              <div id={`groupware-document-${selectedDocument.id}`} className="notification-card read groupware-detail-card">
                <div className="groupware-card-main">
                  <div className="actions-row groupware-card-title">
                    <h3 style={{ margin: 0 }}>{selectedDocument.documentNumber ?? "문서번호 미정"} · {selectedDocument.title}</h3>
                    <span className={`status-pill ${documentStatusTone(selectedDocument.status)}`}>
                      {documentStatusLabel(selectedDocument.status)}
                    </span>
                    <span className="status-pill gray">{documentCategoryLabel(selectedDocument.category)}</span>
                  </div>
                  <div className="groupware-detail-metrics">
                    <div>
                      <span>요청자</span>
                      <strong>{selectedDocument.requester.name}</strong>
                    </div>
                    <div>
                      <span>현재 결재</span>
                      <strong>{selectedDocument.reviewer?.name ?? "미지정"}</strong>
                    </div>
                    <div>
                      <span>결재 진행</span>
                      <strong>{selectedDocument.approvalSteps.filter((step) => step.status === "APPROVED").length}/{selectedDocument.approvalSteps.length}</strong>
                    </div>
                  </div>
                  <p className="muted" style={{ margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{selectedDocument.body}</p>
                  <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                    <h4 style={{ margin: 0 }}>결재선</h4>
                    {selectedDocument.approvalSteps.map((step) => (
                      <div className="groupware-operation-log" key={step.id}>
                        <strong>{step.stepOrder}. {step.label}</strong>
                        <span className={`status-pill ${step.status === "APPROVED" ? "green" : step.status === "REJECTED" ? "red" : "yellow"}`}>
                          {step.status === "APPROVED" ? "승인" : step.status === "REJECTED" ? "반려" : "대기"}
                        </span>
                        <span className="muted">
                          {step.approver?.name ?? "-"}{step.reviewNote ? ` · ${step.reviewNote}` : ""}
                        </span>
                      </div>
                    ))}
                    {(groupware.canManageGroupware || selectedDocument.requester.id === viewerId) && selectedDocument.status === "PENDING" ? (
                      <DocumentApprovalLineActions
                        documentId={selectedDocument.id}
                        steps={selectedDocument.approvalSteps.map((step) => ({
                          id: step.id,
                          label: step.label,
                          status: step.status,
                          approverId: step.approver?.id
                        }))}
                        reviewers={assignableUsers}
                      />
                    ) : null}
                  </div>
                  {selectedDocument.attachments.length > 0 ? attachmentLinks(selectedDocument.attachments, "/api/groupware/document-attachments") : null}
                  {groupware.relatedNotifications.length > 0 ? (
                    <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                      <h4 style={{ margin: 0 }}>관련 알림</h4>
                      {groupware.relatedNotifications.map((notification) => (
                        <div className="groupware-operation-log" key={notification.id}>
                          <strong>{notification.title}</strong>
                          <span className={`status-pill ${notification.isRead ? "gray" : "yellow"}`}>
                            {notification.isRead ? "읽음" : "읽지 않음"}
                          </span>
                          <span className="muted">{notification.readAt ? formatKstDateTime(notification.readAt) : formatKstDateTime(notification.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="actions-row groupware-card-actions">
                    <Link className="button secondary" href={documentHref()}>
                      목록
                    </Link>
                    <a className="button secondary" href={`/api/groupware/document-requests/${selectedDocument.id}/pdf`}>
                      <Download size={14} />
                      PDF
                    </a>
                    {selectedDocument.workThread ? (
                      <Link className="button secondary" href={`/dashboard?view=workbox&workThreadId=${selectedDocument.workThread.id}`}>
                        업무함 댓글 {selectedDocument.workThread._count.comments}개
                      </Link>
                    ) : null}
                    {selectedDocument.requester.id === viewerId && selectedDocument.status === "REJECTED" ? (
                      <DocumentResubmitButton documentId={selectedDocument.id} />
                    ) : null}
                  </div>
                </div>
                {groupware.canManageGroupware && selectedDocument.status === "PENDING" ? (
                  <DocumentReviewButtons
                    documentId={selectedDocument.id}
                    reviewers={assignableUsers}
                    currentReviewerId={selectedDocument.reviewer?.id}
                  />
                ) : null}
              </div>
            ) : selectedDocumentId ? (
              <div className="empty">선택한 전자결재 문서를 찾을 수 없거나 접근 권한이 없습니다.</div>
            ) : null}
            {groupware.documentRequests.length > 0 ? (
              <div className="stack" style={{ gap: 8 }}>
                {groupware.documentRequests.filter((document) => document.id !== selectedDocument?.id).map((document) => (
                  <div className="notification-card read" key={document.id}>
                    <div>
                      <div className="actions-row">
                        <strong>{document.documentNumber ?? "문서번호 미정"} · {document.title}</strong>
                        <span className={`status-pill ${documentStatusTone(document.status)}`}>
                          {documentStatusLabel(document.status)}
                        </span>
                      </div>
                      <p className="muted" style={{ margin: "6px 0 0" }}>
                        {documentCategoryLabel(document.category)} · 요청 {document.requester.name} · 현재 결재 {document.reviewer?.name ?? "미지정"}
                      </p>
                      <p className="muted" style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{document.body}</p>
                      <div className="actions-row" style={{ marginTop: 8 }}>
                        {document.approvalSteps.map((step) => (
                          <span className={`status-pill ${step.status === "APPROVED" ? "green" : step.status === "REJECTED" ? "red" : "yellow"}`} key={step.id}>
                            {step.label}: {step.approver?.name ?? "-"}
                          </span>
                        ))}
                      </div>
                      {document.attachments.length > 0 ? (
                        attachmentLinks(document.attachments, "/api/groupware/document-attachments")
                      ) : null}
                      <div className="actions-row" style={{ marginTop: 8 }}>
                        <Link className="button secondary" href={documentHref(document.id)}>
                          상세
                        </Link>
                        <a className="button secondary" href={`/api/groupware/document-requests/${document.id}/pdf`}>
                          <Download size={14} />
                          PDF
                        </a>
                        {document.workThread ? (
                          <Link className="button secondary" href={`/dashboard?view=workbox&workThreadId=${document.workThread.id}`}>
                            댓글 {document.workThread._count.comments}개
                          </Link>
                        ) : null}
                        {document.requester.id === viewerId && document.status === "REJECTED" ? (
                          <DocumentResubmitButton documentId={document.id} />
                        ) : null}
                      </div>
                    </div>
                    {groupware.canManageGroupware && document.status === "PENDING" ? (
                      <DocumentReviewButtons
                        documentId={document.id}
                        reviewers={assignableUsers}
                        currentReviewerId={document.reviewer?.id}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">전자결재 문서가 없습니다.</div>
            )}
          </section>
        ) : null}

        {activeTab === "library" ? (
          <section id="groupware-library" className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>
                <FolderOpen size={20} /> 자료실
              </h2>
              <span className="status-pill gray">{filteredLibraryItems.length}건</span>
            </div>
            {groupware.canManageGroupware ? (
              <nav className="dashboard-tabs" aria-label="자료실 상태">
                <Link
                  href={`${groupwareHref({ tab: "library", libraryStatus: "ACTIVE", libraryCategory: normalizedLibraryCategory, librarySearch })}#groupware-library`}
                  aria-current={groupware.libraryFilters.status === "ACTIVE" ? "page" : undefined}
                >
                  사용 중 자료
                </Link>
                <Link
                  href={`${groupwareHref({ tab: "library", libraryStatus: "ARCHIVED", libraryCategory: normalizedLibraryCategory, librarySearch })}#groupware-library`}
                  aria-current={groupware.libraryFilters.status === "ARCHIVED" ? "page" : undefined}
                >
                  보관 자료
                </Link>
              </nav>
            ) : null}
            <form action="/dashboard" className="inline-form">
              <input type="hidden" name="view" value="groupware" />
              <input type="hidden" name="groupwareTab" value="library" />
              <div className="grid-4">
                <div className="field">
                  <label htmlFor="groupware-library-search">자료 검색</label>
                  <input id="groupware-library-search" name="groupwareLibrarySearch" defaultValue={librarySearch} placeholder="자료명, 설명, 파일명" />
                </div>
                <div className="field">
                  <label htmlFor="groupware-library-category">분류</label>
                  <select id="groupware-library-category" name="groupwareLibraryCategory" defaultValue={normalizedLibraryCategory}>
                    <option value="ALL">전체</option>
                    <option value="POLICY">회사 규정</option>
                    <option value="CONTRACT">계약서</option>
                    <option value="LEAVE">휴가 정책</option>
                    <option value="PAYROLL">급여 안내</option>
                    <option value="FORM">서식</option>
                  </select>
                </div>
                {groupware.canManageGroupware ? (
                  <div className="field">
                    <label htmlFor="groupware-library-status">상태</label>
                    <select id="groupware-library-status" name="groupwareLibraryStatus" defaultValue={groupware.libraryFilters.status}>
                      <option value="ACTIVE">사용 중</option>
                      <option value="ARCHIVED">보관 자료</option>
                    </select>
                  </div>
                ) : null}
                <button className="button secondary" type="submit" style={{ alignSelf: "end" }}>
                  검색
                </button>
              </div>
              {groupware.canManageGroupware ? (
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="groupware-library-permission-user">권한 테스트 사용자</label>
                    <select id="groupware-library-permission-user" name="groupwareLibraryPermissionUserId" defaultValue={groupware.libraryFilters.permissionUserId}>
                      <option value="">선택 안 함</option>
                      {contactOptions.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="actions-row" style={{ alignSelf: "end" }}>
                    <a className="button secondary" href={libraryDownloadExportHref(selectedLibraryItem?.id)}>
                      다운로드 이력 CSV
                    </a>
                  </div>
                </div>
              ) : null}
            </form>
            {groupware.canManageGroupware ? (
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <DocumentLibraryForm
                  items={groupware.libraryItems.map((item) => ({ id: item.id, title: item.title }))}
                  teams={organization.selectableTeams}
                />
              </div>
            ) : null}
            {selectedLibraryItem ? (
              <div id={`groupware-library-item-${selectedLibraryItem.id}`} className="notification-card read groupware-detail-card">
                <div className="groupware-card-main">
                  <div className="actions-row groupware-card-title">
                    <h3 style={{ margin: 0 }}>{selectedLibraryItem.title}</h3>
                    {selectedLibraryItem.isPinned ? <span className="status-pill yellow">중요</span> : null}
                    <span className="status-pill gray">{libraryCategoryLabel(selectedLibraryItem.category)}</span>
                    <span className="status-pill gray">{libraryScopeLabel(selectedLibraryItem.accessScope)}</span>
                    {selectedLibraryItem.team ? <span className="status-pill gray">{selectedLibraryItem.team.name}</span> : null}
                  </div>
                  {selectedLibraryItem.description ? (
                    <p className="muted" style={{ margin: "8px 0 0" }}>{selectedLibraryItem.description}</p>
                  ) : null}
                  <div className="groupware-detail-metrics">
                    <div>
                      <span>총 다운로드</span>
                      <strong>{selectedLibraryItem.downloadCount}회</strong>
                    </div>
                    <div>
                      <span>버전</span>
                      <strong>{selectedLibraryItem.versions.length}개</strong>
                    </div>
                    <div>
                      <span>등록자</span>
                      <strong>{selectedLibraryItem.createdBy.name}</strong>
                    </div>
                  </div>
                  {groupware.canManageGroupware ? (
                    <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                      <h4 style={{ margin: 0 }}>접근 가능 대상</h4>
                      <p className="muted" style={{ margin: 0 }}>
                        총 {selectedLibraryItem.accessPreview.totalCount}명 · {selectedLibraryItem.accessPreview.sampleUsers.map((user) => `${user.name}${user.teamName ? `(${user.teamName})` : ""}`).join(", ") || "대상 없음"}
                      </p>
                      {selectedLibraryItem.permissionTest ? (
                        <div className="groupware-operation-log">
                          <strong>{selectedLibraryItem.permissionTest.user.name}</strong>
                          <span className={`status-pill ${selectedLibraryItem.permissionTest.canAccess ? "green" : "red"}`}>
                            {selectedLibraryItem.permissionTest.canAccess ? "접근 가능" : "접근 불가"}
                          </span>
                          <span className="muted">{selectedLibraryItem.permissionTest.reason}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                    <h4 style={{ margin: 0 }}>버전 이력</h4>
                    {selectedLibraryItem.versions.map((version) => (
                      <div className="actions-row groupware-version-row" key={version.id}>
                        {canPreviewAttachment(version) ? (
                          <a className="button secondary" href={`/api/groupware/library/versions/${version.id}?preview=1`} target="_blank" rel="noreferrer">
                            미리보기
                          </a>
                        ) : null}
                        <a className="button secondary" href={`/api/groupware/library/versions/${version.id}`}>
                          <Download size={14} />
                          v{version.versionNo} {version.originalName}
                        </a>
                        {version.isHidden ? <span className="status-pill gray">숨김</span> : null}
                        <span className="muted">
                          {version.uploadedBy.name} · 다운로드 {version.downloadCount}회 · {formatKstDateTime(version.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {groupware.canManageGroupware ? (
                    <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                      <h4 style={{ margin: 0 }}>다운로드 로그</h4>
                      {selectedLibraryItem.downloadLogs.length > 0 ? (
                        selectedLibraryItem.downloadLogs.map((log) => (
                          <div className="groupware-operation-log" key={log.id}>
                            <strong>{log.originalName}</strong>
                            <span className="muted">{log.actor?.name ?? "시스템"}</span>
                            <span className="muted">{formatKstDateTime(log.createdAt)}</span>
                          </div>
                        ))
                      ) : (
                        <div className="empty">아직 다운로드 기록이 없습니다.</div>
                      )}
                    </div>
                  ) : null}
                  {groupware.relatedNotifications.length > 0 ? (
                    <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                      <h4 style={{ margin: 0 }}>관련 알림</h4>
                      {groupware.relatedNotifications.map((notification) => (
                        <div className="groupware-operation-log" key={notification.id}>
                          <strong>{notification.title}</strong>
                          <span className={`status-pill ${notification.isRead ? "gray" : "yellow"}`}>
                            {notification.isRead ? "읽음" : "읽지 않음"}
                          </span>
                          <span className="muted">{notification.readAt ? formatKstDateTime(notification.readAt) : formatKstDateTime(notification.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="actions-row groupware-card-actions">
                    <Link className="button secondary" href={libraryHref()}>
                      목록
                    </Link>
                    {groupware.canManageGroupware ? (
                      <DocumentLibraryManageActions
                        item={{
                          id: selectedLibraryItem.id,
                          title: selectedLibraryItem.title,
                          category: selectedLibraryItem.category,
                          accessScope: selectedLibraryItem.accessScope,
                          teamId: selectedLibraryItem.teamId,
                          description: selectedLibraryItem.description,
                          isPinned: selectedLibraryItem.isPinned,
                          isArchived: selectedLibraryItem.isArchived,
                          versions: selectedLibraryItem.versions.map((version) => ({
                            id: version.id,
                            versionNo: version.versionNo,
                            originalName: version.originalName,
                            isHidden: version.isHidden
                          }))
                        }}
                        teams={organization.selectableTeams}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ) : selectedLibraryItemId ? (
              <div className="empty">선택한 자료를 찾을 수 없거나 접근 권한이 없습니다.</div>
            ) : null}
            {filteredLibraryItems.length > 0 ? (
              <div className="stack" style={{ gap: 8 }}>
                {filteredLibraryItems.filter((item) => item.id !== selectedLibraryItem?.id).map((item) => (
                  <div id={`groupware-library-item-${item.id}`} className="notification-card read groupware-card" key={item.id}>
                    <div className="groupware-card-main">
                      <div className="actions-row groupware-card-title">
                        <strong>{item.title}</strong>
                        {item.isPinned ? <span className="status-pill yellow">중요</span> : null}
                        <span className="status-pill gray">{libraryCategoryLabel(item.category)}</span>
                        <span className="status-pill gray">{libraryScopeLabel(item.accessScope)}</span>
                        {item.team ? <span className="status-pill gray">{item.team.name}</span> : null}
                        <span className="status-pill gray">다운로드 {item.downloadCount}회</span>
                      </div>
                      {item.description ? (
                        <p className="muted" style={{ margin: "6px 0 0" }}>{item.description}</p>
                      ) : null}
                      {groupware.canManageGroupware ? (
                        <p className="muted" style={{ margin: "6px 0 0" }}>
                          접근 가능 {item.accessPreview.totalCount}명
                          {item.permissionTest ? ` · ${item.permissionTest.user.name}: ${item.permissionTest.canAccess ? "접근 가능" : "접근 불가"}` : ""}
                        </p>
                      ) : null}
                      {groupware.canManageGroupware ? (
                        <div className="actions-row" style={{ marginTop: 8 }}>
                          <DocumentLibraryManageActions
                            item={{
                              id: item.id,
                              title: item.title,
                              category: item.category,
                              accessScope: item.accessScope,
                              teamId: item.teamId,
                              description: item.description,
                              isPinned: item.isPinned,
                              isArchived: item.isArchived,
                              versions: item.versions.map((version) => ({
                                id: version.id,
                                versionNo: version.versionNo,
                                originalName: version.originalName,
                                isHidden: version.isHidden
                              }))
                            }}
                            teams={organization.selectableTeams}
                          />
                        </div>
                      ) : null}
                      <div className="actions-row groupware-card-actions">
                        <Link className="button secondary" href={libraryHref(item.id)}>
                          상세
                        </Link>
                      </div>
                      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                        {item.versions.map((version) => (
                          <div className="actions-row groupware-version-row" key={version.id}>
                            {canPreviewAttachment(version) ? (
                              <a className="button secondary" href={`/api/groupware/library/versions/${version.id}?preview=1`} target="_blank" rel="noreferrer">
                                미리보기
                              </a>
                            ) : null}
                            <a className="button secondary" href={`/api/groupware/library/versions/${version.id}`}>
                              <Download size={14} />
                              v{version.versionNo} {version.originalName}
                            </a>
                            {version.isHidden ? <span className="status-pill gray">숨김</span> : null}
                            <span className="muted">
                              {version.uploadedBy.name} · 다운로드 {version.downloadCount}회 · {formatKstDateTime(version.createdAt)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">조건에 맞는 자료가 없습니다.</div>
            )}
          </section>
        ) : null}

        {activeTab === "operations" ? (
          <section id="groupware-operations" className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>
                <History size={20} /> 운영 로그
              </h2>
              <span className="status-pill gray">{groupware.operationLogs.length}건</span>
            </div>
            {groupware.canManageGroupware ? (
              <form action="/dashboard" className="inline-form">
                <input type="hidden" name="view" value="groupware" />
                <input type="hidden" name="groupwareTab" value="operations" />
                <div className="grid-4">
                  <div className="field">
                    <label htmlFor="groupware-operation-action">작업</label>
                    <select id="groupware-operation-action" name="groupwareOperationAction" defaultValue={groupware.operationFilters.action}>
                      {groupware.operationActions.map((action) => (
                        <option key={action} value={action}>
                          {operationActionLabel(action)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="groupware-operation-actor">행위자</label>
                    <select id="groupware-operation-actor" name="groupwareOperationActorId" defaultValue={groupware.operationFilters.actorId}>
                      <option value="">전체</option>
                      {contactOptions.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="groupware-operation-from">시작일</label>
                    <input id="groupware-operation-from" name="groupwareOperationFrom" type="date" defaultValue={groupware.operationFilters.from} />
                  </div>
                  <div className="field">
                    <label htmlFor="groupware-operation-to">종료일</label>
                    <input id="groupware-operation-to" name="groupwareOperationTo" type="date" defaultValue={groupware.operationFilters.to} />
                  </div>
                </div>
                <div className="actions-row">
                  <button className="button secondary" type="submit">
                    로그 필터
                  </button>
                  <a className="button secondary" href={operationExportHref}>
                    CSV 내보내기
                  </a>
                </div>
              </form>
            ) : null}
            {groupware.canManageGroupware ? (
              groupware.operationLogs.length > 0 ? (
                <div className="stack" style={{ gap: 8 }}>
                  {groupware.operationLogs.map((log) => (
                    <div className="notification-card read groupware-operation-card" key={log.id}>
                      <div className="groupware-card-main">
                        <div className="actions-row groupware-card-title">
                          <span className="status-pill gray">{log.label}</span>
                          <strong>{log.detail}</strong>
                        </div>
                        <p className="muted" style={{ margin: "6px 0 0" }}>
                          {log.actor?.name ?? "시스템"} · {formatKstDateTime(log.createdAt)}
                        </p>
                        <p className="muted" style={{ margin: "6px 0 0" }}>
                          대상 {log.targetType} · {log.targetId}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">아직 운영 로그가 없습니다.</div>
              )
            ) : (
              <div className="empty">운영 로그는 관리자, 인사 담당, 팀장 권한에서 확인할 수 있습니다.</div>
            )}
          </section>
        ) : null}

        {activeTab === "operations" ? (
          <section id="groupware-memos" className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>메모 타임라인</h2>
              <span className="status-pill gray">{groupware.profileMemoThreads.length}건</span>
            </div>
            {groupware.profileMemoThreads.length > 0 ? (
              <div className="stack" style={{ gap: 8 }}>
                {groupware.profileMemoThreads.slice(0, 6).map((thread) => (
                  <Link className="notification-card" href={thread.href} key={thread.id} style={{ textDecoration: "none" }}>
                    <div>
                      <strong>{thread.targetUser?.name ?? thread.title}</strong>
                      <p className="muted" style={{ margin: "6px 0 0" }}>
                        {thread.lastComment?.body ?? "메모 내용 없음"}
                      </p>
                      <p className="muted" style={{ margin: "6px 0 0" }}>
                        담당 {thread.assignee?.name ?? "미지정"} · {thread.lastCommentAt ? formatKstDateTime(thread.lastCommentAt) : formatKstDateTime(thread.updatedAt)}
                      </p>
                    </div>
                    <span className={`status-pill ${workThreadStatusTone(thread.status)}`}>
                      {workThreadStatusLabel(thread.status)}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty">아직 프로필 메모가 없습니다.</div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

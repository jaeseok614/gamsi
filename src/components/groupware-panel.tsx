import { Bell, BriefcaseBusiness, FileText, Mail, MessageSquareText, Phone, Search, Target, Users } from "lucide-react";
import Link from "next/link";

import {
  AnnouncementForm,
  AnnouncementReadButton,
  DocumentRequestForm,
  DocumentReviewButtons,
  PayrollIssueForm,
  PerformanceGoalForm,
  PerformanceGoalUpdateForm,
  ProfileMemoForm
} from "@/components/groupware-actions";
import { roleLabel } from "@/lib/display-labels";
import type { getGroupwareDashboard } from "@/lib/groupware";
import type { getOrganizationDashboard } from "@/lib/organization";
import { formatKstDateTime } from "@/lib/time";

type GroupwareSummary = Awaited<ReturnType<typeof getGroupwareDashboard>>;
type OrganizationSummary = Awaited<ReturnType<typeof getOrganizationDashboard>>;

type GroupwareUserOption = {
  id: string;
  name: string;
  email: string;
  role: string;
};

function groupwareHref(params?: {
  userId?: string | null;
  teamId?: string | null;
  search?: string | null;
}) {
  const search = new URLSearchParams();
  search.set("view", "groupware");
  if (params?.userId) {
    search.set("orgUserId", params.userId);
  }
  if (params?.teamId) {
    search.set("orgTeamId", params.teamId);
  }
  if (params?.search) {
    search.set("orgSearch", params.search);
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

function documentStatusLabel(status: string) {
  if (status === "APPROVED") {
    return "승인";
  }
  if (status === "REJECTED") {
    return "반려";
  }
  return "대기";
}

export function GroupwarePanel({
  organization,
  groupware,
  mentionableUsers,
  assignableUsers,
  viewerId
}: {
  organization: OrganizationSummary;
  groupware: GroupwareSummary;
  mentionableUsers: GroupwareUserOption[];
  assignableUsers: GroupwareUserOption[];
  viewerId: string;
}) {
  const selected = organization.selectedUser;
  const selectedMemoStat = selected ? groupware.memoStatsByUser.find((item) => item.userId === selected.id) : null;
  const openProfileMemos = groupware.profileMemoThreads.filter((thread) => thread.status === "OPEN");
  const payrollTargetUserId = groupware.canViewPayrollForOthers ? selected?.id : viewerId;
  const visibleContacts = organization.users.slice(0, 18);
  const contactOptions = organization.users.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role
  }));
  const pendingDocuments = groupware.documentRequests.filter((document) => document.status === "PENDING");

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid-4">
        <div className="metric">
          <span>연락처</span>
          <strong>{organization.stats.filteredUsers}명</strong>
        </div>
        <div className="metric">
          <span>근무/업무중</span>
          <strong>{organization.stats.workingUsers}명</strong>
        </div>
        <div className="metric">
          <span>미결 메모</span>
          <strong>{openProfileMemos.length}건</strong>
        </div>
        <div className="metric">
          <span>공지 미읽음</span>
          <strong>{groupware.unreadAnnouncementCount}건</strong>
        </div>
      </div>

      <form action="/dashboard" className="panel inline-form">
        <input type="hidden" name="view" value="groupware" />
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

      <div className="groupware-layout">
        <section className="stack">
          <div id="groupware-announcements" className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>
                <Bell size={20} /> 공지/게시판
              </h2>
              <span className="status-pill gray">{groupware.announcements.length}건</span>
            </div>
            {groupware.canManageGroupware ? (
              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <AnnouncementForm teams={organization.selectableTeams} />
              </div>
            ) : null}
            {groupware.announcements.length > 0 ? (
              <div className="stack" style={{ gap: 8 }}>
                {groupware.announcements.map((announcement) => (
                  <div className={`notification-card ${announcement.isReadByViewer ? "read" : "unread"}`} key={announcement.id}>
                    <div>
                      <div className="actions-row">
                        <strong>{announcement.title}</strong>
                        <span className="status-pill gray">{announcement.audience === "TEAM" ? announcement.team?.name ?? "팀" : "전체"}</span>
                        {announcement.isPinned ? <span className="status-pill yellow">고정</span> : null}
                      </div>
                      <p className="muted" style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
                        {announcement.body}
                      </p>
                      <p className="muted" style={{ margin: "6px 0 0" }}>
                        {announcement.author.name} · 읽음 {announcement._count.reads}명 · {formatKstDateTime(announcement.createdAt)}
                      </p>
                    </div>
                    <AnnouncementReadButton announcementId={announcement.id} isRead={announcement.isReadByViewer} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">등록된 공지가 없습니다.</div>
            )}
          </div>

          <div className="panel stack">
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
                            <Link href={groupwareHref({ userId: member.id, teamId: organization.filters.teamId, search: organization.filters.search })}>{member.name}</Link>
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
                            <Link className="button secondary" href={groupwareHref({ userId: member.id })}>
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
        </section>

        <aside className="stack">
          <section className="panel stack">
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
              </>
            ) : (
              <div className="empty">직원을 선택하면 연락처와 메모를 확인할 수 있습니다.</div>
            )}
          </section>

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
                        {issue.status === "LOCKED" ? "잠금" : "발행"} · {issue.issuedBy?.name ?? "-"} · {formatKstDateTime(issue.issuedAt)}
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
                      <p className="muted" style={{ margin: "6px 0 0" }}>HR 검토용 PDF · CSV</p>
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

          <section id="groupware-documents" className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>
                <FileText size={20} /> 전자결재/문서함
              </h2>
              <span className="status-pill gray">대기 {pendingDocuments.length}건</span>
            </div>
            <DocumentRequestForm reviewers={assignableUsers} />
            {groupware.documentRequests.length > 0 ? (
              <div className="stack" style={{ gap: 8 }}>
                {groupware.documentRequests.map((document) => (
                  <div className="notification-card read" key={document.id}>
                    <div>
                      <div className="actions-row">
                        <strong>{document.title}</strong>
                        <span className={`status-pill ${document.status === "PENDING" ? "yellow" : document.status === "APPROVED" ? "green" : "red"}`}>
                          {documentStatusLabel(document.status)}
                        </span>
                      </div>
                      <p className="muted" style={{ margin: "6px 0 0" }}>
                        {document.category} · 요청 {document.requester.name} · 결재 {document.reviewer?.name ?? "미지정"}
                      </p>
                      <p className="muted" style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{document.body}</p>
                    </div>
                    {groupware.canManageGroupware && document.status === "PENDING" ? <DocumentReviewButtons documentId={document.id} /> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">전자결재 문서가 없습니다.</div>
            )}
          </section>

          <section className="panel stack">
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
                    <span className={`status-pill ${thread.status === "RESOLVED" ? "green" : "yellow"}`}>
                      {thread.status === "RESOLVED" ? "해결" : "미결"}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty">아직 프로필 메모가 없습니다.</div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

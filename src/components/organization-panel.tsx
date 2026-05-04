import { BriefcaseBusiness, Building2, Clock, Mail, Phone, Users } from "lucide-react";
import Link from "next/link";

import { roleLabel } from "@/lib/display-labels";
import type { getOrganizationDashboard, OrganizationStatusFilter } from "@/lib/organization";
import { formatKstDate, formatKstDateTime, formatKstTime, formatMinutes } from "@/lib/time";

type OrganizationDashboard = Awaited<ReturnType<typeof getOrganizationDashboard>>;

const statusFilterOptions: Array<{ value: OrganizationStatusFilter; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "WORKING", label: "근무중" },
  { value: "AWAY", label: "자리비움" },
  { value: "LEAVE", label: "휴가" },
  { value: "OFFLINE", label: "오프라인" }
];

function organizationHref(
  filters: OrganizationDashboard["filters"],
  patch?: {
    userId?: string | null;
    teamId?: string | null;
    status?: OrganizationStatusFilter | null;
    search?: string | null;
  }
) {
  const params = new URLSearchParams();
  params.set("view", "organization");
  const userId = patch?.userId;
  const teamId = patch?.teamId ?? filters.teamId;
  const status = patch?.status ?? filters.status;
  const search = patch?.search ?? filters.search;

  if (userId) {
    params.set("orgUserId", userId);
  }
  if (teamId) {
    params.set("orgTeamId", teamId);
  }
  if (status && status !== "ALL") {
    params.set("orgStatus", status);
  }
  if (search) {
    params.set("orgSearch", search);
  }

  return `/dashboard?${params.toString()}`;
}

function eventLabel(type: string) {
  if (type === "CHECK_IN") {
    return "출근";
  }
  if (type === "CHECK_OUT") {
    return "퇴근";
  }
  return "상태 변경";
}

function approvalTypeLabel(type: string) {
  if (type === "LEAVE") {
    return "휴가";
  }
  if (type === "OVERTIME") {
    return "초과근로";
  }
  return "근태 정정";
}

function approvalStatusLabel(status: string) {
  if (status === "APPROVED") {
    return "승인";
  }
  if (status === "REJECTED") {
    return "반려";
  }
  return "대기";
}

function scheduleWindow(schedule?: { scheduledStartAt: Date; scheduledEndAt: Date } | null) {
  return schedule ? `${formatKstTime(schedule.scheduledStartAt)} - ${formatKstTime(schedule.scheduledEndAt)}` : "미등록";
}

export function OrganizationPanel({ summary }: { summary: OrganizationDashboard }) {
  const selected = summary.selectedUser;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid-4">
        <div className="metric">
          <span>전체 직원</span>
          <strong>{summary.stats.totalUsers}명</strong>
        </div>
        <div className="metric">
          <span>근무/업무중</span>
          <strong>{summary.stats.workingUsers}명</strong>
        </div>
        <div className="metric">
          <span>휴가</span>
          <strong>{summary.stats.leaveUsers}명</strong>
        </div>
        <div className="metric">
          <span>팀</span>
          <strong>{summary.stats.teamCount}개</strong>
        </div>
      </div>

      <form action="/dashboard" className="panel inline-form">
        <input type="hidden" name="view" value="organization" />
        <div className="grid-4">
          <div className="field">
            <label htmlFor="org-search">직원 검색</label>
            <input id="org-search" name="orgSearch" defaultValue={summary.filters.search} placeholder="이름, 이메일, 직책" />
          </div>
          <div className="field">
            <label htmlFor="org-team">팀</label>
            <select id="org-team" name="orgTeamId" defaultValue={summary.filters.teamId}>
              <option value="">전체 팀</option>
              {summary.selectableTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="org-status">상태</label>
            <select id="org-status" name="orgStatus" defaultValue={summary.filters.status}>
              {statusFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button className="button secondary" type="submit" style={{ alignSelf: "end" }}>
            필터 적용
          </button>
        </div>
      </form>

      <div className="organization-layout">
        <div className="panel stack">
          <div className="actions-row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>
              <Building2 size={20} /> 조직도
            </h2>
            <span className="status-pill gray">{summary.stats.filteredUsers}명 표시</span>
          </div>
          <div className="stack" style={{ gap: 12 }}>
            {summary.teams.map((team) => (
              <div className="card org-team-card" key={team.id}>
                <div className="actions-row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <strong>{team.name}</strong>
                    <p className="muted" style={{ margin: "6px 0 0" }}>
                      관리자 {team.manager?.name ?? "-"} · 구성원 {team.memberCount}명
                    </p>
                  </div>
                  <div className="actions-row">
                    <span className="status-pill green">{team.workingCount}</span>
                    <span className="status-pill yellow">{team.leaveCount}</span>
                    <span className="status-pill gray">{team.offlineCount}</span>
                  </div>
                </div>
                <div className="org-member-grid">
                  {team.members.map((member) => (
                    <Link
                      key={member.id}
                      className="org-member-chip"
                      href={organizationHref(summary.filters, { userId: member.id, teamId: team.id === "__none__" ? "" : team.id })}
                      aria-current={selected?.id === member.id ? "page" : undefined}
                    >
                      <span className={`status-dot ${member.statusTone}`} aria-hidden="true" />
                      <span>
                        <strong>{member.name}</strong>
                        <small>{member.jobTitle || roleLabel(member.role)}</small>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="stack">
          <div className="panel stack">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>
                <Users size={20} /> 근무 상태판
              </h2>
              <span className="status-pill gray">{summary.today}</span>
            </div>
            {summary.users.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>직원</th>
                      <th>상태</th>
                      <th>팀</th>
                      <th>오늘 스케줄</th>
                      <th>오늘</th>
                      <th>최근 접속</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.users.map((member) => (
                      <tr key={member.id}>
                        <td>
                          <Link href={organizationHref(summary.filters, { userId: member.id })}>{member.name}</Link>
                          <br />
                          <span className="muted">{member.jobTitle || roleLabel(member.role)}</span>
                        </td>
                        <td>
                          <span className={`status-pill ${member.statusTone}`}>{member.latestStatusLabel}</span>
                        </td>
                        <td>{member.team?.name ?? "소속 없음"}</td>
                        <td>{scheduleWindow(member.todaySchedule)}</td>
                        <td>{member.todayMinutes === null ? "-" : formatMinutes(member.todayMinutes)}</td>
                        <td>{member.lastSeenAt ? formatKstDateTime(member.lastSeenAt) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">조건에 맞는 직원이 없습니다.</div>
            )}
          </div>

          <div className="panel stack">
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
                  <div className="metric">
                    <span>고용 형태</span>
                    <strong style={{ fontSize: 18 }}>{selected.employmentTypeLabel}</strong>
                  </div>
                  <div className="metric">
                    <span>입사일</span>
                    <strong style={{ fontSize: 18 }}>{formatKstDate(selected.joinedAt)}</strong>
                  </div>
                  <div className="metric">
                    <span>보고 라인</span>
                    <strong style={{ fontSize: 18 }}>{summary.selectedTeamManager?.name ?? "-"}</strong>
                  </div>
                </div>

                <div className="grid-3">
                  <div className="card">
                    <strong>
                      <Mail size={16} /> 이메일
                    </strong>
                    <p className="muted" style={{ marginBottom: 0 }}>{selected.email}</p>
                  </div>
                  <div className="card">
                    <strong>
                      <Phone size={16} /> 연락처
                    </strong>
                    <p className="muted" style={{ marginBottom: 0 }}>{selected.phoneNumber ?? "-"}</p>
                  </div>
                  <div className="card">
                    <strong>
                      <BriefcaseBusiness size={16} /> 내선
                    </strong>
                    <p className="muted" style={{ marginBottom: 0 }}>{selected.extensionNumber ?? "-"}</p>
                  </div>
                </div>

                <div className="grid-3">
                  <div className="metric">
                    <span>오늘 스케줄</span>
                    <strong style={{ fontSize: 18 }}>{scheduleWindow(selected.todaySchedule)}</strong>
                  </div>
                  <div className="metric">
                    <span>출근/퇴근</span>
                    <strong style={{ fontSize: 18 }}>
                      {selected.session ? `${formatKstTime(selected.session.checkInAt)} / ${formatKstTime(selected.session.checkOutAt)}` : "-"}
                    </strong>
                  </div>
                  <div className="metric">
                    <span>주간 누적</span>
                    <strong style={{ fontSize: 18 }}>{selected.weeklyMinutes === null ? "-" : formatMinutes(selected.weeklyMinutes)}</strong>
                  </div>
                </div>

                {selected.canViewSensitive ? (
                  <div className="split">
                    <div className="card">
                      <div className="actions-row" style={{ justifyContent: "space-between" }}>
                        <strong>
                          <Clock size={16} /> 오늘 기록
                        </strong>
                        <span className="status-pill gray">{summary.selectedEvents.length}건</span>
                      </div>
                      <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                        {summary.selectedEvents.length > 0 ? (
                          summary.selectedEvents.map((event) => (
                            <div className="notification-card read" key={event.id}>
                              <div>
                                <strong>{eventLabel(event.eventType)}</strong>
                                <p className="muted" style={{ margin: "6px 0 0" }}>
                                  {formatKstDateTime(event.occurredAt)} · {event.status ? event.status : "-"} · {event.source}
                                </p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="empty">오늘 기록이 없습니다.</div>
                        )}
                      </div>
                    </div>

                    <div className="card">
                      <div className="actions-row" style={{ justifyContent: "space-between" }}>
                        <strong>최근 신청</strong>
                        <span className="status-pill gray">{summary.selectedApprovals.length}건</span>
                      </div>
                      <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                        {summary.selectedApprovals.length > 0 ? (
                          summary.selectedApprovals.map((approval) => (
                            <div className="notification-card read" key={approval.id}>
                              <div>
                                <strong>{approvalTypeLabel(approval.type)} · {approvalStatusLabel(approval.status)}</strong>
                                <p className="muted" style={{ margin: "6px 0 0" }}>
                                  {formatKstDateTime(approval.createdAt)} · {approval.reason}
                                </p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="empty">최근 신청이 없습니다.</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="empty">근무 시간 상세는 본인과 관리 범위 직원만 표시됩니다.</div>
                )}
              </>
            ) : (
              <div className="empty">표시할 직원 프로필이 없습니다.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

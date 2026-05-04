"use client";

import { AtSign, CheckCircle2, MessageSquare, UserCog } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type WorkboxUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type WorkboxThread = {
  id: string;
  targetType: string;
  targetId: string;
  title: string;
  status: string;
  priority: string;
  assignee: WorkboxUser | null;
  createdBy: WorkboxUser | null;
  lastCommentAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  lastCommentPreview: string | null;
  isUnread: boolean;
  targetSummary: string;
  href: string;
  mine: boolean;
};

type WorkboxComment = {
  id: string;
  body: string;
  mentions: unknown;
  createdAt: string | Date;
  author: WorkboxUser;
};

type WorkboxDetail = WorkboxThread & {
  comments: WorkboxComment[];
};

type WorkboxSummary = {
  filter: string;
  threads: WorkboxThread[];
  selectedThread: WorkboxDetail | null;
  assignableUsers: WorkboxUser[];
  mentionableUsers: WorkboxUser[];
  canManageThreads: boolean;
  stats: {
    total: number;
    mine: number;
    unread: number;
    approval: number;
    risk: number;
    monthClose: number;
    resolved: number;
  };
};

async function postJson(path: string, body?: Record<string, unknown>, method = "POST") {
  const response = await fetch(path, {
    method,
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

function workboxHref(filter: string, threadId?: string) {
  const params = new URLSearchParams();
  params.set("view", "workbox");
  params.set("workboxFilter", filter);
  if (threadId) {
    params.set("workThreadId", threadId);
  }
  return `/dashboard?${params.toString()}`;
}

function formatShortDate(value?: string | Date | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function targetTypeLabel(type: string) {
  if (type === "APPROVAL_REQUEST") {
    return "승인";
  }
  if (type === "RISK_SIGNAL") {
    return "리스크";
  }
  if (type === "USER_PROFILE") {
    return "메모";
  }
  if (type === "DOCUMENT_REQUEST") {
    return "전자결재";
  }
  return "월마감";
}

function priorityTone(priority: string) {
  if (priority === "URGENT" || priority === "HIGH") {
    return "red";
  }
  if (priority === "LOW") {
    return "gray";
  }
  return "yellow";
}

export function WorkboxPanel({ summary }: { summary: WorkboxSummary }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [assigneeId, setAssigneeId] = useState(summary.selectedThread?.assignee?.id ?? "");
  const [status, setStatus] = useState(summary.selectedThread?.status ?? "OPEN");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const selected = summary.selectedThread;
  const filters = [
    { key: "mine", label: "내 담당", count: summary.stats.mine },
    { key: "unread", label: "미읽음", count: summary.stats.unread },
    { key: "approval", label: "승인", count: summary.stats.approval },
    { key: "risk", label: "리스크", count: summary.stats.risk },
    { key: "month-close", label: "월마감", count: summary.stats.monthClose },
    { key: "resolved", label: "해결됨", count: summary.stats.resolved }
  ];

  function toggleMention(userId: string) {
    setMentionIds((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  }

  function submitComment() {
    if (!selected) {
      return;
    }

    setMessage("");
    startTransition(async () => {
      try {
        await postJson(`/api/workbox/threads/${selected.id}/comments`, {
          body: comment,
          mentionUserIds: mentionIds
        });
        setComment("");
        setMentionIds([]);
        setMessage("댓글을 남겼습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "댓글 저장에 실패했습니다.");
      }
    });
  }

  function saveThread() {
    if (!selected) {
      return;
    }

    setMessage("");
    startTransition(async () => {
      try {
        await postJson(
          `/api/workbox/threads/${selected.id}`,
          {
            assigneeId: assigneeId || null,
            status
          },
          "PATCH"
        );
        setMessage("업무 상태를 저장했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "업무 상태 저장에 실패했습니다.");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid-4">
        <div className="metric">
          <span>전체 업무</span>
          <strong>{summary.stats.total}건</strong>
        </div>
        <div className="metric">
          <span>내 담당</span>
          <strong>{summary.stats.mine}건</strong>
        </div>
        <div className="metric">
          <span>미읽음</span>
          <strong>{summary.stats.unread}건</strong>
        </div>
        <div className="metric">
          <span>해결됨</span>
          <strong>{summary.stats.resolved}건</strong>
        </div>
      </div>

      <div className="actions-row">
        {filters.map((filter) => (
          <Link
            key={filter.key}
            className={`button ${summary.filter === filter.key ? "" : "secondary"}`}
            href={workboxHref(filter.key)}
          >
            {filter.label} {filter.count}
          </Link>
        ))}
      </div>

      <div className="workbox-layout">
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>
            <MessageSquare size={20} /> 업무 목록
          </h2>
          {summary.threads.length > 0 ? (
            <div className="stack" style={{ gap: 10 }}>
              {summary.threads.map((thread) => (
                <Link
                  className="notification-card"
                  key={thread.id}
                  href={workboxHref(summary.filter, thread.id)}
                  style={{
                    textDecoration: "none",
                    borderColor: selected?.id === thread.id ? "#3b82f6" : undefined,
                    background: thread.isUnread ? "#f8fbff" : "#ffffff"
                  }}
                >
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="actions-row">
                      <span className={`status-pill ${priorityTone(thread.priority)}`}>{thread.priority}</span>
                      <span className="status-pill gray">{targetTypeLabel(thread.targetType)}</span>
                      {thread.isUnread ? <span className="status-pill yellow">미읽음</span> : null}
                    </div>
                    <strong>{thread.title}</strong>
                    <p className="muted" style={{ margin: 0 }}>
                      {thread.targetSummary}
                    </p>
                    {thread.lastCommentPreview ? (
                      <p className="muted" style={{ margin: 0 }}>
                        최근 댓글: {thread.lastCommentPreview}
                      </p>
                    ) : null}
                    <p className="muted" style={{ margin: 0 }}>
                      담당 {thread.assignee?.name ?? "미지정"} · {formatShortDate(thread.lastCommentAt ?? thread.updatedAt)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty">이 필터에 표시할 업무가 없습니다.</div>
          )}
        </div>

        <div className="panel stack">
          {selected ? (
            <>
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <h2 style={{ margin: "0 0 8px" }}>{selected.title}</h2>
                  <p className="muted" style={{ margin: 0 }}>
                    {selected.targetSummary}
                  </p>
                </div>
                <span className={`status-pill ${selected.status === "RESOLVED" ? "green" : "yellow"}`}>
                  {selected.status === "RESOLVED" ? "해결됨" : "진행 중"}
                </span>
              </div>

              {summary.canManageThreads ? (
                <div className="grid-3">
                  <div className="field">
                    <label htmlFor="workbox-assignee">담당자</label>
                    <select id="workbox-assignee" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                      <option value="">미지정</option>
                      {summary.assignableUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name} · {user.role}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="workbox-status">상태</label>
                    <select id="workbox-status" value={status} onChange={(event) => setStatus(event.target.value)}>
                      <option value="OPEN">진행 중</option>
                      <option value="RESOLVED">해결됨</option>
                    </select>
                  </div>
                  <button className="button secondary" type="button" disabled={isPending} onClick={saveThread} style={{ alignSelf: "end" }}>
                    <UserCog size={16} />
                    저장
                  </button>
                </div>
              ) : null}

              <div className="stack" style={{ gap: 10 }}>
                <h3 style={{ margin: 0 }}>댓글 타임라인</h3>
                {selected.comments.length > 0 ? (
                  selected.comments.map((item) => (
                    <div className="card" key={item.id}>
                      <div className="actions-row" style={{ justifyContent: "space-between" }}>
                        <strong>{item.author.name}</strong>
                        <span className="muted">{formatShortDate(item.createdAt)}</span>
                      </div>
                      <p style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{item.body}</p>
                    </div>
                  ))
                ) : (
                  <div className="empty">아직 댓글이 없습니다. 확인 내용이나 보완 요청을 남기세요.</div>
                )}
              </div>

              <div className="panel stack" style={{ background: "#fbfdff" }}>
                <h3 style={{ margin: 0 }}>
                  <AtSign size={18} /> 댓글 작성
                </h3>
                <div className="field">
                  <label htmlFor="workbox-comment">업무 메모</label>
                  <textarea
                    id="workbox-comment"
                    rows={4}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="@멘션할 사람을 선택하고 보완 요청이나 처리 메모를 남기세요."
                  />
                </div>
                <div className="workbox-mention-grid">
                  {summary.mentionableUsers.slice(0, 12).map((user) => (
                    <label className="check-row" key={user.id}>
                      <input
                        type="checkbox"
                        checked={mentionIds.includes(user.id)}
                        onChange={() => toggleMention(user.id)}
                      />
                      {user.name}
                    </label>
                  ))}
                </div>
                <div className="actions-row">
                  <button className="button" type="button" disabled={isPending || !comment.trim()} onClick={submitComment}>
                    <CheckCircle2 size={16} />
                    댓글 남기기
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty">업무를 선택하면 댓글과 처리 상태를 확인할 수 있습니다.</div>
          )}
          {message ? <p className="muted" aria-live="polite">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}

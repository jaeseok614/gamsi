"use client";

import { MessageSquarePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type GroupwareUserOption = {
  id: string;
  name: string;
  email: string;
  role: string;
};

async function postJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "요청 처리에 실패했습니다.");
  }

  return response.json().catch(() => ({}));
}

async function patchJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "요청 처리에 실패했습니다.");
  }

  return response.json().catch(() => ({}));
}

export function AnnouncementForm({
  teams
}: {
  teams: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("ALL");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    setMessage("");
    startTransition(async () => {
      try {
        await postJson("/api/groupware/announcements", {
          title,
          body,
          audience,
          teamId: audience === "TEAM" ? teamId : null
        });
        setTitle("");
        setBody("");
        setMessage("공지를 발행했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "공지 발행에 실패했습니다.");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="announcement-title">공지 제목</label>
          <input id="announcement-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="announcement-audience">대상</label>
          <select id="announcement-audience" value={audience} onChange={(event) => setAudience(event.target.value)}>
            <option value="ALL">전체</option>
            <option value="TEAM">팀</option>
          </select>
        </div>
      </div>
      {audience === "TEAM" ? (
        <div className="field">
          <label htmlFor="announcement-team">대상 팀</label>
          <select id="announcement-team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="announcement-body">공지 내용</label>
        <textarea id="announcement-body" rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
      </div>
      <div className="actions-row">
        <button className="button" type="button" disabled={isPending || !title.trim() || !body.trim()} onClick={submit}>
          발행
        </button>
        {message ? <span className="muted" aria-live="polite">{message}</span> : null}
      </div>
    </div>
  );
}

export function AnnouncementReadButton({ announcementId, isRead }: { announcementId: string; isRead: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function markRead() {
    setMessage("");
    startTransition(async () => {
      try {
        await postJson(`/api/groupware/announcements/${announcementId}/read`, {});
        setMessage("읽음 처리했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "읽음 처리에 실패했습니다.");
      }
    });
  }

  return (
    <div className="actions-row">
      <button className="button secondary" type="button" disabled={isPending || isRead} onClick={markRead}>
        {isRead ? "읽음" : "읽음 처리"}
      </button>
      {message ? <span className="muted">{message}</span> : null}
    </div>
  );
}

export function PerformanceGoalForm({
  currentMonth,
  users,
  teams
}: {
  currentMonth: string;
  users: GroupwareUserOption[];
  teams: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [ownerType, setOwnerType] = useState("USER");
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [month, setMonth] = useState(currentMonth);
  const [title, setTitle] = useState("");
  const [unit, setUnit] = useState("건");
  const [targetValue, setTargetValue] = useState("100");
  const [actualValue, setActualValue] = useState("0");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    setMessage("");
    startTransition(async () => {
      try {
        await postJson("/api/groupware/performance-goals", {
          ownerType,
          userId: ownerType === "USER" ? userId : null,
          teamId: ownerType === "TEAM" ? teamId : null,
          month,
          title,
          unit,
          targetValue: Number(targetValue),
          actualValue: Number(actualValue)
        });
        setTitle("");
        setMessage("실적 목표를 저장했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "실적 목표 저장에 실패했습니다.");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="grid-3">
        <div className="field">
          <label htmlFor="performance-owner-type">대상</label>
          <select id="performance-owner-type" value={ownerType} onChange={(event) => setOwnerType(event.target.value)}>
            <option value="USER">직원</option>
            <option value="TEAM">팀</option>
          </select>
        </div>
        {ownerType === "USER" ? (
          <div className="field">
            <label htmlFor="performance-user">직원</label>
            <select id="performance-user" value={userId} onChange={(event) => setUserId(event.target.value)}>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="performance-team">팀</label>
            <select id="performance-team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="performance-month">월</label>
          <input id="performance-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </div>
      </div>
      <div className="grid-3">
        <div className="field">
          <label htmlFor="performance-title">지표명</label>
          <input id="performance-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="performance-target">목표</label>
          <input id="performance-target" type="number" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="performance-actual">실적</label>
          <input id="performance-actual" type="number" value={actualValue} onChange={(event) => setActualValue(event.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="performance-unit">단위</label>
        <input id="performance-unit" value={unit} onChange={(event) => setUnit(event.target.value)} />
      </div>
      <div className="actions-row">
        <button className="button" type="button" disabled={isPending || !title.trim()} onClick={submit}>
          목표 저장
        </button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </div>
  );
}

export function PerformanceGoalUpdateForm({ goalId, currentActual }: { goalId: string; currentActual: number }) {
  const router = useRouter();
  const [actualValue, setActualValue] = useState(String(currentActual));
  const [evaluationMemo, setEvaluationMemo] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    setMessage("");
    startTransition(async () => {
      try {
        await patchJson("/api/groupware/performance-goals", {
          id: goalId,
          actualValue: Number(actualValue),
          evaluationMemo
        });
        setEvaluationMemo("");
        setMessage("실적을 업데이트했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "실적 업데이트에 실패했습니다.");
      }
    });
  }

  return (
    <div className="grid-3">
      <div className="field">
        <label htmlFor={`goal-actual-${goalId}`}>실적</label>
        <input id={`goal-actual-${goalId}`} type="number" value={actualValue} onChange={(event) => setActualValue(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`goal-memo-${goalId}`}>평가 메모</label>
        <input id={`goal-memo-${goalId}`} value={evaluationMemo} onChange={(event) => setEvaluationMemo(event.target.value)} />
      </div>
      <div className="actions-row" style={{ alignSelf: "end" }}>
        <button className="button secondary" type="button" disabled={isPending} onClick={submit}>
          저장
        </button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </div>
  );
}

export function PayrollIssueForm({
  currentMonth,
  users
}: {
  currentMonth: string;
  users: GroupwareUserOption[];
}) {
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth);
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState("PUBLISHED");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = (await postJson("/api/groupware/payroll-statements/issue", {
          month,
          userIds: userId ? [userId] : undefined,
          status
        })) as { count?: number };
        setMessage(`${result.count ?? 0}건 발행했습니다.`);
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "급여명세 발행에 실패했습니다.");
      }
    });
  }

  return (
    <div className="grid-4">
      <div className="field">
        <label htmlFor="payroll-issue-month">월</label>
        <input id="payroll-issue-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="payroll-issue-user">대상</label>
        <select id="payroll-issue-user" value={userId} onChange={(event) => setUserId(event.target.value)}>
          <option value="">전체 직원</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="payroll-issue-status">상태</label>
        <select id="payroll-issue-status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="PUBLISHED">발행</option>
          <option value="LOCKED">잠금 발행</option>
        </select>
      </div>
      <div className="actions-row" style={{ alignSelf: "end" }}>
        <button className="button" type="button" disabled={isPending} onClick={submit}>
          발행
        </button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </div>
  );
}

export function DocumentRequestForm({
  reviewers
}: {
  reviewers: GroupwareUserOption[];
}) {
  const router = useRouter();
  const [category, setCategory] = useState("GENERAL");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [amount, setAmount] = useState("");
  const [reviewerId, setReviewerId] = useState(reviewers[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    setMessage("");
    startTransition(async () => {
      try {
        await postJson("/api/groupware/document-requests", {
          category,
          title,
          body,
          amount: amount ? Number(amount) : null,
          reviewerId
        });
        setTitle("");
        setBody("");
        setAmount("");
        setMessage("전자결재를 상신했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "전자결재 상신에 실패했습니다.");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="grid-3">
        <div className="field">
          <label htmlFor="document-category">유형</label>
          <select id="document-category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="GENERAL">일반 품의</option>
            <option value="EXPENSE">지출결의</option>
            <option value="PURCHASE">구매요청</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="document-reviewer">결재자</label>
          <select id="document-reviewer" value={reviewerId} onChange={(event) => setReviewerId(event.target.value)}>
            {reviewers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="document-amount">금액</label>
          <input id="document-amount" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="document-title">제목</label>
        <input id="document-title" value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="document-body">내용</label>
        <textarea id="document-body" rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
      </div>
      <div className="actions-row">
        <button className="button" type="button" disabled={isPending || !title.trim() || !body.trim()} onClick={submit}>
          상신
        </button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </div>
  );
}

export function DocumentReviewButtons({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function review(status: "APPROVED" | "REJECTED") {
    setMessage("");
    startTransition(async () => {
      try {
        await postJson(`/api/groupware/document-requests/${documentId}/review`, {
          status,
          reviewNote: status === "APPROVED" ? "승인" : "반려"
        });
        setMessage(status === "APPROVED" ? "승인했습니다." : "반려했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "전자결재 처리에 실패했습니다.");
      }
    });
  }

  return (
    <div className="actions-row">
      <button className="button secondary" type="button" disabled={isPending} onClick={() => review("APPROVED")}>
        승인
      </button>
      <button className="button secondary" type="button" disabled={isPending} onClick={() => review("REJECTED")}>
        반려
      </button>
      {message ? <span className="muted">{message}</span> : null}
    </div>
  );
}

export function ProfileMemoForm({
  targetUserId,
  mentionableUsers,
  assignableUsers
}: {
  targetUserId: string;
  mentionableUsers: GroupwareUserOption[];
  assignableUsers: GroupwareUserOption[];
}) {
  const router = useRouter();
  const [memo, setMemo] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [mentionUserIds, setMentionUserIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function toggleMention(userId: string) {
    setMentionUserIds((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  }

  function submitMemo() {
    setMessage("");
    startTransition(async () => {
      try {
        await postJson("/api/groupware/profile-memos", {
          userId: targetUserId,
          memo,
          assigneeId: assigneeId || null,
          mentionUserIds
        });
        setMemo("");
        setAssigneeId("");
        setMentionUserIds([]);
        setMessage("메모를 저장했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "메모 저장에 실패했습니다.");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {assignableUsers.length > 0 ? (
        <div className="field">
          <label htmlFor={`memo-assignee-${targetUserId}`}>담당자</label>
          <select id={`memo-assignee-${targetUserId}`} value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">미지정</option>
            {assignableUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.role}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={`profile-memo-${targetUserId}`}>프로필 메모</label>
        <textarea
          id={`profile-memo-${targetUserId}`}
          rows={4}
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="확인할 내용, 후속 조치, 전달 메모를 남기세요."
        />
      </div>
      {mentionableUsers.length > 0 ? (
        <div className="workbox-mention-grid">
          {mentionableUsers.slice(0, 12).map((user) => (
            <label className="check-row" key={user.id}>
              <input
                type="checkbox"
                checked={mentionUserIds.includes(user.id)}
                onChange={() => toggleMention(user.id)}
              />
              {user.name}
            </label>
          ))}
        </div>
      ) : null}
      <div className="actions-row">
        <button className="button" type="button" disabled={isPending || !memo.trim()} onClick={submitMemo}>
          <MessageSquarePlus size={16} />
          메모 저장
        </button>
        {message ? <span className="muted" aria-live="polite">{message}</span> : null}
      </div>
    </div>
  );
}

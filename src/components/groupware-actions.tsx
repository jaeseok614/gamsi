"use client";

import { MessageSquarePlus, Paperclip, Upload } from "lucide-react";
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

async function postForm(path: string, formData: FormData) {
  const response = await fetch(path, {
    method: "POST",
    body: formData
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
  const [category, setCategory] = useState("NOTICE");
  const [publishAt, setPublishAt] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [allowComments, setAllowComments] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    setMessage("");
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("title", title);
        formData.set("body", body);
        formData.set("audience", audience);
        formData.set("teamId", audience === "TEAM" ? teamId : "");
        formData.set("category", category);
        formData.set("publishAt", publishAt);
        formData.set("isPinned", String(isPinned));
        formData.set("allowComments", String(allowComments));
        files.forEach((file) => formData.append("attachments", file));
        await postForm("/api/groupware/announcements", formData);
        setTitle("");
        setBody("");
        setPublishAt("");
        setIsPinned(false);
        setAllowComments(false);
        setFiles([]);
        setMessage("공지를 발행했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "공지 발행에 실패했습니다.");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="grid-3">
        <div className="field">
          <label htmlFor="announcement-title">공지 제목</label>
          <input id="announcement-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="announcement-category">분류</label>
          <select id="announcement-category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="NOTICE">공지</option>
            <option value="RESOURCE">자료실</option>
            <option value="TEAM">팀 게시판</option>
            <option value="HR">HR 안내</option>
          </select>
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
      <div className="grid-3">
        <div className="field">
          <label htmlFor="announcement-publish-at">예약 발행</label>
          <input id="announcement-publish-at" type="datetime-local" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} />
        </div>
        <label className="check-row" style={{ alignSelf: "end" }}>
          <input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} />
          상단 고정
        </label>
        <label className="check-row" style={{ alignSelf: "end" }}>
          <input type="checkbox" checked={allowComments} onChange={(event) => setAllowComments(event.target.checked)} />
          댓글 허용
        </label>
      </div>
      <div className="field">
        <label htmlFor="announcement-attachments">첨부파일</label>
        <input
          id="announcement-attachments"
          type="file"
          multiple
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
      </div>
      <div className="actions-row">
        <button className="button" type="button" disabled={isPending || !title.trim() || !body.trim()} onClick={submit}>
          <Upload size={15} />
          발행
        </button>
        {files.length > 0 ? (
          <span className="muted">
            <Paperclip size={14} /> {files.length}개
          </span>
        ) : null}
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

export function AnnouncementCommentForm({ announcementId }: { announcementId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    setMessage("");
    startTransition(async () => {
      try {
        await postJson(`/api/groupware/announcements/${announcementId}/comments`, {
          body
        });
        setBody("");
        setMessage("댓글을 저장했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "댓글 저장에 실패했습니다.");
      }
    });
  }

  return (
    <div className="actions-row">
      <input aria-label="공지 댓글" value={body} onChange={(event) => setBody(event.target.value)} placeholder="댓글" />
      <button className="button secondary" type="button" disabled={isPending || !body.trim()} onClick={submit}>
        저장
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
  const [vendor, setVendor] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [budgetCode, setBudgetCode] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    setMessage("");
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("category", category);
        formData.set("title", title);
        formData.set("body", body);
        formData.set("amount", amount);
        formData.set("reviewerId", reviewerId);
        formData.set("vendor", vendor);
        formData.set("dueDate", dueDate);
        formData.set("budgetCode", budgetCode);
        files.forEach((file) => formData.append("attachments", file));
        await postForm("/api/groupware/document-requests", formData);
        setTitle("");
        setBody("");
        setAmount("");
        setVendor("");
        setDueDate("");
        setBudgetCode("");
        setFiles([]);
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
      <div className="grid-3">
        <div className="field">
          <label htmlFor="document-vendor">거래처/대상</label>
          <input id="document-vendor" value={vendor} onChange={(event) => setVendor(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="document-due-date">희망일</label>
          <input id="document-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="document-budget-code">예산/계정</label>
          <input id="document-budget-code" value={budgetCode} onChange={(event) => setBudgetCode(event.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="document-body">내용</label>
        <textarea id="document-body" rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="document-attachments">첨부파일</label>
        <input id="document-attachments" type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
      </div>
      <div className="actions-row">
        <button className="button" type="button" disabled={isPending || !title.trim() || !body.trim()} onClick={submit}>
          상신
        </button>
        {files.length > 0 ? (
          <span className="muted">
            <Paperclip size={14} /> {files.length}개
          </span>
        ) : null}
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

export function DocumentLibraryForm({
  items,
  teams
}: {
  items: Array<{ id: string; title: string }>;
  teams: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [itemId, setItemId] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("POLICY");
  const [accessScope, setAccessScope] = useState("ALL");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    setMessage("");
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("itemId", itemId);
        formData.set("title", title);
        formData.set("category", category);
        formData.set("accessScope", accessScope);
        formData.set("teamId", accessScope === "TEAM" ? teamId : "");
        formData.set("description", description);
        formData.set("note", note);
        if (file) {
          formData.set("file", file);
        }
        await postForm("/api/groupware/library", formData);
        setTitle("");
        setDescription("");
        setNote("");
        setFile(null);
        setMessage("자료를 등록했습니다.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "자료 등록에 실패했습니다.");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {items.length > 0 ? (
        <div className="field">
          <label htmlFor="library-item">새 버전 대상</label>
          <select id="library-item" value={itemId} onChange={(event) => setItemId(event.target.value)}>
            <option value="">새 문서</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="grid-3">
        <div className="field">
          <label htmlFor="library-title">자료명</label>
          <input id="library-title" value={title} disabled={Boolean(itemId)} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="library-category">분류</label>
          <select id="library-category" value={category} disabled={Boolean(itemId)} onChange={(event) => setCategory(event.target.value)}>
            <option value="POLICY">회사 규정</option>
            <option value="CONTRACT">계약서 양식</option>
            <option value="LEAVE">휴가 정책</option>
            <option value="PAYROLL">급여 안내</option>
            <option value="FORM">서식</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="library-access">권한</label>
          <select id="library-access" value={accessScope} disabled={Boolean(itemId)} onChange={(event) => setAccessScope(event.target.value)}>
            <option value="ALL">전체</option>
            <option value="TEAM">부서</option>
            <option value="HR">HR/관리자</option>
          </select>
        </div>
      </div>
      {accessScope === "TEAM" && !itemId ? (
        <div className="field">
          <label htmlFor="library-team">공개 부서</label>
          <select id="library-team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="grid-2">
        <div className="field">
          <label htmlFor="library-description">설명</label>
          <input id="library-description" value={description} disabled={Boolean(itemId)} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="library-note">버전 메모</label>
          <input id="library-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="library-file">파일</label>
        <input id="library-file" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </div>
      <div className="actions-row">
        <button className="button" type="button" disabled={isPending || !file || (!itemId && !title.trim())} onClick={submit}>
          <Upload size={15} />
          등록
        </button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
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

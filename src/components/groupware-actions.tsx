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

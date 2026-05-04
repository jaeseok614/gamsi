"use client";

import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function InviteAcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="login-form">
      <div className="field">
        <label htmlFor="invite-password">비밀번호 설정</label>
        <input
          id="invite-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="8자 이상"
        />
      </div>
      <button
        className="button"
        type="button"
        disabled={isPending}
        onClick={() => {
          setMessage("");
          startTransition(async () => {
            const response = await fetch(`/api/invitations/${token}/accept`, {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({ password })
            });

            if (!response.ok) {
              const payload = (await response.json().catch(() => null)) as { error?: string } | null;
              setMessage(payload?.error ?? "초대 수락에 실패했습니다.");
              return;
            }

            router.push("/login");
            router.refresh();
          });
        }}
      >
        <CheckCircle2 size={16} />
        초대 수락
      </button>
      {message ? <div className="error">{message}</div> : null}
    </div>
  );
}

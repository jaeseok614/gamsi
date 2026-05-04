"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function PasswordResetConfirmForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="login-form">
      <div className="field">
        <label htmlFor="reset-password">새 비밀번호</label>
        <input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="8자 이상"
        />
      </div>
      <div className="field">
        <label htmlFor="reset-password-confirm">새 비밀번호 확인</label>
        <input
          id="reset-password-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="다시 입력"
        />
      </div>
      <button
        className="button"
        type="button"
        disabled={isPending}
        onClick={() => {
          if (password !== confirmPassword) {
            setMessage("비밀번호 확인이 일치하지 않습니다.");
            return;
          }

          setMessage("");
          startTransition(async () => {
            const response = await fetch("/api/auth/password/reset/confirm", {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                token,
                nextPassword: password
              })
            });

            const payload = (await response.json().catch(() => null)) as { error?: string } | null;
            if (!response.ok) {
              setMessage(payload?.error ?? "비밀번호 재설정에 실패했습니다.");
              return;
            }

            router.push("/login");
            router.refresh();
          });
        }}
      >
        <KeyRound size={16} />
        새 비밀번호 저장
      </button>
      {message ? <div className="error">{message}</div> : null}
    </div>
  );
}

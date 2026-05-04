"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

export function PasswordResetRequestForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="login-form">
      <div className="field">
        <label htmlFor="reset-email">이메일</label>
        <input
          id="reset-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="가입한 이메일 주소"
        />
      </div>
      <button
        className="button"
        type="button"
        disabled={isPending}
        onClick={() => {
          setMessage("");
          startTransition(async () => {
            const response = await fetch("/api/auth/password/reset/request", {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({ email })
            });

            const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
            if (!response.ok) {
              setMessage(payload?.error ?? "재설정 메일 요청에 실패했습니다.");
              return;
            }

            setMessage(payload?.message ?? "재설정 안내를 확인하세요.");
          });
        }}
      >
        <Mail size={16} />
        재설정 메일 보내기
      </button>
      {message ? <div className={message.includes("실패") || message.includes("확인") ? "error" : "empty"}>{message}</div> : null}
      <Link className="button secondary" href="/login">
        로그인으로 돌아가기
      </Link>
    </div>
  );
}

"use client";

import { LogIn } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const demoAccounts = [
  { label: "관리자", email: "admin@gamsi.kr" },
  { label: "인사 담당", email: "hr@gamsi.kr" },
  { label: "팀장", email: "manager@gamsi.kr" },
  { label: "직원", email: "employee@gamsi.kr" },
  { label: "현장", email: "field@gamsi.kr" }
];

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("manager@gamsi.kr");
  const [password, setPassword] = useState("password123!");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function login() {
    setError("");
    startTransition(async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "로그인에 실패했습니다.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="login-form">
      <div className="field">
        <label htmlFor="email">이메일</label>
        <input id="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="password">비밀번호</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </div>
      {error ? <div className="error">{error}</div> : null}
      <button className="button" type="button" onClick={login} disabled={isPending}>
        <LogIn size={18} />
        {isPending ? "로그인 중" : "로그인"}
      </button>
      <Link href="/reset-password" className="muted" style={{ fontWeight: 700, textDecoration: "underline" }}>
        비밀번호를 잊으셨나요?
      </Link>
      <div className="stack" style={{ gap: 10 }}>
        <strong>데모 계정</strong>
        <div className="actions-row">
          {demoAccounts.map((account) => (
            <button
              className="button secondary"
              key={account.email}
              type="button"
              onClick={() => {
                setEmail(account.email);
                setPassword("password123!");
              }}
            >
              {account.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

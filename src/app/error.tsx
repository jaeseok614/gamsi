"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset
}: {
  error: Error & {
    digest?: string;
  };
  reset: () => void;
}) {
  useEffect(() => {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: error.message,
        digest: error.digest ?? null,
        pathname: typeof window !== "undefined" ? window.location.pathname : null,
        stack: error.stack ?? null
      })
    }).catch(() => undefined);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#f8fafc"
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          borderRadius: 18,
          border: "1px solid #dbeafe",
          background: "#ffffff",
          padding: 24,
          boxShadow: "0 20px 60px rgba(15, 23, 42, 0.08)"
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 12 }}>화면을 불러오지 못했습니다.</h1>
        <p style={{ marginTop: 0, color: "#475569", lineHeight: 1.6 }}>
          오류 정보를 기록했습니다. 잠시 후 다시 시도하거나 관리자 설정의 운영 관제에서 최근 오류를 확인하세요.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            border: 0,
            borderRadius: 10,
            background: "#1d4ed8",
            color: "#fff",
            padding: "10px 14px",
            fontWeight: 700,
            cursor: "pointer"
          }}
        >
          다시 시도
        </button>
      </div>
    </main>
  );
}

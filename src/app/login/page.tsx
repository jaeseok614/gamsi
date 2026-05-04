import { ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="login-page">
      <section className="login-shell" aria-label="워크가드 로그인">
        <div className="login-copy">
          <Link className="brand" href="/">
            <Image src="/logo.jpg" alt="워크가드 로고" width={34} height={34} priority />
            <span>워크가드</span>
          </Link>
          <div style={{ marginTop: 42 }}>
            <span className="status-pill">
              <ShieldCheck size={14} />
              노무 리스크 관리
            </span>
            <h1 style={{ margin: "18px 0 14px", fontSize: 36, lineHeight: 1.18 }}>
              초과근로와 증빙을
              <br />
              한 화면에서 관리합니다
            </h1>
            <p className="section-copy">
              데모 계정으로 직원 기록, 관리자 리스크 대시보드, 인사 리포트 흐름을 바로 확인할 수 있습니다.
            </p>
          </div>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}

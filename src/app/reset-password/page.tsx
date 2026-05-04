import { ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { PasswordResetRequestForm } from "@/components/password-reset-request-form";

export default function PasswordResetRequestPage() {
  return (
    <main className="login-page">
      <section className="login-shell" aria-label="비밀번호 재설정 요청">
        <div className="login-copy">
          <Link className="brand" href="/">
            <Image src="/logo.jpg" alt="워크가드 로고" width={34} height={34} priority />
            <span>워크가드</span>
          </Link>
          <div style={{ marginTop: 42 }}>
            <span className="status-pill">
              <ShieldCheck size={14} />
              계정 보안
            </span>
            <h1 style={{ margin: "18px 0 14px", fontSize: 34, lineHeight: 1.18 }}>
              비밀번호를
              <br />
              다시 설정합니다
            </h1>
            <p className="section-copy">
              가입한 이메일을 입력하면 재설정 링크를 보냅니다. 메일 링크는 1시간 동안만 유효합니다.
            </p>
          </div>
        </div>
        <PasswordResetRequestForm />
      </section>
    </main>
  );
}

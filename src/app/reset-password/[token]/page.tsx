import { ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PasswordResetConfirmForm } from "@/components/password-reset-confirm-form";
import { getPasswordResetRequestMeta } from "@/lib/account-security";

type ResetPasswordPageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function ResetPasswordConfirmPage({ params }: ResetPasswordPageProps) {
  const resolvedParams = await params;
  const resetRequest = await getPasswordResetRequestMeta(resolvedParams.token);

  if (!resetRequest) {
    notFound();
  }

  return (
    <main className="login-page">
      <section className="login-shell" aria-label="비밀번호 재설정">
        <div className="login-copy">
          <Link className="brand" href="/">
            <Image src="/logo.jpg" alt="워크가드 로고" width={34} height={34} priority />
            <span>워크가드</span>
          </Link>
          <div style={{ marginTop: 42 }}>
            <span className="status-pill green">
              <ShieldCheck size={14} />
              재설정 가능
            </span>
            <h1 style={{ margin: "18px 0 14px", fontSize: 34, lineHeight: 1.18 }}>
              {resetRequest.companyName}
              <br />
              계정 비밀번호를 갱신합니다
            </h1>
            <p className="section-copy">
              {resetRequest.name}님({resetRequest.email})의 새 비밀번호를 설정합니다. 저장하면 다른 기기는 다시 로그인해야 합니다.
            </p>
          </div>
        </div>
        <PasswordResetConfirmForm token={resolvedParams.token} />
      </section>
    </main>
  );
}

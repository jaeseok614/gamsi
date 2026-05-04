import { ArrowLeft, Settings } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { QrDisplayClient } from "@/components/qr-display-client";
import { canManage, requireCurrentUser } from "@/lib/auth";
import { getFieldVerificationSummary } from "@/lib/verification";

export default async function AdminQrDisplayPage() {
  const user = await requireCurrentUser();
  if (!canManage(user.role)) {
    redirect("/dashboard");
  }

  const summary = await getFieldVerificationSummary(user.companyId);

  return (
    <main className="qr-display-page">
      <div className="qr-display-shell">
        <header className="qr-display-header">
          <div>
            <p className="eyebrow">WorkGuard 현장 인증</p>
            <h1>출퇴근 QR 표시</h1>
          </div>
          <div className="actions-row" style={{ justifyContent: "flex-end" }}>
            <Link className="button secondary" href="/dashboard?view=settings#field-verification">
              <Settings size={16} />
              근무지 설정
            </Link>
            <Link className="button secondary" href="/dashboard">
              <ArrowLeft size={16} />
              대시보드
            </Link>
          </div>
        </header>

        <QrDisplayClient locations={summary.locations} />
      </div>
    </main>
  );
}

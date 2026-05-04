import { InviteStatus } from "@/generated/prisma";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InviteAcceptForm } from "@/components/invite-accept-form";
import { prisma } from "@/lib/prisma";

type InvitePageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function InvitePage({ params }: InvitePageProps) {
  const resolvedParams = await params;
  const invitation = await prisma.invitation.findUnique({
    where: {
      token: resolvedParams.token
    },
    include: {
      company: true,
      team: true
    }
  });

  if (!invitation || invitation.status !== InviteStatus.PENDING || invitation.expiresAt < new Date()) {
    notFound();
  }

  return (
    <main className="login-page">
      <section className="login-shell" aria-label="워크가드 초대 수락">
        <div className="login-copy">
          <Link className="brand" href="/">
            <Image src="/logo.jpg" alt="워크가드 로고" width={34} height={34} priority />
            <span>워크가드</span>
          </Link>
          <div style={{ marginTop: 42 }}>
            <span className="status-pill green">초대 대기</span>
            <h1 style={{ margin: "18px 0 14px", fontSize: 34, lineHeight: 1.18 }}>
              {invitation.company.name}
              <br />
              워크스페이스에 참여합니다
            </h1>
            <p className="section-copy">
              {invitation.name}님은 {invitation.team?.name ?? "소속 미지정"} / {invitation.role} 역할로 초대되었습니다.
            </p>
          </div>
        </div>
        <InviteAcceptForm token={invitation.token} />
      </section>
    </main>
  );
}

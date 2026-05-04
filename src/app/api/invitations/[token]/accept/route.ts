import { InviteStatus } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/security";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const body = (await request.json()) as { password?: string };
  const password = body.password ?? "";

  if (password.length < 8) {
    return jsonError("비밀번호는 8자 이상 입력하세요.");
  }

  const invitation = await prisma.invitation.findUnique({
    where: {
      token: params.token
    }
  });

  if (!invitation || invitation.status !== InviteStatus.PENDING || invitation.expiresAt < new Date()) {
    return jsonError("초대가 만료되었거나 유효하지 않습니다.", 404);
  }

  const existingUser = await prisma.user.findUnique({
    where: {
      email: invitation.email
    }
  });

  if (existingUser) {
    return jsonError("이미 가입된 이메일입니다.");
  }

  const user = await prisma.user.create({
    data: {
      companyId: invitation.companyId,
      teamId: invitation.teamId,
      name: invitation.name,
      email: invitation.email,
      role: invitation.role,
      passwordHash: await hashPassword(password)
    }
  });

  await prisma.invitation.update({
    where: {
      id: invitation.id
    },
    data: {
      status: InviteStatus.ACCEPTED,
      acceptedAt: new Date()
    }
  });

  await writeAuditLog({
    companyId: invitation.companyId,
    actorUserId: user.id,
    action: "invitation.accepted",
    targetType: "invitation",
    targetId: invitation.id,
    payload: {
      email: invitation.email,
      role: invitation.role
    }
  });

  return NextResponse.json({ ok: true });
}

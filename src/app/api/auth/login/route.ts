import { NextResponse, type NextRequest } from "next/server";

import {
  clearFailedLoginAttempts,
  clientIpFromRequest,
  createUserSession,
  getLoginThrottleState,
  recordLoginAttempt,
  setSessionCookie
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/security";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";

  if (!email || !password) {
    return NextResponse.json({ error: "이메일과 비밀번호를 입력하세요." }, { status: 400 });
  }

  const ipAddress = clientIpFromRequest(request);
  const throttle = await getLoginThrottleState({
    email,
    ipAddress
  });

  if (throttle.limited) {
    await recordLoginAttempt({
      email,
      ipAddress,
      succeeded: false,
      reason: "rate_limited"
    });
    return NextResponse.json(
      { error: `${throttle.windowMinutes}분 동안 로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.` },
      { status: 429 }
    );
  }

  const user = await prisma.user.findUnique({
    where: {
      email
    },
    include: {
      company: true,
      team: true
    }
  });

  const verification = user
    ? await verifyPassword(password, user.passwordHash)
    : { valid: false, needsRehash: false };

  if (!user || !user.isActive || !verification.valid) {
    await recordLoginAttempt({
      email,
      ipAddress,
      succeeded: false,
      reason: user && !user.isActive ? "inactive_user" : "invalid_credentials"
    });
    return NextResponse.json({ error: "계정 정보를 확인하세요." }, { status: 401 });
  }

  if (verification.needsRehash) {
    await prisma.user.update({
      where: {
        id: user.id
      },
      data: {
        passwordHash: await hashPassword(password)
      }
    });
  }

  await clearFailedLoginAttempts(email);
  await recordLoginAttempt({
    email,
    ipAddress,
    succeeded: true,
    reason: "login_success"
  });

  const sessionToken = await createUserSession({
    userId: user.id,
    ipAddress,
    userAgent: request.headers.get("user-agent")
  });

  const response = NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyName: user.company.name,
      teamName: user.team?.name ?? null
    }
  });

  setSessionCookie(response, sessionToken);

  return response;
}

import type { User } from "@/generated/prisma";

import { prisma } from "@/lib/prisma";

type Actor = Pick<User, "id" | "companyId" | "role">;
export type CompanyPlanTier = "TRIAL" | "STARTER" | "GROWTH" | "ENTERPRISE";

type CompanyPlanRow = {
  planTier: CompanyPlanTier;
  userLimit: number;
};

export type CompanyPlanSummary = {
  tier: CompanyPlanTier;
  userLimit: number;
  activeUsers: number;
  pendingInvitations: number;
  remainingSeats: number;
  canInvite: boolean;
};

export async function getCompanyPlanSummary(companyId: string): Promise<CompanyPlanSummary> {
  const [companyRows, activeUsers, pendingInvitations] = await Promise.all([
    prisma.$queryRaw<CompanyPlanRow[]>`
      SELECT "planTier", "userLimit"
      FROM "Company"
      WHERE "id" = ${companyId}
      LIMIT 1
    `,
    prisma.user.count({
      where: {
        companyId,
        isActive: true
      }
    }),
    prisma.invitation.count({
      where: {
        companyId,
        status: "PENDING",
        expiresAt: {
          gt: new Date()
        }
      }
    })
  ]);
  const company = companyRows[0] ?? {
    planTier: "TRIAL" as const,
    userLimit: 25
  };

  const remainingSeats = Math.max(0, company.userLimit - activeUsers - pendingInvitations);

  return {
    tier: company.planTier,
    userLimit: company.userLimit,
    activeUsers,
    pendingInvitations,
    remainingSeats,
    canInvite: remainingSeats > 0
  };
}

export async function assertCompanyHasSeat(companyId: string) {
  const summary = await getCompanyPlanSummary(companyId);
  if (!summary.canInvite) {
    throw new Error(`현재 플랜의 사용자 한도 ${summary.userLimit}명을 초과할 수 없습니다.`);
  }
  return summary;
}

export async function updateCompanyPlan(
  actor: Actor,
  input: {
    planTier: CompanyPlanTier;
    userLimit: number;
  }
) {
  if (actor.role !== "ADMIN") {
    throw new Error("플랜 설정 권한이 없습니다.");
  }

  const userLimit = Math.max(1, Math.min(5000, Math.round(input.userLimit)));
  const activeUsers = await prisma.user.count({
    where: {
      companyId: actor.companyId,
      isActive: true
    }
  });

  if (userLimit < activeUsers) {
    throw new Error(`현재 활성 사용자가 ${activeUsers}명이라 사용자 한도를 더 낮출 수 없습니다.`);
  }

  await prisma.$executeRaw`
    UPDATE "Company"
    SET "planTier" = ${input.planTier}::"CompanyPlanTier",
        "userLimit" = ${userLimit},
        "updatedAt" = ${new Date()}
    WHERE "id" = ${actor.companyId}
  `;

  return getCompanyPlanSummary(actor.companyId);
}

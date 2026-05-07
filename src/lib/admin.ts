import { randomBytes } from "node:crypto";

import { Role, type User } from "@/generated/prisma";

import { getOperationsAutomationSummary } from "@/lib/automation";
import { writeAuditLog } from "@/lib/audit";
import { assertCompanyHasSeat, getCompanyPlanSummary } from "@/lib/company-plan";
import { buildInviteUrl, sendInvitationEmail } from "@/lib/email";
import { getEvidenceSecuritySummary } from "@/lib/evidence";
import { getIntegrationOpsSummary, getIntegrationSettings, getRecentIntegrationDispatchLogs } from "@/lib/integrations";
import { getOnboardingSummary } from "@/lib/onboarding";
import { getDeploymentOpsSummary } from "@/lib/ops";
import { getPermissionMatrixSummary } from "@/lib/permission-matrix";
import { getCurrentWorkPolicy, getWorkPolicyVersions } from "@/lib/policy-engine";
import { prisma } from "@/lib/prisma";
import { getFieldVerificationSummary } from "@/lib/verification";

type Actor = Pick<User, "id" | "companyId" | "role">;

export async function getAdminSettings(actor: Actor, input?: { permissionUserId?: string | null }) {
  if (actor.role !== "ADMIN") {
    throw new Error("관리자 설정 권한이 없습니다.");
  }

  const [
    company,
    currentPolicy,
    policyVersions,
    holidays,
    teams,
    users,
    invitations,
    integrationSettings,
    integrationDispatchLogs,
    integrationOpsSummary,
    deploymentOpsSummary,
    automationSummary,
    evidenceSummary,
    onboardingSummary,
    planSummary,
    verificationSummary,
    permissionMatrixSummary
  ] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: {
        id: actor.companyId
      }
    }),
    getCurrentWorkPolicy(actor.companyId),
    getWorkPolicyVersions(actor.companyId),
    prisma.companyHoliday.findMany({
      where: {
        companyId: actor.companyId
      },
      orderBy: {
        date: "asc"
      }
    }),
    prisma.team.findMany({
      where: {
        companyId: actor.companyId
      },
      include: {
        manager: true,
        _count: {
          select: {
            users: true
          }
        }
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    }),
    prisma.user.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true
      },
      include: {
        team: true
      },
      orderBy: [{ team: { name: "asc" } }, { name: "asc" }]
    }),
    prisma.invitation.findMany({
      where: {
        companyId: actor.companyId
      },
      include: {
        team: true,
        invitedBy: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 20
    }),
    getIntegrationSettings(actor.companyId),
    getRecentIntegrationDispatchLogs(actor.companyId, 24, {
      includeAll: true
    }),
    getIntegrationOpsSummary(actor.companyId),
    getDeploymentOpsSummary(actor.companyId),
    getOperationsAutomationSummary(actor.companyId),
    getEvidenceSecuritySummary(actor.companyId),
    getOnboardingSummary(actor.companyId),
    getCompanyPlanSummary(actor.companyId),
    getFieldVerificationSummary(actor.companyId),
    getPermissionMatrixSummary(actor.companyId, input?.permissionUserId)
  ]);

  return {
    company,
    currentPolicy,
    policyVersions,
    holidays,
    teams,
    users,
    invitations,
    integrationSettings,
    integrationDispatchLogs,
    integrationOpsSummary,
    deploymentOpsSummary,
    automationSummary,
    evidenceSummary,
    onboardingSummary,
    planSummary,
    verificationSummary,
    permissionMatrixSummary
  };
}

export async function updateCompanySettings(
  actor: Actor,
  input: {
    name: string;
    weeklyLimitHours: number;
    defaultBreakMinutes: number;
  }
) {
  if (actor.role !== "ADMIN") {
    throw new Error("관리자 설정 권한이 없습니다.");
  }

  const company = await prisma.company.update({
    where: {
      id: actor.companyId
    },
    data: {
      name: input.name,
      weeklyLimitMinutes: Math.round(input.weeklyLimitHours * 60),
      defaultBreakMinutes: input.defaultBreakMinutes
    }
  });

  await prisma.workPolicy.updateMany({
    where: {
      companyId: actor.companyId,
      isActive: true
    },
    data: {
      weeklyLimitMinutes: company.weeklyLimitMinutes,
      defaultBreakMinutes: company.defaultBreakMinutes
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "admin.company.updated",
    targetType: "company",
    targetId: actor.companyId,
    payload: {
      name: company.name,
      weeklyLimitMinutes: company.weeklyLimitMinutes,
      defaultBreakMinutes: company.defaultBreakMinutes
    }
  });

  return company;
}

export async function updateWorkPolicySettings(
  actor: Actor,
  input: {
    standardDailyHours: number;
    overtimeThresholdHours: number;
    weeklyLimitHours: number;
    defaultBreakMinutes: number;
    annualLeaveBasis: "CALENDAR_YEAR" | "JOIN_DATE";
    annualLeaveGrantDays: number;
    firstYearMonthlyAccrualEnabled: boolean;
    annualLeaveCarryoverDays: number;
    carryoverExpiryMonth: number;
    carryoverExpiryDay: number;
    allowHalfDayLeave: boolean;
    allowHourlyLeave: boolean;
    hourlyLeaveUnitMinutes: number;
    overtimePremiumRate: number;
    nightPremiumRate: number;
    holidayPremiumRate: number;
    holidayIncludesWeekends: boolean;
    nightWorkStart: string;
    nightWorkEnd: string;
  }
) {
  if (actor.role !== "ADMIN") {
    throw new Error("계산 정책 설정 권한이 없습니다.");
  }

  const currentPolicy = await getCurrentWorkPolicy(actor.companyId);
  const standardDailyMinutes = Math.round(input.standardDailyHours * 60);
  const overtimeThresholdMinutes = Math.round(input.overtimeThresholdHours * 60);
  const weeklyLimitMinutes = Math.round(input.weeklyLimitHours * 60);
  const nextVersion = currentPolicy.version + 1;

  await prisma.workPolicy.updateMany({
    where: {
      companyId: actor.companyId
    },
    data: {
      isActive: false
    }
  });

  const policy = await prisma.workPolicy.create({
    data: {
      companyId: actor.companyId,
      name: "현재 계산 정책",
      version: nextVersion,
      isActive: true,
      effectiveFrom: new Date(),
      standardDailyMinutes,
      overtimeThresholdMinutes,
      weeklyLimitMinutes,
      defaultBreakMinutes: input.defaultBreakMinutes,
      annualLeaveBasis: input.annualLeaveBasis,
      annualLeaveGrantDays: input.annualLeaveGrantDays,
      firstYearMonthlyAccrualEnabled: input.firstYearMonthlyAccrualEnabled,
      annualLeaveCarryoverDays: input.annualLeaveCarryoverDays,
      carryoverExpiryMonth: input.carryoverExpiryMonth,
      carryoverExpiryDay: input.carryoverExpiryDay,
      allowHalfDayLeave: input.allowHalfDayLeave,
      allowHourlyLeave: input.allowHourlyLeave,
      hourlyLeaveUnitMinutes: input.hourlyLeaveUnitMinutes,
      overtimePremiumRate: input.overtimePremiumRate,
      nightPremiumRate: input.nightPremiumRate,
      holidayPremiumRate: input.holidayPremiumRate,
      holidayIncludesWeekends: input.holidayIncludesWeekends,
      nightWorkStart: input.nightWorkStart,
      nightWorkEnd: input.nightWorkEnd
    }
  });

  await prisma.company.update({
    where: {
      id: actor.companyId
    },
    data: {
      weeklyLimitMinutes,
      defaultBreakMinutes: input.defaultBreakMinutes
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "admin.work_policy.updated",
    targetType: "work_policy",
    targetId: policy.id,
    payload: {
      version: policy.version,
      annualLeaveBasis: policy.annualLeaveBasis,
      standardDailyMinutes: policy.standardDailyMinutes,
      overtimeThresholdMinutes: policy.overtimeThresholdMinutes,
      weeklyLimitMinutes: policy.weeklyLimitMinutes,
      annualLeaveGrantDays: policy.annualLeaveGrantDays,
      firstYearMonthlyAccrualEnabled: policy.firstYearMonthlyAccrualEnabled,
      annualLeaveCarryoverDays: policy.annualLeaveCarryoverDays,
      carryoverExpiryMonth: policy.carryoverExpiryMonth,
      carryoverExpiryDay: policy.carryoverExpiryDay,
      allowHalfDayLeave: policy.allowHalfDayLeave,
      allowHourlyLeave: policy.allowHourlyLeave,
      hourlyLeaveUnitMinutes: policy.hourlyLeaveUnitMinutes,
      overtimePremiumRate: policy.overtimePremiumRate,
      nightPremiumRate: policy.nightPremiumRate,
      holidayPremiumRate: policy.holidayPremiumRate,
      holidayIncludesWeekends: policy.holidayIncludesWeekends,
      nightWorkStart: policy.nightWorkStart,
      nightWorkEnd: policy.nightWorkEnd
    }
  });

  return policy;
}

export async function upsertCompanyHoliday(
  actor: Actor,
  input: {
    date: string;
    name: string;
    isPaidHoliday: boolean;
  }
) {
  if (actor.role !== "ADMIN") {
    throw new Error("공휴일 설정 권한이 없습니다.");
  }

  const name = input.name.trim();
  if (!name) {
    throw new Error("공휴일 이름을 입력하세요.");
  }

  const holiday = await prisma.companyHoliday.upsert({
    where: {
      companyId_date: {
        companyId: actor.companyId,
        date: new Date(`${input.date}T00:00:00.000Z`)
      }
    },
    create: {
      companyId: actor.companyId,
      date: new Date(`${input.date}T00:00:00.000Z`),
      name,
      isPaidHoliday: input.isPaidHoliday
    },
    update: {
      name,
      isPaidHoliday: input.isPaidHoliday
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "admin.holiday.upserted",
    targetType: "company_holiday",
    targetId: holiday.id,
    payload: {
      date: holiday.date.toISOString().slice(0, 10),
      name: holiday.name,
      isPaidHoliday: holiday.isPaidHoliday
    }
  });

  return holiday;
}

export async function deleteCompanyHoliday(actor: Actor, holidayId: string) {
  if (actor.role !== "ADMIN") {
    throw new Error("공휴일 설정 권한이 없습니다.");
  }

  const holiday = await prisma.companyHoliday.findFirst({
    where: {
      id: holidayId,
      companyId: actor.companyId
    }
  });

  if (!holiday) {
    throw new Error("공휴일을 찾을 수 없습니다.");
  }

  await prisma.companyHoliday.delete({
    where: {
      id: holidayId
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "admin.holiday.deleted",
    targetType: "company_holiday",
    targetId: holiday.id,
    payload: {
      date: holiday.date.toISOString().slice(0, 10),
      name: holiday.name
    }
  });

  return holiday;
}

export async function createTeam(
  actor: Actor,
  input: {
    name: string;
    managerUserId?: string | null;
  }
) {
  if (actor.role !== "ADMIN") {
    throw new Error("관리자 설정 권한이 없습니다.");
  }

  const name = input.name.trim();
  if (name.length < 2) {
    throw new Error("팀 이름은 2자 이상 입력하세요.");
  }

  if (input.managerUserId) {
    const manager = await prisma.user.findFirst({
      where: {
        id: input.managerUserId,
        companyId: actor.companyId,
        role: {
          in: [Role.MANAGER, Role.HR, Role.ADMIN]
        },
        isActive: true
      }
    });

    if (!manager) {
      throw new Error("관리자로 지정할 사용자를 찾을 수 없습니다.");
    }
  }

  const team = await prisma.team.create({
    data: {
      companyId: actor.companyId,
      name,
      managerUserId: input.managerUserId || null
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "admin.team.created",
    targetType: "team",
    targetId: team.id,
    payload: {
      name: team.name,
      managerUserId: team.managerUserId
    }
  });

  return team;
}

export async function updateTeam(
  actor: Actor,
  input: {
    teamId: string;
    name: string;
    managerUserId?: string | null;
    isActive: boolean;
  }
) {
  if (actor.role !== "ADMIN") {
    throw new Error("팀 설정 권한이 없습니다.");
  }

  const team = await prisma.team.findFirst({
    where: {
      id: input.teamId,
      companyId: actor.companyId
    }
  });

  if (!team) {
    throw new Error("팀을 찾을 수 없습니다.");
  }

  const name = input.name.trim();
  if (name.length < 2) {
    throw new Error("팀 이름은 2자 이상 입력하세요.");
  }

  if (input.managerUserId) {
    const manager = await prisma.user.findFirst({
      where: {
        id: input.managerUserId,
        companyId: actor.companyId,
        role: {
          in: [Role.MANAGER, Role.HR, Role.ADMIN]
        },
        isActive: true
      }
    });

    if (!manager) {
      throw new Error("팀 관리자로 지정할 사용자를 찾을 수 없습니다.");
    }
  }

  const updated = await prisma.team.update({
    where: {
      id: team.id
    },
    data: {
      name,
      managerUserId: input.managerUserId || null,
      isActive: input.isActive
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "admin.team.updated",
    targetType: "team",
    targetId: team.id,
    payload: {
      name: updated.name,
      managerUserId: updated.managerUserId,
      isActive: updated.isActive
    }
  });

  return updated;
}

export async function updateUser(
  actor: Actor,
  input: {
    userId: string;
    name: string;
    email: string;
    role: Role;
    teamId?: string | null;
    jobTitle?: string | null;
    phoneNumber?: string | null;
    extensionNumber?: string | null;
    isActive: boolean;
  }
) {
  if (actor.role !== "ADMIN") {
    throw new Error("직원 설정 권한이 없습니다.");
  }

  const user = await prisma.user.findFirst({
    where: {
      id: input.userId,
      companyId: actor.companyId
    }
  });

  if (!user) {
    throw new Error("직원을 찾을 수 없습니다.");
  }

  if (user.id === actor.id && !input.isActive) {
    throw new Error("본인 계정은 비활성화할 수 없습니다.");
  }

  if (!user.isActive && input.isActive) {
    await assertCompanyHasSeat(actor.companyId);
  }

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const jobTitle = input.jobTitle?.trim() || null;
  const phoneNumber = input.phoneNumber?.trim() || null;
  const extensionNumber = input.extensionNumber?.trim() || null;
  if (!name || !email.includes("@")) {
    throw new Error("이름과 이메일을 확인하세요.");
  }

  const existingEmailUser = await prisma.user.findUnique({
    where: {
      email
    }
  });

  if (existingEmailUser && existingEmailUser.id !== user.id) {
    throw new Error("이미 사용 중인 이메일입니다.");
  }

  if (input.teamId) {
    const team = await prisma.team.findFirst({
      where: {
        id: input.teamId,
        companyId: actor.companyId,
        isActive: true
      }
    });

    if (!team) {
      throw new Error("활성 팀을 찾을 수 없습니다.");
    }
  }

  const updated = await prisma.user.update({
    where: {
      id: user.id
    },
    data: {
      name,
      email,
      role: input.role,
      teamId: input.teamId || null,
      jobTitle,
      phoneNumber,
      extensionNumber,
      isActive: input.isActive
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "admin.user.updated",
    targetType: "user",
    targetId: user.id,
    payload: {
      name: updated.name,
      email: updated.email,
      role: updated.role,
      teamId: updated.teamId,
      jobTitle: updated.jobTitle,
      phoneNumber: updated.phoneNumber,
      extensionNumber: updated.extensionNumber,
      isActive: updated.isActive
    }
  });

  return updated;
}

export async function createInvitation(
  actor: Actor,
  input: {
    name: string;
    email: string;
    role: Role;
    teamId?: string | null;
  }
) {
  if (actor.role !== "ADMIN") {
    throw new Error("관리자 설정 권한이 없습니다.");
  }

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!name || !email.includes("@")) {
    throw new Error("초대할 이름과 이메일을 확인하세요.");
  }

  const existingUser = await prisma.user.findUnique({
    where: {
      email
    }
  });

  if (existingUser) {
    throw new Error("이미 가입된 이메일입니다.");
  }

  await assertCompanyHasSeat(actor.companyId);

  if (input.teamId) {
    const team = await prisma.team.findFirst({
      where: {
        id: input.teamId,
        companyId: actor.companyId
      }
    });

    if (!team) {
      throw new Error("팀을 찾을 수 없습니다.");
    }
  }

  const token = randomBytes(24).toString("hex");
  const invitation = await prisma.invitation.create({
    data: {
      companyId: actor.companyId,
      teamId: input.teamId || null,
      invitedById: actor.id,
      name,
      email,
      role: input.role,
      token,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)
    }
  });

  const company = await prisma.company.findUniqueOrThrow({
    where: {
      id: actor.companyId
    }
  });
  const inviteUrl = buildInviteUrl(invitation.token);
  const emailResult = await sendInvitationEmail({
    to: invitation.email,
    name: invitation.name,
    companyName: company.name,
    role: invitation.role,
    inviteUrl
  });

  const updatedInvitation = await prisma.invitation.update({
    where: {
      id: invitation.id
    },
    data: {
      emailSentAt: emailResult.sent ? new Date() : null,
      emailStatus: emailResult.status,
      emailError: emailResult.error
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "admin.invitation.created",
    targetType: "invitation",
    targetId: invitation.id,
    payload: {
      email: invitation.email,
      role: invitation.role,
      teamId: invitation.teamId,
      inviteUrl,
      emailStatus: emailResult.status
    }
  });

  return updatedInvitation;
}

export async function updateInvitationStatus(
  actor: Actor,
  input: {
    invitationId: string;
    action: "cancel" | "resend" | "reissue";
  }
) {
  if (actor.role !== "ADMIN") {
    throw new Error("초대 관리 권한이 없습니다.");
  }

  const invitation = await prisma.invitation.findFirst({
    where: {
      id: input.invitationId,
      companyId: actor.companyId
    }
  });

  if (!invitation) {
    throw new Error("초대를 찾을 수 없습니다.");
  }

  if (invitation.status !== "PENDING") {
    throw new Error("대기 중인 초대만 변경할 수 있습니다.");
  }

  if (input.action === "cancel") {
    const cancelled = await prisma.invitation.update({
      where: {
        id: invitation.id
      },
      data: {
        status: "CANCELLED"
      }
    });

    await writeAuditLog({
      companyId: actor.companyId,
      actorUserId: actor.id,
      action: "admin.invitation.cancelled",
      targetType: "invitation",
      targetId: invitation.id,
      payload: {
        email: invitation.email
      }
    });

    return {
      invitation: cancelled,
      inviteUrl: null
    };
  }

  const token = input.action === "reissue" ? randomBytes(24).toString("hex") : invitation.token;
  const refreshed = await prisma.invitation.update({
    where: {
      id: invitation.id
    },
    data: {
      token,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)
    }
  });
  const company = await prisma.company.findUniqueOrThrow({
    where: {
      id: actor.companyId
    }
  });
  const inviteUrl = buildInviteUrl(refreshed.token);
  const emailResult = await sendInvitationEmail({
    to: refreshed.email,
    name: refreshed.name,
    companyName: company.name,
    role: refreshed.role,
    inviteUrl
  });
  const updated = await prisma.invitation.update({
    where: {
      id: refreshed.id
    },
    data: {
      emailSentAt: emailResult.sent ? new Date() : refreshed.emailSentAt,
      emailStatus: emailResult.status,
      emailError: emailResult.error
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: input.action === "reissue" ? "admin.invitation.reissued" : "admin.invitation.resent",
    targetType: "invitation",
    targetId: invitation.id,
    payload: {
      email: invitation.email,
      inviteUrl,
      emailStatus: emailResult.status
    }
  });

  return {
    invitation: updated,
    inviteUrl
  };
}

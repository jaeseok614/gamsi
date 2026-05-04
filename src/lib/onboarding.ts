import { ApprovalStatus, ApprovalType, LeaveDuration, LeaveType, Role, type User } from "@/generated/prisma";

import { writeAuditLog } from "@/lib/audit";
import { getIntegrationOpsSummary } from "@/lib/integrations";
import { prisma } from "@/lib/prisma";
import { hashPasswordSync } from "@/lib/security";
import { listScheduleTemplates } from "@/lib/schedule-operations";
import { dateOnly, getKstDateString, kstDateTime } from "@/lib/time";

type Actor = Pick<User, "id" | "companyId" | "name">;

function addDays(dateString: string, offset: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export async function getOnboardingSummary(companyId: string) {
  const [company, userCount, activeTeamCount, invitationCount, scheduleCount, templates, integrationOps, sampleSeeded] =
    await Promise.all([
      prisma.company.findUniqueOrThrow({
        where: {
          id: companyId
        },
        select: {
          name: true
        }
      }),
      prisma.user.count({
        where: {
          companyId,
          isActive: true
        }
      }),
      prisma.team.count({
        where: {
          companyId,
          isActive: true
        }
      }),
      prisma.invitation.count({
        where: {
          companyId
        }
      }),
      prisma.workSchedule.count({
        where: {
          companyId
        }
      }),
      listScheduleTemplates(companyId),
      getIntegrationOpsSummary(companyId),
      prisma.auditLog.findFirst({
        where: {
          companyId,
          action: {
            in: ["onboarding.sample.seeded", "onboarding.sample.removed"]
          },
          targetType: "onboarding"
        },
        orderBy: {
          createdAt: "desc"
        }
      })
    ]);

  const criticalChecks = integrationOps.checks.filter((check) => check.status === "critical");
  const warningChecks = integrationOps.checks.filter((check) => check.status === "warning");

  const sampleSeededAt = sampleSeeded?.action === "onboarding.sample.seeded" ? sampleSeeded.createdAt : null;
  const steps = [
    {
      id: "company-policy",
      label: "회사/정책",
      complete: Boolean(company.name.trim()),
      detail: `회사명 '${company.name}'과 현재 근로 정책 버전이 준비되어 있습니다.`
    },
    {
      id: "team-people",
      label: "팀/구성원",
      complete: activeTeamCount > 0 && userCount > 1,
      detail: `활성 팀 ${activeTeamCount}개, 활성 사용자 ${userCount}명`
    },
    {
      id: "invitation-flow",
      label: "초대 흐름",
      complete: invitationCount > 0 || userCount > 1,
      detail: `초대 ${invitationCount}건, 현재 구성원 ${userCount}명`
    },
    {
      id: "schedule-setup",
      label: "스케줄 운영",
      complete: scheduleCount > 0 || templates.length > 0,
      detail: `등록 스케줄 ${scheduleCount}건, 템플릿 ${templates.length}개`
    },
    {
      id: "integrations",
      label: "배포/연동",
      complete: criticalChecks.length === 0,
      detail:
        criticalChecks.length === 0
          ? `필수 연동 체크 완료, 주의 ${warningChecks.length}건`
          : `필수 체크 미완료 ${criticalChecks.length}건`
    },
    {
      id: "sample-data",
      label: "샘플 데이터",
      complete: Boolean(sampleSeededAt),
      detail: sampleSeededAt ? "샘플 운영 데이터가 주입되었습니다." : "샘플 데이터가 없습니다."
    }
  ];

  return {
    steps,
    completedCount: steps.filter((step) => step.complete).length,
    totalCount: steps.length,
    criticalChecks,
    warningChecks,
    sampleSeededAt
  };
}

export async function seedOnboardingSampleData(actor: Actor) {
  const suffix = actor.companyId.slice(0, 8).toLowerCase();
  const existingTeam = await prisma.team.findFirst({
    where: {
      companyId: actor.companyId,
      name: "샘플 운영팀"
    }
  });
  const team =
    existingTeam ??
    (await prisma.team.create({
      data: {
        companyId: actor.companyId,
        name: "샘플 운영팀",
        isActive: true
      }
    }));

  if (!team.isActive) {
    await prisma.team.update({
      where: {
        id: team.id
      },
      data: {
        isActive: true
      }
    });
  }

  const manager = await prisma.user.upsert({
    where: {
      email: `sample-manager-${suffix}@example.test`
    },
    create: {
      companyId: actor.companyId,
      teamId: team.id,
      name: "샘플 매니저",
      email: `sample-manager-${suffix}@example.test`,
      passwordHash: hashPasswordSync("password123!"),
      role: Role.MANAGER,
      joinedAt: dateOnly(getKstDateString())
    },
    update: {
      companyId: actor.companyId,
      teamId: team.id,
      isActive: true
    }
  });

  await prisma.team.update({
    where: {
      id: team.id
    },
    data: {
      managerUserId: manager.id
    }
  });

  const workers = await Promise.all(
    [
      { key: "alpha", name: "샘플 직원 A" },
      { key: "beta", name: "샘플 직원 B" }
    ].map((entry) =>
      prisma.user.upsert({
        where: {
          email: `sample-${entry.key}-${suffix}@example.test`
        },
        create: {
          companyId: actor.companyId,
          teamId: team.id,
          name: entry.name,
          email: `sample-${entry.key}-${suffix}@example.test`,
          passwordHash: hashPasswordSync("password123!"),
          role: Role.EMPLOYEE,
          joinedAt: dateOnly(getKstDateString())
        },
        update: {
          companyId: actor.companyId,
          teamId: team.id,
          isActive: true
        }
      })
    )
  );

  const today = getKstDateString();
  const scheduleDates = [0, 1, 2, 3, 4].map((offset) => addDays(today, offset));
  for (const worker of workers) {
    for (const workDate of scheduleDates) {
      await prisma.workSchedule.upsert({
        where: {
          userId_workDate: {
            userId: worker.id,
            workDate: dateOnly(workDate)
          }
        },
        create: {
          companyId: actor.companyId,
          userId: worker.id,
          workDate: dateOnly(workDate),
          shiftName: "샘플 주간 근무",
          scheduledStartAt: kstDateTime(workDate, 9, 0),
          scheduledEndAt: kstDateTime(workDate, 18, 0),
          breakMinutes: 60,
          note: "온보딩 샘플 데이터"
        },
        update: {
          shiftName: "샘플 주간 근무",
          scheduledStartAt: kstDateTime(workDate, 9, 0),
          scheduledEndAt: kstDateTime(workDate, 18, 0),
          breakMinutes: 60,
          note: "온보딩 샘플 데이터"
        }
      });
    }
  }

  const leaveDate = addDays(today, 1);
  await prisma.approvalRequest.create({
    data: {
      companyId: actor.companyId,
      requesterId: workers[0].id,
      reviewerId: actor.id,
      type: ApprovalType.LEAVE,
      leaveType: LeaveType.ANNUAL,
      leaveStartDate: dateOnly(leaveDate),
      leaveEndDate: dateOnly(leaveDate),
      leaveDuration: LeaveDuration.FULL_DAY,
      requestedLeaveMinutes: 0,
      reason: "온보딩 샘플 휴가",
      status: ApprovalStatus.APPROVED,
      reviewedAt: new Date(),
      reviewNote: "샘플 승인"
    }
  });

  await prisma.approvalRequest.create({
    data: {
      companyId: actor.companyId,
      requesterId: workers[1].id,
      type: ApprovalType.OVERTIME,
      requestedMinutes: 120,
      reason: "온보딩 샘플 초과근로",
      status: ApprovalStatus.PENDING
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "onboarding.sample.seeded",
    targetType: "onboarding",
    targetId: actor.companyId,
    payload: {
      teamId: team.id,
      managerUserId: manager.id,
      workerIds: workers.map((worker) => worker.id),
      scheduleDates
    }
  });

  return {
    teamId: team.id,
    managerUserId: manager.id,
    workerIds: workers.map((worker) => worker.id),
    scheduleDates
  };
}

export async function removeOnboardingSampleData(actor: Actor) {
  const suffix = actor.companyId.slice(0, 8).toLowerCase();
  const sampleEmails = [
    `sample-manager-${suffix}@example.test`,
    `sample-alpha-${suffix}@example.test`,
    `sample-beta-${suffix}@example.test`
  ];

  const sampleUsers = await prisma.user.findMany({
    where: {
      companyId: actor.companyId,
      email: {
        in: sampleEmails
      }
    },
    select: {
      id: true
    }
  });
  const sampleUserIds = sampleUsers.map((user) => user.id);

  await prisma.$transaction(async (tx) => {
    await tx.team.updateMany({
      where: {
        companyId: actor.companyId,
        name: "샘플 운영팀"
      },
      data: {
        managerUserId: null
      }
    });

    await tx.approvalRequest.deleteMany({
      where: {
        companyId: actor.companyId,
        OR: [
          {
            requesterId: {
              in: sampleUserIds
            }
          },
          {
            reason: {
              startsWith: "온보딩 샘플"
            }
          }
        ]
      }
    });

    await tx.workSchedule.deleteMany({
      where: {
        companyId: actor.companyId,
        OR: [
          {
            userId: {
              in: sampleUserIds
            }
          },
          {
            note: "온보딩 샘플 데이터"
          }
        ]
      }
    });

    await tx.user.deleteMany({
      where: {
        id: {
          in: sampleUserIds
        },
        companyId: actor.companyId
      }
    });

    await tx.team.deleteMany({
      where: {
        companyId: actor.companyId,
        name: "샘플 운영팀",
        users: {
          none: {}
        }
      }
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "onboarding.sample.removed",
    targetType: "onboarding",
    targetId: actor.companyId,
    payload: {
      removedUserIds: sampleUserIds
    }
  });

  return {
    removedUsers: sampleUserIds.length
  };
}

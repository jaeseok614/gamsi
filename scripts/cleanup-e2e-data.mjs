import { pathToFileURL } from "node:url";

import { PrismaClient, WorkThreadTargetType } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();

const textMarkers = ["Playwright", "Object storage rehearsal", "object storage rehearsal", "object-storage rehearsal"];

function testTextWhere(field) {
  return [
    { [field]: { startsWith: "PW " } },
    { [field]: { startsWith: "PW-" } },
    ...textMarkers.map((marker) => ({ [field]: { contains: marker } }))
  ];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function deleteByIds(model, ids) {
  const uniqueIds = unique(ids);
  if (uniqueIds.length === 0) {
    return 0;
  }

  const result = await model.deleteMany({
    where: {
      id: {
        in: uniqueIds
      }
    }
  });
  return result.count;
}

async function findTestUserIds() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { startsWith: "pw-" } },
        { email: { startsWith: "playwright-" } },
        ...testTextWhere("name")
      ]
    },
    select: {
      id: true
    }
  });
  return users.map((user) => user.id);
}

async function findTestCompanyIds() {
  const companies = await prisma.company.findMany({
    where: {
      OR: testTextWhere("name")
    },
    select: {
      id: true
    }
  });
  return companies.map((company) => company.id);
}

async function findThreadIdsForTestComments() {
  const comments = await prisma.workComment.findMany({
    where: {
      OR: testTextWhere("body")
    },
    select: {
      threadId: true
    }
  });
  return unique(comments.map((comment) => comment.threadId));
}

async function deleteEmptyTestCommentThreads(threadIds) {
  let deleted = 0;
  for (const threadId of unique(threadIds)) {
    const nonTestCommentCount = await prisma.workComment.count({
      where: {
        threadId,
        NOT: {
          OR: testTextWhere("body")
        }
      }
    });

    if (nonTestCommentCount === 0) {
      const result = await prisma.workThread.deleteMany({
        where: {
          id: threadId
        }
      });
      deleted += result.count;
    }
  }
  return deleted;
}

export async function cleanupE2eData() {
  const summary = {};
  const testUserIds = await findTestUserIds();
  const testCompanyIds = await findTestCompanyIds();
  const testCommentThreadIds = await findThreadIdsForTestComments();

  const testDocuments = await prisma.documentRequest.findMany({
    where: {
      OR: [
        ...testTextWhere("title"),
        ...testTextWhere("body")
      ]
    },
    select: {
      id: true
    }
  });
  const testDocumentIds = testDocuments.map((document) => document.id);

  const testApprovals = await prisma.approvalRequest.findMany({
    where: {
      OR: [
        ...testTextWhere("reason"),
        { requesterId: { in: testUserIds } }
      ]
    },
    select: {
      id: true
    }
  });
  const testApprovalIds = testApprovals.map((approval) => approval.id);

  summary.workThreads = await deleteByIds(prisma.workThread, [
    ...(await prisma.workThread.findMany({
      where: {
        OR: [
          ...testTextWhere("title"),
          {
            targetType: WorkThreadTargetType.DOCUMENT_REQUEST,
            targetId: {
              in: testDocumentIds
            }
          },
          {
            targetType: WorkThreadTargetType.APPROVAL_REQUEST,
            targetId: {
              in: testApprovalIds
            }
          }
        ]
      },
      select: {
        id: true
      }
    })).map((thread) => thread.id)
  ]);
  summary.emptyProfileThreads = await deleteEmptyTestCommentThreads(testCommentThreadIds);
  summary.workComments = (await prisma.workComment.deleteMany({ where: { OR: testTextWhere("body") } })).count;
  summary.announcements = (await prisma.announcement.deleteMany({
    where: {
      OR: [
        ...testTextWhere("title"),
        ...testTextWhere("body")
      ]
    }
  })).count;
  summary.documentRequests = await deleteByIds(prisma.documentRequest, testDocumentIds);
  summary.documentLibraryItems = (await prisma.documentLibraryItem.deleteMany({
    where: {
      OR: [
        ...testTextWhere("title"),
        ...testTextWhere("description")
      ]
    }
  })).count;
  summary.performanceGoals = (await prisma.performanceGoal.deleteMany({
    where: {
      OR: [
        ...testTextWhere("title"),
        ...testTextWhere("note"),
        ...testTextWhere("evaluationMemo"),
        { userId: { in: testUserIds } }
      ]
    }
  })).count;
  summary.payrollIssues = (await prisma.payrollStatementIssue.deleteMany({
    where: {
      OR: [
        ...testTextWhere("note"),
        { userId: { in: testUserIds } }
      ]
    }
  })).count;
  summary.approvals = await deleteByIds(prisma.approvalRequest, testApprovalIds);
  summary.workLocations = (await prisma.workLocation.deleteMany({
    where: {
      OR: [
        ...testTextWhere("name"),
        ...testTextWhere("description")
      ]
    }
  })).count;
  summary.schedules = (await prisma.workSchedule.deleteMany({
    where: {
      OR: [
        ...testTextWhere("shiftName"),
        ...testTextWhere("note"),
        { userId: { in: testUserIds } }
      ]
    }
  })).count;
  summary.notifications = (await prisma.notification.deleteMany({
    where: {
      OR: [
        ...testTextWhere("title"),
        ...testTextWhere("message"),
        { userId: { in: testUserIds } }
      ]
    }
  })).count;
  summary.teams = (await prisma.team.deleteMany({
    where: {
      OR: testTextWhere("name")
    }
  })).count;
  summary.invitations = (await prisma.invitation.deleteMany({
    where: {
      OR: [
        { email: { startsWith: "pw-" } },
        ...testTextWhere("name")
      ]
    }
  })).count;
  summary.users = await deleteByIds(prisma.user, testUserIds);
  summary.companies = await deleteByIds(prisma.company, testCompanyIds);

  return summary;
}

export async function disconnectCleanupPrisma() {
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const summary = await cleanupE2eData();
    console.log(`E2E cleanup completed: ${JSON.stringify(summary)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await disconnectCleanupPrisma();
  }
}

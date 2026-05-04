import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { canManage } from "@/lib/auth";
import { jsonError, requireApiUser } from "@/lib/api";
import { buildDigestPreview, getIntegrationSettings } from "@/lib/integrations";
import { prisma } from "@/lib/prisma";
import { getKstDateString, kstMonthBounds } from "@/lib/time";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canManage(user.role)) {
    return jsonError("요약 알림 미리보기 권한이 필요합니다.", 403);
  }

  const month = getKstDateString().slice(0, 7);
  const { start, end } = kstMonthBounds(month);
  const [settings, approvalPending, unresolvedRisks, monthCloseBlockers] = await Promise.all([
    getIntegrationSettings(user.companyId),
    prisma.approvalRequest.count({
      where: {
        companyId: user.companyId,
        status: "PENDING"
      }
    }),
    prisma.riskSignal.count({
      where: {
        companyId: user.companyId,
        resolvedAt: null
      }
    }),
    Promise.all([
      prisma.workSession.count({
        where: {
          companyId: user.companyId,
          workDate: {
            gte: start,
            lt: end
          },
          status: {
            in: ["OPEN", "NEEDS_REVIEW"]
          }
        }
      }),
      prisma.approvalRequest.count({
        where: {
          companyId: user.companyId,
          status: "PENDING",
          createdAt: {
            gte: start,
            lt: end
          }
        }
      })
    ]).then(([sessions, approvals]) => sessions + approvals)
  ]);

  return NextResponse.json(
    buildDigestPreview({
      companyName: user.company.name,
      approvalPending,
      unresolvedRisks,
      monthCloseBlockers,
      settings
    })
  );
}

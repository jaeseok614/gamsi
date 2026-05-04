import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { canViewReports } from "@/lib/auth";
import { jsonError, requireApiUser } from "@/lib/api";
import { getKstDateString, kstWeekBounds } from "@/lib/time";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canViewReports(user.role)) {
    return jsonError("이 기능은 인사 담당 또는 관리자만 사용할 수 있습니다.", 403);
  }

  const date = request.nextUrl.searchParams.get("date") ?? getKstDateString();
  const { start, end, mondayString } = kstWeekBounds(date);
  const sessions = await prisma.workSession.findMany({
    where: {
      companyId: user.companyId,
      workDate: {
        gte: start,
        lt: end
      }
    },
    include: {
      user: {
        include: {
          team: true
        }
      }
    },
    orderBy: [{ user: { name: "asc" } }, { workDate: "asc" }]
  });

  return NextResponse.json({ weekOf: mondayString, sessions });
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { canViewReports } from "@/lib/auth";
import { buildEvidencePackageZip } from "@/lib/evidence-package";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canViewReports(user.role)) {
    return jsonError("증빙 패키지는 인사 담당 또는 관리자만 생성할 수 있습니다.", 403);
  }

  const month = request.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const userId = request.nextUrl.searchParams.get("userId") ?? "";
  if (!userId) {
    return jsonError("직원을 선택하세요.");
  }

  try {
    const result = await buildEvidencePackageZip(user, {
      month,
      userId
    });
    const fileName = `workguard-evidence-${result.data.month}-${result.data.user.email}.zip`;

    return new NextResponse(result.zip, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${fileName.replaceAll('"', "")}"`
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "증빙 패키지 생성에 실패했습니다.");
  }
}

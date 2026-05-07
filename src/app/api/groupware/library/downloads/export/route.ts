import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { exportLibraryDownloadLogsCsv } from "@/lib/groupware";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  try {
    const csv = await exportLibraryDownloadLogsCsv(user, {
      itemId: request.nextUrl.searchParams.get("itemId")
    });
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=groupware-library-downloads.csv"
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "자료실 다운로드 이력을 내보내지 못했습니다.");
  }
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { deleteCompanyHoliday, upsertCompanyHoliday } from "@/lib/admin";
import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("공휴일 설정 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as {
    date?: string;
    name?: string;
    isPaidHoliday?: boolean;
  };

  const date = String(body.date ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!DATE_PATTERN.test(date) || !name) {
    return jsonError("공휴일 날짜와 이름을 확인하세요.");
  }

  try {
    return NextResponse.json(
      await upsertCompanyHoliday(user, {
        date,
        name,
        isPaidHoliday: body.isPaidHoliday !== false
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "공휴일 저장에 실패했습니다.");
  }
}

export async function DELETE(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("공휴일 설정 권한이 필요합니다.", 403);
  }

  const holidayId = request.nextUrl.searchParams.get("id") ?? "";
  if (!holidayId) {
    return jsonError("삭제할 공휴일을 선택하세요.");
  }

  try {
    return NextResponse.json(await deleteCompanyHoliday(user, holidayId));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "공휴일 삭제에 실패했습니다.");
  }
}

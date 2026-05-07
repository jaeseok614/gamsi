import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { jsonError, requireApiUser } from "@/lib/api";
import { deleteGroupwareSearchPreset, saveGroupwareSearchPreset } from "@/lib/groupware";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string | null;
    filters?: {
      search?: string | null;
      type?: string | null;
      category?: string | null;
      authorId?: string | null;
      from?: string | null;
      to?: string | null;
    } | null;
  };

  try {
    return NextResponse.json(
      await saveGroupwareSearchPreset(user, {
        name: body.name,
        filters: body.filters
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "검색 조건을 저장하지 못했습니다.");
  }
}

export async function DELETE(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
  };

  try {
    return NextResponse.json(await deleteGroupwareSearchPreset(user, body.id ?? ""));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "저장 검색을 삭제하지 못했습니다.");
  }
}

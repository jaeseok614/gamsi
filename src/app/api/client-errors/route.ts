import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth";
import { reportClientError } from "@/lib/ops";

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  const body = (await request.json().catch(() => ({}))) as {
    message?: string;
    pathname?: string;
    apiPath?: string | null;
    digest?: string | null;
    stack?: string | null;
  };

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ ok: true });
  }

  await reportClientError({
    actor: user
      ? {
          id: user.id,
          companyId: user.companyId
        }
      : null,
    message,
    pathname: body.pathname,
    apiPath: body.apiPath,
    digest: body.digest,
    stack: body.stack
  });

  return NextResponse.json({ ok: true });
}

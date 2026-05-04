import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api";

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyName: user.company.name,
      teamName: user.team?.name ?? null
    }
  });
}

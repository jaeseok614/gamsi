import { NextResponse } from "next/server";

import { getPublicHealthSnapshot } from "@/lib/ops";

export async function GET() {
  const health = await getPublicHealthSnapshot();
  const databaseDegraded = health.checks.some((check) => check.key === "database" && check.status === "degraded");

  return NextResponse.json(health, {
    status: databaseDegraded ? 503 : 200
  });
}

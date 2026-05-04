import { NextResponse } from "next/server";

import { getWebPushPublicKey, webPushConfigured } from "@/lib/push";

export async function GET() {
  return NextResponse.json({
    enabled: webPushConfigured(),
    publicKey: webPushConfigured() ? getWebPushPublicKey() : null
  });
}

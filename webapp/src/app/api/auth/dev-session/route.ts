import { NextResponse } from "next/server";

import { cookies } from "next/headers";

import {
  decodeDevMockUsername,
  DEV_MOCK_COOKIE_NAME,
  isDevMockLoginEnabled,
} from "@/lib/dev-mock-auth";

export async function GET() {
  if (!isDevMockLoginEnabled()) {
    return NextResponse.json({ mock: false as const }, { status: 200 });
  }

  const jar = await cookies();
  const raw = jar.get(DEV_MOCK_COOKIE_NAME)?.value;
  const username = raw ? decodeDevMockUsername(raw) : null;

  if (!username) {
    return NextResponse.json({ mock: true as const, username: null });
  }

  return NextResponse.json({ mock: true as const, username });
}

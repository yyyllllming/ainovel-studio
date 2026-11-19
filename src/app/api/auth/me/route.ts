import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/server/http";
import { SESSION_COOKIE, verifySession } from "@/lib/auth-session.ts";

export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return jsonError("未登录", 401, "AUTH_REQUIRED");
  }
  return jsonOk({ id: session.i, username: session.u, role: session.r });
}

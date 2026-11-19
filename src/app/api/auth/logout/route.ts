import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-session.ts";
import { jsonOk } from "@/server/http";

function clearSessionCookie(response: NextResponse, request: Request) {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const secure = proto === "https" || new URL(request.url).protocol === "https:";
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure,
  });
  return response;
}

export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("application/json")) {
    return clearSessionCookie(jsonOk({ ok: true }), request);
  }
  return clearSessionCookie(NextResponse.redirect(new URL("/", request.url), 303), request);
}

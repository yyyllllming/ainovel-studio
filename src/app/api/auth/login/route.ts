import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { loginWithIdpPassword } from "@/server/security/idp.ts";
import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  signSession,
} from "@/lib/auth-session.ts";
import { unauthorized } from "@/server/errors.ts";

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = await loginWithIdpPassword(username, password);
    const token = await signSession({ i: user.id, u: user.username, r: user.role });
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    const secure = proto === "https" || new URL(request.url).protocol === "https:";
    const response = jsonOk({ username: user.username, role: user.role });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SEC,
      secure,
    });
    return response;
  } catch (error) {
    return jsonFromError(error, "登录失败", 500);
  }
}

export async function GET() {
  return jsonFromError(unauthorized("请使用 POST 登录"), "请使用 POST 登录", 405);
}

import { forbidden, unauthorized } from "../errors.ts";
import { isUserAllowed } from "../../lib/auth-session.ts";

export type IdpUser = {
  id: number;
  username: string;
  role: number;
};

type IdpLoginResponse = {
  success?: boolean;
  message?: string;
  data?: {
    id?: number;
    username?: string;
    role?: number;
    status?: number;
  };
};

export async function loginWithIdpPassword(username: string, password: string): Promise<IdpUser> {
  const name = username.trim();
  if (!name || !password) {
    throw unauthorized("请输入用户名和密码");
  }
  const base = (process.env.AINOVEL_IDP_BASE ?? "").replace(/\/+$/, "");
  if (!base) {
    throw unauthorized("未配置身份源 AINOVEL_IDP_BASE");
  }
  let response: Response;
  try {
    response = await fetch(`${base}/api/user/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: name, password }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw unauthorized("无法连接身份源，请稍后重试");
  }
  const payload = (await response.json().catch(() => ({}))) as IdpLoginResponse;
  if (!response.ok || payload.success !== true) {
    throw unauthorized(payload.message || "用户名或密码错误");
  }
  const data = payload.data;
  const id = Number(data?.id);
  const idpUsername = data?.username?.trim() ?? "";
  const role = Number(data?.role ?? 1);
  if (!Number.isFinite(id) || !idpUsername) {
    throw unauthorized("身份源未返回用户信息");
  }
  if (data?.status !== undefined && data.status !== 1) {
    throw forbidden("账号已禁用");
  }
  if (!isUserAllowed(idpUsername, role)) {
    throw forbidden("该账号无权访问");
  }
  return { id, username: idpUsername, role };
}

"use client";
function throwIfNotOk(response: Response, payload: { error?: string; code?: string }) {
  if (response.ok) return;
  throw new Error(payload.error || "请求失败");
}

export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });
  const payload = (await response.json()) as T & { error?: string };
  throwIfNotOk(response, payload);
  return payload;
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  throwIfNotOk(response, payload);
  return payload;
}

export async function apiPut<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  throwIfNotOk(response, payload);
  return payload;
}

export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  throwIfNotOk(response, payload);
  return payload;
}

export async function apiDelete<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "DELETE",
    cache: "no-store",
  });
  const payload = (await response.json()) as T & { error?: string };
  throwIfNotOk(response, payload);
  return payload;
}

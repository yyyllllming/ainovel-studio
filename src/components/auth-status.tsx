"use client";
import { useEffect, useState } from "react";

export function AuthStatus() {
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { username?: string } | null) => {
        setUsername(payload?.username ?? null);
      })
      .catch(() => setUsername(null));
  }, []);
  if (!username) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="max-w-[9rem] truncate text-xs tracking-wide text-[var(--ink-soft)]" title={username}>
        {username}
      </span>
      <form action="/api/auth/logout" method="POST">
        <button type="submit" className="btn-ghost px-2 py-1 text-xs">
          退出
        </button>
      </form>
    </div>
  );
}

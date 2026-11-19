export interface ReadJsonLineStreamOptions {
  /** 调用方传入的 AbortSignal；触发后将停止消费并 cancel reader。 */
  signal?: AbortSignal;
}

export async function readJsonLineStream<T extends { type: string }>(
  response: Response,
  onEvent: (event: T) => Promise<void> | void,
  options: ReadJsonLineStreamOptions = {},
) {
  if (!response.ok) {
    let message = "请求失败";
    try {
      const payload = await response.json() as { error?: string };
      message = payload.error || message;
    } catch {
      const fallback = await response.text();
      if (fallback.trim()) {
        message = fallback.trim();
      }
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("服务端没有返回可读取的流式内容。");
  }

  const { signal } = options;
  if (signal?.aborted) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) {
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        if (signal?.aborted) {
          return;
        }
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        await onEvent(JSON.parse(line) as T);
      }
    }

    if (signal?.aborted) {
      return;
    }
    const tail = buffer.trim();
    if (tail) {
      await onEvent(JSON.parse(tail) as T);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
  }
}

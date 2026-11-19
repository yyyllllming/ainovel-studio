import { NextResponse } from "next/server";
import { describeErrorForHttp } from "./errors.ts";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(message: string, status = 400, code?: string, details?: unknown) {
  return NextResponse.json(
    {
      error: message,
      code,
      details,
    },
    { status },
  );
}

export function jsonFromError(error: unknown, fallbackMessage: string, fallbackStatus = 500) {
  const shape = describeErrorForHttp(error, fallbackMessage, fallbackStatus);
  return jsonError(shape.message, shape.status, shape.code, shape.details);
}

export async function readJsonBody(request: Request): Promise<unknown> {
  return await request.json().catch(() => ({}));
}

export function wantsJsonLineStream(request: Request) {
  return new URL(request.url).searchParams.get("stream") === "1"
    || request.headers.get("x-ainovel-stream") === "1";
}

export function createJsonLineStreamResponse(
  run: (emit: (event: Record<string, unknown>) => Promise<void>) => Promise<void>,
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let streamClosed = false;
      const emit = async (event: Record<string, unknown>) => {
        if (streamClosed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          streamClosed = true;
        }
      };

      try {
        await run(emit);
      } finally {
        if (!streamClosed) {
          try {
            controller.close();
          } catch {
            streamClosed = true;
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

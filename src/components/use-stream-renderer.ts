"use client";

import { useCallback, useRef, useState } from "react";

const SENTENCE_BOUNDARY_REGEX = /[。！？!?….]+(?:["'”’」』》】）)\]]+)?/gu;
const PARAGRAPH_BREAK_REGEX = /\n\s*\n/gu;
const SOFT_BREAK_REGEX = /(?:\r?\n+|[，、；;,:：]|\s+)/gu;

const DEFAULT_BUFFER_THRESHOLD = 96;
const DEFAULT_BUFFER_TAIL = 24;

function findLastMatchEnd(regex: RegExp, input: string, maxIndex = input.length) {
  regex.lastIndex = 0;
  let lastIndex = -1;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(input))) {
    const endIndex = match.index + match[0].length;
    if (endIndex > maxIndex) {
      break;
    }
    lastIndex = endIndex;
  }
  return lastIndex;
}

export function consumeSentenceBuffer(
  buffer: string,
  options?: {
    threshold?: number;
    tailChars?: number;
  },
) {
  if (!buffer) {
    return {
      flushText: "",
      remainder: "",
    };
  }

  const paragraphBoundary = findLastMatchEnd(PARAGRAPH_BREAK_REGEX, buffer);
  const sentenceBoundary = findLastMatchEnd(SENTENCE_BOUNDARY_REGEX, buffer);
  const flushBoundary = Math.max(paragraphBoundary, sentenceBoundary);

  if (flushBoundary > 0) {
    return {
      flushText: buffer.slice(0, flushBoundary),
      remainder: buffer.slice(flushBoundary),
    };
  }

  const threshold = Math.max(24, options?.threshold ?? DEFAULT_BUFFER_THRESHOLD);
  if (buffer.length < threshold) {
    return {
      flushText: "",
      remainder: buffer,
    };
  }

  const tailChars = Math.max(8, options?.tailChars ?? DEFAULT_BUFFER_TAIL);
  const softLimit = Math.max(0, buffer.length - tailChars);
  let softBoundary = findLastMatchEnd(SOFT_BREAK_REGEX, buffer, softLimit);
  if (softBoundary <= 0) {
    softBoundary = softLimit;
  }

  return {
    flushText: buffer.slice(0, softBoundary),
    remainder: buffer.slice(softBoundary),
  };
}

export function useStreamRenderer() {
  const [renderedText, setRenderedText] = useState("");
  const bufferRef = useRef("");

  const reset = useCallback((nextText = "") => {
    bufferRef.current = "";
    setRenderedText(nextText);
  }, []);

  const pushDelta = useCallback((delta: string, options?: { replace?: boolean }) => {
    if (options?.replace) {
      bufferRef.current = "";
      setRenderedText(delta);
      return;
    }

    const nextBuffer = `${bufferRef.current}${delta}`;
    const { flushText, remainder } = consumeSentenceBuffer(nextBuffer);
    bufferRef.current = remainder;
    if (flushText) {
      setRenderedText((current) => `${current}${flushText}`);
    }
  }, []);

  const flush = useCallback(() => {
    if (!bufferRef.current) {
      return;
    }
    const tail = bufferRef.current;
    bufferRef.current = "";
    setRenderedText((current) => `${current}${tail}`);
  }, []);

  return {
    renderedText,
    reset,
    pushDelta,
    flush,
  };
}

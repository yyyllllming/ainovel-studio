import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { consumeSentenceBuffer, useStreamRenderer } from "@/components/use-stream-renderer";

function StreamRendererHarness() {
  const { renderedText, pushDelta, flush, reset } = useStreamRenderer();

  return (
    <div>
      <div data-testid="output">{renderedText}</div>
      <button onClick={() => pushDelta("第一句还没写完")}>part</button>
      <button onClick={() => pushDelta("，现在写完。")}>finish</button>
      <button onClick={() => pushDelta('He said, "Go." Then')}>english</button>
      <button onClick={() => pushDelta("整段替换后的完整回复。", { replace: true })}>replace</button>
      <button onClick={() => flush()}>flush</button>
      <button onClick={() => reset()}>reset</button>
    </div>
  );
}

describe("useStreamRenderer", () => {
  it("flushes completed Chinese sentences while keeping the unfinished tail buffered", () => {
    const consumed = consumeSentenceBuffer("第一句。第二句");
    expect(consumed).toEqual({
      flushText: "第一句。",
      remainder: "第二句",
    });
  });

  it("recognizes English punctuation with closing quotes as a sentence boundary", () => {
    const consumed = consumeSentenceBuffer('He said, "Go." Then');
    expect(consumed).toEqual({
      flushText: 'He said, "Go."',
      remainder: " Then",
    });
  });

  it("flushes long punctuation-free text at a safe boundary instead of waiting forever", () => {
    const consumed = consumeSentenceBuffer(
      "第一条设定很长但是故意不加句号 第二条设定还在继续推进",
      { threshold: 20, tailChars: 6 },
    );

    expect(consumed.flushText.length).toBeGreaterThan(0);
    expect(consumed.remainder.length).toBeGreaterThan(0);
  });

  it("buffers fragments until a sentence is complete, then flushes the final tail on done", () => {
    render(<StreamRendererHarness />);

    fireEvent.click(screen.getByRole("button", { name: "part" }));
    expect(screen.getByTestId("output")).toHaveTextContent("");

    fireEvent.click(screen.getByRole("button", { name: "finish" }));
    expect(screen.getByTestId("output")).toHaveTextContent("第一句还没写完，现在写完。");

    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    fireEvent.click(screen.getByRole("button", { name: "part" }));
    fireEvent.click(screen.getByRole("button", { name: "flush" }));
    expect(screen.getByTestId("output")).toHaveTextContent("第一句还没写完");
  });

  it("drops any buffered tail when the server sends a replace event", () => {
    render(<StreamRendererHarness />);

    fireEvent.click(screen.getByRole("button", { name: "part" }));
    fireEvent.click(screen.getByRole("button", { name: "replace" }));

    expect(screen.getByTestId("output")).toHaveTextContent("整段替换后的完整回复。");
  });
});

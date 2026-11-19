import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("manual foundation import UI contract", () => {
  it("exposes a JSON import control wired to the non-LLM endpoint", () => {
    const componentPath = resolve(process.cwd(), "src/components/foundation/manual-foundation-import.tsx");
    let source = "";
    try {
      source = readFileSync(componentPath, "utf8");
    } catch {
      source = "";
    }

    expect(source).toContain("导入人工设定 JSON");
    expect(source).toContain("人工设定 JSON");
    expect(source).toContain("/foundation/import");
    expect(source).not.toMatch(/chatJson|requestChat|Completion/u);
  });

  it("places the manual import control in the real foundation workspace", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/foundation-workshop-client.tsx"),
      "utf8",
    );
    expect(source).toContain("ManualFoundationImport");
  });
});

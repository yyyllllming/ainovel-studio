import { describe, expect, it } from "vitest";
import { buildNewProjectWorkspaceHref } from "@/lib/project-navigation";

describe("buildNewProjectWorkspaceHref", () => {
  it("routes new projects into the foundation workshop", () => {
    expect(buildNewProjectWorkspaceHref("project-1")).toBe("/projects/project-1?tab=chat");
  });
});

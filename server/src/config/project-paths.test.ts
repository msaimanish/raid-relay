import { describe, expect, it } from "vitest";
import { projectRootFromCwd, resolveProjectPath } from "./project-paths.js";

describe("project path resolution", () => {
  it("anchors server workspace paths at the repository root", () => {
    const root = "/work/raid-relay";
    expect(projectRootFromCwd(`${root}/server`)).toBe(root);
    expect(
      resolveProjectPath(".data/twitch-tokens.json", `${root}/server`),
    ).toBe(`${root}/.data/twitch-tokens.json`);
  });

  it("preserves in-memory database paths", () => {
    expect(resolveProjectPath(":memory:", "/work/raid-relay/server")).toBe(
      ":memory:",
    );
  });
});

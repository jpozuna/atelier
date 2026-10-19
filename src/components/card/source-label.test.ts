import { describe, expect, it } from "vitest";
import type { Path } from "@/types";
import { pathToDisplaySteps } from "./helpers";
import { MOCK_CARDS } from "./mock";

describe("sourceLabel on a sourced hop", () => {
  it("shows the label as text and never links the placeholder url", () => {
    const base = MOCK_CARDS.find((m) => m.card.path.hops.some((h) => h.kind === "lineage"))!.card.path;
    const path: Path = {
      ...base,
      hops: base.hops.map((h) =>
        h.kind === "lineage" ? { ...h, provenance: "sourced", sourceUrl: "https://example.org/", sourceLabel: "Qloo" } : h,
      ),
    };
    const lineage = pathToDisplaySteps(path).find((s) => s.kind === "lineage")!;
    expect(lineage.sourceLabel).toBe("Qloo");
    expect(lineage.href).toBeUndefined();
    expect(lineage.linkMissing).toBe(false);
  });
});

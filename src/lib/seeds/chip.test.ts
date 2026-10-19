import { describe, expect, it } from "vitest";
import type { SearchItem } from "@/lib/qloo/types";
import { toChip } from "./chip";

const brand = {
  name: "Invented Atelier Brand",
  entity_id: "00000000-0000-4000-8000-000000000071",
  types: ["urn:entity:brand"],
  properties: { founded_year: 1987 },
} as unknown as SearchItem;

describe("toChip", () => {
  it("reads a brand's founded_year", () => {
    expect(toChip(brand)?.year).toBe(1987);
  });

  it("prefers the searched field type over the item's first type", () => {
    const multi = { ...brand, types: ["urn:entity:place", "urn:entity:brand"] } as unknown as SearchItem;
    expect(toChip(multi, "urn:entity:brand")?.type).toBe("brand");
    expect(toChip(multi)?.type).toBe("place");
  });
});

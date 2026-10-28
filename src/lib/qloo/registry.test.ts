import { describe, expect, it } from "vitest";
import { ENTITY_TYPE_KEYS, INSIGHTS_TYPES, POST_BODY, REGISTRY, TAG_INSIGHTS, entityTypeKeyFromUrn, paramStatus } from "./registry";

describe("registry", () => {
  it("maps each type to a unique urn", () => {
    const urns = ENTITY_TYPE_KEYS.map((k) => INSIGHTS_TYPES[k].urn);
    expect(new Set(urns).size).toBe(urns.length);
    expect(entityTypeKeyFromUrn("urn:entity:artist")).toBe("artist");
    expect(entityTypeKeyFromUrn("urn:entity:music")).toBeNull();
    expect(entityTypeKeyFromUrn("urn:tag")).toBeNull();
  });

  it("reports statuses from the spike", () => {
    expect(paramStatus("movie", "filter.popularity.max")).toBe("listed");
    expect(paramStatus("artist", "feature.explainability")).toBe("confirmed");
    expect(paramStatus("book", "bias.trends")).toBe("rejected");
    expect(paramStatus("book", "bias.content_based")).toBe("ignored");
    expect(paramStatus("brand", "bias.content_based")).toBe("ignored");
    expect(paramStatus("place", "sort_by")).toBe("ignored");
    expect(paramStatus("movie", "filter.not_a_param")).toBe("unknown");
  });

  it("keeps movie-only confirmations off other types", () => {
    expect(paramStatus("movie", "operator.signal.interests.tags")).toBe("confirmed");
    expect(paramStatus("book", "operator.signal.interests.tags")).toBe("unknown");
  });

  it("confirms exactly the body params the 04-post-check verified", () => {
    const verified = ["filter.popularity.max", "filter.exclude.entities", "feature.explainability"];
    expect(POST_BODY.confirmedBodyParams).toEqual(verified);
    expect(REGISTRY.post.confirmedBodyParams).toEqual(verified);
  });

  it("confirms only seed entities for tag insights", () => {
    expect(TAG_INSIGHTS.confirmed).toContain("signal.interests.entities");
    expect(TAG_INSIGHTS.listed).not.toContain("signal.interests.tags");
  });
});

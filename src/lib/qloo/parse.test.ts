import { describe, expect, it } from "vitest";
import { QlooParseError } from "./errors";
import { emptyDiagnosis, httpErrorFor, isNoResultsBody, parseErrorBody, parseFlatEntities, parseInsightsEntities, parseTags, parseTasteAnalysis } from "./parse";
import { insightsBody, searchBody, tagsBody, tasteBody } from "./testing";

describe("envelope parsers", () => {
  it("parses a flat search array", () => {
    expect(parseFlatEntities("/search", searchBody([1, 2])).items).toHaveLength(2);
    expect(parseFlatEntities("/search", { success: true, results: [] }).items).toEqual([]);
  });

  it("parses insights results.entities with query metadata", () => {
    const p = parseInsightsEntities({ ...insightsBody([1]), query: { explainability: {} } });
    expect(p.items).toHaveLength(1);
    expect(p.query).toEqual({ explainability: {} });
  });

  it("parses tags (id) and taste analysis (tag_id)", () => {
    expect(parseTags(tagsBody([1, 2, 3])).items).toHaveLength(3);
    expect(parseTasteAnalysis(tasteBody([1])).items[0].tag_id).toBeTruthy();
  });

  it("does not let one envelope parse as another", () => {
    expect(() => parseInsightsEntities(searchBody([1]))).toThrow(QlooParseError);
    expect(() => parseFlatEntities("/search", insightsBody([1]))).toThrow(QlooParseError);
    // items under the wrong id field are dropped (and counted), not parsed as the other shape
    expect(parseTags(tasteBody([1, 2]))).toMatchObject({ items: [], dropped: 2 });
    expect(parseTasteAnalysis(tagsBody([1]))).toMatchObject({ items: [], dropped: 1 });
    expect(() => parseInsightsEntities(null)).toThrow(QlooParseError);
  });

  it("drops items without an id instead of throwing, and counts them", () => {
    const body = { success: true, results: { entities: [{ entity_id: "a" }, { name: "no id" }, null, { entity_id: "" }, { entity_id: "b" }] } };
    expect(parseInsightsEntities(body)).toMatchObject({ dropped: 3 });
    expect(parseInsightsEntities(body).items).toHaveLength(2);
    expect(parseFlatEntities("/search", { results: [{ nope: 1 }] })).toMatchObject({ items: [], dropped: 1 });
  });

  it("treats a 200 with success:false as an error, not empty", () => {
    const bad = { success: false, errors: [{ message: "upstream failed" }], results: { entities: [] } };
    expect(() => parseInsightsEntities(bad)).toThrow(/success:false.*upstream failed/);
    expect(() => parseFlatEntities("/search", { success: false, results: [] })).toThrow(QlooParseError);
    expect(() => parseTags({ success: false, results: { tags: [] } })).toThrow(QlooParseError);
    expect(() => parseTasteAnalysis({ success: false, results: { tags: [] } })).toThrow(QlooParseError);
  });

  it("recognises the No results body", () => {
    expect(isNoResultsBody(JSON.stringify({ code: 404, reason: "Not Found", message: "No results" }))).toBe(true);
    expect(isNoResultsBody(JSON.stringify({ errors: [{ message: "No path matching" }] }))).toBe(false);
    expect(isNoResultsBody("<html></html>")).toBe(false);
    expect(isNoResultsBody("")).toBe(false);
  });

  it("gives a diagnosis for empty results", () => {
    expect(emptyDiagnosis("/v2/insights", "entity")).toMatch(/silently ignored/);
    expect(emptyDiagnosis("/search", "search")).toMatch(/missing/);
    expect(emptyDiagnosis("/v2/insights", "entity", 4)).toMatch(/^4 item\(s\)/);
  });
});

describe("error bodies", () => {
  it("reads the insights errors[] shape", () => {
    expect(parseErrorBody(JSON.stringify({ errors: [{ message: "bad thing", path: "take" }, { message: "other", subtype: "x" }] })).messages).toEqual(["bad thing (take)", "other (x)"]);
  });
  it("reads the search 400 shape", () => {
    expect(parseErrorBody(JSON.stringify({ error: { reason: "bad_request", message: "take must be <= 100", code: 400, request_id: "r" } })).messages).toEqual(["bad_request: take must be <= 100"]);
  });
  it("reads the flat 429 shape", () => {
    expect(parseErrorBody(JSON.stringify({ code: 429, reason: "Too Many Requests", message: "slow down" })).messages).toEqual(["Too Many Requests: slow down"]);
  });
  it("recognises HTML gateway pages", () => {
    expect(parseErrorBody("<html><body>504 Gateway Time-out</body></html>")).toEqual({ messages: [], html: true });
  });
  it("maps statuses to error kinds", () => {
    const kinds = Object.fromEntries([400, 401, 403, 404, 429, 500, 502, 504].map((s) => [s, httpErrorFor("/search", s, "{}").kind]));
    expect(kinds).toEqual({ 400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 429: "rate_limited", 500: "server_error", 502: "server_error", 504: "gateway_timeout" });
    expect(httpErrorFor("/v2/insights", 504, "<html></html>").html).toBe(true);
    expect(httpErrorFor("/v2/insights", 500, "{}").retryable).toBe(true);
    expect(httpErrorFor("/v2/insights", 400, "{}").retryable).toBe(false);
  });
});

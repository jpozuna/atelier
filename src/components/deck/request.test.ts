import { describe, expect, it } from "vitest";
import { RUN_MAX_EXCLUDE } from "@/lib/agent/config";
import { FIXTURE_INPUTS, FIXTURE_PLAN, makeFixtureResult, uid } from "./fixture";
import { buildRunBody, buildRunRequest, cleanExclude, rerunExclude } from "./request";

describe("buildRunBody", () => {
  it("sends the seeds, profile and axes as they are, and nothing else on a first run", () => {
    const body = buildRunBody(FIXTURE_INPUTS);
    expect(Object.keys(body).sort()).toEqual(["axes", "profile", "seeds"]);
    expect(body.seeds).toBe(FIXTURE_INPUTS.seeds);
  });

  it("sends the plan back unchanged on a repeat", () => {
    expect(buildRunBody(FIXTURE_INPUTS, { plan: FIXTURE_PLAN }).plan).toBe(FIXTURE_PLAN);
  });

  it("sends exclude only when there is something to exclude, and domains in field order", () => {
    expect(buildRunBody(FIXTURE_INPUTS, { exclude: [] })).not.toHaveProperty("exclude");
    const body = buildRunBody(FIXTURE_INPUTS, { exclude: [uid(71)], domains: ["film", "music"] });
    expect(body.exclude).toEqual([uid(71)]);
    expect(body.domains).toEqual(["music", "film"]);
  });
});

describe("cleanExclude", () => {
  it("keeps UUIDs only, once each, and at most the route's limit (newest win)", () => {
    expect(cleanExclude([uid(71), "not-an-id", uid(71), uid(72)])).toEqual([uid(71), uid(72)]);
    const many = Array.from({ length: RUN_MAX_EXCLUDE + 20 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const out = cleanExclude(many);
    expect(out).toHaveLength(RUN_MAX_EXCLUDE);
    expect(out[out.length - 1]).toBe(many[many.length - 1]);
  });
});

describe("buildRunRequest", () => {
  it("is a JSON POST to the run route with no key or other header", () => {
    const req = buildRunRequest(FIXTURE_INPUTS, { plan: FIXTURE_PLAN });
    expect(req.url).toBe("/api/run");
    expect(req.init.method).toBe("POST");
    expect(Object.keys(req.init.headers)).toEqual(["Content-Type"]);
    expect(JSON.parse(req.init.body).plan).toEqual(FIXTURE_PLAN);
  });
});

describe("rerunExclude", () => {
  it("excludes what is set aside and everything already shown in the affected fields", () => {
    const result = makeFixtureResult();
    const aside = [result.domains[0].byBand.calibration[0].qlooId];
    const ids = rerunExclude(result, ["music"], aside);
    for (const p of result.domains[0].picks) expect(ids).toContain(p.qlooId);
    for (const p of result.domains[1].picks) expect(ids).not.toContain(p.qlooId);
  });
});

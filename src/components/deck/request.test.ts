import { describe, expect, it } from "vitest";
import { RUN_MAX_EXCLUDE } from "@/lib/agent/config";
import { FIXTURE_INPUTS, FIXTURE_PLAN, makeFixtureResult, uid } from "./fixture";
import { buildRunBody, buildRunRequest, cleanExclude, notMeRerunBody, rerunExclude } from "./request";

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

describe("notMe", () => {
  const aside = uid(71);

  it("is sent when ids were newly set aside, as a subset of exclude", () => {
    const body = buildRunBody(FIXTURE_INPUTS, { exclude: [uid(72), aside], notMe: [aside] });
    expect(body.notMe).toEqual([aside]);
    expect(body.exclude).toEqual(expect.arrayContaining(body.notMe ?? []));
  });

  it("is left out when nothing was set aside, so a first run and a follow-up keep their shape", () => {
    expect(buildRunBody(FIXTURE_INPUTS)).not.toHaveProperty("notMe");
    expect(buildRunBody(FIXTURE_INPUTS, { exclude: [aside], notMe: [] })).not.toHaveProperty("notMe");
  });

  it("never names an id that is not excluded, and drops anything that is not an id", () => {
    expect(buildRunBody(FIXTURE_INPUTS, { exclude: [uid(72)], notMe: [aside, "nope"] })).not.toHaveProperty("notMe");
    expect(buildRunBody(FIXTURE_INPUTS, { notMe: [aside] })).not.toHaveProperty("notMe");
  });

  it("goes out in the request body", () => {
    const req = buildRunRequest(FIXTURE_INPUTS, { exclude: [aside], notMe: [aside], plan: FIXTURE_PLAN });
    expect(JSON.parse(req.init.body).notMe).toEqual([aside]);
  });
});

describe("notMeRerunBody (what the screen sends for a not-me re-run)", () => {
  const result = makeFixtureResult();
  const pick = result.domains[0].byBand.calibration[0];

  it("sends notMe as the id set aside just now, inside exclude, for the affected field only", () => {
    const earlier = result.domains[1].byBand.calibration[0].qlooId;
    const body = notMeRerunBody(FIXTURE_INPUTS, result, pick, ["music"], [earlier, pick.qlooId]);
    expect(body.notMe).toEqual([pick.qlooId]);
    expect(body.exclude).toEqual(expect.arrayContaining([pick.qlooId, earlier]));
    expect(body.domains).toEqual(["music"]);
    expect(body.plan).toBe(result.plan);
    // Everything shown in the field is excluded, but only the pick set aside now is named "not me".
    for (const p of result.domains[0].picks) expect(body.exclude).toContain(p.qlooId);
    expect(body.notMe).not.toContain(earlier);
  });

  it("carries notMe over the wire", () => {
    const body = notMeRerunBody(FIXTURE_INPUTS, result, pick, ["music"], [pick.qlooId]);
    const req = buildRunRequest(FIXTURE_INPUTS, body);
    expect(JSON.parse(req.init.body).notMe).toEqual([pick.qlooId]);
  });
});

import { describe, expect, it } from "vitest";
import { FIELDS } from "@/types";
import { FIXTURE_INPUTS, FIXTURE_SEEDS, makeFixtureResult } from "@/components/deck/fixture";
import { FOLLOW_UP_MAX_LIVE_CALLS, MAX_SEEDS_PER_USER } from "@/lib/agent/config";
import { answerChanged, planFollowUp, seedFromTried, seedIdForPick, snapshotAfter } from "./follow-up";
import type { FollowUpSource, TriedPick } from "./follow-up";

const result = makeFixtureResult();
const musicPicks = result.domains.find((d) => d.domain === "music")!.picks;
const tried = musicPicks[2];
const triedPick: TriedPick = { id: tried.id, qlooId: tried.qlooId, field: "music", name: tried.name, llmBridged: false };

/** What the page reads from the account: seeds, snapshot, and the saved picks of the field. */
const source = (over: Partial<FollowUpSource> = {}): FollowUpSource => ({
  seeds: FIXTURE_SEEDS,
  profile: FIXTURE_INPUTS.profile,
  axes: FIXTURE_INPUTS.axes,
  plan: result.plan,
  shownIds: musicPicks.map((p) => p.qlooId),
  ...over,
});

describe("planFollowUp", () => {
  it("runs only the pick's own field, with the stored plan", () => {
    const plan = planFollowUp(source(), triedPick, { how: "liked", words: "it held its silences" })!;
    expect(plan.body.domains).toEqual(["music"]);
    expect(plan.body.plan).toEqual(result.plan);
    // One field is one pool plus the loop's own cap of 2 re-queries.
    expect(FOLLOW_UP_MAX_LIVE_CALLS).toBe(3);
    expect(FIELDS).toContain(plan.body.domains![0]);
  });

  it("works with an account that has no plan yet", () => {
    const plan = planFollowUp(source({ plan: null }), triedPick, { how: "mixed" })!;
    expect(plan.body.plan).toBeUndefined();
    expect(plan.body.domains).toEqual(["music"]);
  });

  it("excludes the saved picks of the field and the tried pick, so what comes back is new", () => {
    const plan = planFollowUp(source(), triedPick, { how: "not_liked" })!;
    for (const p of musicPicks) expect(plan.body.exclude).toContain(p.qlooId);
    expect(plan.body.exclude).toContain(tried.qlooId);
    const filmPick = result.domains.find((d) => d.domain === "film")!.picks[0];
    expect(plan.body.exclude).not.toContain(filmPick.qlooId);
  });

  it("adds a liked pick as a seed, in the person's own words, and only then", () => {
    const liked = planFollowUp(source(), triedPick, { how: "liked", words: "it held its silences" })!;
    expect(liked.addSeed).toMatchObject({ id: seedIdForPick(tried.id), field: "music", typed: tried.name, why: "it held its silences", qlooId: tried.qlooId, status: "clean" });
    expect(liked.body.seeds).toHaveLength(FIXTURE_SEEDS.length + 1);
    for (const how of ["mixed", "not_liked"] as const) {
      const plan = planFollowUp(source(), triedPick, { how })!;
      expect(plan.addSeed).toBeNull();
      expect(plan.body.seeds).toHaveLength(FIXTURE_SEEDS.length);
    }
  });

  it("does not seed a bridged pick, one with no entity, one already a seed, or when the account is at its seed limit", () => {
    expect(seedFromTried({ ...triedPick, llmBridged: true }, "w", [])).toBeNull();
    expect(seedFromTried({ ...triedPick, qlooId: null }, "w", [])).toBeNull();
    expect(seedFromTried(triedPick, "w", [{ ...FIXTURE_SEEDS[0], qlooId: tried.qlooId }])).toBeNull();
    expect(seedFromTried(triedPick, "w", [{ ...FIXTURE_SEEDS[0], id: seedIdForPick(tried.id) }])).toBeNull();
    const full = Array.from({ length: MAX_SEEDS_PER_USER }, (_, i) => ({ ...FIXTURE_SEEDS[0], id: `s${i}`, qlooId: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}` }));
    expect(seedFromTried(triedPick, "w", full)).toBeNull();
    // At the limit the follow-up still looks again; it only skips the new seed.
    const plan = planFollowUp(source({ seeds: full }), triedPick, { how: "liked" })!;
    expect(plan.addSeed).toBeNull();
    expect(plan.body.seeds).toHaveLength(MAX_SEEDS_PER_USER);
  });

  it("is null when the account has no stored profile to look again with", () => {
    expect(planFollowUp(null, triedPick, { how: "liked" })).toBeNull();
  });

  it("sends no taste numbers", () => {
    const plan = planFollowUp(source(), triedPick, { how: "liked", words: "w" })!;
    expect(JSON.stringify(plan.body)).not.toMatch(/popularity|"reach"|connection|contribution":\d/);
  });
});

describe("snapshotAfter", () => {
  it("keeps the profile and axes with the plan the run returned", () => {
    const next = { themes: [], requeries: [] };
    expect(snapshotAfter(source(), next)).toEqual({ profile: FIXTURE_INPUTS.profile, axes: FIXTURE_INPUTS.axes, plan: next });
  });
});

describe("answerChanged: a repeat press costs nothing", () => {
  it("counts the first answer, and after that only a different answer", () => {
    expect(answerChanged(null, { how: "liked", words: "" })).toEqual({ changed: true, howChanged: true });
    const last = { how: "liked" as const, words: "held up" };
    expect(answerChanged(last, { ...last })).toEqual({ changed: false, howChanged: false });
    expect(answerChanged(last, { how: "liked", words: "held up well" })).toEqual({ changed: true, howChanged: false });
    expect(answerChanged(last, { how: "mixed", words: "held up" })).toEqual({ changed: true, howChanged: true });
  });
});

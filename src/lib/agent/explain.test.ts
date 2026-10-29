import { describe, expect, it } from "vitest";
import { isCard, isPath, type Path } from "@/types";
import { assembleCard, buildExplainInput, DISTANCE_WORDS, explainDomain, explainMaxTokens, fallbackLines, lineageSentence, provenanceOf, validateLines } from "./explain";
import { disabledLlm } from "./llm";
import { checkText, FIELD_IN, FIELD_PHRASE, maskNames, restates } from "./text";
import { fakeAnthropic, fakeQloo, goodModel, input, modelFor, pool, runWorld, tg, type ModelResponder } from "./testing";
import type { ExplainInput } from "./types";

const base: ExplainInput = {
  pickId: "pick-1",
  seed: { label: "Invented Work 1", field: "music", why: null },
  themeTags: ["Fixture Tag 3", "Fixture Tag 4"],
  pickOnlyTags: [],
  distance: [],
  lineage: null,
  pick: { label: "Invented Pick 7", field: "books" },
  anchorBasis: "shared_tags",
};

const good = {
  why: "Invented Work 1 and Invented Pick 7 share the themes Fixture Tag 3 and Fixture Tag 4. Tracing them into books may help you notice them in Invented Work 1.",
  different: "This one sits in books while the seed sits in music, and only the named themes link them.",
};

describe("explainMaxTokens", () => {
  it("keeps the minimum for small fields, grows with picks, and stops at the ceiling", () => {
    expect(explainMaxTokens(4)).toBe(2400);
    expect(explainMaxTokens(16)).toBe(4800);
    expect(explainMaxTokens(100)).toBe(8000);
  });
});

describe("validateLines", () => {
  it("accepts plain lines built from the path", () => {
    expect(validateLines(good, base)).toEqual([]);
  });

  it("accepts the deterministic fallback for every shape of path", () => {
    const shapes: Partial<ExplainInput>[] = [
      {},
      { themeTags: ["Fixture Tag 3"] },
      { pick: { label: "Invented Pick 8", field: "music" } },
      { pickOnlyTags: ["Fixture Tag 91"] },
      { pickOnlyTags: ["Fixture Tag 91", "Fixture Tag 92"], distance: Object.values(DISTANCE_WORDS) },
      { distance: [DISTANCE_WORDS.other_field] },
      { distance: [DISTANCE_WORDS.farther_from_tags, DISTANCE_WORDS.less_familiar] },
      { lineage: { text: "Influenced by Invented Elder", source: "Qloo", touchesSeed: false } },
      { pick: { label: "Invented Pick 9", field: "tv" } },
      { pick: { label: "Invented Pick 9", field: "food_places" } },
    ];
    for (const shape of shapes) {
      const i = { ...base, ...shape };
      expect(validateLines(fallbackLines(i), i), JSON.stringify(shape)).toEqual([]);
    }
  });

  const refused: [string, Partial<typeof good>, RegExp][] = [
    ["first person", { why: "I find that Invented Work 1 and Invented Pick 7 share Fixture Tag 3 and Fixture Tag 4." }, /first person/],
    ["praise", { why: "Invented Pick 7 is a great pairing for Invented Work 1 through Fixture Tag 3 and Fixture Tag 4." }, /praise/],
    ["a promise", { why: "You will love Invented Pick 7 because of Fixture Tag 3 and Fixture Tag 4." }, /promise/],
    ["a number", { why: "Invented Pick 7 shares Fixture Tag 3 and Fixture Tag 4 with 9 of your picks." }, /number/],
    ["a score", { why: "Invented Pick 7 shares Fixture Tag 3 and Fixture Tag 4 and has a strong score." }, /internal term/],
    ["a reach score", { different: "It has a high reach score from the seed." }, /internal term/],
    ["the connection floor", { different: "It clears the connection floor in books." }, /internal term/],
    ["band edges", { different: "It sits at the edge of the extreme band." }, /internal term/],
    ["popularity", { different: "It is less popular than the seed." }, /internal term/],
    ["a year", { different: "It sits in books, written in the nineteen eighties." }, /year or decade|number/],
    ["a decade", { different: "It sits in books and belongs to an earlier decade than the seed." }, /year or decade/],
    ["lineage", { why: "Invented Pick 7 was influenced by older work and shares Fixture Tag 3 and Fixture Tag 4." }, /lineage/],
    ["a name outside the path", { why: "Invented Work 1 and Invented Pick 7 share the themes Fixture Tag 3 and Fixture Tag 4, as in the work of Somebody Else." }, /not in the path/],
    ["markup", { why: "Invented Work 1 and Invented Pick 7 share **Fixture Tag 3** and Fixture Tag 4." }, /markup/],
    ["a link", { why: "See https://example.com for Fixture Tag 3 and Invented Pick 7." }, /markup/],
    ["a tag id", { why: "Invented Pick 7 carries urn:tag:fixture:theme:t3 with Invented Work 1." }, /markup/],
    ["no shared tag named", { why: "Invented Work 1 and Invented Pick 7 sit near each other." }, /none of the shared tags/],
    ["invented description", { why: "Invented Pick 7 and Invented Work 1 share Fixture Tag 3, with a brooding nocturnal minimalist atmosphere." }, /descriptive words/],
    ["empty", { why: "  " }, /empty/],
    ["too long", { why: `Invented Work 1 and Invented Pick 7 share Fixture Tag 3. ${"It goes on. ".repeat(60)}` }, /longer than/],
  ];
  for (const [name, patch, expected] of refused) {
    it(`refuses ${name}`, () => {
      expect(validateLines({ ...good, ...patch }, base).join("; ")).toMatch(expected);
    });
  }

  it("refuses the wrong number for the themes", () => {
    const one = { ...base, themeTags: ["Fixture Tag 3"] };
    expect(validateLines({ ...good, why: "Invented Work 1 and Invented Pick 7 share the themes Fixture Tag 3." }, one).join(";")).toMatch(/plural for one theme/);
    expect(validateLines({ ...good, why: "Invented Work 1 and Invented Pick 7 share the theme Fixture Tag 3 and Fixture Tag 4." }, base).join(";")).toMatch(/singular for several/);
  });

  it("refuses a different line that restates the why line, comparing words outside the path names", () => {
    const why = "Invented Work 1 and Invented Pick 7 share the themes Fixture Tag 3 and Fixture Tag 4.";
    expect(validateLines({ why, different: "Invented Pick 7 and Invented Work 1 share the themes Fixture Tag 4 and Fixture Tag 3." }, base).join(";")).toMatch(/restates why/);
    // Sharing only path names is not a restatement.
    expect(validateLines({ why, different: "Fixture Tag 3 appears in Invented Pick 7 within books." }, base).join(";")).not.toMatch(/restates/);
  });

  it("refuses text that restates the retrieved lineage line, compared after folding", () => {
    const i = { ...base, lineage: { text: "Influenced by Invented Elder", source: "Qloo", touchesSeed: false } };
    expect(validateLines({ ...good, why: `${good.why} influenced   by invented elder` }, i).length).toBeGreaterThan(0);
  });

  it("lets a name or tag that contains a banned word through when it is a path name, and masks on word boundaries only", () => {
    const i: ExplainInput = { ...base, themeTags: ["Popular Culture", "Stretch Marks"], seed: { label: "Love Story 2", field: "film", why: null } };
    expect(
      validateLines(
        {
          why: "Love Story 2 and Invented Pick 7 share the themes Popular Culture and Stretch Marks. Tracing them into books may help you notice them in Love Story 2.",
          different: "This sits in books while the seed sits in film, and only the named themes link them.",
        },
        i,
      ),
    ).toEqual([]);
    // "heart" is not masked by a name "art", and a name under 3 characters masks nothing.
    expect(maskNames("A heart and an art", ["art"])).toBe("A heart and an  ");
    expect(maskNames("A go-between", ["Go"])).toBe("A go-between");
  });

  it("does not refuse ordinary words that only look internal", () => {
    // band, floor, reach, stretch, anchor, signal, pool and weight alone are ordinary words.
    const text = "The band plays on the floor, within reach of a stretch of signal, a pool of anchor weight.";
    expect(checkText(text, { allowed: [], maxChars: 300 })).toEqual([]);
  });

  it("accepts love, roots and heritage as ordinary words, but not praise", () => {
    expect(checkText("A love of rooted heritage shows in Fixture Tag 3.", { allowed: ["Fixture Tag 3"], maxChars: 200 })).toEqual([]);
    expect(checkText("It is a masterpiece.", { allowed: [], maxChars: 200 }).join()).toMatch(/praise/);
  });

  it("echoes the user's own words about the seed", () => {
    const i = { ...base, seed: { ...base.seed, why: "slow quiet kitchen scenes" } };
    const lines = {
      why: "Invented Work 1 and Invented Pick 7 share the themes Fixture Tag 3 and Fixture Tag 4. Tracing them into books may help you notice them in the slow quiet kitchen scenes you love about Invented Work 1.",
      different: good.different,
    };
    expect(validateLines(lines, i)).toEqual([]);
    expect(validateLines(lines, base).join()).toMatch(/descriptive words/);
  });

  it("accepts plain connecting words, forms of the user's words and joined tag names", () => {
    const i = { ...base, themeTags: ["Fixture Tag 3", "Hand-Bound"], seed: { ...base.seed, why: "so versatile" } };
    const lines = {
      why: "Invented Work 1 links to Invented Pick 7 through the themes Fixture Tag 3 and Hand-Bound. Following them may show how the versatility you describe rests on handbound work, rather than the range alone.",
      different: "It adds no tags beyond the named themes, though the overlap is narrower.",
    };
    expect(validateLines(lines, i)).toEqual([]);
  });

  it("keeps ordinary senses of score, frontier, affinity, late, descending and best", () => {
    const i = { ...base, seed: { ...base.seed, why: "a spare piano score for late nights, a descending bass line, at its best on the frontier, an affinity for ritual" } };
    const lines = {
      why: "Invented Work 1 and Invented Pick 7 share the themes Fixture Tag 3 and Fixture Tag 4. Tracing them may help you notice the spare piano score, the late nights and the descending bass line.",
      different: "It sits on the frontier you describe, with an affinity for ritual, at its best in books.",
    };
    expect(validateLines(lines, i)).toEqual([]);
  });

  it("masks a quoted partial echo of the user's words, but not an unquoted or invented one", () => {
    const i = { ...base, seed: { ...base.seed, why: "my rainy-day album from the 90s" } };
    const echo = (why: string) => validateLines({ ...good, why }, i);
    expect(echo(`Invented Work 1, which you called "my rainy-day album", shares the themes Fixture Tag 3 and Fixture Tag 4 with Invented Pick 7.`)).toEqual([]);
    expect(echo(`Invented Work 1, my favourite, shares the themes Fixture Tag 3 and Fixture Tag 4 with Invented Pick 7.`).join()).toMatch(/first person/);
    expect(echo(`Invented Work 1, which you called "my best album", shares the themes Fixture Tag 3 and Fixture Tag 4 with Invented Pick 7.`).join()).toMatch(/first person|praise/);
  });

  it("accepts a form of a tag name and the singular for one named tag among several", () => {
    const i = { ...base, themeTags: ["Melancholy", "Slow Burn"] };
    const ok = (why: string) => validateLines({ ...good, why }, i);
    expect(ok("Invented Work 1 and Invented Pick 7 share a melancholic Slow Burn. Tracing it into books may help you notice it in Invented Work 1.")).toEqual([]);
    expect(ok("Invented Work 1 links to Invented Pick 7 through the theme of Melancholy, alongside Slow Burn.")).toEqual([]);
    expect(ok("Invented Work 1 and Invented Pick 7 share the theme Melancholy and Slow Burn.").join()).toMatch(/singular for several/);
  });

  it("accepts adjectives of place or style but not an unknown name", () => {
    const ok = (different: string) => validateLines({ ...good, different }, base);
    expect(ok("It sits in books, with a Japanese and Gothic side.")).toEqual([]);
    expect(ok("It sits in books, close to the work of Orla Venn.").join()).toMatch(/name that is not in the path/);
  });

  it("still refuses a line that invents several descriptive words", () => {
    const lines = { ...good, why: "Invented Work 1 and Invented Pick 7 share Fixture Tag 3 and Fixture Tag 4, with a calmer, textured mood and a quieter setting." };
    expect(validateLines(lines, base).join()).toMatch(/descriptive words/);
  });

  it("uses the pick-only tag names", () => {
    const i = { ...base, pickOnlyTags: ["Fixture Tag 91"] };
    expect(validateLines({ ...good, different: "Invented Pick 7 also carries Fixture Tag 91 within books." }, i)).toEqual([]);
  });
});

describe("text checks", () => {
  it("restates compares words, not exact strings", () => {
    expect(restates("Carrying the quiet axis into music", "Carrying the quiet axis into music.")).toBe(true);
    expect(restates("Several seeds lean this way, so the search has a direction.", "Carrying Alpha into music.")).toBe(false);
  });
  it("field phrases are allowed to appear capitalised", () => {
    expect(checkText("It leaves music for TV and food and places.", { allowed: Object.values(FIELD_PHRASE), maxChars: 200 })).toEqual([]);
  });
  it("has natural phrases for where a field is", () => {
    expect(FIELD_IN.tv).toBe("on TV");
    expect(FIELD_IN.food_places).toBe("among places to eat and go");
  });
});

describe("fallback text", () => {
  it("agrees in number and states the honest links", () => {
    const one = fallbackLines({ ...base, themeTags: ["Fixture Tag 3"] });
    expect(one.why).toBe("Invented Work 1 and Invented Pick 7 share the theme Fixture Tag 3. Seeing Fixture Tag 3 in books may help you notice it in Invented Work 1.");
    const two = fallbackLines(base);
    expect(two.why).toMatch(/share the themes Fixture Tag 3 and Fixture Tag 4\. Seeing .* may help you notice them in/);
    expect(fallbackLines({ ...base, pick: { label: "P", field: "tv" } }).why).toContain("on TV");
    expect(fallbackLines({ ...base, pick: { label: "P", field: "food_places" } }).why).toContain("among places to eat and go");
    expect(fallbackLines({ ...base, pick: { label: "P", field: "music" } }).why).toContain("in a second work");
  });

  it("builds `different` from the pick-only tags and the distance words, and says so plainly when there are none", () => {
    const d = fallbackLines({ ...base, pickOnlyTags: ["Fixture Tag 91"], distance: [DISTANCE_WORDS.other_field, DISTANCE_WORDS.less_familiar] }).different;
    expect(d).toBe("Invented Pick 7 also carries Fixture Tag 91, which is not among the themes in your profile. It comes from books, a different field from music. It is less familiar territory.");
    expect(fallbackLines({ ...base, pickOnlyTags: ["Fixture Tag 91", "Fixture Tag 92"] }).different).toContain("which are not among the themes");
    expect(fallbackLines(base).different).toBe("The link runs only through Fixture Tag 3 and Fixture Tag 4; the rest of Invented Pick 7 may differ.");
  });
});

describe("lineage sentence", () => {
  const mk = (text: string, seed = "Invented Work 1") => ({ ...base, seed: { ...base.seed, label: seed }, lineage: { text, source: "Qloo", touchesSeed: text.includes(seed) } });
  it("completes '<pick> ...' for each relation", () => {
    const cases: [string, string][] = [
      ["Influenced by Invented Elder", "Qloo lists Invented Pick 7 as influenced by Invented Elder."],
      ["Influenced Invented Younger and Invented Other", "Qloo lists Invented Pick 7 as having influenced Invented Younger and Invented Other."],
      ["Influenced the genres Invented Genre", "Qloo lists Invented Pick 7 as having influenced the genres Invented Genre."],
      ["Influenced other media: Invented Film", "Qloo lists Invented Pick 7 as having influenced other media: Invented Film."],
      ["Listed as a similar brand to Invented Brand", "Qloo lists Invented Pick 7 as a similar brand to Invented Brand."],
      ["Based on Invented Source", "Qloo lists Invented Pick 7 as based on Invented Source."],
      ["Inspired by Invented Muse", "Qloo lists Invented Pick 7 as inspired by Invented Muse."],
    ];
    for (const [label, sentence] of cases) expect(lineageSentence(mk(label))?.text).toBe(sentence);
    expect(lineageSentence(mk("Something unexpected"))?.text).toBe("Qloo lists this about Invented Pick 7: Something unexpected.");
  });
  it("leads when the retrieved names include the seed, and follows otherwise; omitted with no lineage", () => {
    expect(lineageSentence(mk("Influenced Invented Work 1 and Invented Other"))).toMatchObject({ leads: true });
    expect(lineageSentence(mk("Influenced Invented Younger"))).toMatchObject({ leads: false });
    expect(lineageSentence(base)).toBeNull();
  });
});

describe("cards", () => {
  const path: Path = {
    seedId: "seed-1",
    anchor: { contribution: null, source: "tag_overlap" },
    hops: [
      { kind: "seed", label: "Invented Work 1", provenance: "inferred" },
      { kind: "theme", label: "Fixture Tag 3", tags: ["urn:tag:fixture:theme:t3"], provenance: "inferred" },
      { kind: "pick", label: "Invented Pick 7", provenance: "inferred" },
    ],
    sharedTags: ["urn:tag:fixture:theme:t3"],
    distinctive: true,
  };

  it("builds a card whose provenance counts equal the hop counts", () => {
    const card = assembleCard(path, good, base);
    expect(card.provenance).toEqual({ sourced: 0, inferred: 3 });
    expect(isCard(card)).toBe(true);
    const withLineage: Path = {
      ...path,
      hops: [path.hops[0]!, path.hops[1]!, { kind: "lineage", label: "Influenced by Invented Elder", provenance: "sourced", sourceUrl: "https://www.qloo.com/", sourceLabel: "Qloo" }, path.hops[2]!],
    };
    expect(provenanceOf(withLineage)).toEqual({ sourced: 1, inferred: 3 });
    expect(isPath(withLineage)).toBe(true);
  });

  it("puts the sourced lineage sentence after the model's, or first when it names the seed", () => {
    const after = assembleCard(path, good, { ...base, lineage: { text: "Influenced by Invented Elder", source: "Qloo", touchesSeed: false } });
    expect(after.why.startsWith(good.why)).toBe(true);
    expect(after.why).toMatch(/ Qloo lists Invented Pick 7 as influenced by Invented Elder\.$/);
    const first = assembleCard(path, good, { ...base, lineage: { text: "Influenced Invented Work 1", source: "Qloo", touchesSeed: true } });
    expect(first.why.startsWith("Qloo lists Invented Pick 7 as having influenced Invented Work 1. ")).toBe(true);
    expect(first.why.endsWith(good.why)).toBe(true);
  });

  it("builds the explain input from the path only", () => {
    const tagNames = new Map([["urn:tag:fixture:theme:t3", "Fixture Tag 3"]]);
    const i = buildExplainInput(
      {
        id: "pick-1",
        qlooId: "x",
        name: "Invented Pick 7",
        field: "books",
        popularity: 0.123,
        reach: { tagDistance: 0.9, obscurity: 0.8, fieldUnfamiliarity: 0.7, reach: 0.777 },
        connection: 0.555,
        band: "high",
        llmBridged: false,
        origin: "unknown",
        path: { ...path, pickOnlyTags: ["urn:tag:fixture:theme:t91"], distance: ["other_field", "less_familiar"] },
      },
      { tagNames, pickTagNames: new Map([["urn:tag:fixture:theme:t91", "Fixture Tag 91"]]), seedFields: new Map([["seed-1", "music"]]), seedWhys: new Map([["seed-1", "  slow   and quiet "]]), seedNames: ["Invented Work 1"] },
    );
    expect(i).toEqual({
      pickId: "pick-1",
      seed: { label: "Invented Work 1", field: "music", why: "slow and quiet" },
      themeTags: ["Fixture Tag 3"],
      pickOnlyTags: ["Fixture Tag 91"],
      distance: [DISTANCE_WORDS.other_field, DISTANCE_WORDS.less_familiar],
      lineage: null,
      pick: { label: "Invented Pick 7", field: "books" },
      anchorBasis: "shared_tags",
    });
    expect(JSON.stringify(i)).not.toMatch(/0\.123|0\.777|0\.555/);
  });

  it("omits the lineage when its source is unknown, and leaves out a pick whose path names no theme", async () => {
    const unknownSource: Path = { ...path, hops: [path.hops[0]!, path.hops[1]!, { kind: "lineage", label: "Influenced by X", provenance: "sourced", sourceUrl: "https://example.org/x" }, path.hops[2]!] };
    const mkPick = (p: Path, id: string) => ({ id, qlooId: id, name: "Invented Pick 7", field: "books" as const, popularity: 0, reach: { tagDistance: 0, obscurity: 0, fieldUnfamiliarity: 0, reach: 0 }, connection: 0, band: "high" as const, llmBridged: false, origin: "unknown" as const, path: p });
    const ctx = { tagNames: new Map([["urn:tag:fixture:theme:t3", "Fixture Tag 3"]]), pickTagNames: new Map(), seedFields: new Map(), seedWhys: new Map(), seedNames: [] };
    expect(buildExplainInput(mkPick(unknownSource, "a"), ctx).lineage).toBeNull();
    const noTheme: Path = { ...path, sharedTags: [], hops: [path.hops[0]!, { kind: "theme", label: "  ", provenance: "inferred" }, path.hops[2]!] };
    const out = await explainDomain("books", [mkPick(path, "keep"), mkPick(noTheme, "drop")], new Map(), { ...ctx, llm: disabledLlm, checkAbort: () => {}, emit: () => {}, now: () => new Date() });
    expect(out.picks.map((p) => p.id)).toEqual(["keep"]);
    expect(out.fallbacks.join()).toMatch(/1 left out/);
  });
});

describe("explanations in a run", () => {
  it("sends the model each pick's path, pick-only tags and distance words, and nothing else about the entity", async () => {
    // Every candidate carries a generic tag (91), a tag of its own (100 + i), a description, and a profile tag.
    const qloo = fakeQloo((c) =>
      pool(c.domain, { tagsOf: (i) => [(i % 8) + 1, 91, 100 + i], propertiesOf: () => ({ description: "SECRET-DESCRIPTION-TEXT", tagline: "SECRET-TAGLINE" }) }),
    );
    const model = fakeAnthropic();
    const { result } = await runWorld({ qloo, llm: modelFor(model) });
    const calls = model.calls.filter((c) => c.tool === "write_cards");
    expect(calls).toHaveLength(6);
    const picks = new Map(result.domains.flatMap((d) => d.picks).map((p) => [p.name, p]));
    const profileNames = new Map(input().profile.tags.map((t) => [t.tag, t.name]));
    const seedWhy = new Map(input().seeds.map((s) => [s.typed, s.why]));
    const allowedKeys = ["anchorBasis", "distance", "pick", "pickOnlyTags", "ref", "seed", "themeTags"];
    for (const call of calls) {
      const text = JSON.stringify(call.user);
      expect(text).not.toMatch(/SECRET|Fixture Tag 91|popularity|reach|connection|affinity|explainab|00000000-0000-4000/);
      for (const p of call.user.picks as { ref: string; seed: { name: string; field: string; whyTheUserLovesIt?: string }; pick: { name: string }; themeTags: string[]; pickOnlyTags?: string[]; distance?: string[] }[]) {
        expect(Object.keys(p).every((k) => allowedKeys.includes(k))).toBe(true);
        expect(p.ref).toMatch(/^p\d+$/);
        expect(Object.keys(p.seed).every((k) => ["name", "field", "whyTheUserLovesIt"].includes(k))).toBe(true);
        expect(Object.keys(p.pick).sort()).toEqual(["field", "name"]);
        const stored = picks.get(p.pick.name)!;
        // The theme tags sent are exactly names of the stored path's shared tags.
        expect(p.themeTags).toEqual([...new Set(stored.path.sharedTags.map((t) => profileNames.get(t)!))].slice(0, 5));
        // The pick-only tag is the pick's own tag (never the generic one), and only that.
        expect(stored.path.pickOnlyTags).toHaveLength(1);
        expect(p.pickOnlyTags).toHaveLength(1);
        expect(p.pickOnlyTags![0]).toMatch(/^Fixture Tag 1\d\d$/);
        // The seed's why is the user's own words from the request.
        expect(p.seed.whyTheUserLovesIt).toBe(seedWhy.get(p.seed.name));
        // Distance words only, from the path.
        for (const w of p.distance ?? []) expect(Object.values(DISTANCE_WORDS)).toContain(w);
        expect(p.distance ?? []).toEqual((stored.path.distance ?? []).map((d) => DISTANCE_WORDS[d]));
      }
    }
  });

  it("computes path.distance in code from the reach parts and the fields, and adds the hints to the stored path", async () => {
    const { result } = await runWorld({ qloo: fakeQloo(), llm: disabledLlm });
    const seedFieldOf = new Map(input().seeds.map((s) => [s.id, s.field]));
    for (const p of result.domains.flatMap((d) => d.picks)) {
      const d = p.path.distance ?? [];
      expect(d.includes("other_field")).toBe(seedFieldOf.get(p.path.seedId) !== p.field);
      expect(d.includes("farther_from_tags")).toBe(p.reach.tagDistance >= 0.6);
      expect(isPath(p.path)).toBe(true);
    }
  });

  it("keeps the lineage claim sourced and separate, in the path and in the card", async () => {
    const qloo = fakeQloo((c) => (c.domain === "film" ? pool("film", { propertiesOf: (i) => (i % 3 === 0 ? { influenced_other_media: ["Invented Work 2", "Invented Elder"] } : undefined) }) : pool(c.domain)));
    const model = fakeAnthropic();
    const { result, events } = await runWorld({ qloo, llm: modelFor(model) });
    const film = result.domains.find((d) => d.domain === "film")!;
    const withHop = film.picks.filter((p) => p.path.hops.some((h) => h.kind === "lineage"));
    expect(withHop.length).toBeGreaterThan(0);
    for (const p of withHop) {
      expect(isPath(p.path)).toBe(true);
      expect(p.path.hops.map((h) => h.kind)).toEqual(["seed", "theme", "lineage", "pick"]);
      const hop = p.path.hops[2]!;
      expect(hop).toMatchObject({ provenance: "sourced", sourceLabel: "Qloo" });
      expect(hop.sourceUrl).toBeTruthy();
      expect(p.path.distinctive).toBe(true);
      expect(p.card.provenance).toEqual({ sourced: 1, inferred: 3 });
      // The retrieved names include the seed, so the attributed sentence leads, then the model's sentences follow.
      expect(p.card.why).toMatch(/^Qloo lists .* as having influenced other media: .*Invented Work 2.*\. /);
      const rest = p.card.why.replace(/^Qloo lists [^.]*\. /, "");
      expect(rest).not.toMatch(/influenc/i);
      const sent = model.calls.filter((c) => c.tool === "write_cards").flatMap((c) => c.user.picks as { pick: { name: string }; retrievedLineage?: { source: string } }[]);
      expect(sent.find((s) => s.pick.name === p.name)?.retrievedLineage?.source).toBe("Qloo");
    }
    for (const p of film.picks.filter((x) => !withHop.includes(x))) expect(p.card.why).not.toMatch(/Qloo lists|influenc/i);
    const refs = events.find((e) => e.kind === "fetch_refs");
    expect(refs).toMatchObject({ kind: "fetch_refs", inferredCount: 0 });
    expect((refs as { sourcedCount: number }).sourcedCount).toBeGreaterThan(0);
    const urls = new Set((refs as { sourceUrls: string[] }).sourceUrls);
    for (const p of result.domains.flatMap((d) => d.picks)) for (const h of p.path.hops) if (h.provenance === "sourced") expect(urls.has(h.sourceUrl!)).toBe(true);
  });

  it("replaces refused lines with deterministic text from the same path and records it", async () => {
    const boastful: ModelResponder = (tool, user, system) => {
      if (tool !== "write_cards") return goodModel(tool, user, system);
      const picks = user.picks as { ref: string; seed: { name: string }; pick: { name: string }; themeTags: string[] }[];
      return {
        cards: picks.map((p, i) => ({
          ref: p.ref,
          why: i % 2 === 1 ? `I love ${p.pick.name}, a great pick at 95 percent.` : (goodModel(tool, user, system)!.cards as { why: string }[])[i]!.why,
          different: "Only the named themes link the two, and that is the whole link.",
        })),
      };
    };
    const { result } = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic(boastful)) });
    expect(result.meta.fallbacks.some((f) => /^cards:\w+:\d+ lines$/.test(f))).toBe(true);
    for (const p of result.domains.flatMap((d) => d.picks)) {
      expect(p.card.why).not.toMatch(/\bI love\b|great|95/);
      expect(isCard(p.card)).toBe(true);
    }
  });

  it("falls back for the whole domain when the model call fails, and for picks the model skipped", async () => {
    const skipping: ModelResponder = (tool, user, system) => (tool !== "write_cards" ? goodModel(tool, user, system) : { cards: [] });
    const { result } = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic(skipping)) });
    for (const p of result.domains.flatMap((d) => d.picks)) {
      expect(p.card.why.length).toBeGreaterThan(10);
      expect(p.card.why).toContain(p.name);
    }
    const down = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic(() => undefined)) });
    expect(down.result.meta.fallbacks).toEqual(expect.arrayContaining(["themes", "cards:music", "cards:fashion"]));
    expect(down.result.meta.anthropic.failures).toBeGreaterThan(0);
    for (const p of down.result.domains.flatMap((d) => d.picks)) expect(isCard(p.card)).toBe(true);
  });

  it("never lets an internal term, a number or a first-person claim reach a card, from any model output", async () => {
    const run = await runWorld({ qloo: fakeQloo(), llm: modelFor(fakeAnthropic()) });
    const none = await runWorld({ qloo: fakeQloo(), llm: disabledLlm });
    for (const r of [run, none]) {
      for (const p of r.result.domains.flatMap((d) => d.picks)) {
        for (const text of [p.card.why, p.card.different]) {
          const masked = text.split(p.name).join("").split(p.path.hops[0]!.label).join("").replace(/Fixture Tag \d+/g, "");
          expect(masked).not.toMatch(/\d/);
          expect(masked).not.toMatch(/\b(floor|score|rank|popular\w*|frontier|calibration)\b/i);
          expect(masked).not.toMatch(/\b(I|my|we)\b/);
        }
      }
    }
  });

  it("a tag id in a fixture is shaped urn:tag:fixture", () => {
    expect(tg(3)).toMatch(/^urn:tag:fixture:/);
  });
});

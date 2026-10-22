// Server-render smoke tests for the list, the calibration row, the field toggles and the reasoning area. No browser
// here, so clicks, focus, hover and layout are not covered: those are checked by hand on /picks/preview (see the
// Handoff).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_INPUTS, FIXTURE_SEEDS, makeFixtureResult } from "./fixture";
import { FieldToggles } from "./FieldToggles";
import { createPicksDerivation } from "./derive";
import { PickTile } from "./PickTile";
import { ReasoningArea, SourcesBlock } from "./ReasoningArea";
import { sourcesOf } from "./reasoning";
import { SuggestionList } from "./SuggestionList";
import { edgeSuggestions } from "./suggestions";
import type { PublicPick } from "./types";

const result = makeFixtureResult();
const derived = createPicksDerivation()({ result, hidden: [], notMe: [], seeds: FIXTURE_SEEDS, axes: FIXTURE_INPUTS.axes });
const view = derived.view;
const axisOf = new Map([...derived.placements].map(([id, p]) => [id, p.axis] as const));
const noop = () => {};
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
/** Words that would turn taste into a score or a ranking, or name the connection strength, anywhere on screen. */
const NO_SCORE_WORDS = /\b(score|scores|scored|rank|ranked|ranking|percent|percentage|stars?|strong|steady|light)\b|%/i;

const listFor = (sort: "field" | "stretch") => edgeSuggestions(view.decks, sort);
const listHtml = (extra: Partial<Parameters<typeof SuggestionList>[0]> = {}) => {
  const picks = extra.picks ?? listFor(extra.sort ?? "field");
  return html(
    createElement(SuggestionList, {
      picks,
      sort: "field",
      onSort: noop,
      selectedId: null,
      checked: [],
      chartCount: 0,
      axisOf,
      onOpen: noop,
      onCheck: noop,
      onClear: noop,
      onViewChart: noop,
      ...extra,
    }),
  );
};

describe("SuggestionList", () => {
  const list = listFor("field");

  it("has one row per suggestion, each with a checkbox and a name", () => {
    const out = listHtml();
    expect(out.match(/type="checkbox"/g)).toHaveLength(20);
    for (const p of list) {
      expect(out).toContain(p.name);
      expect(out).toContain(`aria-label="Show ${p.name} on the chart"`);
    }
  });

  it("sorted by field: a heading per field, and each row says where it sits and its stretch, not its field", () => {
    const out = listHtml();
    for (const label of ["Music", "Film", "TV", "Books", "Food and places"]) expect(out).toMatch(new RegExp(`<h3[^>]*>(<svg.*?</svg>)?${label}</h3>`));
    expect(out.match(/<h3/g)).toHaveLength(5);
    const p = list[0];
    expect(out).toContain(`Beside ${axisOf.get(p.id)} · ${["Low", "Medium", "High"].find((w) => out.includes(`${w} stretch`))} stretch`.replace(/ · \w+ stretch$/, ""));
    expect(out).toMatch(/Beside [^<·]+ · (Low|Medium|High) stretch/);
    // The field word is on the heading only: the row detail does not repeat it.
    expect(out).not.toMatch(/class="[^"]*detail[^"]*">Music/);
  });

  it("sorted by stretch: a heading per stretch word, and each row says its field and where it sits", () => {
    const out = listHtml({ sort: "stretch" });
    expect(out.match(/<h3[^>]*>[^<]*stretch<\/h3>/g)).toHaveLength(3);
    expect(out).toMatch(/>Music · Beside [^<]+</);
  });

  it("offers only the field and stretch sorts, with the chosen one pressed", () => {
    const out = listHtml({ sort: "stretch" });
    expect(out).toMatch(/aria-pressed="false"[^>]*>Field</);
    expect(out).toMatch(/aria-pressed="true"[^>]*>Stretch</);
    expect(out).not.toMatch(/sort by (score|rank|match|strength)/i);
  });

  it("shows no score, rank, percentage or connection word anywhere (hard rule 7)", () => {
    const out = listHtml({ checked: [list[0].id, list[1].id], chartCount: 2, selectedId: list[0].id });
    expect(out).not.toMatch(NO_SCORE_WORDS);
    // The strength words are in the data, but not on the screen.
    expect(list.some((p) => p.strength === "strong")).toBe(true);
  });

  it("marks the open row, ticks the ticked ones, and shows the count, Clear and the bottom bar only when something is on the chart", () => {
    const none = listHtml();
    expect(none).not.toContain("on the chart</span>");
    expect(none).not.toContain(">Clear<");
    expect(none).not.toContain(">View chart<");
    const some = listHtml({ checked: [list[2].id, list[3].id], chartCount: 3, selectedId: list[2].id });
    expect(some).toContain("3 suggestions on the chart");
    expect(some.match(/>Clear</g)).toHaveLength(2); // the toolbar (from 64rem) and the bar (below it)
    expect(some).toContain(">View chart<");
    expect(some.match(/aria-current="true"/g)).toHaveLength(1);
    expect(some.match(/ checked=""/g)).toHaveLength(2);
  });

  it("says 'Open, on the chart' on the open row only while it is not ticked, so the checkbox and the count agree", () => {
    const open = list[4].id;
    expect(listHtml({ selectedId: open, chartCount: 1 })).toContain("Open, on the chart");
    expect(listHtml({ selectedId: open, checked: [open], chartCount: 1 })).not.toContain("Open, on the chart");
    expect(listHtml({ selectedId: null, checked: [open], chartCount: 1 })).not.toContain("Open, on the chart");
    expect(listHtml({ selectedId: open, chartCount: 1 }).match(/Open, on the chart/g)).toHaveLength(1);
  });

  it("renders no group at all when every field is hidden", () => {
    expect(listHtml({ picks: [] })).not.toContain("<ul");
  });
});

describe("PickTile (calibration row)", () => {
  const pick = view.calibration[0].pick;
  const row = (extra: Partial<Parameters<typeof PickTile>[0]> = {}) => html(createElement(PickTile, { pick, selected: false, onSelect: noop, kicker: "Same field as Paper Lanterns", onNotMe: noop, ...extra }));

  it("is one compact row: name, field and what it is close to, with a Not me control", () => {
    const out = row();
    expect(out).toContain(pick.name);
    expect(out).toContain("Music · Same field as Paper Lanterns");
    expect(out).toContain(">Not me<");
    expect(out).not.toMatch(NO_SCORE_WORDS);
  });

  it("marks the open row with aria-current", () => {
    expect(row({ selected: true })).toContain('aria-current="true"');
  });
});

describe("FieldToggles", () => {
  it("is one row: a Fields label, then a button per field, with the word Hidden only on a hidden one", () => {
    const out = html(createElement(FieldToggles, { fields: ["music", "film"], hidden: ["film"], onToggle: noop }));
    expect(out.match(/<button/g)).toHaveLength(2);
    expect(out).toContain(">Fields<");
    expect(out.match(/>Hidden</g)).toHaveLength(1);
    expect(out).toMatch(/aria-pressed="true"[^>]*><span>Music</);
    expect(out).toMatch(/aria-pressed="false"[^>]*><span>Film</);
  });
});

const area = (extra: Partial<Parameters<typeof ReasoningArea>[0]> = {}) =>
  html(
    createElement(ReasoningArea, {
      selected: null,
      card: null,
      axes: FIXTURE_INPUTS.axes,
      alsoShown: 0,
      saver: { status: "idle" },
      onReact: noop,
      onClose: noop,
      onViewChart: noop,
      cardRef: null,
      ...extra,
    }),
  );
const edge = listFor("field");
const lineagePick = () => edge.find((p) => p.path.hops.some((h) => h.kind === "lineage")) as PublicPick;
const plainPick = () => edge.find((p) => !p.path.hops.some((h) => h.kind === "lineage")) as PublicPick;

describe("ReasoningArea", () => {
  it("says how to select when nothing is selected, under a plain label, and is not a scroll region", () => {
    const out = area();
    expect(out).toContain("Select a suggestion in the list or on the chart");
    expect(out).toContain('aria-label="Reasoning"');
    expect(out).not.toContain("tabindex");
  });

  it("for a selected pick shows the placement line, a View chart button, and the card, and no trace", () => {
    const pick = lineagePick();
    const out = area({ selected: pick, card: pick.card });
    expect(out).toMatch(/On the chart: beside [^<]+, at (low|medium|high) stretch\./);
    expect(out).toContain(">View chart<");
    expect(out).toContain(pick.card.why);
    expect(out).toContain("The path back to you");
    expect(out).not.toContain("tabindex");
    expect(out).not.toMatch(/Latest step|Read all steps|Reasoning steps|Compare with a plain model/);
  });

  it("puts the sources between the card and the save notice", () => {
    const pick = lineagePick();
    const out = area({ selected: pick, card: pick.card });
    const card = out.indexOf("</article>");
    const sources = out.indexOf('id="sources-heading"');
    const notice = out.indexOf('role="status" aria-live="polite"');
    expect(card).toBeGreaterThan(0);
    expect(sources).toBeGreaterThan(card);
    expect(notice).toBeGreaterThan(sources);
  });

  it("draws no sources block for a pick with nothing retrieved, and no 'none' line", () => {
    const pick = plainPick();
    const out = area({ selected: pick, card: pick.card });
    expect(out).not.toContain("sources-heading");
    expect(out).not.toMatch(/No retrieved source|connecting steps? (is|are) inferred/);
  });

  it("says where a calibration pick sits without a stretch word", () => {
    const pick = view.calibration[0].pick;
    expect(area({ selected: pick, card: pick.card })).toMatch(/On the chart: beside [^<]+, very close to what you named\./);
  });

  it("notes the other suggestions on the chart with it", () => {
    const pick = edge[0];
    expect(area({ selected: pick, card: pick.card, alsoShown: 3 })).toContain("3 other suggestions are on the chart with it.");
    expect(area({ selected: pick, card: pick.card, alsoShown: 0 })).not.toContain("other suggestion");
  });

  it("shows no score, rank, percentage or connection word, empty or open, for every pick (hard rule 7)", () => {
    expect(area()).not.toMatch(NO_SCORE_WORDS);
    for (const pick of [...edge, ...view.calibration.map((c) => c.pick)]) {
      const out = area({ selected: pick, card: pick.card, alsoShown: 2 });
      // The card's own legend and the reaction form are the card's; look at what this area adds around it.
      const around = out.replace(/<article[\s\S]*<\/article>/, "");
      expect(around, pick.name).not.toMatch(NO_SCORE_WORDS);
      expect(out, pick.name).not.toMatch(/\b(score|scores|rank|ranked|ranking|percent|percentage)\b|%/i);
    }
  });
});

describe("SourcesBlock", () => {
  const block = (sources: Parameters<typeof SourcesBlock>[0]["sources"]) => html(createElement(SourcesBlock, { sources }));

  it("sourced and inferred together: lists the sourced step with its word, kind and source, and nothing inferred", () => {
    const pick = lineagePick();
    expect(pick.path.hops.some((h) => h.kind === "theme" && h.provenance === "inferred")).toBe(true);
    const out = block(sourcesOf(pick));
    expect(out).toContain(">Sources</h3>");
    expect(out).toContain(">Sourced<");
    expect(out).toContain("Lineage, a reading");
    expect(out).toMatch(/View source|Source: /);
    expect(out).not.toMatch(/Inferred|inferred/);
    const theme = pick.path.hops.find((h) => h.kind === "theme");
    expect(out).not.toContain(theme?.label ?? "never");
  });

  it("a reading only: shows the reading note with its label and its link", () => {
    const pick = plainPick();
    const sources = sourcesOf({ ...pick, card: { ...pick.card, reading: { text: "A reading.", sourceUrl: "https://example.org/mock", sourceLabel: "Mock source" } } } as PublicPick);
    expect(sources.sourced).toEqual([]);
    const out = block(sources);
    expect(out).toContain("A reading is included, taken from retrieved text.");
    expect(out).toContain("Source: Mock source");
    expect(out).toContain('href="https://example.org/mock"');
    expect(out).not.toContain(">Sourced<");
    expect(out).not.toContain("<ul");
  });

  it("an all-inferred path with a reading: the reading shows, no sourced item and no inferred count", () => {
    const pick = plainPick();
    expect(pick.path.hops.some((h) => h.provenance === "sourced")).toBe(false);
    const out = area({ selected: { ...pick, card: { ...pick.card, reading: { text: "A reading.", sourceUrl: "https://example.org/mock" } } } as PublicPick, card: { ...pick.card, reading: { text: "A reading.", sourceUrl: "https://example.org/mock" } } });
    const sources = out.slice(out.indexOf('id="sources-heading"'));
    expect(sources).toContain("A reading is included");
    expect(sources).not.toContain(">Sourced<");
    expect(sources).not.toMatch(/inferred/i);
  });

  it("draws nothing at all when nothing was retrieved", () => {
    expect(block({ sourced: [], reading: null })).toBe("");
  });
});

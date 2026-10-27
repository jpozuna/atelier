// Server-render smoke tests for the list, the calibration row and the reasoning area. No browser
// here, so clicks, focus, hover and layout are not covered: those are checked by hand on /picks/preview (see the
// Handoff).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_INPUTS, FIXTURE_SEEDS, makeFixtureResult } from "./fixture";
import { createPicksDerivation } from "./derive";
import { PickTile } from "./PickTile";
import { PicksScreen } from "./PicksScreen";
import { ReasoningArea, SourcesBlock } from "./ReasoningArea";
import { sourcesOf } from "./reasoning";
import { serializeStored, sessionKey } from "./storage";
import { ChartBar, SuggestionList } from "./SuggestionList";
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

const listFor = () => edgeSuggestions(view.decks);
const listHtml = (extra: Partial<Parameters<typeof SuggestionList>[0]> = {}) => {
  const picks = extra.picks ?? listFor();
  return html(
    createElement(SuggestionList, {
      picks,
      selectedId: null,
      checked: [],
      chartCount: 0,
      axisOf,
      onOpen: noop,
      onCheck: noop,
      onClear: noop,
      ...extra,
    }),
  );
};

describe("SuggestionList", () => {
  const list = listFor();

  it("has one row per suggestion, each with a checkbox and a name", () => {
    const out = listHtml();
    expect(out.match(/type="checkbox"/g)).toHaveLength(20);
    for (const p of list) {
      expect(out).toContain(p.name);
      expect(out).toContain(`aria-label="Show ${p.name} on the chart"`);
    }
  });

  it("lists by field: a heading per field, and each row says where it sits and its stretch, not its field", () => {
    const out = listHtml();
    for (const label of ["Music", "Film", "TV", "Books", "Food and places"]) expect(out).toMatch(new RegExp(`<h3[^>]*>(<svg.*?</svg>)?${label}</h3>`));
    expect(out.match(/<h3/g)).toHaveLength(5);
    const p = list[0];
    expect(out).toContain(`Beside ${axisOf.get(p.id)} · ${["Low", "Medium", "High"].find((w) => out.includes(`${w} stretch`))} stretch`.replace(/ · \w+ stretch$/, ""));
    expect(out).toMatch(/Beside [^<·]+ · (Low|Medium|High) stretch/);
    // The field word is on the heading only: the row detail does not repeat it.
    expect(out).not.toMatch(/class="[^"]*detail[^"]*">Music/);
  });

  it("has no sort control and no field-toggle row: the chart key filters fields", () => {
    const out = listHtml();
    expect(out).not.toMatch(/Sort by|>Fields<|>Hidden<|aria-pressed/);
    expect(out).not.toMatch(/stretch<\/h3>/); // no heading per stretch word
    expect(out.match(/<button/g)).toHaveLength(list.length); // the rows' open buttons only
  });

  it("shows no score, rank, percentage or connection word anywhere (hard rule 7)", () => {
    const out = listHtml({ checked: [list[0].id, list[1].id], chartCount: 2, selectedId: list[0].id });
    expect(out).not.toMatch(NO_SCORE_WORDS);
    // The strength words are in the data, but not on the screen.
    expect(list.some((p) => p.strength === "strong")).toBe(true);
  });

  it("marks the open row, ticks the ticked ones, and shows the count and Clear only when something is on the chart", () => {
    const none = listHtml();
    expect(none).not.toContain("on the chart</span>");
    expect(none).not.toContain(">Clear<");
    const some = listHtml({ checked: [list[2].id, list[3].id], chartCount: 3, selectedId: list[2].id });
    expect(some).toContain("3 suggestions on the chart");
    expect(some.match(/>Clear</g)).toHaveLength(1); // the toolbar (from 64rem); the phone bar is the screen's, not the list's
    expect(some).not.toContain(">View chart<");
    expect(some.match(/aria-current="true"/g)).toHaveLength(1);
    expect(some.match(/ checked=""/g)).toHaveLength(2);
  });

  it("has a bottom bar of its own, drawn only while something is on the chart", () => {
    expect(html(createElement(ChartBar, { chartCount: 0, onViewChart: noop, onClear: noop }))).toBe("");
    const bar = html(createElement(ChartBar, { chartCount: 2, onViewChart: noop, onClear: noop }));
    expect(bar).toContain("2 suggestions on the chart");
    expect(bar).toContain(">View chart<");
    expect(bar).toContain(">Clear<");
  });

  it("says how many suggestions there are, and has no scrolling box or 'more below' cue of its own", () => {
    const out = listHtml();
    expect(out).toContain(`${list.length} suggestions.`);
    expect(out).not.toMatch(/More below|data-more|in a list that scrolls/);
  });

  it("says 'Open, on the chart' on the open row only while it is not ticked, so the checkbox and the count agree", () => {
    const open = list[4].id;
    expect(listHtml({ selectedId: open, chartCount: 1 })).toContain("Open, on the chart");
    expect(listHtml({ selectedId: open, checked: [open], chartCount: 1 })).not.toContain("Open, on the chart");
    expect(listHtml({ selectedId: null, checked: [open], chartCount: 1 })).not.toContain("Open, on the chart");
    expect(listHtml({ selectedId: open, chartCount: 1 }).match(/Open, on the chart/g)).toHaveLength(1);
  });

  it("puts the heading first, then the lede, the status line and the rows, with the notice after the rows", () => {
    const out = listHtml({
      heading: createElement("h2", { id: "heading-probe" }, "heading"),
      lede: createElement("p", { id: "lede-probe" }, "lede"),
      status: createElement("p", { id: "status-probe" }, "status"),
      notice: createElement("p", { id: "notice-probe" }, "notice"),
    });
    const at = (needle: string) => {
      const i = out.indexOf(needle);
      expect(i, needle).toBeGreaterThan(0);
      return i;
    };
    const heading = at('id="heading-probe"');
    const lede = at('id="lede-probe"');
    const status = at('id="status-probe"');
    const rows = at("<h3");
    const notice = at('id="notice-probe"');
    expect(heading).toBeLessThan(lede);
    expect(lede).toBeLessThan(status);
    expect(status).toBeLessThan(rows);
    expect(rows).toBeLessThan(notice);
    expect(out.indexOf('aria-label="Suggestions at the edge of your taste"')).toBeLessThan(notice);
    expect(out.indexOf('aria-label="Suggestions at the edge of your taste"')).toBeGreaterThan(status);
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
const edge = listFor();
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

  it("leads and ends the card with a Back to suggestions control, and has no Close button", () => {
    const pick = lineagePick();
    const out = area({ selected: pick, card: pick.card });
    expect(out.match(/>Back to suggestions</g)).toHaveLength(2);
    expect(out.indexOf(">Back to suggestions<")).toBeLessThan(out.indexOf("On the chart:"));
    expect(out.lastIndexOf(">Back to suggestions<")).toBeGreaterThan(out.indexOf('id="sources-heading"'));
    expect(out).not.toContain(">Close<");
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

describe("PicksScreen order", () => {
  afterEach(() => vi.unstubAllGlobals());

  // A revisit restores the stored picks on the first render, so the whole screen can be rendered on the server.
  function screenHtml() {
    const key = sessionKey(FIXTURE_INPUTS);
    const raw = serializeStored({ version: 1, key, result, events: [], notMe: [], hidden: [], reactions: {}, reruns: 0 });
    vi.stubGlobal("window", { sessionStorage: { getItem: () => raw, setItem: () => {}, removeItem: () => {} } });
    return html(createElement(PicksScreen, { inputs: FIXTURE_INPUTS }));
  }

  const at = (out: string, needle: string) => {
    const i = out.indexOf(needle);
    expect(i, needle).toBeGreaterThan(0);
    return i;
  };

  it("runs title, chart key, the plot, then the edge suggestions as the first thing in the right column, then the close picks", () => {
    const out = screenHtml();
    const title = at(out, "Beyond your list");
    const key = at(out, "Farther out is less familiar");
    const plot = out.search(/<svg[^>]*role="group"/); // the plot itself; the key's marks are aria-hidden
    expect(plot).toBeGreaterThan(0);
    const figureEnd = at(out, "</figure>");
    const heading = at(out, "At the edge of your taste");
    const rows = at(out, 'aria-label="Suggestions at the edge of your taste"');
    const close = at(out, "Close to what you named");
    expect(title).toBeLessThan(key);
    expect(key).toBeLessThan(plot);
    // Nothing between the chart and the panel's edge section: the list is not above the plot any more.
    expect(plot).toBeLessThan(figureEnd);
    expect(figureEnd).toBeLessThan(heading);
    expect(heading).toBeLessThan(rows);
    expect(rows).toBeLessThan(close);
    // The panel starts with the edge heading: no text sits between the chart's end and it.
    const between = out.slice(figureEnd, heading).replace(/<[^>]*>/g, "");
    expect(between.trim()).toBe("");
  });

  it("has no sort control, no Fields row and no Hidden word; the key entries are the field buttons", () => {
    const out = screenHtml();
    expect(out).not.toMatch(/Sort by|>Fields<|field-toggle|>Hidden</);
    expect(out).toContain('id="chart-key-music"');
    for (const f of ["music", "film", "tv", "books", "food_places"]) expect(out).toContain(`id="chart-key-${f}"`);
    expect(out.match(/id="chart-key-[a-z_]+" [^>]*aria-pressed="true"/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    // The hint sits right above the key (inside the chart's section, before its figure), not in the title row.
    const hint = out.indexOf("Select a field to hide it.");
    expect(hint).toBeGreaterThan(out.indexOf("</h1>"));
    expect(hint).toBeLessThan(out.indexOf("<figure"));
    expect(out).not.toContain("Select a field in the key");
  });

  it("shows the lede line, and the close picks after the suggestions, with no reasoning card while nothing is open", () => {
    const out = screenHtml();
    expect(out).toContain("Stretch is distance from your profile, not a grade. Select one to see its path back to you.");
    // Quiet links to the sections that are far from where the reader is (the phone one is drawn below 64rem only).
    expect(out).toContain(">Close to what you named, below<");
    expect(out).toContain(">Suggestions below<");
    expect(out).not.toContain(">Back to suggestions<");
    expect(out).not.toContain("Select a suggestion in the list or on the chart");
    expect(out.slice(out.indexOf("</figure>"))).not.toContain('aria-label="Reasoning"');
    // A finished, restored run has nothing still coming and no stopped note.
    expect(out).not.toMatch(/Still coming|The run stopped/);
  });
});

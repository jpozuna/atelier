// Server-render smoke tests: the screens produce the markup the design asks for. No browser here, so interaction,
// focus and layout are not covered (see the Handoff).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeFixtureResult } from "@/components/deck/fixture";
import { FollowUp } from "./FollowUp";
import { SaveNotice } from "./SaveNotice";
import { SavedCard } from "./SavedCard";
import { SavedList } from "./SavedList";
import type { SavedItem } from "./groups";
import { AT } from "./testing";

const picks = makeFixtureResult().domains.flatMap((d) => d.picks);
const item = (i: number, state: "explore" | "tried" | "not_interested" | "later", extra: Partial<SavedItem> = {}): SavedItem => ({
  id: picks[i].id,
  name: picks[i].name,
  field: picks[i].field,
  card: { ...picks[i].card, reaction: { state, at: AT, words: `my words ${i}` } },
  savedAt: AT,
  tried: state === "tried",
  how: null,
  ...extra,
});

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("SavedList", () => {
  it("groups by state with a heading each, and links every pick to its stored card", () => {
    const out = html(createElement(SavedList, { items: [item(2, "explore"), item(3, "later"), item(4, "tried", { how: "liked" }), item(5, "not_interested")] }));
    for (const title of ["Explore further", "Save for later", "I tried it", "Not for me"]) expect(out).toContain(`>${title}</h2>`);
    expect(out).not.toContain(">I will try it</h2>");
    // The card's order, not a ranking.
    expect(out.indexOf("Save for later")).toBeLessThan(out.indexOf("Explore further"));
    expect(out.indexOf("Explore further")).toBeLessThan(out.indexOf("I tried it"));
    for (const i of [2, 3, 4, 5]) expect(out).toContain(`href="/saved/${encodeURIComponent(picks[i].id)}"`);
    expect(out).toContain("my words 5");
    expect(out).toContain("You liked it.");
  });

  it("says plainly when nothing is saved, with a way on", () => {
    const out = html(createElement(SavedList, { items: [] }));
    expect(out).toContain("Nothing saved yet");
    expect(out).toContain('href="/picks"');
  });

  it("shows no score, rank or percentage", () => {
    const out = html(createElement(SavedList, { items: picks.slice(0, 8).map((_, i) => item(i, "explore")) }));
    expect(out).not.toMatch(/\b(score|rank|percent)\w*\b|%/i);
  });
});

describe("SaveNotice", () => {
  it("keeps a live region in the DOM, and offers sign-in for a guest and the list after a save", () => {
    expect(html(createElement(SaveNotice, { saver: { status: "idle" } }))).toContain('role="status"');
    const guest = html(createElement(SaveNotice, { saver: { status: "sign_in" } }));
    expect(guest).toContain("To keep this, sign in");
    expect(guest).toContain('href="/auth/sign-in?next=%2Fpicks"');
    const saved = html(createElement(SaveNotice, { saver: { status: "saved" } }));
    expect(saved).toContain('href="/saved"');
    expect(html(createElement(SaveNotice, { saver: { status: "saved" }, showSavedLink: false }))).not.toContain('href="/saved"');
  });
});

describe("SavedCard and FollowUp", () => {
  const saved = item(2, "explore");
  const pick = { id: "p", qlooId: "q", field: "music" as const, name: "Invented", llmBridged: false };
  const follow = (over: Partial<Parameters<typeof FollowUp>[0]> = {}) =>
    html(createElement(FollowUp, { pick, tried: false, how: null, reaction: undefined, source: null, onSaved: () => {}, ...over }));

  it("opens the stored card as the page's one h1, with its four parts and the follow-up questions", () => {
    const out = html(createElement(SavedCard, { item: saved, qlooId: picks[2].qlooId, llmBridged: false, source: null }));
    expect(out.match(/<h1\b/g)).toHaveLength(1);
    expect(out).toMatch(new RegExp(`<h1[^>]*>${picks[2].name}</h1>`));
    for (const part of ["The path back to you", "Why this one", "What is different", "Provenance", "After you try it", "Did you try it?"]) expect(out).toContain(part);
    expect(out).toContain(picks[2].card.why);
    // "Tried" is offered only inside the follow-up, never as a save state on a pick that is not tried.
    expect(out).not.toContain("<span>I tried it</span>");
    expect(out).toContain("<span>Yes, I tried it</span>");
  });

  it("asks how it was only after 'yes', preselects nothing, and marks the answer required", () => {
    expect(follow()).not.toContain("How was it?");
    const yes = follow({ tried: true, how: null, reaction: { state: "tried", at: AT } });
    expect(yes).toContain("How was it?");
    expect(yes).toContain("Required");
    expect(yes).toContain("Why, in your own words");
    expect(yes).toContain('aria-required="true"');
    // No answer given: no radio in the "how" group is checked, so nothing is said for the person.
    const howGroup = yes.slice(yes.indexOf("How was it?"), yes.indexOf("Why, in your own words"));
    expect(howGroup).not.toContain("checked");
    // Nor is an error reserved before there is one.
    expect(yes).not.toContain("role=\"alert\"");
  });

  it("shows the stored answer, and relabels the button Update", () => {
    const out = follow({ tried: true, how: "mixed", reaction: { state: "tried", words: "held up", at: AT } });
    const howGroup = out.slice(out.indexOf("How was it?"), out.indexOf("Why, in your own words"));
    expect(howGroup.match(/checked/g)).toHaveLength(1);
    expect(out).toContain("held up");
    expect(out).toContain(">Update<");
    expect(follow({ tried: true, how: null, reaction: { state: "tried", at: AT } })).toContain(">Save what happened<");
  });

  it("has no follow-up for 'not for me'", () => {
    const notForMe = html(createElement(SavedCard, { item: item(2, "not_interested"), qlooId: picks[2].qlooId, llmBridged: false, source: null }));
    expect(notForMe).not.toContain("After you try it");
  });
});

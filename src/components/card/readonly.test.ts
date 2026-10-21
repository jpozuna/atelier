import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PickCard } from "./PickCard";
import { MOCK_CARDS } from "./mock";

const mock = MOCK_CARDS[0]!;
const props = { card: mock.card, title: "Invented Title", field: mock.field };

describe("PickCard readOnly", () => {
  it("has no reaction area and no form, and keeps the four parts", () => {
    const out = renderToStaticMarkup(createElement(PickCard, { ...props, readOnly: true }));
    expect(out).not.toContain("Your reaction");
    expect(out).not.toContain("<form");
    expect(out).not.toContain("Save reaction");
    for (const part of ["The path back to you", "Why this one", "What is different", "Provenance"]) expect(out).toContain(part);
  });

  it("is the same card up to where the reaction area would start", () => {
    const full = renderToStaticMarkup(createElement(PickCard, props));
    const ro = renderToStaticMarkup(createElement(PickCard, { ...props, readOnly: true }));
    expect(full).toContain("Your reaction");
    expect(ro.endsWith("</article>")).toBe(true);
    expect(full.startsWith(ro.slice(0, -"</article>".length))).toBe(true);
  });
});

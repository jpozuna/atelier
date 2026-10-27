/*
 * T-29: the `aboveStage` slot, checked in real server-rendered markup (real React, no DOM needed).
 * Fixtures are the synthetic chart mocks.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttributeChart } from './AttributeChart';
import type { AttributeChartProps } from './AttributeChart';
import { MOCK_AXES, MOCK_PICKS_6 } from './mock';

const render = (extra: Partial<AttributeChartProps> = {}) =>
  renderToStaticMarkup(createElement(AttributeChart, { axes: MOCK_AXES, picks: MOCK_PICKS_6, ...extra }));

const slot = createElement('div', { 'data-testid': 'above-slot' }, 'Fixture suggestion list');

describe('aboveStage', () => {
  it('renders after the key and before the plot', () => {
    const html = render({ aboveStage: slot });
    const keyEnd = html.indexOf('</figcaption>');
    const at = html.indexOf('data-testid="above-slot"');
    const plot = html.indexOf('<svg', keyEnd); // the key holds its own small marks, so search after it
    expect(keyEnd).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(keyEnd);
    expect(plot).toBeGreaterThan(at);
    expect(html).toContain('Fixture suggestion list');
    expect(html.split('data-testid="above-slot"')).toHaveLength(2); // exactly once
  });

  it('puts the slot inside the figure, as a sibling of the key and the plot', () => {
    const html = render({ aboveStage: slot });
    expect(html).toMatch(/<\/figcaption><div[^>]*><div data-testid="above-slot">/);
    expect(html).toMatch(/Fixture suggestion list<\/div><\/div><div[^>]*><svg/);
  });

  it('renders nothing extra when omitted: the plot follows the key directly', () => {
    const html = render();
    expect(html).toMatch(/<\/figcaption><div[^>]*><svg/);
    expect(html).not.toContain('above-slot');
  });

  it('treats null, false and undefined like omitted', () => {
    const omitted = render();
    expect(render({ aboveStage: null })).toBe(omitted);
    expect(render({ aboveStage: false })).toBe(omitted);
    expect(render({ aboveStage: undefined })).toBe(omitted);
  });

  it('keeps everything else identical apart from the slot wrapper', () => {
    const withSlot = render({ aboveStage: slot });
    const omitted = render();
    const stripped = withSlot.replace(/<div class="[^"]*"><div data-testid="above-slot">Fixture suggestion list<\/div><\/div>/, '');
    expect(stripped).toBe(omitted);
  });

  it('works on an empty chart (no picks) and with no key content', () => {
    const html = render({ picks: [], aboveStage: slot });
    expect(html.indexOf('</figcaption>')).toBeLessThan(html.indexOf('data-testid="above-slot"'));
    expect(html.indexOf('data-testid="above-slot"')).toBeLessThan(html.indexOf('<svg', html.indexOf('</figcaption>')));
  });
});

describe('server render, before any hover', () => {
  it('has no hover card and no per-axis aria-describedby', () => {
    const html = render();
    expect(html).not.toContain('role="tooltip"');
    // The svg group itself is described by its own <desc>; no axis button carries aria-describedby.
    const axisButtons = html.match(/<g[^>]*aria-label="[^"]* axis\. Show its tags"[^>]*>/g) ?? [];
    expect(axisButtons).toHaveLength(MOCK_AXES.length);
    for (const tag of axisButtons) expect(tag).not.toContain('aria-describedby');
  });
});

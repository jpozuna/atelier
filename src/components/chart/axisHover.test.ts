import { describe, expect, it } from 'vitest';
import { AXIS_CARD_EDGE, AXIS_CARD_GAP, AXIS_CARD_WIDTH, estimateCardSize, placeAxisCard } from './AttributeChart';
import type { CardBox } from './AttributeChart';

function overlaps(a: CardBox, b: CardBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(box: CardBox, bounds: { w: number; h: number }): boolean {
  return (
    box.x >= AXIS_CARD_EDGE &&
    box.y >= AXIS_CARD_EDGE &&
    box.x + box.w <= bounds.w - AXIS_CARD_EDGE &&
    box.y + box.h <= bounds.h - AXIS_CARD_EDGE
  );
}

describe('placeAxisCard', () => {
  const card = { w: 240, h: 100 };

  it('never covers a label at the left edge, and stays inside', () => {
    const bounds = { w: 860, h: 700 };
    const anchor = { x: 40, y: 330, w: 120, h: 44 }; // a label at the left edge
    const spot = placeAxisCard(anchor, card, bounds);
    expect(overlaps({ x: spot.x, y: spot.y, ...card }, anchor)).toBe(false);
    expect(inside({ x: spot.x, y: spot.y, ...card }, bounds)).toBe(true);
  });

  it('chooses the side facing away from the centre when there is room', () => {
    const bounds = { w: 860, h: 700 };
    const anchor = { x: 40, y: 330, w: 44, h: 44 };
    // Outward is right, which has no room at x=700 (700+44+8+240 is past 856), so it takes the next side that fits.
    const edge = placeAxisCard({ ...anchor, x: 700 }, card, bounds);
    expect(edge.side).not.toBe('right');
    const roomy = placeAxisCard({ x: 600, y: 330, w: 44, h: 44 }, { w: 120, h: 80 }, bounds);
    expect(roomy.side).toBe('right');
    expect(roomy.x).toBe(600 + 44 + AXIS_CARD_GAP);
  });

  it('keeps the card clear of the axis and inside the box at 390 wide, for anchors all around the rim', () => {
    const bounds = { w: 390, h: 400 };
    const size = estimateCardSize('Slow cinema and quiet rooms', ['one', 'two', 'three', 'four', 'five'], bounds.w - 2 * AXIS_CARD_EDGE);
    expect(size.w).toBeLessThanOrEqual(AXIS_CARD_WIDTH);
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      const anchor = { x: 195 + Math.sin(a) * 160 - 22, y: 200 - Math.cos(a) * 160 - 22, w: 44, h: 44 };
      const spot = placeAxisCard(anchor, size, bounds);
      const box = { x: spot.x, y: spot.y, ...size };
      expect(inside(box, bounds)).toBe(true);
      expect(overlaps(box, anchor)).toBe(false);
    }
  });

  it('keeps the card clear of the axis and inside the box at 1280 for a wide chart', () => {
    const bounds = { w: 860, h: 640 };
    const size = estimateCardSize('Ritual and craft', ['tea', 'ceramics', 'woodwork'], bounds.w);
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2;
      const anchor = { x: 430 + Math.sin(a) * 330 - 60, y: 320 - Math.cos(a) * 270 - 22, w: 120, h: 44 };
      const spot = placeAxisCard(anchor, size, bounds);
      const box = { x: spot.x, y: spot.y, ...size };
      expect(inside(box, bounds)).toBe(true);
      expect(overlaps(box, anchor)).toBe(false);
    }
  });

  it('keeps a tall card (an axis with many tags) inside the box and clear of the axis at 390 wide', () => {
    const bounds = { w: 390, h: 420 };
    const tags = Array.from({ length: 14 }, (_, i) => `quiet tag number ${i}`);
    const size = estimateCardSize('Slow cinema and quiet rooms', tags, bounds.w - 2 * AXIS_CARD_EDGE);
    expect(size.h).toBeGreaterThan(200); // genuinely tall, so a side placement must be judged on height too
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      const anchor = { x: 195 + Math.sin(a) * 160 - 22, y: 210 - Math.cos(a) * 160 - 22, w: 44, h: 44 };
      const spot = placeAxisCard(anchor, size, bounds);
      const box = { x: spot.x, y: spot.y, ...size };
      expect(inside(box, bounds)).toBe(true);
      expect(overlaps(box, anchor)).toBe(false);
    }
  });

  it('does not take a side the card is too tall for, even when it fits across that side', () => {
    const bounds = { w: 390, h: 300 };
    // Wide enough for a right placement by width alone, but taller than the box allows beside the axis.
    const spot = placeAxisCard({ x: 20, y: 120, w: 44, h: 44 }, { w: 200, h: 296 }, bounds);
    const box = { x: spot.x, y: spot.y, w: 200, h: 296 };
    expect(spot.side === 'above' || spot.side === 'below').toBe(false); // neither has room either
    expect(box.y).toBeGreaterThanOrEqual(AXIS_CARD_EDGE);
    expect(box.y + box.h).toBeLessThanOrEqual(bounds.h);
  });

  it('prefers a spot outside the plot disc when there is room, then overlays the plot when there is not', () => {
    const bounds = { w: 390, h: 390 };
    const disc = { x: 195, y: 195, r: 130 };
    const small = { w: 90, h: 50 };
    // An axis in the top-right corner: a small card fits to its left, beyond the disc (a spot below would cover it).
    const anchor = { x: 330, y: 6, w: 44, h: 44 };
    const out = placeAxisCard(anchor, small, bounds, AXIS_CARD_GAP, AXIS_CARD_EDGE, disc);
    const nearest = (b: CardBox) =>
      Math.hypot(Math.min(b.x + b.w, Math.max(b.x, disc.x)) - disc.x, Math.min(b.y + b.h, Math.max(b.y, disc.y)) - disc.y);
    expect(nearest({ x: out.x, y: out.y, ...small })).toBeGreaterThanOrEqual(disc.r);
    expect(overlaps({ x: out.x, y: out.y, ...small }, anchor)).toBe(false);
    // A card as wide as the column cannot avoid the disc, so it still lands inside the box and clear of the axis.
    const wide = { w: 240, h: 100 };
    const over = placeAxisCard(anchor, wide, bounds, AXIS_CARD_GAP, AXIS_CARD_EDGE, disc);
    expect(inside({ x: over.x, y: over.y, ...wide }, bounds)).toBe(true);
    expect(overlaps({ x: over.x, y: over.y, ...wide }, anchor)).toBe(false);
  });

  it('clamps inside the box when no side has room', () => {
    const bounds = { w: 200, h: 120 };
    const spot = placeAxisCard({ x: 80, y: 40, w: 40, h: 40 }, { w: 192, h: 110 }, bounds);
    expect(spot.x).toBeGreaterThanOrEqual(AXIS_CARD_EDGE);
    expect(spot.y).toBeGreaterThanOrEqual(AXIS_CARD_EDGE);
  });
});

describe('estimateCardSize', () => {
  it('never exceeds the room it is given and grows with more tags', () => {
    const narrow = estimateCardSize('A', ['x'], 120);
    expect(narrow.w).toBe(120);
    const few = estimateCardSize('Axis', ['a', 'b'], 400);
    const many = estimateCardSize('Axis', Array.from({ length: 20 }, (_, i) => `tag number ${i}`), 400);
    expect(many.h).toBeGreaterThan(few.h);
  });
});

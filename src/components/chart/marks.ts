import type { Field } from '@/types';

/** Plain-language field names for labels and the text alternative. */
export const FIELD_LABEL: Record<Field, string> = {
  music: 'Music',
  film: 'Film',
  tv: 'TV',
  books: 'Books',
  food_places: 'Food and places',
  fashion: 'Fashion',
};

/** One shape per field, so fields stay distinguishable without color. */
export const FIELD_SHAPE: Record<Field, string> = {
  music: 'circle',
  film: 'square',
  tv: 'triangle',
  books: 'diamond',
  food_places: 'hexagon',
  fashion: 'cross',
};

const f = (v: number) => Math.round(v * 100) / 100;

function poly(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`).join(' ') + ' Z';
}

/** SVG path data for a field's mark, centred on the origin, fitting a circle of radius `r`. */
export function markPath(field: Field, r: number): string {
  switch (field) {
    case 'music':
      return `M${f(-r)} 0 A${f(r)} ${f(r)} 0 1 0 ${f(r)} 0 A${f(r)} ${f(r)} 0 1 0 ${f(-r)} 0 Z`;
    case 'film': {
      const s = r * 0.88;
      return poly([
        [-s, -s],
        [s, -s],
        [s, s],
        [-s, s],
      ]);
    }
    case 'tv':
      return poly([
        [0, -r * 1.05],
        [r * 1.0, r * 0.8],
        [-r * 1.0, r * 0.8],
      ]);
    case 'books':
      return poly([
        [0, -r * 1.15],
        [r * 1.15, 0],
        [0, r * 1.15],
        [-r * 1.15, 0],
      ]);
    case 'food_places': {
      const pts: [number, number][] = [];
      for (let k = 0; k < 6; k += 1) {
        const a = (Math.PI / 3) * k;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return poly(pts);
    }
    case 'fashion': {
      const w = r * 0.38;
      const l = r * 1.1;
      return poly([
        [-w, -l],
        [w, -l],
        [w, -w],
        [l, -w],
        [l, w],
        [w, w],
        [w, l],
        [-w, l],
        [-w, w],
        [-l, w],
        [-l, -w],
        [-w, -w],
      ]);
    }
  }
}

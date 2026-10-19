import type { Card } from "@/types";

/*
 * Synthetic mock cards for the demo and tests. Every name, id and URL is invented.
 * Nothing here comes from Qloo.
 */

export interface MockCard {
  id: string;
  title: string;
  field: "music" | "film" | "tv" | "books" | "food_places" | "fashion";
  card: Card;
}

const lineageCard: Card = {
  path: {
    seedId: "00000000-0000-4000-8000-000000000001",
    anchor: { contribution: 0.62, source: "qloo_explainability" },
    hops: [
      { kind: "seed", label: "The Glass Orchard", provenance: "inferred" },
      {
        kind: "theme",
        label: "Slow, formal compositions that withhold the camera",
        tags: ["00000000-0000-4000-8000-000000000021"],
        provenance: "inferred",
      },
      {
        kind: "lineage",
        label: "Both draw on a shared tradition of stage-bound tableau",
        provenance: "sourced",
        sourceUrl: "https://example.org/mock/tableau-tradition",
      },
      { kind: "pick", label: "Hollow Meridian", provenance: "inferred" },
    ],
    sharedTags: ["00000000-0000-4000-8000-000000000021"],
    distinctive: true,
  },
  why: "You said you love The Glass Orchard for how long still shots let a room speak. Hollow Meridian builds its chapters the same way, as fixed scenes viewed from one place.",
  different:
    "It is a book, a field you have not named, and it moves by chapters and fixed scenes rather than by edited footage.",
  provenance: { sourced: 1, inferred: 1 },
  reading: {
    text: "Read this way, the fixed viewpoint echoes older stage tableaux, where a scene is held still so the audience does the looking.",
    sourceUrl: "https://example.org/mock/tableau-reading",
  },
};

const inferredCard: Card = {
  path: {
    seedId: "00000000-0000-4000-8000-000000000002",
    anchor: { contribution: null, source: "tag_overlap", thin: true },
    hops: [
      { kind: "seed", label: "Paper Lanterns", provenance: "inferred" },
      {
        kind: "theme",
        label: "Spare arrangements with room left around each sound",
        tags: ["00000000-0000-4000-8000-000000000022"],
        provenance: "inferred",
      },
      { kind: "pick", label: "Salt Atlas", provenance: "inferred" },
    ],
    sharedTags: ["00000000-0000-4000-8000-000000000022"],
    distinctive: false,
  },
  why: "You said Paper Lanterns works because nothing crowds the main sound. Salt Atlas plates a few elements with open space between them, which is the same instinct.",
  different:
    "It sits in food and places, which is new for you, and the experience is a meal at a table rather than something you watch or hear.",
  provenance: { sourced: 0, inferred: 1 },
};

const reactedCard: Card = {
  path: {
    seedId: "00000000-0000-4000-8000-000000000003",
    anchor: { contribution: 0.48, source: "qloo_explainability" },
    hops: [
      { kind: "seed", label: "Night Ledger", provenance: "inferred" },
      {
        kind: "theme",
        label: "Ordinary work treated as quiet ritual",
        tags: ["00000000-0000-4000-8000-000000000023"],
        provenance: "inferred",
      },
      {
        kind: "lineage",
        label: "Both descend from a tradition of work clothing made to be mended",
        provenance: "sourced",
        sourceUrl: "https://example.org/mock/mended-workwear",
      },
      { kind: "pick", label: "Indigo Thread Workwear", provenance: "inferred" },
    ],
    sharedTags: ["00000000-0000-4000-8000-000000000023"],
    distinctive: true,
  },
  why: "You said Night Ledger makes routine feel ceremonial. This label presents repair and daily wear in the same spirit.",
  different: "It is fashion, far from your usual screen picks, and it reads through cloth, stitching and wear rather than story.",
  provenance: { sourced: 1, inferred: 1 },
  reaction: {
    state: "will_try",
    words: "I want to see how the mending is shown.",
    at: "2026-10-19T12:00:00.000Z",
  },
};

export const MOCK_CARDS: MockCard[] = [
  { id: "00000000-0000-4000-8000-000000000011", title: "Hollow Meridian", field: "books", card: lineageCard },
  { id: "00000000-0000-4000-8000-000000000012", title: "Salt Atlas", field: "food_places", card: inferredCard },
  { id: "00000000-0000-4000-8000-000000000013", title: "Indigo Thread Workwear", field: "fashion", card: reactedCard },
];

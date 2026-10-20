// rubric-fit: discernment, pattern recognition and idiosyncrasy, each 1 to 5 (the taste facets in judge-rubrics.md).
// Slop is visible signs of taste lifted out of context and used generically. Labels are the scores a careful reader
// gives; a judge agrees when every score is within the tolerance. Five strong cards, five weak, with two mixed. All invented.

import type { CalibrationItem } from "../types";
import { card, cardItem } from "./builders";
import { BOOK_C, FASHION_D, FILM_A, MUSIC_B, PLACE_E, TV_F } from "./seeds";

const J = "rubric-fit" as const;

export const RUBRIC_FIT: CalibrationItem[] = [
  cardItem(
    J,
    "rf-01",
    card({
      seed: FILM_A,
      pick: { label: "Fixture Book X1", field: "books", tags: ["slow pacing", "long takes", "ensemble cast"] },
      theme: ["long takes", "slow pacing"],
      pickOnly: ["ensemble cast"],
      distance: ["other_field", "farther_from_tags"],
      why: "You said the long takes make you feel time passing. Fixture Book X1 shares the long takes and slow pacing, so what holds you may be duration itself rather than any one story.",
      different: "Not the other slow, patient titles near your seed: its tags add an ensemble cast, so time passes for several people at once. That is the part to read for.",
    }),
    { discernment: 4, pattern: 4, idiosyncrasy: 5 },
    "Picked out from near neighbors, ties to the user's own words, and names a pattern across fields.",
  ),
  cardItem(
    J,
    "rf-02",
    card({
      seed: BOOK_C,
      pick: { label: "Fixture Series X2", field: "tv", tags: ["unreliable narrator", "domestic", "ellipsis"] },
      theme: ["unreliable narrator"],
      pickOnly: ["domestic", "ellipsis"],
      distance: ["other_field", "less_familiar"],
      why: "You like narrators who tell it sideways and never explain. Fixture Series X2 shares the unreliable narrator, so the withheld explanation, not the plot, may be what hooks you.",
      different: "Where the novel withholds in sentences, this one adds ellipsis and a domestic setting and has to withhold in what it shows; it is less obvious than other narrator-driven shows because the narrator is only implied.",
    }),
    { discernment: 4, pattern: 4, idiosyncrasy: 5 },
    "Specific to the user's phrase, explains why this and not the obvious alternative.",
  ),
  cardItem(
    J,
    "rf-03",
    card({
      seed: PLACE_E,
      pick: { label: "Fixture Label X3", field: "fashion", tags: ["handmade", "quiet", "natural fibers"] },
      theme: ["handmade", "quiet"],
      pickOnly: ["natural fibers"],
      distance: ["other_field", "farther_from_tags"],
      why: "You said the cafe is quiet and everything is made slowly. Fixture Label X3 is tagged handmade and quiet, which suggests the slowness you value lives in how things are made, not only in a room.",
      different: "It leaves the room behind and keeps the making, with natural fibers added; most picks tied to a quiet cafe stay in food and places.",
    }),
    { discernment: 4, pattern: 4, idiosyncrasy: 4 },
    "Distinguishes from the obvious same-field neighbors and links the user's words to a cross-field pattern.",
  ),
  cardItem(
    J,
    "rf-04",
    card({
      seed: MUSIC_B,
      pick: { label: "Fixture Film X4", field: "film", tags: ["repetition", "gradual build", "night"] },
      theme: ["repetition", "gradual build"],
      pickOnly: ["night"],
      distance: ["other_field", "less_familiar"],
      why: "You named layered, hypnotic repetition that builds slowly. Fixture Film X4 is built on repetition and gradual build, so the same engine works in images instead of sound.",
      different: "Rather than another band that layers loops, it moves the build to film, and its tags add night: the repetition happens in the dark.",
    }),
    { discernment: 4, pattern: 4, idiosyncrasy: 4 },
    "Names why this and not an obvious band, and a cross-field mechanism, shaped by the user's phrase.",
  ),
  cardItem(
    J,
    "rf-05",
    card({
      seed: TV_F,
      pick: { label: "Fixture Book X5", field: "books", tags: ["confined setting", "dialogue-driven", "subtext"] },
      theme: ["confined setting", "dialogue-driven"],
      pickOnly: ["subtext"],
      distance: ["other_field"],
      why: "You described a small cast stuck in one place, talking around the thing. Fixture Book X5 is confined and dialogue-driven, and its tags add subtext: the thing talked around.",
      different: "Not another series: it moves the stuck room onto the page, where talking around the thing is all the book has.",
    }),
    { discernment: 4, pattern: 3, idiosyncrasy: 5 },
    "Tied closely to the user's wording; pattern is solid but less far-reaching.",
  ),
  cardItem(
    J,
    "rf-06",
    card({
      seed: FILM_A,
      pick: { label: "Fixture Book X6", field: "books", tags: ["slow pacing"] },
      theme: ["slow pacing"],
      distance: ["other_field"],
      why: "If you like Fixture Film A, you'll love Fixture Book X6, a beautiful, atmospheric choice.",
      different: "It's a classic of its kind.",
    }),
    { discernment: 1, pattern: 1, idiosyncrasy: 1 },
    "Generic, interchangeable with any similar item; slop (generic aesthetic label).",
  ),
  cardItem(
    J,
    "rf-07",
    card({
      seed: MUSIC_B,
      pick: { label: "Fixture Film X7", field: "film", tags: ["repetition", "mood"] },
      theme: ["repetition"],
      distance: ["other_field"],
      why: "People who like Fixture Band B also like Fixture Film X7. It has a moody, cinematic vibe.",
      different: "It is a film.",
    }),
    { discernment: 1, pattern: 1, idiosyncrasy: 1 },
    "'People who like X also like Y' with a vibe label; ignores the user's words.",
  ),
  cardItem(
    J,
    "rf-08",
    card({
      seed: FASHION_D,
      pick: { label: "Fixture Cafe X8", field: "food_places", tags: ["minimal"] },
      theme: ["minimal"],
      distance: ["other_field"],
      why: "Fixture Cafe X8 is minimal, like your seed. A clean, timeless aesthetic.",
      different: "It is a cafe, not a label.",
    }),
    { discernment: 1, pattern: 2, idiosyncrasy: 1 },
    "One surface tag and a generic aesthetic label; nothing from the user's plain-cut, heavy-fabric reason.",
  ),
  cardItem(
    J,
    "rf-09",
    card({
      seed: BOOK_C,
      pick: { label: "Fixture Series X9", field: "tv", tags: ["unreliable narrator"] },
      theme: ["unreliable narrator"],
      distance: ["other_field"],
      why: "Fixture Series X9 has an unreliable narrator, like the novel.",
      different: "It is television.",
    }),
    { discernment: 2, pattern: 1, idiosyncrasy: 2 },
    "Surface tag match, no distinction from near neighbors and no use of the user's words.",
  ),
  cardItem(
    J,
    "rf-10",
    card({
      seed: PLACE_E,
      pick: { label: "Fixture Place X10", field: "food_places", tags: ["slow living", "quiet"] },
      theme: ["slow living", "quiet"],
      distance: ["farther_from_tags"],
      why: "Fixture Place X10 is tagged slow living and quiet, so it is a natural next stop after the cafe.",
      different: "It is another place and a bit less familiar.",
    }),
    { discernment: 2, pattern: 2, idiosyncrasy: 2 },
    "Correct tags, but the obvious neighbor: nothing explains why this and not any quiet place, and the user's words are unused.",
  ),
];

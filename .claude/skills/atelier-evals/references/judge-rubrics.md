# Judge rubrics

Shared by the LLM-judge scorers and the `bridge-judge` agent. Examples are illustrative and invented. They are not Qloo data.

## General instructions for any judge

- Use only what you are given: the card, its path (hops, shared tags, provenance), the tags returned for the pick, the sources retrieved. Do not use your own knowledge of the pick.
- Quote the exact words that support each judgment. If you cannot quote evidence, the judgment is "not supported".
- Do not reward length. A short explanation that names a real, specific connection beats a long vague one.
- Do not rewrite the card. Report only.
- Output JSON only, no other text, in the schema at the end.

## bridge-groundedness (pass / fail)

Pass only if every connection the explanation claims between the user's seed and the pick is traceable to the path's shared tags, a hop, or a retrieved source.

Fail if the explanation names a theme, influence, era, technique or relationship that is not in the provided data, even if it sounds true.

- Pass example: path shared tags are `{slow cinema, long takes}`; explanation says the pick "shares the seed's long, patient takes." Supported.
- Fail example: same path; explanation says the pick "was inspired by the seed's director." No such hop or source. Unsupported.

List each unsupported claim verbatim.

## bridge-quality (1 to 5)

- 1: generic. "You'll like this because it's similar." Nothing a reader could not guess.
- 2: names a shared tag but says nothing about what it means or what differs.
- 3: names a specific connection and one difference. Correct but unremarkable.
- 4: names a specific connection, says what is different, and gives the reader something to notice or look for.
- 5: also changes how the reader might see their own seed. Specific, accurate to the data, and teaches.

## stretch-defensibility (pass / fail)

Given the profile, a Match pick and a Stretch pick:
- Pass if the Stretch pick is clearly further from the profile center (less obvious, less popular, less overlap) AND the path gives a believable reason it belongs to this person's taste.
- Fail if Stretch is not further out than Match, or if it is far but the path is thin, generic or only technically connected (random).

## lineage-groundedness (pass / fail)

Pass only if every influence, lineage or "comes from" claim appears in a retrieved source and carries a source link. Anything stated without a source fails. A claim marked `inferred` is not a lineage claim and must not be worded as fact.

## reading-restraint (pass / fail)

Pass if every symbolic or interpretive reading is (a) supported by retrieved text, (b) worded as a reading ("one reading is...", "critics have read this as..."), and (c) kept apart from sourced fact. A card with no retrieved text and no reading passes. A card that asserts meaning with no text fails.

## rubric-fit (three scores, 1 to 5 each)

These come from the project's research on taste (Segal's three facets). Slop means visible signs of taste extracted from their context and used generically.

- **Discernment:** Does the pick and explanation distinguish this from near neighbors, saying why this and not the obvious alternative? 1 = interchangeable with any similar item; 5 = clearly picked out.
- **Pattern recognition:** Does the explanation connect the pick to the user's seeds through something that reaches beyond surface tags, drawing on knowledge of how these works relate? 1 = surface match; 5 = a real pattern across fields.
- **Idiosyncrasy:** Does the pick belong to THIS user's profile rather than a generic "people who like X also like Y"? 1 = would be the same for anyone who listed that seed; 5 = visibly shaped by their particular combination of seeds and reasons.

Flag "slop" explicitly if the card relies on an obvious icon or a generic aesthetic label with no specifics.

## Output schema

```json
{
  "scorer": "bridge-groundedness | bridge-quality | stretch-defensibility | lineage-groundedness | reading-restraint | rubric-fit",
  "card_id": "string",
  "result": "pass | fail | 1-5 | {discernment, pattern, idiosyncrasy}",
  "evidence": ["exact quote from the card or data", "..."],
  "unsupported_claims": ["verbatim claim", "..."],
  "reason": "one sentence"
}
```

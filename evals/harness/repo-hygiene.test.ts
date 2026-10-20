// The offending strings are assembled at run time so this file itself stays clean under repo-hygiene.

import { describe, expect, it } from "vitest";
import { parseAllowList, scanFile, scanLine, scoreRepoHygiene } from "../scorers/repo-hygiene";
import type { RepoSource } from "./types";

const REAL_UUID = ["3f2b8c1e", "7a4d", "4e5f", "9b6a", "1c2d3e4f5a6b"].join("-");
const SYNTH_UUID = "00000000-0000-4000-8000-000000000042";
const REAL_TAG = ["urn", "tag", "genre", "media", "Drama"].join(":");
const TAG_TYPE = ["urn", "tag", "genre", "media"].join(":");
const HACK_KEY = `hack${"_"}${"a1B2c3D4e5F6g7H8"}`;
const DASHLESS = REAL_UUID.replaceAll("-", "");
const SK_ANT = `sk-ant-${"xYz9QrSt".repeat(4)}`;
const JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJ4In0", "c2ln"].join(".");
const NONE = new Set<string>();

function source(files: Record<string, string>, o: { ignored?: boolean; history?: { path: string; commit: string; line: string }[] | null } = {}): RepoSource {
  return {
    listFiles: () => Object.keys(files),
    read: (p) => files[p] ?? null,
    historyAdded: () => (o.history === undefined ? [] : o.history),
    isIgnored: () => o.ignored ?? true,
  };
}

describe("scanLine", () => {
  it("flags a non-synthetic UUID and accepts the synthetic pattern", () => {
    expect(scanLine(`id: ${REAL_UUID}`, NONE)).toEqual(["uuid"]);
    expect(scanLine(`id: ${SYNTH_UUID}`, NONE)).toEqual([]);
    expect(scanLine(`id: ${["00000000", "0000", "4000", "8000", "000000000142"].join("-")}`, NONE)).toEqual(["uuid"]);
  });

  it("flags a tag id with a value part, not a tag type", () => {
    expect(scanLine(`tag ${REAL_TAG}`, NONE)).toEqual(["tag-id"]);
    expect(scanLine(`type ${TAG_TYPE}`, NONE)).toEqual([]);
    expect(scanLine("shape urn:tag:<kind>:<namespace>:<value>", NONE)).toEqual([]);
  });

  it("accepts synthetic tag ids and allow-listed ones", () => {
    expect(scanLine("urn:tag:fixture:theme:one", NONE)).toEqual([]);
    expect(scanLine("urn:tag:genre:synthetic:tag-1", NONE)).toEqual([]);
    expect(scanLine(`${REAL_TAG}.`, new Set([REAL_TAG]))).toEqual([]);
  });

  it("flags a hack_ key but not the bare prefix", () => {
    expect(scanLine(`key=${HACK_KEY}`, NONE)).toEqual(["api-key"]);
    expect(scanLine("a hack_ key", NONE)).toEqual([]);
  });

  it("flags a real-looking value after QLOO_API_KEY or X-Api-Key but not placeholders", () => {
    expect(scanLine(`QLOO_API_KEY=${"k".repeat(32)}`, NONE)).toEqual(["api-key"]);
    expect(scanLine(`"X-Api-Key": "${"k".repeat(32)}"`, NONE)).toEqual(["api-key"]);
    expect(scanLine("QLOO_API_KEY=your-qloo-hackathon-key", NONE)).toEqual([]);
    expect(scanLine('QLOO_API_KEY: "synthetic-test-key"', NONE)).toEqual([]);
  });
});

describe("scanLine: hardening", () => {
  it("sees a UUID next to a hyphen, and uppercase UUIDs", () => {
    expect(scanLine(`movie-${REAL_UUID}`, NONE)).toEqual(["uuid"]);
    expect(scanLine(`${REAL_UUID}-x`, NONE)).toEqual(["uuid"]);
    expect(scanLine(`/entities/${REAL_UUID.toUpperCase()}/`, NONE)).toEqual(["uuid"]);
    expect(scanLine(`movie-${SYNTH_UUID}-x`, NONE)).toEqual([]);
  });

  it("sees a dashless 32-hex UUID, but not a longer hex run (a sha256 hash)", () => {
    expect(scanLine(`id=${DASHLESS}`, NONE)).toEqual(["uuid"]);
    expect(scanLine(`id=${DASHLESS.toUpperCase()}`, NONE)).toEqual(["uuid"]);
    expect(scanLine(`sha256-${DASHLESS}${DASHLESS}`, NONE)).toEqual([]);
    expect(scanLine(`id=${SYNTH_UUID.replaceAll("-", "")}`, NONE)).toEqual([]);
  });

  it("sees sk-ant keys and JWTs", () => {
    expect(scanLine(`k = "${SK_ANT}"`, NONE)).toEqual(["api-key"]);
    expect(scanLine(`Authorization: Bearer ${JWT}`, NONE)).toEqual(["api-key"]);
    expect(scanLine("prefix sk-ant-xyz", NONE)).toEqual([]);
  });

  it("sees any non-placeholder value for the three secret env names", () => {
    for (const name of ["QLOO_API_KEY", "ANTHROPIC_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
      expect(scanLine(`${name}=abc123`, NONE), name).toEqual(["api-key"]);
      expect(scanLine(`${name}="abc123"`, NONE), name).toEqual(["api-key"]);
      expect(scanLine(`${name}: "abc123"`, NONE), name).toEqual(["api-key"]);
      expect(scanLine(`${name}=your-${name.toLowerCase()}`, NONE), name).toEqual([]);
      expect(scanLine(`${name}=`, NONE), name).toEqual([]);
    }
    expect(scanLine("ANTHROPIC_API_KEY=your-anthropic-key", NONE)).toEqual([]);
  });

  it("does not flag code that merely mentions the names", () => {
    expect(scanLine("QLOO_API_KEY: undefined", NONE)).toEqual([]);
    expect(scanLine("const k = env.QLOO_API_KEY;", NONE)).toEqual([]);
    expect(scanLine("QLOO_API_KEY: string;", NONE)).toEqual([]);
    expect(scanLine("QLOO_API_KEY=process.env.QLOO_API_KEY", NONE)).toEqual([]);
  });

  it("sees hack_ keys in any case", () => {
    expect(scanLine(`k=${HACK_KEY.toUpperCase()}`, NONE)).toEqual(["api-key"]);
    expect(scanLine(`k=HACK${"_"}${"A1B2C3D4E5F6"}`, NONE)).toEqual(["api-key"]);
  });

  it("sees URL-encoded tag ids", () => {
    expect(scanLine(`?tags=${REAL_TAG.replaceAll(":", "%3A")}`, NONE)).toEqual(["tag-id"]);
    expect(scanLine(`?tags=${REAL_TAG.replaceAll(":", "%3a")}`, NONE)).toEqual(["tag-id"]);
    expect(scanLine(`?t=${TAG_TYPE.replaceAll(":", "%3A")}`, NONE)).toEqual([]);
  });
});

describe("scanFile", () => {
  it("flags raw Qloo-shaped JSON with real-looking names, wherever it sits", () => {
    const real = JSON.stringify({ results: [{ name: "Some Real Name", entity_id: SYNTH_UUID }] });
    expect(scanFile("evals/fixtures/qloo/x.json", real, NONE).map((f) => f.rule)).toContain("raw-json");
    expect(scanFile("docs/x.json", real, NONE).map((f) => f.rule)).toContain("raw-json");
  });

  it("accepts fixture JSON with invented names under evals/fixtures/ only", () => {
    const ok = JSON.stringify({ results: [{ name: "Fixture Film One", entity_id: SYNTH_UUID }] });
    expect(scanFile("evals/fixtures/qloo/x.json", ok, NONE)).toEqual([]);
    expect(scanFile("docs/x.json", ok, NONE).map((f) => f.rule)).toEqual(["raw-json"]);
  });

  it("checks every name, title and label value under evals/fixtures/", () => {
    for (const key of ["name", "title", "label"]) {
      const real = JSON.stringify({ results: [{ entity_id: SYNTH_UUID, name: "Fixture Film One", [key]: "Some Real Name" }] });
      expect(scanFile("evals/fixtures/qloo/x.json", real, NONE).map((f) => f.rule), key).toContain("raw-json");
    }
    const ok = JSON.stringify({ results: [{ entity_id: SYNTH_UUID, name: "Fixture One", title: "Invented Title", label: "Synthetic Label" }] });
    expect(scanFile("evals/fixtures/qloo/x.json", ok, NONE)).toEqual([]);
  });

  it("flags recordings and private paths", () => {
    expect(scanFile(".qloo-private/a.json", "{}", NONE).map((f) => f.rule)).toEqual(["private-path"]);
    expect(scanFile("x/run.recording.json", "{}", NONE).map((f) => f.rule)).toEqual(["private-path"]);
  });

  it("reports the line number", () => {
    expect(scanFile("a.ts", `ok\nok\nid ${REAL_UUID}`, NONE)).toEqual([{ rule: "uuid", line: 3 }]);
  });
});

describe("scoreRepoHygiene", () => {
  it("passes a clean repo", () => {
    const r = scoreRepoHygiene(source({ "a.ts": `const id = "${SYNTH_UUID}";` }));
    expect(r.pass).toBe(true);
  });

  it("fails on each rule and never prints the matched value", () => {
    const r = scoreRepoHygiene(
      source({ "a.ts": `x ${REAL_UUID}`, "b.ts": REAL_TAG, "c.env": `k=${HACK_KEY}`, ".qloo-private/d.json": "{}" }),
    );
    expect(r.pass).toBe(false);
    const all = r.reasons.join("\n");
    expect(all).toContain("a.ts:1: uuid");
    expect(all).toContain("b.ts:1: tag-id");
    expect(all).toContain("c.env:1: api-key");
    expect(all).toContain(".qloo-private/d.json: private-path");
    for (const secret of [REAL_UUID, REAL_TAG, HACK_KEY]) expect(all).not.toContain(secret);
  });

  it("fails when .qloo-private/ is not ignored by git", () => {
    const r = scoreRepoHygiene(source({ "a.ts": "ok" }, { ignored: false }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toContain(".qloo-private/ is not ignored");
  });

  it("fails on a bad line added in history, naming the commit and file", () => {
    const r = scoreRepoHygiene(source({ "a.ts": "ok" }, { history: [{ path: "old.md", commit: "abc1234", line: `id ${REAL_UUID}` }] }));
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toBe("history abc1234 old.md: uuid");
  });

  it("can skip history, and reports unreadable history as a failure", () => {
    expect(scoreRepoHygiene(source({ "a.ts": "ok" }, { history: null }), { history: false }).pass).toBe(true);
    expect(scoreRepoHygiene(source({ "a.ts": "ok" }, { history: null })).pass).toBe(false);
  });

  it("reads the allow list from the repo and skips binary or missing files", () => {
    const files = { "evals/harness/hygiene-allow.txt": `# c\n${REAL_TAG}\n`, "a.ts": `tag ${REAL_TAG}` };
    expect(scoreRepoHygiene(source(files)).pass).toBe(true);
    expect(scoreRepoHygiene({ ...source({ "bin.dat": "x" }), read: () => null }).pass).toBe(true);
  });

  it("fails on tracked images unless the path prefix is allow-listed", () => {
    for (const f of ["shot.png", "a/b.JPG", "a.jpeg", "a.webp", "a.gif"]) {
      const r = scoreRepoHygiene(source({ [f]: "x" }));
      expect(r.pass, f).toBe(false);
      expect(r.reasons[0], f).toContain("image");
    }
    expect(scoreRepoHygiene(source({ "public/brand/logo.png": "x" }), { allow: new Set(["image:public/brand/"]) }).pass).toBe(true);
    expect(scoreRepoHygiene(source({ "public/shots/a.png": "x" }), { allow: new Set(["image:public/brand/"]) }).pass).toBe(false);
    expect(scoreRepoHygiene(source({ "a.svg": "<svg/>" })).pass).toBe(true);
  });

  it("warns, without failing, about files it could not scan", () => {
    const src: RepoSource = { ...source({ "a.ts": "ok", "big.bin": "x", "logo.png": "x" }), read: (p) => (p === "a.ts" ? "ok" : null) };
    const r = scoreRepoHygiene(src, { allow: new Set(["image:logo"]) });
    expect(r.pass).toBe(true);
    const warning = r.reasons.find((x) => x.startsWith("WARNING"));
    expect(warning).toContain("1 file(s) not scanned");
    expect(warning).toContain("big.bin");
    expect(warning).not.toContain("logo.png");
  });

  it("caps the list of reasons", () => {
    const files = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}.ts`, REAL_UUID]));
    const r = scoreRepoHygiene(source(files));
    expect(r.reasons.length).toBeLessThanOrEqual(21);
    expect(r.reasons.at(-1)).toMatch(/more$/);
  });
});

describe("parseAllowList", () => {
  it("ignores comments and blank lines", () => {
    expect([...parseAllowList("# x\n\n a \nb\n")]).toEqual(["a", "b"]);
    expect([...parseAllowList(null)]).toEqual([]);
  });
});

describe("scanLine: short test stubs", () => {
  it("does not flag a value too short to be a key", () => {
    expect(scanLine('QLOO_API_KEY: "abc"', new Set())).toEqual([]);
    expect(scanLine("QLOO_API_KEY=abc", new Set())).toEqual([]);
  });
});

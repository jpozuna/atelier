import { describe, expect, it } from "vitest";
import { createAnthropicNamer, createAxisNamer, parseNameReply } from "./anthropic-namer";
import { fallbackNamer, nameAxis } from "./naming";
import { ttype } from "./fixtures";

const input = { tagType: ttype("theme"), kind: "theme", tagNames: ["Quiet Ending", "Long Take"] };

function fakeAnthropic(reply: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown>; redirect?: RequestRedirect }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string), redirect: init.redirect });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const message = (text: string) => ({ content: [{ type: "text", text }] });

describe("anthropic namer", () => {
  it("posts only the axis's tag names, with the key in the header and the model from config", async () => {
    const { f, calls } = fakeAnthropic(message('{"label":"Quiet theme","justification":"Quiet Ending and Long Take, both theme."}'));
    const namer = createAnthropicNamer({ apiKey: "synthetic-anthropic-key", model: "synthetic-model", fetch: f });
    const got = await nameAxis(input, namer);
    expect(got).toMatchObject({ label: "Quiet theme", source: "model" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers["x-api-key"]).toBe("synthetic-anthropic-key");
    expect(calls[0].redirect).toBe("error");
    expect(calls[0].body.model).toBe("synthetic-model");
    const sent = JSON.stringify(calls[0].body.messages);
    expect(sent).toContain("Quiet Ending");
    expect(JSON.stringify(calls[0].body)).not.toContain("synthetic-anthropic-key");
  });

  it("falls back on an http error, bad JSON, or an ungrounded answer", async () => {
    for (const [reply, status] of [[{}, 500], [message("no json here"), 200], [message('{"label":"Baroque","justification":"Quiet Ending and Long Take."}'), 200]] as const) {
      const { f } = fakeAnthropic(reply, status);
      const got = await nameAxis(input, createAnthropicNamer({ apiKey: "k", model: "m", fetch: f }));
      expect(got.source).toBe("fallback");
    }
  });

  it("parses fenced or chatty JSON replies and rejects malformed ones", () => {
    expect(parseNameReply('Here: ```json\n{"label":"A","justification":"B"}\n```')).toEqual({ label: "A", labelJustification: "B" });
    expect(parseNameReply('{"label":1}')).toBeNull();
    expect(parseNameReply("{bad")).toBeNull();
  });

  it("is the deterministic fallback with no key or no model, and never calls out", async () => {
    const { f, calls } = fakeAnthropic(message("{}"));
    expect(createAxisNamer({}, f)).toBe(fallbackNamer);
    expect(createAxisNamer({ ANTHROPIC_API_KEY: "your-test-key" }, f)).toBe(fallbackNamer);
    expect(createAxisNamer({ ATELIER_MODEL: "m" }, f)).toBe(fallbackNamer);
    expect(createAxisNamer({ ANTHROPIC_API_KEY: "your-test-key", ATELIER_MODEL: "m" }, f)).not.toBe(fallbackNamer);
    expect(calls).toHaveLength(0);
  });
});

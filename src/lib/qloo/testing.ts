// Synthetic fixtures and helpers for Qloo client tests. Invented names, ids shaped
// 00000000-0000-4000-8000-0000000000NN. No Qloo data. Envelope shapes follow docs/spike-report.md.

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const tagId = (n: number) => `urn:tag:genre:synthetic:tag-${n}`;

export const ENV = {
  QLOO_BASE_URL: "https://hackathon.api.qloo.com",
  QLOO_API_KEY: "synthetic-test-key",
  QLOO_RESERVE: "6000",
};

export function searchItem(n: number, extra: Record<string, unknown> = {}) {
  return {
    name: `Invented Work ${n}`,
    entity_id: id(n),
    types: ["urn:entity:movie"],
    popularity: 0.5,
    disambiguation: "synthetic",
    tags: [{ name: "Invented Tag", tag_id: tagId(n), type: "urn:tag:genre:synthetic", value: "invented" }],
    properties: { external: { wikidata: [{ id: `Q${n}` }] } },
    ...extra,
  };
}

export function insightsEntity(n: number, extra: Record<string, unknown> = {}) {
  return {
    name: `Invented Pick ${n}`,
    entity_id: id(n),
    type: "urn:entity",
    subtype: "urn:entity:book",
    popularity: 0.4,
    disambiguation: "synthetic",
    tags: [{ id: tagId(n), name: "Invented Tag", type: "urn:tag:genre:synthetic" }],
    external: {},
    query: { affinity: 0.8, explainability: { "signal.interests.entities": [{ entity_id: id(1), score: 0.6 }] } },
    properties: { akas: ["x"], description: "short" },
    akas: [{ value: "Invented Alias" }],
    ...extra,
  };
}

export const searchBody = (ns: number[]) => ({ success: true, duration: 12, results: ns.map((n) => searchItem(n)) });
export const insightsBody = (ns: number[]) => ({ success: true, results: { entities: ns.map((n) => insightsEntity(n)), duration: 30 } });
export const tagsBody = (ns: number[]) => ({ success: true, duration: 9, results: { tags: ns.map((n) => ({ id: tagId(n), name: `Invented Tag ${n}`, type: "urn:tag:genre:synthetic", parents: [] })) } });
export const tasteBody = (ns: number[]) => ({
  success: true,
  duration: 700,
  results: { tags: ns.map((n) => ({ tag_id: tagId(n), name: `Invented Tag ${n}`, types: ["urn:entity:movie"], subtype: "urn:tag:genre:synthetic", tag_value: "invented", popularity: 0.3, query: { affinity: 0.7 } })) },
});

export interface FakeCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  redirect?: RequestRedirect;
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

/** A fetch stand-in that records calls and answers from `respond`. No network. */
export function fakeFetch(respond: (call: FakeCall, n: number) => FakeResponse | Promise<FakeResponse>) {
  const calls: FakeCall[] = [];
  const fn = (async (input: URL | string, init?: RequestInit) => {
    const call: FakeCall = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      redirect: init?.redirect,
    };
    calls.push(call);
    const r = await respond(call, calls.length);
    return new Response(r.text ?? JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { "x-month-ratelimit-remaining": "9000", ...(r.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

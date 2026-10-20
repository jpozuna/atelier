import { describe, expect, it } from "vitest";
import { DbConfigError } from "@/lib/db/server";
import { requestLink } from "./core";
import type { SendLink } from "./core";

describe("requestLink", () => {
  it("passes the address and the destination to the sender and reports the link as sent", async () => {
    const calls: unknown[] = [];
    const send: SendLink = async (input) => {
      calls.push(input);
      return { ok: true };
    };
    expect(await requestLink({ email: "  Reader@Example.TEST ", next: "/picks" }, send)).toEqual({ status: "sent", email: "reader@example.test" });
    expect(calls).toEqual([{ email: "Reader@Example.TEST", next: "/picks" }]);
  });

  it("sends no destination when there is none", async () => {
    const calls: unknown[] = [];
    await requestLink({ email: "a@example.test", next: "" }, async (i) => (calls.push(i), { ok: true }));
    expect(calls).toEqual([{ email: "a@example.test", next: null }]);
  });

  it("maps each failure to a reason, keeping what was typed", async () => {
    for (const reason of ["invalid_email", "rate_limited", "failed"] as const) {
      expect(await requestLink({ email: "x", next: null }, async () => ({ ok: false, reason }))).toEqual({ status: "error", reason, email: "x" });
    }
  });

  it("treats a configuration error as unavailable, without repeating it", async () => {
    const state = await requestLink({ email: "a@example.test", next: null }, async () => {
      throw new DbConfigError("SITE_URL is not set");
    });
    expect(state).toEqual({ status: "error", reason: "unavailable", email: "a@example.test" });
    expect(JSON.stringify(state)).not.toMatch(/SITE_URL/);
  });

  it("ignores form fields that are not text", async () => {
    const state = await requestLink({ email: null, next: 5 }, async (i) => ({ ok: false, reason: i.email === "" ? "invalid_email" : "failed" }));
    expect(state).toMatchObject({ status: "error", reason: "invalid_email" });
  });
});

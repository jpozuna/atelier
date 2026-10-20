"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FIELDS } from "@/types";
import type { Field } from "./types";
import {
  buildProfileRequest,
  buildResolveRequest,
  buildWhyRequest,
  readProfile,
  readResolve,
  readWhy,
} from "./api";
import { MAX_QUERY_LENGTH, MAX_SEEDS_PER_USER, MAX_WHY_CHARS } from "@/lib/agent/config";
import { TASTE_PATH } from "./constants";
import { COPY, FIELD_LABEL, FIELD_PROMPT, isCalmError } from "./copy";
import {
  addEntry,
  buildEntry,
  draftReducer,
  initialDraft,
  profileSeeds,
  readiness,
  removeEntry,
  sameSeeds,
  selectedChip,
  validateQuery,
  validateWhy,
} from "./flow";
import type { Entry } from "./flow";
import { newSeedId, useHydrated } from "./hooks";
import { MatchPicker } from "./MatchPicker";
import { SeedList } from "./SeedList";
import {
  assembleTrace,
  clearTasteSession,
  loadFlowSession,
  readTasteSession,
  saveFlowSession,
  saveTasteSession,
  SESSION_VERSION,
} from "./session";
import styles from "./Onboarding.module.css";

/** Shell for the flow. It mounts the inner flow only after hydration, so stored state can seed it safely. */
export function OnboardingFlow() {
  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <p className={styles.note} role="status">
        {COPY.gettingReady}
      </p>
    );
  }
  return <Flow />;
}

function Flow() {
  const router = useRouter();
  const [stored] = useState(loadFlowSession);
  const [draft, dispatch] = useReducer(draftReducer, stored?.field ?? FIELDS[0], initialDraft);
  const [entries, setEntries] = useState<Entry[]>(stored?.entries ?? []);

  const [queryError, setQueryError] = useState("");
  const [whyError, setWhyError] = useState("");
  const [formError, setFormError] = useState("");
  const [adding, setAdding] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");
  const [buildCalm, setBuildCalm] = useState(false);
  const [announce, setAnnounce] = useState("");
  /** Bumped when "See my taste" is pressed before the list is ready, so the reason is announced each time. */
  const [blocked, setBlocked] = useState(0);

  // The latest list, so work that finishes after an await checks the list as it is now, not as it was.
  const entriesRef = useRef(entries);
  const tokenRef = useRef(0);
  const queryRef = useRef<HTMLInputElement>(null);
  const whyRef = useRef<HTMLInputElement>(null);
  const matchRef = useRef<HTMLElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);

  /** Every change to the list goes through here. A changed list makes the stored chart stale, so it is dropped. */
  function commit(list: Entry[]) {
    entriesRef.current = list;
    setEntries(list);
    setBlocked(0);
    setBuildError("");
    clearTasteSession();
  }

  // Keep the list through a reload of this tab.
  useEffect(() => {
    saveFlowSession({ version: SESSION_VERSION, field: draft.field, entries });
  }, [draft.field, entries]);

  // Move focus to where the next step is when a lookup finishes.
  const searchKind = draft.search.kind;
  useEffect(() => {
    if (searchKind === "clean") whyRef.current?.focus();
    else if (searchKind === "ambiguous") matchRef.current?.querySelector("input")?.focus();
    else if (searchKind === "missing" || searchKind === "error") queryRef.current?.focus();
  }, [searchKind]);

  const chip = selectedChip(draft);
  const ready = readiness(entries);
  const full = entries.length >= MAX_SEEDS_PER_USER;
  const prompt = FIELD_PROMPT[draft.field];
  const searching = draft.search.kind === "loading";
  const busy = adding || building;

  async function onFind(e: FormEvent) {
    e.preventDefault();
    if (searching) return;
    const q = validateQuery(draft.query);
    if (!q.ok) {
      setQueryError(q.message);
      queryRef.current?.focus();
      return;
    }
    setQueryError("");
    setFormError("");
    const token = ++tokenRef.current;
    dispatch({ type: "searchStart", token, query: q.value });
    const req = buildResolveRequest(draft.field, q.value);
    let result;
    try {
      const res = await fetch(req.url, req.init);
      const body: unknown = await res.json().catch(() => null);
      result = readResolve(res.status, body);
    } catch {
      result = readResolve(0, null);
    }
    dispatch({ type: "searchDone", token, query: q.value, result });
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (adding) return;
    if (!chip) {
      setFormError(COPY.needMatch);
      return;
    }
    const why = validateWhy(draft.why);
    if (!why.ok) {
      setWhyError(why.message);
      whyRef.current?.focus();
      return;
    }
    setWhyError("");
    setFormError("");

    const id = newSeedId();
    // Check the list rules before spending a lookup on the reason.
    const probe = buildEntry(draft, id, undefined);
    if (!probe) return;
    const pre = addEntry(entriesRef.current, probe);
    if (!pre.ok) {
      setFormError(pre.message);
      return;
    }

    setAdding(true);
    let entry = probe;
    try {
      const req = buildWhyRequest(draft.field, why.value, id);
      const res = await fetch(req.url, req.init);
      const body: unknown = await res.json().catch(() => null);
      const read = readWhy(res.status, body);
      const built = buildEntry(draft, id, read.ok ? read.tags : undefined, read.event);
      if (built) entry = built;
    } catch {
      // The seed is kept without mapped tags; the profile build treats that as "never mapped".
    }
    setAdding(false);

    // The list may have changed while the reason was being read: check again against it as it is now.
    const next = addEntry(entriesRef.current, entry);
    if (!next.ok) {
      setFormError(next.message);
      return;
    }
    commit(next.entries);
    setAnnounce(entry.whyMapped ? COPY.added(entry.matchedLabel) : COPY.addedUnmapped(entry.matchedLabel));
    dispatch({ type: "reset" });
    // A full list replaces the form, so focus has to go somewhere that still exists.
    if (next.entries.length >= MAX_SEEDS_PER_USER) listHeadingRef.current?.focus();
    else queryRef.current?.focus();
  }

  function onRemove(id: string) {
    if (busy) return;
    const gone = entriesRef.current.find((x) => x.seed.id === id);
    commit(removeEntry(entriesRef.current, id));
    if (gone) setAnnounce(COPY.removed(gone.matchedLabel));
    listHeadingRef.current?.focus();
  }

  async function onSeeTaste() {
    if (busy) return;
    if (!ready.ready) {
      setBlocked((n) => n + 1);
      return;
    }
    setBuilding(true);
    setBuildError("");
    setBuildCalm(false);
    const seeds = profileSeeds(entries);
    // The same list as the stored chart: no second profile call.
    const stored = readTasteSession();
    if (stored && sameSeeds(stored.seeds, seeds)) {
      router.push(TASTE_PATH);
      return;
    }
    try {
      const req = buildProfileRequest(seeds);
      const res = await fetch(req.url, req.init);
      const body: unknown = await res.json().catch(() => null);
      const read = readProfile(res.status, body);
      if (!read.ok) {
        setBuildError(read.message);
        setBuildCalm(isCalmError(read.code));
        setBuilding(false);
        return;
      }
      saveTasteSession({
        version: SESSION_VERSION,
        seeds,
        profile: read.result.profile,
        axes: read.result.axes,
        trace: assembleTrace(entries, read.result.trace),
      });
      router.push(TASTE_PATH);
    } catch {
      setBuildError(COPY.profileFailed);
      setBuilding(false);
    }
  }

  const searchLive = building
    ? COPY.building
    : searching
      ? COPY.finding
      : draft.search.kind === "clean"
        ? COPY.matchedTo(draft.search.chip.label)
        : draft.search.kind === "ambiguous"
          ? chip
            ? COPY.matchedTo(chip.label)
            : COPY.chooseHeading
          : draft.search.kind === "missing"
            ? COPY.missing
            : "";

  const missingId = draft.search.kind === "missing" ? "match-missing" : undefined;
  const errorId = queryError ? "query-error" : undefined;
  const queryDescribedBy = [errorId, missingId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={styles.flow}>
      {full ? (
        <p className={styles.note}>{COPY.atMax(MAX_SEEDS_PER_USER)}</p>
      ) : (
        <section className={styles.card} aria-labelledby="entry-heading">
          <h2 id="entry-heading" className={styles.cardHeading}>
            {entries.length === 0 ? COPY.firstHeading : COPY.nextHeading}
          </h2>

          <form className={styles.form} onSubmit={onFind} noValidate>
            <div className={styles.control}>
              <label htmlFor="field" className={styles.label}>
                {COPY.fieldLabel}
              </label>
              <select
                id="field"
                className={styles.input}
                value={draft.field}
                onChange={(e) => dispatch({ type: "setField", field: e.target.value as Field })}
              >
                {FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {FIELD_LABEL[f]}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.control}>
              <label htmlFor="query" className={styles.label}>
                {COPY.queryLabel(prompt.noun)}
              </label>
              <div className={styles.row}>
                <input
                  id="query"
                  ref={queryRef}
                  className={styles.input}
                  type="text"
                  autoComplete="off"
                  maxLength={MAX_QUERY_LENGTH}
                  placeholder={prompt.example}
                  value={draft.query}
                  aria-invalid={queryError ? true : undefined}
                  aria-describedby={queryDescribedBy}
                  onChange={(e) => {
                    setQueryError("");
                    dispatch({ type: "setQuery", query: e.target.value });
                  }}
                />
                <button type="submit" className={styles.secondary} aria-disabled={searching} aria-busy={searching}>
                  {searching ? COPY.finding : COPY.find}
                </button>
              </div>
              {queryError ? (
                <p id="query-error" className={styles.error}>
                  {queryError}
                </p>
              ) : null}
            </div>
          </form>

          {draft.search.kind === "error" ? (
            <p className={styles.error} role="alert">
              {draft.search.message}
            </p>
          ) : null}

          <MatchPicker
            ref={matchRef}
            search={draft.search}
            onChoose={(qlooId) => dispatch({ type: "choose", qlooId })}
            onChange={() => {
              dispatch({ type: "changeMatch" });
              queryRef.current?.focus();
            }}
          />

          {chip ? (
            <form className={styles.form} onSubmit={onAdd} noValidate>
              <div className={styles.control}>
                <label htmlFor="why" className={styles.label}>
                  {COPY.whyLabel}
                </label>
                <input
                  id="why"
                  ref={whyRef}
                  className={styles.input}
                  type="text"
                  autoComplete="off"
                  maxLength={MAX_WHY_CHARS}
                  required
                  aria-required="true"
                  aria-invalid={whyError ? true : undefined}
                  aria-describedby={whyError ? "why-hint why-error" : "why-hint"}
                  value={draft.why}
                  onChange={(e) => {
                    setWhyError("");
                    dispatch({ type: "setWhy", why: e.target.value });
                  }}
                />
                <p id="why-hint" className={styles.hint}>
                  {COPY.whyHint}
                </p>
                {whyError ? (
                  <p id="why-error" className={styles.error}>
                    {whyError}
                  </p>
                ) : null}
              </div>
              {formError ? (
                <p className={styles.error} role="alert">
                  {formError}
                </p>
              ) : null}
              <div>
                <button type="submit" className={styles.primary} aria-disabled={adding} aria-busy={adding}>
                  {adding ? COPY.adding : COPY.add}
                </button>
              </div>
            </form>
          ) : formError ? (
            <p className={styles.error} role="alert">
              {formError}
            </p>
          ) : null}
        </section>
      )}

      <SeedList ref={listHeadingRef} entries={entries} busy={busy} onRemove={onRemove} />

      <section className={styles.go} aria-labelledby="go-heading">
        <h2 id="go-heading" className="sr-only">
          {COPY.chartHeading}
        </h2>
        <div className={styles.bar} aria-hidden="true">
          <span className={styles.barFill} style={{ inlineSize: `${Math.round(ready.progress * 100)}%` }} />
        </div>
        <p id="ready-text" className={styles.readyText}>
          {ready.text}
        </p>
        <button
          type="button"
          className={styles.primary}
          aria-disabled={!ready.ready || busy}
          aria-describedby="ready-text"
          aria-busy={building}
          onClick={onSeeTaste}
        >
          {building ? COPY.building : COPY.seeTaste}
        </button>
        {buildError ? (
          <p className={buildCalm ? styles.note : styles.error} role="alert">
            {buildError}
          </p>
        ) : null}
        {blocked > 0 && !ready.ready ? (
          <p key={blocked} className={styles.note} role="alert">
            {ready.text}
          </p>
        ) : null}
      </section>

      <p className="sr-only" role="status" aria-live="polite">
        {searchLive}
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

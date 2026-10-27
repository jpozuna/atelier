"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FIELDS } from "@/types";
import type { Field, TraceEvent, WhyTag } from "./types";
import {
  buildProfileRequest,
  buildResolveRequest,
  buildWhyRequest,
  readProfile,
  readResolve,
  readWhy,
} from "./api";
import { MAX_QUERY_LENGTH, MAX_SEEDS_PER_USER, MAX_WHY_CHARS } from "@/lib/agent/config";
import { TASTE_PATH, WHY_TIMEOUT_MS } from "./constants";
import { COPY, FIELD_LABEL, FIELD_PROMPT, isCalmError } from "./copy";
import {
  addEntry,
  buildEntry,
  canonical,
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
import type { Draft, Entry } from "./flow";
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

/** Why-lookups still running, by seed id. Several can run at once; each seed still makes exactly one. */
type Pending = ReadonlySet<string>;

/**
 * The flow. The form is part of the server render, so the first paint is the real page and not a placeholder. After
 * hydration the stored list is read into this same instance, so nothing the person has typed or focused is lost.
 */
export function OnboardingFlow() {
  const hydrated = useHydrated();
  const router = useRouter();
  const [draft, dispatch] = useReducer(draftReducer, FIELDS[0], initialDraft);
  const [entries, setEntries] = useState<Entry[]>([]);
  /** True once the stored list has been read (or there was none). Nothing is saved or sent before. */
  const [live, setLive] = useState(false);
  /** Seeds added in this visit, whose note line keeps its height after the reading clears. */
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());

  // Once hydrated, read the stored list into this same instance (not a remount, so typing and focus stay). Done
  // during render, as React advises for state that follows an outside value; nothing is saved before it.
  if (hydrated && !live) {
    setLive(true);
    const stored = loadFlowSession();
    if (stored) {
      setEntries(stored.entries);
      dispatch({ type: "restoreField", field: stored.field });
    }
  }

  const [queryError, setQueryError] = useState("");
  const [whyError, setWhyError] = useState("");
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState<Pending>(() => new Set());
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");
  const [buildCalm, setBuildCalm] = useState(false);
  const [announce, setAnnounce] = useState("");
  /** Bumped when "See my taste" is pressed before the list is ready, so the reason is announced each time. */
  const [blocked, setBlocked] = useState(0);

  // The latest list, so work that finishes after an await checks the list as it is now, not as it was.
  const entriesRef = useRef(entries);
  const pendingRef = useRef(new Map<string, Promise<void>>());
  /** True from "See my taste" until it fails. Late reasons then do not drop the chart that is about to be saved. */
  const buildingRef = useRef(false);
  /** The draft the last seed was added from, so a quick second press of Add on the same render adds nothing. */
  const addedDraftRef = useRef<Draft | null>(null);
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

  /**
   * A reason finished being read: swap the entry in place. The stored chart is dropped only when the tags really
   * changed, and not while the chart is being drawn (it is built from the finished list and saved right after).
   */
  function replaceEntry(entry: Entry) {
    const list = entriesRef.current;
    const old = list.find((x) => x.seed.id === entry.seed.id);
    if (!old) return;
    const next = list.map((x) => (x.seed.id === entry.seed.id ? entry : x));
    entriesRef.current = next;
    setEntries(next);
    const changed = canonical(old.seed.whyTags ?? null) !== canonical(entry.seed.whyTags ?? null);
    if (changed && !buildingRef.current) clearTasteSession();
  }

  // Keeps the ref in step with the state, for the restore below (the other changes write both at once).
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  // Keep the list through a reload of this tab. Not before the stored list has been read, or it would be overwritten.
  useEffect(() => {
    if (live) saveFlowSession({ version: SESSION_VERSION, field: draft.field, entries });
  }, [live, draft.field, entries]);

  // Fetch the chart screen ahead of the button, so the step after "See my taste" opens without a wait.
  useEffect(() => {
    if (live) router.prefetch(TASTE_PATH);
  }, [live, router]);

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
  const busy = building;

  async function onFind(e: FormEvent) {
    e.preventDefault();
    if (!live || searching || building) return;
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

  function onAdd(e: FormEvent) {
    e.preventDefault();
    // While the chart is being drawn the list is fixed. A repeat press on the same render is the same add.
    if (building || draft === addedDraftRef.current) return;
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
    // The seed goes on the list at once, so the form is free for the next one. Its reason is read in the background.
    const built = buildEntry(draft, id, undefined);
    if (!built) return;
    const probe: Entry = { ...built, whyPending: true };
    const next = addEntry(entriesRef.current, probe);
    if (!next.ok) {
      setFormError(next.message);
      return;
    }
    addedDraftRef.current = draft;
    commit(next.entries);
    setFresh((f) => new Set(f).add(id));
    setAnnounce(COPY.added(probe.matchedLabel));
    dispatch({ type: "reset" });
    // A full list replaces the form, so focus has to go somewhere that still exists.
    if (next.entries.length >= MAX_SEEDS_PER_USER) listHeadingRef.current?.focus();
    else queryRef.current?.focus();

    const task = readReason(draft, id, why.value).finally(() => {
      pendingRef.current.delete(id);
      setPending((p) => {
        const rest = new Set(p);
        rest.delete(id);
        return rest;
      });
    });
    pendingRef.current.set(id, task);
    setPending((p) => new Set(p).add(id));
  }

  /**
   * One why-lookup for one seed. Never throws. A failure, or no answer within WHY_TIMEOUT_MS, leaves the seed on the
   * list without mapped tags. A seed removed meanwhile is not touched or announced.
   */
  async function readReason(d: Draft, id: string, why: string) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), WHY_TIMEOUT_MS);
    let tags: WhyTag[] | undefined;
    let event: TraceEvent | undefined;
    try {
      const req = buildWhyRequest(d.field, why, id);
      const res = await fetch(req.url, { ...req.init, signal: abort.signal });
      const body: unknown = await res.json().catch(() => null);
      const read = readWhy(res.status, body);
      if (read.ok) tags = read.tags;
      event = read.event;
    } catch {
      // Unmapped: the profile build treats the seed as "never mapped".
    } finally {
      clearTimeout(timer);
    }
    if (!entriesRef.current.some((x) => x.seed.id === id)) return;
    const built = buildEntry(d, id, tags, event);
    if (built) {
      replaceEntry(built);
      if (!built.whyMapped) setAnnounce(COPY.addedUnmapped(built.matchedLabel));
    }
  }

  function onRemove(id: string) {
    if (busy) return;
    const gone = entriesRef.current.find((x) => x.seed.id === id);
    commit(removeEntry(entriesRef.current, id));
    // Nothing waits on a removed seed's reason.
    pendingRef.current.delete(id);
    setPending((p) => {
      if (!p.has(id)) return p;
      const rest = new Set(p);
      rest.delete(id);
      return rest;
    });
    if (gone) setAnnounce(COPY.removed(gone.matchedLabel));
    listHeadingRef.current?.focus();
  }

  async function onSeeTaste() {
    if (busy) return;
    if (!ready.ready) {
      setBlocked((n) => n + 1);
      return;
    }
    buildingRef.current = true;
    setBuilding(true);
    setBuildError("");
    setBuildCalm(false);
    // Reasons still being read finish first, so the chart is drawn from all of them. They run together, not in turn.
    // The list cannot grow while building, but look again in case a lookup started just before the press.
    while (pendingRef.current.size > 0) await Promise.all([...pendingRef.current.values()]);
    const list = entriesRef.current;
    const seeds = profileSeeds(list);
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
        buildingRef.current = false;
        setBuilding(false);
        return;
      }
      saveTasteSession({
        version: SESSION_VERSION,
        seeds,
        profile: read.result.profile,
        axes: read.result.axes,
        trace: assembleTrace(list, read.result.trace),
      });
      router.push(TASTE_PATH);
    } catch {
      setBuildError(COPY.profileFailed);
      buildingRef.current = false;
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
                <button
                  type="submit"
                  className={styles.secondary}
                  disabled={!live}
                  aria-disabled={searching || building}
                  aria-busy={searching}
                >
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
                <button type="submit" className={styles.primary} aria-disabled={building}>
                  {COPY.add}
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

      <SeedList ref={listHeadingRef} entries={entries} busy={busy} pending={pending} reserve={fresh} onRemove={onRemove} />

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

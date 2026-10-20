"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Field, Reaction } from "@/types";
import { FIELDS } from "@/types";
import { AttributeChart } from "@/components/chart";
import { PickCard } from "@/components/card";
import { ReasoningPanel, buildSteps } from "@/components/reasoning";
import { TASTE_PATH } from "@/components/onboarding/constants";
import { ANNOUNCE_CLEAR_MS, FOLLOW_THRESHOLD_PX, MAX_NOT_ME_RERUNS, NOTE_CLEAR_MS, REVEAL_TOTAL_MS } from "./constants";
import { COPY, failedBodyFor, failedTitleFor, rerunFailedFor } from "./copy";
import { EdgeDeck } from "./EdgeDeck";
import { FieldToggles, toggleDomId } from "./FieldToggles";
import { affectedFields, buildView, pickNameMap, revealDelays, seedNameMap, toChartPick, toggleHidden } from "./grouping";
import type { CalibrationItem } from "./grouping";
import { PickTile, tileDomId } from "./PickTile";
import { buildRunBody, rerunExclude } from "./request";
import type { RunBody } from "./request";
import { initialRunState, isStreaming, runReducer } from "./run-state";
import { fetchRunSource } from "./source";
import type { RunHandle, RunSource } from "./source";
import { loadStored, saveStored, sessionKey } from "./storage";
import type { RunInputs } from "./types";
import styles from "./PicksScreen.module.css";

export interface PicksScreenProps {
  inputs: RunInputs;
  /** Where messages come from. Default: POST /api/run. The dev preview streams a synthetic run instead. */
  source?: RunSource;
  /** Keep picks in sessionStorage so a revisit makes no run. Default true. */
  persist?: boolean;
}

const defaultSource = fetchRunSource();


/** Where focus goes next, once the screen has re-rendered: an element by id, or the open card's title. */
type FocusTarget = { kind: "id"; id: string } | { kind: "card" };

const CALIBRATION_HEADING_ID = "calibration-heading";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The picks screen: the chart, the selected card and the reasoning panel on one screen, with calibration picks
 * first and then the edge decks by field. Guests are fully served: nothing here needs an account, and nothing
 * leaves the browser except the run request.
 */
export function PicksScreen({ inputs, source = defaultSource, persist = true }: PicksScreenProps) {
  const key = useMemo(() => sessionKey(inputs), [inputs]);

  // What a revisit starts from. Read once, on the first render (the screen only mounts after hydration).
  const [restored] = useState(() => (persist ? loadStored(key) : null));
  const [state, dispatch] = useReducer(runReducer, restored, (r) =>
    r ? initialRunState({ result: r.result, events: r.events }) : { ...initialRunState(), phase: "running" as const },
  );
  const [hidden, setHidden] = useState<Field[]>(restored?.hidden ?? []);
  const [notMe, setNotMe] = useState<string[]>(restored?.notMe ?? []);
  const [reactions, setReactions] = useState<Record<string, Reaction>>(restored?.reactions ?? {});
  const [reruns, setReruns] = useState(restored?.reruns ?? 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [calibrationNote, setCalibrationNote] = useState("");
  const [focusReq, setFocusReq] = useState<{ target: FocusTarget; n: number } | null>(null);
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const [revealDoneFor, setRevealDoneFor] = useState<string[] | null>(null);

  const handle = useRef<RunHandle | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const chartRef = useRef<HTMLElement>(null);
  /** The control the open card came from (a tile, a chart node or a chart list button), for Close. */
  const origin = useRef<HTMLElement | SVGElement | null>(null);
  const eventsRef = useRef(state.events);

  const launch = useCallback(
    (body: RunBody) => {
      handle.current?.cancel();
      handle.current = source(body, {
        onMessage: (message) => dispatch({ type: "message", message }),
        onEnd: () => dispatch({ type: "closed" }),
      });
    },
    [source],
  );

  // The first run, when there is nothing to restore. The timer keeps a development double-mount from sending two.
  const needsFirstRun = useRef(restored === null);
  useEffect(() => {
    if (!needsFirstRun.current) return;
    const timer = setTimeout(() => {
      needsFirstRun.current = false;
      launch(buildRunBody(inputs));
    }, 0);
    return () => clearTimeout(timer);
  }, [inputs, launch]);
  useEffect(() => () => handle.current?.cancel(), []);

  function retry() {
    dispatch({ type: "start" });
    launch(buildRunBody(inputs));
  }

  // Keep the picks for a revisit. The person's own choices (set aside, hidden, reactions, re-run count) are saved
  // even while a run is streaming, so leaving mid-run cannot bring a set-aside pick back. The trace is saved
  // once the run ends, so a stream does not rewrite storage on every event.
  useEffect(() => {
    eventsRef.current = state.events;
  }, [state.events]);
  useEffect(() => {
    if (!persist || !state.result) return;
    saveStored({ version: 1, key, result: state.result, events: eventsRef.current, notMe, hidden, reactions, reruns });
  }, [persist, key, state.result, state.phase, notMe, hidden, reactions, reruns]);

  // Messages clear once they have been spoken or read.
  useEffect(() => {
    if (!announce) return;
    const timer = setTimeout(() => setAnnounce(""), ANNOUNCE_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [announce]);
  useEffect(() => {
    if (!calibrationNote) return;
    const timer = setTimeout(() => setCalibrationNote(""), NOTE_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [calibrationNote]);

  const view = useMemo(() => buildView(state.result, { hidden, notMe, seeds: inputs.seeds }), [state.result, hidden, notMe, inputs.seeds]);
  // A stable array: the chart resets its hover and focus whenever this identity changes.
  const chartPicks = useMemo(() => view.picks.map(toChartPick), [view.picks]);
  // Only the picks that just arrived take the reveal; a restored session or a re-run does not replay it.
  const fresh = useMemo(() => new Set(state.freshIds), [state.freshIds]);
  const delays = useMemo(() => (fresh.size > 0 && revealDoneFor !== state.freshIds ? revealDelays(view, fresh) : undefined), [fresh, revealDoneFor, state.freshIds, view]);
  const seedNames = useMemo(() => seedNameMap(inputs.seeds), [inputs.seeds]);
  const pickNames = useMemo(() => pickNameMap(state.result), [state.result]);
  const steps = useMemo(() => buildSteps(state.events, { seedNames, pickNames }), [state.events, seedNames, pickNames]);
  const latest = steps.length > 0 ? steps[steps.length - 1] : null;
  const streaming = isStreaming(state);

  // The selection is derived: a pick that is hidden or set aside simply is not found.
  const selected = selectedId ? view.byId.get(selectedId) ?? null : null;

  // Once a batch of tiles has had its reveal, tiles that appear later (a field shown again) simply appear.
  useEffect(() => {
    if (state.freshIds.length === 0) return;
    const ids = state.freshIds;
    const timer = setTimeout(() => setRevealDoneFor(ids), REVEAL_TOTAL_MS);
    return () => clearTimeout(timer);
  }, [state.freshIds]);

  const clearSelection = useCallback(() => setSelectedId(null), []);
  const requestFocus = useCallback((target: FocusTarget) => setFocusReq((r) => ({ target, n: (r?.n ?? 0) + 1 })), []);

  function selectFromTile(id: string) {
    origin.current = document.getElementById(tileDomId(id));
    setSelectedId(id);
    requestFocus({ kind: "card" });
  }

  function selectFromChart(id: string) {
    const active = document.activeElement;
    origin.current = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    setSelectedId(id);
    requestFocus({ kind: "card" });
  }

  // Move focus where the last action says, after the screen has re-rendered. Focus never falls to the page body.
  useEffect(() => {
    if (!focusReq) return;
    const { target } = focusReq;
    if (target.kind === "id") {
      document.getElementById(target.id)?.focus();
      return;
    }
    const wrap = cardRef.current;
    const title = wrap?.querySelector<HTMLElement>("article h2");
    if (!wrap || !title) return;
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
    wrap.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [focusReq]);

  function closeCard() {
    const back = origin.current;
    setSelectedId(null);
    if (back && back.isConnected && back !== document.body) back.focus();
    else chartRef.current?.focus();
  }

  function setAside(item: CalibrationItem) {
    const pick = item.pick;
    if (streaming) {
      setCalibrationNote(COPY.notMeWaiting);
      setAnnounce(COPY.notMeWaiting);
      return;
    }
    const next = [...notMe, pick.qlooId];
    // Focus goes to the next tile, or to the heading when none is left.
    const at = view.calibration.findIndex((c) => c.pick.id === pick.id);
    const neighbour = view.calibration[at + 1] ?? view.calibration[at - 1];
    requestFocus({ kind: "id", id: neighbour ? tileDomId(neighbour.pick.id) : CALIBRATION_HEADING_ID });
    setNotMe(next);
    if (selectedId === pick.id) setSelectedId(null);
    if (reruns >= MAX_NOT_ME_RERUNS) {
      setCalibrationNote(COPY.setAsideOnly(pick.name));
      setAnnounce(COPY.setAsideOnly(pick.name));
      return;
    }
    const fields = affectedFields(pick);
    setReruns((n) => n + 1);
    setCalibrationNote(COPY.settingAside(pick.name));
    setAnnounce(COPY.settingAside(pick.name));
    dispatch({ type: "start", refresh: { fields, aside: next } });
    launch(buildRunBody(inputs, { exclude: rerunExclude(state.result, fields, next), plan: state.result?.plan, domains: fields }));
  }

  function toggleField(field: Field) {
    const nextHidden = toggleHidden(hidden, field);
    setHidden(nextHidden);
    setAnnounce(nextHidden.includes(field) ? COPY.hiddenAnnounce(field) : COPY.shownAnnounce(field));
    // A deck that hides itself takes its Hide button with it: focus goes to that field's toggle.
    requestFocus({ kind: "id", id: toggleDomId(field) });
  }

  function react(id: string, reaction: Reaction) {
    setReactions((r) => ({ ...r, [id]: reaction }));
  }

  // Follow the newest step inside the panel while it streams, unless the person has scrolled up to read.
  const stepCount = steps.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !streaming || !following.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [stepCount, streaming, reasoningOpen]);

  function onPanelScroll() {
    const el = scrollRef.current;
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
  }

  function showAllSteps() {
    setReasoningOpen(true);
    following.current = true;
    sideRef.current?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  }

  const readyText = state.phase === "done" && state.result ? COPY.ready(view.picks.length) : "";
  const fieldsInResult = useMemo(() => FIELDS.filter((f) => state.result?.domains.some((d) => d.domain === f)), [state.result]);
  const anyShown = view.decks.some((d) => !d.hidden);
  const cardFor = selected ? (reactions[selected.id] ? { ...selected.card, reaction: reactions[selected.id] } : selected.card) : null;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <header className={styles.intro}>
          <h1 className={styles.title}>{COPY.title}</h1>
          <p className={styles.lede}>{COPY.lede}</p>
        </header>

        {/* One polite line for what the person did and for the result arriving. The panel announces the steps. */}
        <p className="sr-only" role="status">
          {announce || readyText}
        </p>

        {/* The newest step, near the top: on a phone the panel is far below. The slot keeps its height, so the chart does not jump. */}
        {latest || streaming ? (
          <p className={reasoningOpen ? `${styles.latest} ${styles.latestNarrow}` : styles.latest}>
            <span className={styles.latestLabel}>{streaming ? COPY.latestStep : COPY.lastStep}</span>
            <span className={styles.latestText}>{latest ? latest.text : COPY.working}</span>
            {latest ? (
              <button type="button" className={styles.link} onClick={showAllSteps}>
                {COPY.readAllSteps}
              </button>
            ) : null}
          </p>
        ) : null}

        <section ref={chartRef} tabIndex={-1} className={styles.chart} aria-label={COPY.chartLabel}>
          <AttributeChart
            axes={inputs.axes}
            picks={chartPicks}
            selectedId={selected?.id ?? null}
            onSelect={(p) => selectFromChart(p.id)}
            onClear={clearSelection}
            label={COPY.chartLabel}
            showConnectionWeight={false}
          />
        </section>

        {cardFor && selected ? (
          <section className={styles.selected} aria-label={COPY.selectedLabel}>
            <div ref={cardRef} className={styles.cardWrap}>
              <PickCard key={selected.id} card={cardFor} title={selected.name} field={selected.field} headingLevel={2} onReact={(r) => react(selected.id, r)} />
            </div>
            <button type="button" className={styles.quiet} onClick={closeCard}>
              {COPY.close}
            </button>
          </section>
        ) : state.result ? (
          <p className={styles.hintLine}>{COPY.noneSelected}</p>
        ) : null}

        {state.phase === "not_ready" ? <NotReady /> : null}
        {state.phase === "failed" ? <Failed code={state.errorCode} onRetry={retry} /> : null}

        {state.result ? (
          <>
            <section className={styles.section} aria-labelledby="calibration-heading">
              <h2 id={CALIBRATION_HEADING_ID} tabIndex={-1} className={styles.sectionTitle}>
                {COPY.calibrationHeading}
              </h2>
              <p className={styles.sectionLede}>{COPY.calibrationLede}</p>
              {state.refreshing.length > 0 ? <p className={styles.working}>{COPY.rerunning}</p> : null}
              {calibrationNote ? <p className={styles.note}>{calibrationNote}</p> : null}
              {state.rerunError ? <p className={styles.note}>{rerunFailedFor(state.rerunError)}</p> : null}
              {view.calibration.length > 0 ? (
                <ul className={styles.tiles}>
                  {view.calibration.map((c) => (
                    <PickTile
                      key={c.pick.id}
                      pick={c.pick}
                      selected={c.pick.id === selected?.id}
                      onSelect={selectFromTile}
                      revealDelayMs={delays?.get(c.pick.id)}
                      kicker={c.scope === "same_field" ? COPY.sameField(c.seedLabel) : c.scope === "other_field" ? COPY.otherField(c.seedLabel) : null}
                      onNotMe={() => setAside(c)}
                      notMeBusy={streaming}
                    />
                  ))}
                </ul>
              ) : (
                <p className={styles.note}>{COPY.calibrationEmpty}</p>
              )}
            </section>

            <section className={styles.section} aria-labelledby="edge-heading">
              <h2 id="edge-heading" className={styles.sectionTitle}>
                {COPY.edgeHeading}
              </h2>
              <p className={styles.sectionLede}>{COPY.edgeLede}</p>
              <FieldToggles fields={fieldsInResult} hidden={hidden} onToggle={toggleField} />
              {!anyShown ? <p className={styles.note}>{COPY.allHidden}</p> : null}
              {view.decks
                .filter((d) => !d.hidden)
                .map((d) => (
                  <EdgeDeck key={d.field} deck={d} selectedId={selected?.id ?? null} onSelect={selectFromTile} onHide={() => toggleField(d.field)} delays={delays} />
                ))}
            </section>
          </>
        ) : null}
      </div>

      <aside ref={sideRef} className={styles.side} aria-label={COPY.reasoningLabel}>
        <div ref={scrollRef} className={styles.sideScroll} onScroll={onPanelScroll} tabIndex={0} role="group" aria-label={COPY.stepsLabel}>
          <ReasoningPanel
            events={state.events}
            streaming={streaming}
            seedNames={seedNames}
            pickNames={pickNames}
            title={COPY.reasoningTitle}
            headingLevel={2}
            landmark={false}
            open={reasoningOpen}
            onOpenChange={setReasoningOpen}
          />
        </div>
      </aside>
    </div>
  );
}

/** The switch for live picks is closed on the server. Calm, not an error page. */
function NotReady() {
  return (
    <section className={styles.state} aria-labelledby="not-ready-title" role="status">
      <h2 id="not-ready-title" className={styles.sectionTitle}>
        {COPY.notReadyTitle}
      </h2>
      <p className={styles.sectionLede}>{COPY.notReadyBody}</p>
      <p>
        <Link className={styles.linkPlain} href={TASTE_PATH}>
          {COPY.backToChart}
        </Link>
      </p>
    </section>
  );
}

function Failed({ code, onRetry }: { code: string | null; onRetry: () => void }) {
  return (
    <section className={styles.state} aria-labelledby="failed-title" role="alert">
      <h2 id="failed-title" className={styles.sectionTitle}>
        {failedTitleFor(code)}
      </h2>
      <p className={styles.sectionLede}>{failedBodyFor(code)}</p>
      <button type="button" className={styles.quiet} onClick={onRetry}>
        {COPY.retry}
      </button>
    </section>
  );
}

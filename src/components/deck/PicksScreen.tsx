"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { Field, Reaction } from "@/types";
import { FIELDS } from "@/types";
import { AttributeChart } from "@/components/chart";
import { useReactionSaver } from "@/components/reactions";
import { ANNOUNCE_CLEAR_MS, MAX_NOT_ME_RERUNS, NOTE_CLEAR_MS } from "@/lib/agent/config";
import { TASTE_PATH } from "@/components/onboarding/constants";
import { COPY, FIELD_LABEL, failedBodyFor, failedTitleFor, rerunFailedFor } from "./copy";
import { createPicksDerivation } from "./derive";
import { affectedFields, toggleHidden } from "./grouping";
import type { CalibrationItem } from "./grouping";
import { PickTile, tileDomId } from "./PickTile";
import { ReasoningArea } from "./ReasoningArea";
import { buildRunBody, notMeRerunBody } from "./request";
import type { RunBody } from "./request";
import { initialRunState, isStreaming, pendingFields, runReducer, shownResult } from "./run-state";
import { fetchRunSource } from "./source";
import type { RunHandle, RunSource } from "./source";
import { loadStored, saveStored, sessionKey } from "./storage";
import { ChartBar, SuggestionList, checkDomId } from "./SuggestionList";
import { chartSelection, edgeSuggestions, toggleChecked } from "./suggestions";
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
type FocusTarget = { kind: "id"; id: string; orChart?: boolean } | { kind: "card" };

const CALIBRATION_HEADING_ID = "calibration-heading";
const EDGE_HEADING_ID = "edge-heading";
/** The DOM id of a field's entry in the chart key (the chart's own contract), so hiding a field can hand focus back to it. */
const keyDomId = (f: Field) => `chart-key-${f}`;

const WIDE_QUERY = "(min-width: 64rem)";
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
/** True from 64rem, where the chart and the panel sit side by side and the panel scrolls inside itself. */
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => false);

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The picks screen. From 64rem the left column is the title and the chart, whose key is the field filter. A panel on
 * the right keeps its place and scrolls inside itself: first the edge suggestions, grouped by field and ticked onto
 * the chart, then the close picks (which can be set aside); opening a suggestion swaps both for its reasoning, with a
 * way back. Below 64rem it stacks: title, key, chart, then the same panel, and a bar sticks to the bottom while
 * anything is on the chart. Picks appear per field as each arrives, and a stopped run keeps what came. The run's steps
 * are not shown here: only the final reasoning for the pick you open. Ticking only changes the chart; opening a row
 * reads it.
 * Guests are fully served: nothing here needs an account, and nothing leaves the browser except the run request.
 */
export function PicksScreen({ inputs, source = defaultSource, persist = true }: PicksScreenProps) {
  const key = useMemo(() => sessionKey(inputs), [inputs]);

  // What a revisit starts from. Read once, on the first render (the screen only mounts after hydration).
  const [restored] = useState(() => (persist ? loadStored(key) : null));
  const [state, dispatch] = useReducer(runReducer, restored, (r) =>
    r ? initialRunState({ result: r.result, events: r.events }) : { ...initialRunState(), phase: "running" as const },
  );
  const saver = useReactionSaver({ inputs, result: state.result });
  const save = saver.save;
  const [hidden, setHidden] = useState<Field[]>(restored?.hidden ?? []);
  const [notMe, setNotMe] = useState<string[]>(restored?.notMe ?? []);
  const [reactions, setReactions] = useState<Record<string, Reaction>>(restored?.reactions ?? {});
  const [reruns, setReruns] = useState(restored?.reruns ?? 0);
  /** The suggestion being read in the reasoning area. */
  const [focusId, setFocusId] = useState<string | null>(null);
  /** The ticked suggestions, shown together on the chart. Ticking never changes the one being read. */
  const [checked, setChecked] = useState<string[]>([]);
  /** The row being hovered or focused, drawn on the chart only while it lasts. */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [calibrationNote, setCalibrationNote] = useState("");
  const [focusReq, setFocusReq] = useState<{ target: FocusTarget; n: number } | null>(null);

  const handle = useRef<RunHandle | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLElement>(null);
  const wide = useWide();
  const announcedReady = useRef(restored !== null);
  const derive = useState(createPicksDerivation)[0];
  /** Where the open card came from, for "Back to suggestions": a list row or tile by its DOM id (a close pick's tile is
   *  gone while the card is open, so it is found again after the screen re-renders), or a chart node. */
  const origin = useRef<string | HTMLElement | SVGElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef(state.events);
  /** Reactions given to early picks, before the final result exists to save them against. Replayed when it arrives. */
  const pendingReactions = useRef<Map<string, Reaction>>(new Map());

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
    // A fresh run: what was ticked, opened or previewed belonged to the picks of the run that stopped.
    setChecked([]);
    setFocusId(null);
    setPreviewId(null);
    setCalibrationNote("");
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

  // Early picks cannot be saved (nothing partial is stored). A reaction given to one is kept on screen; when the final
  // result arrives, each one whose pick is in it is saved then, and the rest are dropped.
  useEffect(() => {
    if (!state.result || pendingReactions.current.size === 0) return;
    const ids = new Set(state.result.domains.flatMap((d) => d.picks.map((p) => p.id)));
    for (const [id, reaction] of pendingReactions.current) if (ids.has(id)) save(id, reaction);
    pendingReactions.current.clear();
  }, [state.result, save]);

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

  // Rebuilt only when the result, hidden fields, set-aside ids, seeds or axes change. Ticking, reading, previewing
  // and sorting leave `chartPicks` as the very same array: the chart resets its hover and focus when it changes.
  // What is drawn is `shownResult(state)`: the early picks while they are the newest, else the final result. Storage, the
  // saver and the re-run body keep reading `state.result` only, so nothing partial is ever saved or sent back.
  const shown = shownResult(state);
  const { view, chartPicks, showConnectionWeight, placements, visibleIds } = derive({ result: shown, hidden, notMe, seeds: inputs.seeds, axes: inputs.axes });
  // What the chart is told is selected. The row being previewed goes to the chart's own `previewId`, never into the
  // selection: a selection opens the readout under the plot, and a row under the mouse changing the page's height made
  // the page and the sticky panel oscillate (the panel moves off the row, the preview ends, the panel moves back).
  const committedIds = useMemo(() => chartSelection(checked, focusId, visibleIds), [checked, focusId, visibleIds]);
  const chartPreviewId = previewId && visibleIds.has(previewId) ? previewId : null;
  const edgePicks = useMemo(() => edgeSuggestions(view.decks), [view.decks]);
  const axisOf = useMemo(() => new Map([...placements].map(([id, p]) => [id, p.axis] as const)), [placements]);
  const streaming = isStreaming(state);

  // The selection is derived: a pick that is hidden or set aside simply is not found.
  const selected = focusId ? view.byId.get(focusId) ?? null : null;

  // The count is said once, when the first result arrives, not again after every action.
  useEffect(() => {
    if (announcedReady.current || state.phase !== "done" || !state.result) return;
    announcedReady.current = true;
    setAnnounce(COPY.ready(view.picks.length));
  }, [state.phase, state.result, view.picks.length]);

  const requestFocus = useCallback((target: FocusTarget) => setFocusReq((r) => ({ target, n: (r?.n ?? 0) + 1 })), []);

  const hasSelection = focusId !== null || checked.length > 0;
  const clearAll = useCallback(() => {
    setFocusId(null);
    setChecked([]);
    setPreviewId(null);
    if (hasSelection) setAnnounce(COPY.cleared);
  }, [hasSelection]);

  function openFromList(id: string) {
    origin.current = tileDomId(id);
    // A close pick's tile leaves with the card, so a preview that was on it would never end.
    setPreviewId(null);
    setFocusId(id);
    requestFocus({ kind: "card" });
  }

  function openFromChart(id: string) {
    const active = document.activeElement;
    origin.current = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    setPreviewId(null);
    setFocusId(id);
    requestFocus({ kind: "card" });
  }

  function check(id: string) {
    // Ticking only adds to or removes from the chart. Which pick is read does not change.
    const next = toggleChecked(checked, id);
    setChecked(next);
    const name = view.byId.get(id)?.name ?? "";
    setAnnounce(next.includes(id) ? COPY.addedAnnounce(name, placements.get(id)?.axis ?? null) : COPY.removedAnnounce(name));
  }

  function viewChart() {
    const el = chartRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }

  /** The way back from the chart on a phone: the last ticked row, else the open one. */
  function backToList() {
    const last = [...checked].reverse().find((id) => visibleIds.has(id));
    const id = last ? checkDomId(last) : focusId ? tileDomId(focusId) : null;
    if (selected) {
      // The card has taken the list's place: back to the suggestions first, then focus goes to that row (or the heading).
      setFocusId(null);
      requestFocus({ kind: "id", id: id ?? EDGE_HEADING_ID, orChart: true });
      return;
    }
    // An open close pick has no row (its card has taken its place): the list's heading is the way back.
    const el = (id ? document.getElementById(id) : null) ?? document.getElementById(EDGE_HEADING_ID);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }

  /** Scroll to a heading of the panel (or the stacked page) and focus it. */
  function goTo(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const behavior = reducedMotion() ? "auto" : "smooth";
    const panel = panelRef.current;
    if (wide && panel) {
      // The panel scrolls inside itself: move only that, so the chart stays where it is.
      panel.scrollTo({ top: panel.scrollTop + el.getBoundingClientRect().top - panel.getBoundingClientRect().top, behavior });
    } else {
      el.scrollIntoView({ block: "start", behavior });
    }
    el.focus({ preventScroll: true });
  }

  function clearFromList() {
    clearAll();
    // The Clear button leaves with the ticks: focus goes to the list's heading, not to the page body.
    requestFocus({ kind: "id", id: EDGE_HEADING_ID });
  }

  // The panel swaps the close picks for the card and back: each starts at its top, not where the other was scrolled.
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [selectedId]);

  // Move focus where the last action says, after the screen has re-rendered. Focus never falls to the page body.
  useEffect(() => {
    if (!focusReq) return;
    const { target } = focusReq;
    if (target.kind === "id") {
      const el = document.getElementById(target.id);
      if (el) el.focus();
      else if (target.orChart) chartRef.current?.focus();
      return;
    }
    const wrap = cardRef.current;
    const title = wrap?.querySelector<HTMLElement>("article h2");
    if (!wrap || !title) return;
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
    if (window.matchMedia(WIDE_QUERY).matches) {
      // The panel scrolls inside itself: start it at its top, so the leading "Back to suggestions" is in view.
      if (panelRef.current) panelRef.current.scrollTop = 0;
    } else {
      // Stacked below the chart: the whole area (its Back control first) comes to the top, not the card inside it.
      (wrap.closest("section") ?? wrap).scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }, [focusReq]);

  function closeCard() {
    const back = origin.current;
    setFocusId(null);
    if (typeof back === "string") requestFocus({ kind: "id", id: back, orChart: true });
    else if (back && back.isConnected && back !== document.body) back.focus();
    else chartRef.current?.focus();
  }

  function setAside(item: CalibrationItem) {
    const pick = item.pick;
    if (streaming) {
      setCalibrationNote(COPY.notMeWaiting);
      setAnnounce(COPY.notMeWaiting);
      return;
    }
    if (!state.result) {
      // A stopped run's partial picks: there is no result to re-run from, so ask for a full run first.
      setCalibrationNote(COPY.notMeStopped);
      setAnnounce(COPY.notMeStopped);
      return;
    }
    const next = [...notMe, pick.qlooId];
    // Focus goes to the next tile, or to the heading when none is left.
    const at = view.calibration.findIndex((c) => c.pick.id === pick.id);
    const neighbour = view.calibration[at + 1] ?? view.calibration[at - 1];
    requestFocus({ kind: "id", id: neighbour ? tileDomId(neighbour.pick.id) : CALIBRATION_HEADING_ID });
    setNotMe(next);
    if (focusId === pick.id) setFocusId(null);
    setChecked((c) => c.filter((id) => id !== pick.id));
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
    // The body carries `notMe`: the id set aside just now, so the run log records exactly which pick was "not me" (T-27).
    launch(notMeRerunBody(inputs, state.result, pick, fields, next));
  }

  function toggleField(field: Field) {
    const nextHidden = toggleHidden(hidden, field);
    setHidden(nextHidden);
    if (nextHidden.includes(field)) {
      // A pick in a field that has just been hidden leaves the chart, and stays off it when the field is shown again.
      const ids = new Set(shown?.domains.find((d) => d.domain === field)?.picks.map((p) => p.id) ?? []);
      setChecked((c) => c.filter((id) => !ids.has(id)));
      setPreviewId(null);
    }
    setAnnounce(nextHidden.includes(field) ? COPY.hiddenAnnounce(field) : COPY.shownAnnounce(field));
    // The key entry stays where it is: focus goes (back) to that field's button in the chart key.
    requestFocus({ kind: "id", id: keyDomId(field) });
  }

  function react(id: string, reaction: Reaction) {
    setReactions((r) => ({ ...r, [id]: reaction }));
    if (state.result?.domains.some((d) => d.picks.some((p) => p.id === id))) {
      pendingReactions.current.delete(id);
      saver.save(id, reaction);
    } else {
      // An early pick: kept for the final result.
      pendingReactions.current.set(id, reaction);
    }
  }

  const fieldsInResult = useMemo(() => FIELDS.filter((f) => shown?.domains.some((d) => d.domain === f)), [shown]);
  const anyShown = view.decks.some((d) => !d.hidden);
  const cardFor = selected ? (reactions[selected.id] ? { ...selected.card, reaction: reactions[selected.id] } : selected.card) : null;
  const notes = view.decks.filter((d) => !d.hidden && (d.note || d.picks.length === 0)).map((d) => ({ field: d.field, text: d.note ?? COPY.deckEmpty(d.field) }));
  // The panel has a place when the run is going, or there is something to show (early picks count). A failed run with
  // nothing delivered has neither.
  const showPanel = shown !== null || streaming;
  // Fields whose picks have not come yet: a quiet line while the run is going, a calm note if it stopped.
  const coming = pendingFields(state);
  // A stream that broke, or whose switch closed, after some fields arrived: those picks stay, with a calm note.
  const stopped = (state.phase === "failed" || state.phase === "not_ready") && state.partial !== null ? FIELDS.filter((f) => !state.arrived.includes(f)) : null;

  // The hint sits right above the key, and only when there is something to hide (two fields or more). On a phone a quiet
  // link says where the suggestions are, since they are further down than the chart.
  const showKeyHint = fieldsInResult.length >= 2;
  const showEdgeLink = !wide && shown !== null && selected === null;

  const edgeSection = shown ? (
    <section className={styles.edge} aria-labelledby={EDGE_HEADING_ID}>
      <SuggestionList
        picks={edgePicks}
        selectedId={selected?.id ?? null}
        checked={checked.filter((id) => visibleIds.has(id))}
        chartCount={committedIds.length}
        axisOf={axisOf}
        onOpen={openFromList}
        onCheck={check}
        onClear={clearFromList}
        onPreview={setPreviewId}
        heading={
          <h2 id={EDGE_HEADING_ID} tabIndex={-1} className={styles.edgeTitle}>
            {COPY.edgeHeading}
          </h2>
        }
        lede={<p className={styles.edgeLede}>{COPY.edgeLede}</p>}
        status={
          stopped ? (
            <div className={styles.stopped}>
              <p className={styles.note} role="status">
                {COPY.partialStopped(stopped)}
              </p>
              {state.phase === "failed" ? (
                <button type="button" className={styles.quiet} onClick={retry}>
                  {COPY.retry}
                </button>
              ) : null}
            </div>
          ) : state.refreshing.length === 0 && coming.length > 0 ? (
            <p className={styles.coming}>{COPY.stillComing(coming)}</p>
          ) : null
        }
        notice={
          <div className={styles.edgeNotes}>
            {!anyShown ? <p className={styles.note}>{COPY.allHidden}</p> : null}
            {notes.length > 0 ? (
              <ul className={styles.fieldNotes}>
                {notes.map((n) => (
                  <li key={n.field}>
                    <strong>{FIELD_LABEL[n.field]}:</strong> {n.text}
                  </li>
                ))}
              </ul>
            ) : null}
            {/* The close picks are a long way down the panel: say so, and offer the way there. */}
            <button type="button" className={styles.textLink} onClick={() => goTo(CALIBRATION_HEADING_ID)}>
              {COPY.closeBelow}
            </button>
          </div>
        }
      />
    </section>
  ) : null;

  return (
    <div className={showPanel ? `${styles.layout} ${styles.split}` : styles.layout}>
      {/* One polite line for what the person did, and for the first result arriving. */}
      <p className="sr-only" role="status">
        {announce}
      </p>

      <div className={styles.main}>
        <header className={styles.intro}>
          <h1 className={styles.title}>{COPY.title}</h1>
          <p className={styles.lede}>{COPY.lede}</p>
        </header>

        <section ref={chartRef} tabIndex={-1} className={styles.chart} aria-label={COPY.chartLabel}>
          {showKeyHint || showEdgeLink ? (
            <div className={styles.keyRow}>
              {showKeyHint ? <p className={styles.keyHint}>{COPY.keyHint}</p> : null}
              {showEdgeLink ? (
                <button type="button" className={styles.textLink} onClick={() => goTo(EDGE_HEADING_ID)}>
                  {COPY.suggestionsBelow}
                </button>
              ) : null}
            </div>
          ) : null}
          <AttributeChart
            axes={inputs.axes}
            picks={chartPicks}
            selectedIds={committedIds}
            previewId={chartPreviewId}
            onSelect={(p) => openFromChart(p.id)}
            onClear={clearAll}
            label={COPY.chartLabel}
            showConnectionWeight={showConnectionWeight}
            hiddenFields={hidden}
            fieldsInKey={fieldsInResult}
            onToggleField={toggleField}
          />
          {committedIds.length > 0 ? (
            <button type="button" className={styles.backToList} onClick={backToList}>
              {COPY.backToList}
            </button>
          ) : null}
        </section>

        {state.phase === "not_ready" ? <NotReady /> : null}
        {state.phase === "failed" && !stopped ? <Failed code={state.errorCode} onRetry={retry} /> : null}
      </div>

      {showPanel ? (
        <div
          ref={panelRef}
          className={styles.panel}
          tabIndex={wide ? 0 : undefined}
          role={wide ? "region" : undefined}
          aria-label={wide ? COPY.panelLabel : undefined}
        >
          {!shown ? (
            <p className={styles.working} role="status">
              {COPY.working}
            </p>
          ) : selected ? (
            // The card takes the place of the suggestions and the close picks. Back to suggestions brings them back.
            <>
              {state.refreshing.length > 0 ? <p className={styles.working}>{COPY.rerunning}</p> : null}
              {state.rerunError ? <p className={styles.note}>{rerunFailedFor(state.rerunError)}</p> : null}
              <ReasoningArea
                selected={selected}
                card={cardFor}
                axes={inputs.axes}
                alsoShown={committedIds.filter((id) => id !== selected.id).length}
                saver={saver}
                onReact={react}
                onClose={closeCard}
                onViewChart={viewChart}
                cardRef={cardRef}
              />
            </>
          ) : (
            <>
              {state.refreshing.length > 0 || calibrationNote || state.rerunError ? (
                <div className={styles.rerunStatus}>
                  {state.refreshing.length > 0 ? <p className={styles.working}>{COPY.rerunning}</p> : null}
                  {calibrationNote ? <p className={styles.note}>{calibrationNote}</p> : null}
                  {state.rerunError ? <p className={styles.note}>{rerunFailedFor(state.rerunError)}</p> : null}
                </div>
              ) : null}
              {edgeSection}
              <section className={styles.section} aria-labelledby={CALIBRATION_HEADING_ID}>
                <h2 id={CALIBRATION_HEADING_ID} tabIndex={-1} className={styles.sectionTitle}>
                  {COPY.calibrationHeading}
                </h2>
                <p className={styles.sectionLede}>{COPY.calibrationLede}</p>
                {view.calibration.length > 0 ? (
                  <ul className={styles.tiles}>
                    {view.calibration.map((c) => (
                      <PickTile
                        key={c.pick.id}
                        pick={c.pick}
                        selected={false}
                        onSelect={openFromList}
                        kicker={c.scope === "same_field" ? COPY.sameField(c.seedLabel) : c.scope === "other_field" ? COPY.otherField(c.seedLabel) : null}
                        onNotMe={() => setAside(c)}
                        notMeBusy={streaming || !state.result}
                        onPreview={setPreviewId}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className={styles.note}>{state.phase === "running" && state.refreshing.length === 0 && state.partial ? COPY.calibrationComing : COPY.calibrationEmpty}</p>
                )}
              </section>
            </>
          )}
        </div>
      ) : null}

      {/* Below 64rem, at the end of the layout so it stays with the person at the plot and the panel, not only the list. */}
      <ChartBar chartCount={committedIds.length} onViewChart={viewChart} onClear={clearFromList} />
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

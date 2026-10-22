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
import { FieldToggles, toggleDomId } from "./FieldToggles";
import { createPicksDerivation } from "./derive";
import { affectedFields, toggleHidden } from "./grouping";
import type { CalibrationItem } from "./grouping";
import { PickTile, tileDomId } from "./PickTile";
import { ReasoningArea } from "./ReasoningArea";
import { buildRunBody, notMeRerunBody } from "./request";
import type { RunBody } from "./request";
import { initialRunState, isStreaming, runReducer } from "./run-state";
import { fetchRunSource } from "./source";
import type { RunHandle, RunSource } from "./source";
import { loadStored, saveStored, sessionKey } from "./storage";
import { SuggestionList, checkDomId } from "./SuggestionList";
import { chartSelection, edgeSuggestions, toggleChecked } from "./suggestions";
import type { SuggestionSort } from "./suggestions";
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
const EDGE_HEADING_ID = "edge-heading";

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
 * The picks screen. From 64rem the chart, with the reasoning for the open pick under it, sits on the left, and a
 * panel on the right (close picks that can be set aside, then one list of edge suggestions that can be sorted,
 * filtered by field and ticked onto the chart) keeps its place and scrolls inside itself. Below 64rem it stacks, and
 * a bar sticks to the bottom while anything is on the chart. The run still streams, but its steps are not shown
 * here: only the final reasoning for the pick you open. Ticking only changes the chart; opening a row reads it.
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
  const [sort, setSort] = useState<SuggestionSort>("field");
  const [announce, setAnnounce] = useState("");
  const [calibrationNote, setCalibrationNote] = useState("");
  const [focusReq, setFocusReq] = useState<{ target: FocusTarget; n: number } | null>(null);

  const handle = useRef<RunHandle | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLElement>(null);
  const wide = useWide();
  const announcedReady = useRef(restored !== null);
  const derive = useState(createPicksDerivation)[0];
  /** The control the open card came from (a list row or a chart node), for Close. */
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

  // Rebuilt only when the result, hidden fields, set-aside ids, seeds or axes change. Ticking, reading, previewing
  // and sorting leave `chartPicks` as the very same array: the chart resets its hover and focus when it changes.
  const { view, chartPicks, showConnectionWeight, placements, visibleIds } = derive({ result: state.result, hidden, notMe, seeds: inputs.seeds, axes: inputs.axes });
  // What the chart is told is selected, with and without the row being previewed. The count never includes a preview.
  const committedIds = useMemo(() => chartSelection(checked, focusId, visibleIds), [checked, focusId, visibleIds]);
  const chartIds = useMemo(() => chartSelection(checked, focusId, visibleIds, previewId), [checked, focusId, visibleIds, previewId]);
  const edgePicks = useMemo(() => edgeSuggestions(view.decks, sort), [view.decks, sort]);
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
    origin.current = document.getElementById(tileDomId(id));
    setFocusId(id);
    requestFocus({ kind: "card" });
  }

  function openFromChart(id: string) {
    const active = document.activeElement;
    origin.current = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
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
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }

  function clearFromList() {
    clearAll();
    // The Clear button leaves with the ticks: focus goes to the list's heading, not to the page body.
    requestFocus({ kind: "id", id: EDGE_HEADING_ID });
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
    setFocusId(null);
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
      const ids = new Set(state.result?.domains.find((d) => d.domain === field)?.picks.map((p) => p.id) ?? []);
      setChecked((c) => c.filter((id) => !ids.has(id)));
      setPreviewId(null);
    }
    setAnnounce(nextHidden.includes(field) ? COPY.hiddenAnnounce(field) : COPY.shownAnnounce(field));
    // The toggle stays where it is: focus goes (back) to that field's toggle.
    requestFocus({ kind: "id", id: toggleDomId(field) });
  }

  function react(id: string, reaction: Reaction) {
    setReactions((r) => ({ ...r, [id]: reaction }));
    saver.save(id, reaction);
  }

  const fieldsInResult = useMemo(() => FIELDS.filter((f) => state.result?.domains.some((d) => d.domain === f)), [state.result]);
  const anyShown = view.decks.some((d) => !d.hidden);
  const cardFor = selected ? (reactions[selected.id] ? { ...selected.card, reaction: reactions[selected.id] } : selected.card) : null;
  const notes = view.decks.filter((d) => !d.hidden && (d.note || d.picks.length === 0)).map((d) => ({ field: d.field, text: d.note ?? COPY.deckEmpty(d.field) }));
  // The panel has a place when the run is going, or there is something to show. A failed run has neither.
  const showPanel = state.result !== null || streaming;

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
          <AttributeChart
            axes={inputs.axes}
            picks={chartPicks}
            selectedIds={chartIds}
            onSelect={(p) => openFromChart(p.id)}
            onClear={clearAll}
            label={COPY.chartLabel}
            showConnectionWeight={showConnectionWeight}
          />
          {committedIds.length > 0 ? (
            <button type="button" className={styles.backToList} onClick={backToList}>
              {COPY.backToList}
            </button>
          ) : null}
        </section>

        {state.result ? (
          // Nothing selected: on narrow screens the chart's own hint says it, so the empty note stays out of the way.
          <div className={selected ? styles.reasoning : `${styles.reasoning} ${styles.reasoningIdle}`}>
            <ReasoningArea
              selected={selected}
              card={cardFor}
              axes={inputs.axes}
              alsoShown={selected ? committedIds.filter((id) => id !== selected.id).length : 0}
              saver={saver}
              onReact={react}
              onClose={closeCard}
              onViewChart={viewChart}
              cardRef={cardRef}
            />
          </div>
        ) : null}

        {state.phase === "not_ready" ? <NotReady /> : null}
        {state.phase === "failed" ? <Failed code={state.errorCode} onRetry={retry} /> : null}
      </div>

      {showPanel ? (
        <div
          className={styles.panel}
          tabIndex={wide ? 0 : undefined}
          role={wide ? "region" : undefined}
          aria-label={wide ? COPY.panelLabel : undefined}
        >
          {!state.result ? (
            <p className={styles.working} role="status">
              {COPY.working}
            </p>
          ) : (
            <>
              <section className={styles.section} aria-labelledby={CALIBRATION_HEADING_ID}>
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
                        onSelect={openFromList}
                        kicker={c.scope === "same_field" ? COPY.sameField(c.seedLabel) : c.scope === "other_field" ? COPY.otherField(c.seedLabel) : null}
                        onNotMe={() => setAside(c)}
                        notMeBusy={streaming}
                        onPreview={setPreviewId}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className={styles.note}>{COPY.calibrationEmpty}</p>
                )}
              </section>

              <section className={styles.section} aria-labelledby={EDGE_HEADING_ID}>
                <h2 id={EDGE_HEADING_ID} tabIndex={-1} className={styles.sectionTitle}>
                  {COPY.edgeHeading}
                </h2>
                <p className={styles.sectionLede}>{COPY.edgeLede}</p>
                <FieldToggles fields={fieldsInResult} hidden={hidden} onToggle={toggleField} />
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
                <SuggestionList
                  picks={edgePicks}
                  sort={sort}
                  onSort={setSort}
                  selectedId={selected?.id ?? null}
                  checked={checked.filter((id) => visibleIds.has(id))}
                  chartCount={committedIds.length}
                  axisOf={axisOf}
                  onOpen={openFromList}
                  onCheck={check}
                  onClear={clearFromList}
                  onViewChart={viewChart}
                  onPreview={setPreviewId}
                />
              </section>
            </>
          )}
        </div>
      ) : null}
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

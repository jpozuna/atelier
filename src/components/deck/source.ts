// Where run messages come from. The screen takes a `RunSource`, so the dev preview can stream a synthetic run and
// the real screen streams POST /api/run. The browser never sees the Qloo key: the route holds it.

import { RUN_URL } from "./constants";
import { buildRunRequest } from "./request";
import type { RunBody } from "./request";
import { codeFromErrorBody, feedSse, readMessage } from "./sse";
import type { RunMessage } from "./sse";

export interface RunHandlers {
  onMessage: (message: RunMessage) => void;
  /** The stream is over (finished, cut off, or failed). Called once, never after `cancel`. */
  onEnd: () => void;
}

export interface RunHandle {
  cancel: () => void;
}

export type RunSource = (body: RunBody, handlers: RunHandlers) => RunHandle;

/** Streams POST /api/run. The HTTP status can be 200 for an in-stream error; the `error` event is what says so. */
export function fetchRunSource(url: string = RUN_URL): RunSource {
  return (body, handlers) => {
    const controller = new AbortController();
    let cancelled = false;
    const emit = (m: RunMessage) => {
      if (!cancelled) handlers.onMessage(m);
    };
    const end = () => {
      if (!cancelled) handlers.onEnd();
    };

    void (async () => {
      try {
        const req = buildRunRequest({ seeds: body.seeds, profile: body.profile, axes: body.axes }, body, url);
        const res = await fetch(req.url, { ...req.init, signal: controller.signal });
        if (!res.ok || !res.body) {
          let code = `http_${res.status}`;
          try {
            code = codeFromErrorBody(res.status, await res.json());
          } catch {
            // Not JSON: the status is enough.
          }
          emit({ type: "error", error: { code } });
          return end();
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const fed = feedSse(buffer, decoder.decode(value, { stream: true }));
          buffer = fed.rest;
          for (const raw of fed.messages) {
            const m = readMessage(raw);
            if (m) emit(m);
          }
        }
        end();
      } catch {
        if (cancelled) return;
        emit({ type: "error", error: { code: "network" } });
        end();
      }
    })();

    return {
      cancel: () => {
        cancelled = true;
        controller.abort();
      },
    };
  };
}

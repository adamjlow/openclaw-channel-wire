// Adapter from the Wire SDK Logger interface to OpenClaw's channel log sink.
// The SDK's info lines include some unobfuscated conversation ids and its debug
// lines dump raw event payloads, so: warn/error pass through, info is demoted
// to debug, debug is dropped, and structured metadata is reduced to Error
// messages only.
import type { Logger } from "@wireapp/wire-apps-js-sdk";
import { redact } from "./redact.js";

export type LogSink = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
};

// SDK 0.1.0 logs this (and nothing else) when WebSocketClient gives up
// reconnecting. Used as a fast signal; the connection watchdog is the backstop
// if the wording changes.
const GIVE_UP_PATTERN = /^WebSocket stopped after \d+ failed reconnect attempts/;

function describeMeta(meta: unknown[]): string {
  const errors = meta
    .filter((item): item is Error => item instanceof Error)
    .map((err) => redact(err.message))
    .filter(Boolean);
  return errors.length ? ` (${errors.join("; ")})` : "";
}

export function createSdkLogger(sink: LogSink | undefined, onGiveUp?: () => void): Logger {
  const prefix = "[wire-sdk] ";
  return {
    debug: () => undefined,
    info: (message) => sink?.debug?.(prefix + redact(message)),
    warn: (message, ...meta) => sink?.warn(prefix + redact(message) + describeMeta(meta)),
    error: (message, ...meta) => {
      sink?.error(prefix + redact(message) + describeMeta(meta));
      if (GIVE_UP_PATTERN.test(message)) onGiveUp?.();
    },
  };
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearSavedMarketVisitBaseline,
  emptySavedMarketScope,
  readSavedMarketScope,
  reconcileSavedMarkets,
  removeSavedMarket,
  savedMarketId,
  savedMarketScopeId,
  isSavedMarketScopeState,
  saveSavedMarket,
  writeSavedMarketScope,
} from "./saved-markets.js";

const EMPTY = { ...emptySavedMarketScope(), baseline: {}, error: null, ready: false };

function browserStorage(name) {
  if (typeof window === "undefined") return null;
  try { return window[name]; } catch { return null; }
}

export function useSavedMarkets(scope) {
  const [state, setState] = useState(EMPTY);
  const available = Boolean(scope?.game && scope?.league);
  const currentScopeKey = savedMarketScopeId(scope);
  const stamp = (value) => ({ ...value, scopeKey: currentScopeKey });

  useEffect(() => {
    if (!available) {
      setState(stamp(EMPTY));
      return;
    }
    const localStorage = browserStorage("localStorage");
    if (!localStorage) {
      setState(stamp({ ...EMPTY, ready: true, error: "Browser storage is unavailable. Saved markets cannot be updated in this browser." }));
      return;
    }
    const result = readSavedMarketScope(localStorage, scope);
    setState(stamp({ ...result.value, baseline: {}, error: result.error, ready: true }));
  }, [available, scope?.game, scope?.league]);

  const reconcile = useCallback((radar) => {
    const localStorage = browserStorage("localStorage");
    const sessionStorage = browserStorage("sessionStorage");
    if (!available || !localStorage || !sessionStorage) {
      const error = "Browser storage is unavailable. Saved market comparisons cannot be updated in this browser.";
      setState((current) => stamp({ ...current, error, ready: true }));
      return { matched: false, returned: false };
    }
    const result = reconcileSavedMarkets({ localStorage, sessionStorage, scope, radar });
    if (result.matched && result.value) setState(stamp({ ...result.value, baseline: result.baseline, error: result.error, ready: true }));
    return result;
  }, [available, scope?.game, scope?.league]);

  const save = useCallback((row, radar) => {
    const localStorage = browserStorage("localStorage");
    if (!available || !localStorage) {
      const error = "Browser storage is unavailable. Your saved markets were not changed.";
      setState((current) => stamp({ ...current, error }));
      return { ok: false, error };
    }
    const next = saveSavedMarket({ storage: localStorage, scope, row, radar });
    if (!next.ok || !next.changed) {
      if (!next.ok) setState((current) => stamp({ ...current, error: next.error, ready: true }));
      return next;
    }
    setState((current) => stamp({ ...next.value, baseline: current.baseline, error: null, ready: true }));
    return next;
  }, [available, scope?.game, scope?.league]);

  const remove = useCallback((entry) => {
    const localStorage = browserStorage("localStorage");
    const sessionStorage = browserStorage("sessionStorage");
    if (!available || !localStorage) {
      const error = "Browser storage is unavailable. Your saved markets were not changed.";
      setState((current) => stamp({ ...current, error }));
      return { ok: false, error };
    }
    const persisted = readSavedMarketScope(localStorage, scope);
    if (persisted.error) {
      setState((current) => stamp({ ...current, error: persisted.error }));
      return { ok: false, error: persisted.error };
    }
    const next = removeSavedMarket(persisted.value, entry);
    const write = writeSavedMarketScope(localStorage, scope, next);
    if (!write.ok) {
      setState((current) => stamp({ ...current, error: write.error }));
      return write;
    }
    const visitWrite = sessionStorage ? clearSavedMarketVisitBaseline(sessionStorage, scope, entry) : {
      ok: false,
      error: "Saved market comparisons are unavailable because this browser blocks session storage.",
    };
    setState((current) => {
      const baseline = { ...current.baseline };
      delete baseline[savedMarketId(entry)];
      return stamp({ ...next, baseline, error: visitWrite.error, ready: true });
    });
    return { ok: true, error: visitWrite.error };
  }, [available, scope?.game, scope?.league]);

  const visible = isSavedMarketScopeState(state, scope) ? state : stamp(EMPTY);
  const ids = useMemo(() => new Set(visible.saved.map(savedMarketId)), [visible.saved]);
  return { ...visible, ids, isSaved: (row) => ids.has(savedMarketId({ ...scope, target: row?.target, anchor: row?.anchor })), reconcile, save, remove };
}

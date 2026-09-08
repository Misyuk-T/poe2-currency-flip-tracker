export const SAVED_MARKETS_VERSION = 1;
export const SAVED_MARKETS_LIMIT = 30;
export const SAVED_MARKETS_REFERENCE_KIND = "hourly-traded-volume-ratio";
export const SAVED_MARKETS_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const SAVED_MARKETS_MAX_BYTES = 24 * 1024;

const KEY_PREFIX = "poe2flip.saved-markets.v1";
const VISIT_PREFIX = "poe2flip.saved-markets-visit.v1";

function isText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160 && !value.includes("\u0000");
}

function validScope(scope) {
  return scope && isText(scope.game) && isText(scope.league);
}

export function savedMarketId({ game, league, target, anchor }) {
  return [game, league, target, anchor].join("\u0000");
}

export function savedMarketScopeId(scope) {
  return validScope(scope) ? `${scope.game}\u0000${scope.league}` : null;
}

export function isSavedMarketScopeState(state, scope) {
  return state?.scopeKey === savedMarketScopeId(scope);
}

export function savedMarketScopeKey({ game, league }) {
  return `${KEY_PREFIX}:${encodeURIComponent(game)}:${encodeURIComponent(league)}`;
}

export function savedMarketVisitKey({ game, league }) {
  return `${VISIT_PREFIX}:${encodeURIComponent(game)}:${encodeURIComponent(league)}`;
}

export function emptySavedMarketScope() {
  return { version: SAVED_MARKETS_VERSION, saved: [], observations: {} };
}

function validSaved(entry, scope) {
  return entry
    && entry.game === scope.game
    && entry.league === scope.league
    && isText(entry.target)
    && isText(entry.anchor)
    && Number.isFinite(entry.savedAt)
    && entry.savedAt > 0;
}

function validObservation(value, scope) {
  return value
    && value.game === scope.game
    && value.league === scope.league
    && isText(value.target)
    && isText(value.anchor)
    && value.referenceKind === SAVED_MARKETS_REFERENCE_KIND
    && Number.isFinite(value.reference)
    && value.reference > 0
    && Number.isFinite(value.completedHour)
    && value.completedHour > 0;
}

function validScopePayload(value, scope) {
  if (!value || value.version !== SAVED_MARKETS_VERSION || !Array.isArray(value.saved) || !value.observations || typeof value.observations !== "object" || Array.isArray(value.observations)) return false;
  if (value.saved.length > SAVED_MARKETS_LIMIT || !value.saved.every((entry) => validSaved(entry, scope))) return false;
  const ids = value.saved.map(savedMarketId);
  if (new Set(ids).size !== ids.length) return false;
  const observations = Object.entries(value.observations);
  if (observations.length > SAVED_MARKETS_LIMIT) return false;
  return observations.every(([id, observation]) => ids.includes(id) && id === savedMarketId(observation) && validObservation(observation, scope));
}

function readJson(storage, key, fallback) {
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    return { value: fallback, error: "Browser storage is unavailable. Saved markets cannot be updated in this browser." };
  }
  if (raw == null) return { value: fallback, error: null };
  if (typeof raw !== "string" || raw.length > SAVED_MARKETS_MAX_BYTES) {
    return { value: fallback, error: "Saved market data was invalid and was not used. You can save markets again.", recoverable: true };
  }
  try {
    return { value: JSON.parse(raw), error: null };
  } catch {
    return { value: fallback, error: "Saved market data was invalid and was not used. You can save markets again.", recoverable: true };
  }
}

export function readSavedMarketScope(storage, scope) {
  if (!validScope(scope)) return { value: emptySavedMarketScope(), error: "Saved markets need a game and league." };
  const result = readJson(storage, savedMarketScopeKey(scope), emptySavedMarketScope());
  if (result.error) return result;
  if (!validScopePayload(result.value, scope)) {
    return {
      value: emptySavedMarketScope(),
      error: "Saved market data was invalid and was not used. You can save markets again.",
      recoverable: true,
    };
  }
  return result;
}

export function writeSavedMarketScope(storage, scope, value) {
  if (!validScopePayload(value, scope)) return { ok: false, error: "Saved market data is invalid." };
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false, error: "Saved market data is invalid." };
  }
  if (serialized.length > SAVED_MARKETS_MAX_BYTES) {
    return { ok: false, error: "Saved market storage is full. Your existing saved markets were not changed." };
  }
  try {
    storage.setItem(savedMarketScopeKey(scope), serialized);
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "Browser storage is unavailable. Your saved markets were not changed." };
  }
}

function currentObservation(row, scope, now) {
  if (!row || row.stale === true || row.target == null || row.anchor == null) return null;
  const observation = {
    game: scope.game,
    league: scope.league,
    target: row.target,
    anchor: row.anchor,
    reference: row.reference,
    referenceKind: row.referenceKind,
    completedHour: row.latestCompletedHour,
  };
  if (!validObservation(observation, scope)) return null;
  // The timestamp decides freshness and an explicit stale response is never
  // usable; a presentational hint cannot make an old response fresh again.
  const age = now - observation.completedHour;
  if (age < 0 || age > SAVED_MARKETS_MAX_AGE_MS) return null;
  return observation;
}

export function radarMatchesSavedScope(radar, scope) {
  return Boolean(validScope(scope) && radar && radar.game === scope.game && radar.league === scope.league);
}

export function addSavedMarket(value, scope, row, { now = Date.now() } = {}) {
  if (!row?.pairId || !isText(row.target) || !isText(row.anchor)) {
    return { ok: false, value, error: "Only an available native market can be saved." };
  }
  const entry = { game: scope.game, league: scope.league, target: row.target, anchor: row.anchor, savedAt: now };
  const id = savedMarketId(entry);
  if (value.saved.some((saved) => savedMarketId(saved) === id)) return { ok: true, value, changed: false, error: null };
  if (value.saved.length >= SAVED_MARKETS_LIMIT) return { ok: false, value, error: `Save up to ${SAVED_MARKETS_LIMIT} markets for this game and league.` };
  const observation = currentObservation(row, scope, now);
  return {
    ok: true,
    changed: true,
    error: null,
    value: {
      ...value,
      saved: [...value.saved, entry],
      observations: observation ? { ...value.observations, [id]: observation } : value.observations,
    },
  };
}

/** A save must be derived from the active response, never an old table row. */
export function saveSavedMarket({ storage, scope, radar, row, now = Date.now() }) {
  const nativeRow = (radar?.rows ?? []).find((candidate) => candidate?.pairId === row?.pairId && candidate.target === row?.target && candidate.anchor === row?.anchor);
  if (!radarMatchesSavedScope(radar, scope) || !nativeRow) {
    return { ok: false, error: "Wait for the current market data before saving a market." };
  }
  const persisted = readSavedMarketScope(storage, scope);
  if (persisted.error && !persisted.recoverable) return { ok: false, error: persisted.error };
  const next = addSavedMarket(persisted.value, scope, nativeRow, { now });
  if (!next.ok || !next.changed) return next;
  const write = writeSavedMarketScope(storage, scope, next.value);
  return write.ok ? next : write;
}

export function removeSavedMarket(value, entry) {
  const id = savedMarketId(entry);
  const observations = { ...value.observations };
  delete observations[id];
  return { ...value, saved: value.saved.filter((saved) => savedMarketId(saved) !== id), observations };
}

function readVisit(sessionStorage, scope) {
  const result = readJson(sessionStorage, savedMarketVisitKey(scope), null);
  if (result.error) return { value: null, error: result.recoverable ? "Saved market comparisons are unavailable because this tab's saved state is invalid." : "Saved market comparisons are unavailable because this browser blocks session storage." };
  if (result.value == null) return result;
  const visit = result.value;
  if (!visit || visit.version !== SAVED_MARKETS_VERSION || typeof visit.startedWithSaved !== "boolean" || !visit.baseline || typeof visit.baseline !== "object" || Array.isArray(visit.baseline)) {
    return { value: null, error: "Saved market comparisons are unavailable because this tab's saved state is invalid." };
  }
  const baseline = Object.entries(visit.baseline);
  if (baseline.length > SAVED_MARKETS_LIMIT || !baseline.every(([id, observation]) => id === savedMarketId(observation) && validObservation(observation, scope))) {
    return { value: null, error: "Saved market comparisons are unavailable because this tab's saved state is invalid." };
  }
  return { value: visit, error: null };
}

function writeVisit(sessionStorage, scope, visit) {
  let serialized;
  try {
    serialized = JSON.stringify(visit);
  } catch {
    return { ok: false, error: "Saved market comparisons are unavailable because this tab's saved state is invalid." };
  }
  if (serialized.length > SAVED_MARKETS_MAX_BYTES) {
    return { ok: false, error: "Saved market comparisons are unavailable because this tab's saved state is too large." };
  }
  try {
    sessionStorage.setItem(savedMarketVisitKey(scope), serialized);
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "Saved market comparisons are unavailable because this browser blocks session storage." };
  }
}

export function clearSavedMarketVisitBaseline(sessionStorage, scope, entry) {
  const result = readVisit(sessionStorage, scope);
  if (result.error || !result.value) return result.error ? { ok: false, error: result.error } : { ok: true, error: null };
  const baseline = { ...result.value.baseline };
  delete baseline[savedMarketId(entry)];
  return writeVisit(sessionStorage, scope, { ...result.value, baseline });
}

/**
 * Re-read local storage before each response merge. A delayed older response
 * therefore cannot overwrite a newer observation that a different tab wrote.
 */
export function reconcileSavedMarkets({ localStorage, sessionStorage, scope, radar, now = Date.now() }) {
  if (!radarMatchesSavedScope(radar, scope)) return { matched: false, returned: false, value: null, baseline: {}, error: null };
  const persisted = readSavedMarketScope(localStorage, scope);
  if (persisted.error) return { matched: true, returned: false, value: persisted.value, baseline: {}, error: persisted.error };

  const visitRead = readVisit(sessionStorage, scope);
  if (visitRead.error) return { matched: true, returned: false, value: persisted.value, baseline: {}, error: visitRead.error };
  let visit = visitRead.value;
  let firstMatchingResponse = false;
  if (!visit) {
    firstMatchingResponse = true;
    visit = { version: SAVED_MARKETS_VERSION, startedWithSaved: persisted.value.saved.length > 0, baseline: { ...persisted.value.observations } };
    const write = writeVisit(sessionStorage, scope, visit);
    if (!write.ok) return { matched: true, returned: false, value: persisted.value, baseline: {}, error: write.error };
  }

  const observations = { ...persisted.value.observations };
  for (const saved of persisted.value.saved) {
    const row = (radar.rows ?? []).find((candidate) => candidate?.pairId && candidate.target === saved.target && candidate.anchor === saved.anchor);
    const next = currentObservation(row, scope, now);
    const id = savedMarketId(saved);
    if (next && (!observations[id] || next.completedHour > observations[id].completedHour)) observations[id] = next;
  }
  const nextValue = { ...persisted.value, observations };
  const write = writeSavedMarketScope(localStorage, scope, nextValue);
  if (!write.ok) return { matched: true, returned: false, value: persisted.value, baseline: visit.baseline, error: write.error };
  return {
    matched: true,
    returned: firstMatchingResponse && visit.startedWithSaved,
    value: nextValue,
    baseline: visit.baseline,
    error: null,
  };
}

export function savedMarketComparison({ saved, baseline, radar, scope, now = Date.now() }) {
  const id = savedMarketId(saved);
  const prior = baseline?.[id];
  if (!radarMatchesSavedScope(radar, scope)) {
    return { state: "unavailable", message: "Current market is unavailable.", previous: prior ?? null, current: null };
  }
  const sameTarget = (radar?.rows ?? []).filter((row) => row?.pairId && row.target === saved.target);
  const row = sameTarget.find((candidate) => candidate.anchor === saved.anchor);
  if (!row) {
    return {
      state: sameTarget.length ? "anchor-changed" : "unavailable",
      message: sameTarget.length ? "Comparison unavailable: the current market uses a different anchor." : "Current market is unavailable.",
      previous: prior ?? null,
      current: null,
    };
  }
  const current = currentObservation(row, scope, now);
  if (!current) {
    return { state: "current-unavailable", message: "Current hourly reference is unavailable or stale.", previous: prior ?? null, current: null };
  }
  if (!prior) return { state: "new", message: "No previous hourly reference yet. Check back on a later visit.", previous: null, current };
  if (current.completedHour <= prior.completedHour) {
    return { state: "waiting", message: "Waiting for a newer completed hour.", previous: prior, current };
  }
  const change = current.reference / prior.reference - 1;
  if (!Number.isFinite(change)) {
    return { state: "current-unavailable", message: "Current hourly reference cannot be compared safely.", previous: prior, current: null };
  }
  return { state: "changed", change, message: null, previous: prior, current };
}

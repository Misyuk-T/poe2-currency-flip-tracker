// Stored radar payloads are a cache of derived data, including item taxonomy.
// Bump this whenever the payload meaning changes so a deploy cannot keep
// serving structurally fresh but semantically outdated snapshots.
export const RADAR_PAYLOAD_VERSION = 4;
export const RADAR_SNAPSHOT_MAX_AGE_MS = 6 * 3600_000;

export function isCompatibleRadarSnapshot(snapshot, now = Date.now()) {
  return snapshot?.payload?.payloadVersion === RADAR_PAYLOAD_VERSION
    && Number.isFinite(snapshot.refreshedAt)
    && now - snapshot.refreshedAt < RADAR_SNAPSHOT_MAX_AGE_MS;
}

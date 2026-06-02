import type { MatchType } from '@ruletka/shared-types';

/**
 * DI token for the optional bearer secret guarding `GET /metrics`. Bound in
 * {@link MetricsModule} from `process.env.METRICS_TOKEN`. When blank/undefined
 * the endpoint is OPEN (the common deployment: scraped from a private network /
 * sidecar). When set, callers must present `Authorization: Bearer <token>`.
 */
export const METRICS_TOKEN = 'METRICS_TOKEN';

/**
 * Prefix applied to every custom application metric so they group cleanly in
 * Prometheus/Grafana and never collide with the default `process_*` / `nodejs_*`
 * series that {@link https://github.com/siimon/prom-client prom-client} emits.
 */
export const METRIC_PREFIX = 'ruletka_';

/**
 * The matchmaking modalities we expose a queue-depth gauge for. Kept as a local
 * constant (rather than imported from the matchmaking module) so the metrics
 * subsystem stays decoupled from it — the gauge reads pool sizes straight from
 * Redis. MUST stay in step with the `MatchType` union in shared-types.
 */
export const MATCH_TYPES: ReadonlyArray<MatchType> = ['video', 'voice'];

/**
 * Redis ZSET key for a modality's live waiting pool. DUPLICATED from
 * `modules/matchmaking/matchmaking.constants.ts#poolKey` on purpose: the
 * queue-depth gauge reads pool cardinality (ZCARD) directly so the metrics
 * module takes no value-import dependency on matchmaking (mirroring how the
 * gateway duplicates the `notif:new` / `moderation:action` channel names). MUST
 * stay identical to that helper.
 */
export function matchmakingPoolKey(type: MatchType): string {
  return `mm:pool:${type}`;
}

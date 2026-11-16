/**
 * The recorder's request allowlist (CONTRACT.md, "Recorder"). The one
 * definition lives in `src/replayAllowlist.ts`, shared with the server, which
 * persists only the misses this allowlist would replay ("Durable misses").
 */
export { EBAY_PINNED_REQUESTS, MAX_FACET_VALUES, MAX_REPLAY_BODY_BYTES, REPLAY_FACETS, ebayReplayRefusal, replayRefusal } from "../src/replayAllowlist";

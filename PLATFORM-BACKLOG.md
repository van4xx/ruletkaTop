# ruletka.top — Platform Completeness Backlog

> Generated from a 6-domain parallel audit (backend↔frontend gap analysis +
> business-logic review of monetization, moderation, and video/audio calling).
> 54 raw findings → deduplicated + prioritized. This is the definitive
> "what's left to make this a complete, monetizable, safe, polished product."

**Status legend:** ☐ todo · ◐ in progress · ☑ done

---

## P0 — must-have (broken / missing core)

- ◐ **[monetization]** Add `'cover'` to `COIN_TX_TYPES` (derive enum from `coinTxTypeSchema.options`) — `apps/api/src/modules/wallet/schemas/coin-transaction.schema.ts:7` — paid covers debit the user then 500 on the ledger insert (no rollback on standalone Mongo): silent coin theft / broken purchase on RS. *(Build wave 1)*
- ☐ **[monetization]** Build `POST /payments/premium/checkout` that mints a PENDING Payment row — `apps/api/.../payments.service.ts` + `apps/web/.../use-premium.ts:112` — client fakes an invoiceId so CloudPayments Check declines; **premium revenue is uncollectable through the UI.** *(Needs CloudPayments keys — keyed wave)*
- ☐ **[monetization]** Add a subscription expiry sweep (use the already-wired bullmq) — `premium.service.ts` + `subscription.schema.ts:66` — lapsed/canceled premium stays `active` forever (stale badge on profiles/leaderboards/top). *(Scheduler wave)*
- ☐ **[monetization]** Stop in-app cancel from being silently un-canceled — `premium.service.ts:167` + `payments.service.ts:298` — `handleRecurrent` re-activates + re-bills a canceled user; honor `cancelAtPeriodEnd`. *(Needs CloudPayments outbound)*
- ☐ **[calls]** Wire the post-accept media session for direct friend calls — web `call-invite-modal.tsx:56`, mobile `socket_service.dart` — backend complete but neither client builds a PeerConnection on `call:accept` (phantom feature). *(Needs 2-peer test)*
- ☐ **[calls]** Make "video call a friend" honor the target — `friend-card.tsx:60` / `chat-thread.tsx:152` deep-link `/video?to=<id>` but nothing reads `?to=` → drops into the anonymous stranger queue.
- ☐ **[moderation]** Force-end the active room on `POST /blocks` — `blocks.service.ts:44` — blocking mid-call is client-side skip only; abuser keeps seeing/hearing the victim. *(Build wave 1, if clean)*
- ◐ **[moderation]** Wire report resolution to enforcement (resolve-with-ban + per-target aggregation) — `reports.service.ts:142` + admin `Moderation.tsx:304` — confirming abuse applies zero sanction. *(Build wave 1)*
- ◐ **[moderation]** Add "Confirm & ban" to the web review card — `apps/web/.../review-card.tsx:144` — upholding an AI nudity/minor flag only flips status. *(Build wave 1)*
- ◐ **[social]** Paginate the friends list — `use-friends.ts:43` — only `.items`; >20 friends unreachable. → `useInfiniteQuery`. *(Build wave 1)*
- ◐ **[social]** Paginate the conversations inbox — `use-conversations.ts:29` — same first-page-only bug. *(Build wave 1)*
- ☐ **[social]** Always expose minimal peer identity for existing conversations — `profiles.service.ts:227` + `use-conversations.ts:60` — private-profile chat partner shows nameless/avatarless.
- ◐ **[admin]** Add premium-plan CRUD endpoints + UI — `admin-economy.controller.ts`, `apps/admin/.../Premium.tsx` — plan pricing/tiers are hard-coded seed (price change = code edit + redeploy). *(Build wave 1)*

## P1 — important

- ☐ **[monetization]** Credit gift recipients (`gift_in`) or remove the dead type + document the model — `gifts.service.ts:131` — gifting is a pure coin sink; no cash-out/payout path.
- ☐ **[monetization]** Record each recurring renewal as a completed Payment row — `payments.service.ts:298` — renewals miss admin revenue stats + user history.
- ☐ **[monetization]** Add an admin-initiated refund action (CloudPayments refund API) — `admin-payments.service.ts` (read-only today).
- ☐ **[moderation]** Add an appeals / ban-contest path + surface `banReason` at login — `moderation.service.ts:134` instant-permanent bans, no recourse for false positives.
- ☐ **[moderation]** Thread `matchId` + optional evidence frame into in-call reports — `report-dialog.tsx:61` — call reports store `matchId=null`, no proof.
- ☐ **[calls/moderation]** Port `mod:action` handling (+ NSFW screening) to mobile — `apps/mobile/lib` has neither; mobile broadcasters unscreened.
- ☐ **[calls]** Fix mobile roulette teardown disconnecting the shared `/mm` socket — `roulette_controller.dart:624,718` — kills app-wide presence/notifications/incoming-calls; emit `mm:leave` instead.
- ☐ **[social]** Enforce the `showOnlineStatus` privacy toggle — `friends.service.ts:194`, `presence.controller.ts` — stored but never checked.
- ☐ **[social]** Add active-session/device management — `GET /auth/sessions` + `DELETE /auth/sessions/:id` — Session rows store ip/UA; no UI to review/revoke.
- ☐ **[social]** Surface a typed `chat:rejected` on swallowed sends — `chat.gateway.ts:175` + `use-thread.ts:193` — block/privacy/validation drops are silent.
- ☐ **[social]** Join blocked-user profile into `GET /blocks` — blocklist shows raw hex ObjectIds.

## P2 — nice-to-have

- ☐ **[admin]** `againstUserId` filter on `GET /reports` + "reports against user" in the user dossier — `moderation.contracts.ts`, `Users.tsx`.
- ☐ **[monetization]** TTL/sweeper for expired top placements (+ confirm slot-scarcity / auction model) — `top-placement.schema.ts:15`.
- ☐ **[monetization]** Add `GET /premium/subscription`; stop reading state via side-effecting `POST /premium/subscribe` — `premium.controller.ts:41`.
- ☐ **[calls]** Honor TURN `ttlExpiresAt` (re-fetch before ICE restart) — long calls fail relay reconnection for bad-NAT users.
- ☐ **[calls]** Let the answerer trigger the initiator's ICE restart — `use-roulette.ts:387`.
- ☐ **[calls]** Bind `ws:error` on both clients (rate-limit/forbidden toasts) + populate `mm:waiting.positionHint`.
- ☐ **[social]** Image DMs + avatar/cover upload — contract has `type:'image'` but no upload endpoint/attach control (product decision).
- ☐ **[housekeeping]** Match-reconciliation sweep + delete stale "backend missing" comments — `match.schema.ts:91`, `use-presence.ts:10`, `use-friend-requests.ts:6`.

---

## Themes (systemic)

1. **Monetization is wired but uncollectable / leaky end-to-end.** Premium has no server checkout, no expiry sweep, no authoritative cancel; covers 500 mid-purchase; gift recipients and renewals produce no ledger/Payment rows. Root cause: the **missing scheduler** (bullmq configured, zero jobs) and the **missing outbound CloudPayments client** (webhooks-in only).
2. **Moderation is a bookkeeping queue, not enforcement.** Blocks/reports/AI-flag resolutions just flip a status — no room teardown, no ban linkage, no aggregation/appeals — and anti-abuse (CAPTCHA, server scorer, fingerprint) ships disabled, so the system trusts the client to self-incriminate.
3. **Mobile is a second-class client.** No covers, no password/email recovery, no NSFW screening, no `mod:action`, and a socket-teardown bug that breaks app-wide realtime — consistent web↔mobile parity debt.
4. **"Backend exists, frontend doesn't" is the dominant gap shape.** Announcements, direct calls, sessions, blocklist identity, premium-plan admin, friends/inbox pagination, and `showOnlineStatus` are all built server-side and stranded at the UI/contract boundary — the fastest value is finishing these last hops, not new backend.

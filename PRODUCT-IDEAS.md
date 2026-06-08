# ruletka.top — Post-Launch Product Proposal Deck

> From an 8-dimension parallel product-strategy audit (74 proposals → 33 curated).
> Everything below **builds on systems already shipped**. Effort: S = days, M = 1-2 wks, L = 3+ wks.
> Companion to `PLATFORM-BACKLOG.md` (correctness/launch) — this file is **growth/product**.

---

## ⚡ Quick wins (high impact / low effort — do these first, around launch)

1. **[Activation]** Persist onboarding interests → first-match prefill — onboarding collects interests then *throws them away*; wire them to the profile + the `sharedInterestCount` matcher that already exists, so every new user's first call is topical. (high / S) — *the single most embarrassing gap.*
2. **[Safety]** Auto-quarantine on report velocity — `countOpenReportsByTarget` already counts distinct reporters; auto-match offenders only with other quarantined users pending review. (high / S)
3. **[Activation]** Live "people online now" count — replace the *fabricated* static landing stats with a real `ZCARD` off the presence refcount; "1,240 online · 80 waiting". Kills the "is anyone here?" bounce. (high / S)
4. **[Monetization]** Enforce + tier premium filters — gender/country filters are gated in *copy only*, not in `satisfies()`. Enforce server-side, add `languages`/`verifiedOnly`, ship a cheap "Premium Lite" (filters-only). (med / S)
5. **[Matching]** Real queue position + ETA — client already renders `positionHint` but the gateway emits empty `mm:waiting {}`; compute `ZRANK`/`ZCARD`/throughput + a "widen filters" nudge. (med / M)
6. **[Platform]** Real installable PWA + push re-engagement — no manifest today; add one + app-shell caching (survives RF/flaky-DNS) and wire the already-built web-push to triggers. (high / S)
7. **[Monetization]** Boost — one-off paid queue priority — the queue score already does `joinedAt − (isPremium?BONUS:0)`; add a coin-bought `boostUntil` TTL. Highest-ARPU dating lever, clean coin sink. (high / M)
8. **[Safety]** Rolling evidence buffer on report — single-frame → ~6-10s low-res ring buffer; same `evidenceUrl` storage. Cuts moderator error + wrongful bans. (med / M)
9. **[Retention]** Daily streak + claimable coin reward — `bonus` ledger, push, presence, BullMQ sweep, dashboard grid all exist; assemble a 7-day ladder + streak flame. (high / M)
10. **[AI]** AI icebreakers from shared interests — `commitMatch` knows both peers' tags; drop opener chips into the existing in-call chat. No-op default, LLM via one env flag. (med / S)
11. **[Social]** Friend-of-friend suggestions — the Friendship graph is indexed both ways; 2-hop `GET /friends/suggestions` with "X mutual friends". (med / S)
12. **[Matching]** "Stay" signal feeds match quality — add a deliberate Stay counter as a reputation term in `eligible.sort`. (med / S)

## 📈 Growth bets (the engine — next 1-3 months)

13. **[Acquisition]** Coin-reward referral system — `referral` ledger + `referredBy`/`referralCode`; credit both parties via the atomic `WalletService` on first completed call. **Foundational — everything hangs off it.** (high / M)
14. **[Acquisition]** Programmatic SEO landing pages — `/chat/<country>`, `/video-chat/<language>`, `/talk-to/<interest>` off the existing taxonomy; `seo.ts` is already the single source of truth. Harvests post-Omegle search demand. (high / M)
15. **[Acquisition]** Shareable call-highlight clips — dual-opt-in "Save moment" reuses `captureStreamFrame` + the OG-card renderer → branded ref-linked share card. (high / L)
16. **[Acquisition]** Bring-a-friend into the call (2-v-stranger) — deep link drops a non-user into your live room, referral attributed. The viral loop unique to roulette. (high / L)
17. **[Acquisition]** Influencer/affiliate program — vanity ref codes via the admin SPA, attributed on the idempotent `Payment` ledger. (high / L)
18. **[Matching]** Topic Lobbies — `poolKey(type)` → `poolKey(type, topic)` off the 16-tag catalog; free picks a lobby, premium re-ranks inside it. "42 waiting in Games." (high / M)
19. **[Matching]** Re-match / "Sparks" — one-tap like in `call-controls`; mutual likes → `/sparks` + the existing directed `call:invite` + auto chat thread. Premium gates "who liked you". (high / M)
20. **[Matching]** Speed-dating / speed-friending — server-authoritative 90s timer + mutual Keep/Next; reuses the matchmaking + requeue stack. (high / M)
21. **[Matching]** In-call 2-player mini-games + icebreakers — typed `game:*` on the existing WebRTC datachannel; peer-to-peer, no backend. Kills awkward silence. (high / M)
22. **[Monetization]** Super-gifts + gift→coins loop — high-price animated gift takeover; wire the *reserved-but-unused* `gift_in` ledger to credit recipients coins-only (no cash-out). The Bigo/Azar engine. (high / M)
23. **[Monetization]** "Who wants to talk to you" paid reveal — blurred "N people want to call you" → pay to unlock. Tinder Gold's #1 lever. (high / M)
24. **[Monetization]** Ticketed themed events — paid-ticket pool via `poolKey(eventId)`; concentrates liquidity AND sells tickets. (high / L)
25. **[Retention]** Daily & weekly quests — every action is already persisted; subscribe to the domain events, pay via `bonus` ledger. Premium gets a 4th quest / 1.5×. (high / M)
26. **[Retention]** Seasonal battle-pass (free + premium) — composes covers, coin ledger, Top vouchers, CloudPayments. The most proven retention+monetization engine. (high / L)
27. **[Retention]** Themed live events — config window over the interest-aware matcher + admin announcement/broadcast + push. Manufactures appointment demand. (high / L)
28. **[Safety]** Reputation/karma biasing matchmaking — hidden 0-100 score from signals already persisted (mod events, upheld reports, blocks, call duration, age) → the same priority ZSET. Quarantines bad actors together. (high / M)
29. **[Safety]** Gender/age verification badge — the `verified` badge **exists in the enum but is never issued**; grant via selfie liveness (reusing the `FrameScorer` shape). Biggest female-retention lever. (high / L)
30. **[AI]** AI text-moderation on chat + reports — a `TextScorer` twin of `FrameScorer` (same fail-open contract) auto-prioritizing toxic reports. (high / M)
31. **[Social]** Explore / discovery feed — compose Top + Leaderboard + presence + search into `/explore` with "available now" → direct calls. (high / M)
32. **[Platform]** Product-analytics + feature-flag/experiment service — today analytics is 9 client-only pings; add server events + Redis A/B bucketing. **Foundation for shipping every bet with evidence.** (high / M)

## 🌙 Moonshots

33. **[AI]** ⭐ Real-time speech translation in calls — env-gated `CallTranslator` (mirrors `FrameScorer`): STT → translated subtitle band over the video tile, languages from each profile's `languages[]`, premium-gated. Flips the language barrier from the #1 churn cause into *the* reason to choose this app — the one thing Chatroulette/OmeTV structurally can't do. (high / L)
34. **[Matching]** Group rooms (3-4 way lounges) — generalize `RoomState` to `participants[]` on a light SFU (LiveKit/mediasoup) behind the existing TURN/ICE; the 2×2 grid already exists. (high / L)
35. **[Monetization]** Creator/host economy — high-engagement users become Hosts running one-to-many rooms; viewer gifts credit hosts coins-only (no cash-out). Turns hosts into the biggest spenders. (high / L)

---

## 🎯 Recommended post-launch sequence

- **Step 1 — Fix the leaks & light the meters (launch week):** #1 onboarding interests, #3 live count, #5 queue ETA, #6 PWA+push, #2 auto-quarantine, #8 evidence buffer — and **#32 analytics+flags** (can't tune the rest without it). Mostly wiring data into systems that already exist; no dependencies.
- **Step 2 — Viral + retention spine (wks 2-5):** #13 referral first (everything hangs off it), then #9 streak + #25 quests, then #14 SEO + #15 clips.
- **Step 3 — Differentiate the core loop (wks 4-9):** #18 Topic Lobbies → #20 Speed-dating → #19 Sparks → #21 games. Land #28 karma + #29 verification alongside (better matching is wasted if creeps saturate the pool).
- **Step 4 — Stack monetization (wks 8-12+):** #7 Boost → #4 filter tiers → #22 super-gifts → #23 paid reveal → #26 battle-pass. Selling Boost into a deep, retained, lobby-segmented pool prints money; into a thin cold pool it doesn't.
- *Moonshots run as a parallel R&D track — start translation (#33) prototyping in Step 3.*

## 💡 The single biggest opportunity — Real-time speech translation (#33)

Everything else makes ruletka a *better* version of products that exist. Translation makes it a *different* product. Every random-video app silently caps each user's match pool at "people who share my language." Translation detonates that wall — your pool stops being "Russian speakers online" and becomes "humans online." That's a step-change in **liquidity** (the master variable every other proposal fights to improve), perceived quality, and TAM at once.

Why it's the right bet, not just the shiny one:
- **Rides patterns already in the code** — the env-gated/fail-open `FrameScorer` is the exact template; subtitles render over the existing video tile via the existing data channel; languages come from the `languages[]` already on every profile (accessibility captions ship the same UI band first, for free).
- **Monetizes cleanly** — the most compelling premium perk the platform could offer; people pay monthly to keep it.
- **Compounds the whole deck** — programmatic SEO ("video chat with people in Brazil") becomes truthful; Topic Lobbies go global; the creator economy gets a worldwide audience.
- **Defensible** — incumbents are 1:1-random by architecture with no language data, no profile layer, no premium rail. ruletka has all three.

Build the launch leaks-and-spine first (Steps 1-2) so there's a healthy funnel to pour the new global supply into — then make translation the headline that defines what ruletka *is*.

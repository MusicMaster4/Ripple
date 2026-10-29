# Architecture

Ripple has a static browser application and a managed Convex backend. Vercel serves the frontend bundle; Convex runs authentication and database functions.

## Files

| Path | Responsibility |
| --- | --- |
| `src/game/engine.ts` | Shared deterministic simulation and replay validation |
| `src/game/GameCanvas.tsx` | Rendering, input, and game-loop integration |
| `src/lib/audio.ts` | Playlist, recorded water drops, and water rumble |
| `src/lib/auth.ts` | Browser Better Auth client |
| `src/App.tsx` | Game screens, account flow, settings, and leaderboard UI |
| `convex/auth.ts` | Better Auth server configuration and adapter |
| `convex/leaderboard.ts` | Run tickets, replay checks, leaderboard, and cleanup |
| `convex/schema.ts` | Run-ticket and personal-best tables |
| `convex/crons.ts` | Scheduled cleanup of expired tickets |
| `patches/` | Explicit dependency compatibility changes |

## The simulation

The playing field fills the viewport. Its longest edge is normalized to 1000 logical units; the shorter edge is an integer between 100 and 1000, preserving the viewport aspect ratio within those bounds. Every accepted click teleports the dot and creates an expanding wave. Rendering may introduce tiny irregularities into a line, but the collision model uses exact circles.

Wave reflections use image sources. For an original source at `(x, y)`, mirrored sources are placed at `(2iW ± x, 2jH ± y)`. Expanding circles from those sources, clipped to the original rectangle, produce reflected arcs with the same travel distance as the physical reflection.

The engine checks whether a wave crosses the stationary player anywhere within each elapsed interval, rather than checking only one rendered frame. It also checks the destination immediately when a player moves. The outgoing wave is safe at its own birthplace; its reflected copies are not.

| Rule | Value |
| --- | --- |
| Wave speed | 72.5 logical units per second |
| Wave lifetime | 17 seconds |
| Player collision radius | 5.5 logical units |
| Minimum accepted click interval | 80 ms |
| Maximum round duration | 180 seconds |
| Rules version | 2 |
| Score | Accepted clicks × elapsed seconds, rounded to three decimal places |

A round ends if the playing field is resized, so its dimensions stay fixed for the replay. Changes that affect fairness should update `RULES_VERSION` and explicitly address existing leaderboard records.

## Scoring and leaderboard

At the start of a round, the browser requests a run ticket using a random token and normalized field dimensions. The server validates and stores those dimensions with the current rules version. Guest play is allowed. A finished round may be submitted after the player signs in.

The server:

1. Requires an authenticated session.
2. Finds a matching, unused, unexpired run ticket.
3. Replays the submitted movement history and validated field dimensions through the shared engine.
4. Derives the score itself and applies timing checks.
5. Marks the ticket used and updates the player's record only if the score is a new personal best.

Only the best score per player is stored in the leaderboard table. The board shows rules-version-2 results; a player's first version-2 score replaces an older-rules record even if its numeric value is lower. Queries return at most 100 entries and a separate record for the current player's personal best. They return display names and score details, not email addresses or authentication records.

Replay checks reject invalid histories and direct score fabrication. They do not detect skilled bots or prove that input came from a human.

## Authentication compatibility

The published `@convex-dev/better-auth` component currently expects an older Better Auth release. Ripple uses a newer Better Auth release and a committed `patch-package` patch rather than downgrading to the older version.

Better Auth 1.7 removed the deprecated OIDC-provider plugin imported by the component. Ripple uses Convex's custom-JWT verification and email/password authentication. The compatibility patch keeps the component's discovery metadata available without installing an OAuth provider. It also strips the newer adapter's `modelKey` metadata before strict Convex validation, permits the optional JWKS `alg` field, and aligns the React provider declaration with the concrete client plugin types. JWT issuance, password hashing, session handling, and verification remain in the upstream authentication packages.

Review this patch against upstream changes when upgrading either package. Verify account creation, password sign-in, authenticated queries, score submission, logout, and session persistence after every authentication dependency update.

## Audio

The music playlist is supplied as static MP3 assets. Tracks play one at a time and wrap to the first after the last. Water effects use excerpts of actual CC0 water recordings, including a bank of drops and a low, calm water rumble. Web Audio plays and mixes those recorded samples. The effects slider controls drops and ambience together; the music slider controls the playlist separately. See [recording sources and processing](AUDIO_SOURCES.md).

Audio initializes only after a user gesture. Music and effects settings are stored locally. Browsers may suspend audio when backgrounded, and blocked audio must not prevent a game from running.

## Data and privacy

| Data | Location | Visibility |
| --- | --- | --- |
| Sound preferences and local best | Browser local storage | This browser |
| Email, display name, password hash, sessions | Convex Better Auth component | Authentication backend |
| Display name and personal-best details | Convex leaderboard table | Authenticated players |
| Temporary run ticket | Convex run table | Backend functions |
| Submitted move history | Used during score validation | Backend mutation; not stored as a full replay |

The app does not add advertising or analytics. Hosting and database providers may process operational logs according to their own terms. Run tickets are periodically removed after 24 hours. Deleting an authentication account also removes its leaderboard entry. The current signup flow does not verify email addresses or send transactional email.

When publishing your own instance, configure provider retention and account-deletion handling to match your needs. Do not ask users to place private account information in public GitHub issues.

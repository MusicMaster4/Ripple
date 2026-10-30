# Architecture

Ripple has a static browser application and a managed Convex backend. Vercel serves the frontend bundle; Convex runs authentication and database functions.

## Files

| Path                      | Responsibility                                            |
| ------------------------- | --------------------------------------------------------- |
| `src/game/engine.ts`      | Shared deterministic simulation and replay validation     |
| `src/game/rain.ts`        | Seeded rain rolls, landing warnings, and impact schedule  |
| `src/game/rain-render.ts` | Canvas landing marks and falling drops                    |
| `src/game/arena.ts`       | Seeded obstacle contours and blocked-area checks          |
| `src/game/water.ts`       | Surface-wave propagation, crests, reflection, diffraction |
| `src/game/GameCanvas.tsx` | Rendering, input, and game-loop integration               |
| `src/lib/audio.ts`        | Playlist, recorded water drops, and water rumble          |
| `src/lib/auth.ts`         | Browser Better Auth client                                |
| `src/App.tsx`             | Game screens, account flow, settings, and leaderboard UI  |
| `convex/auth.ts`          | Better Auth server configuration and adapter              |
| `convex/leaderboard.ts`   | Run tickets, replay checks, leaderboard, and cleanup      |
| `convex/schema.ts`        | Run-ticket and personal-best tables                       |
| `convex/crons.ts`         | Scheduled cleanup of expired tickets                      |
| `patches/`                | Explicit dependency compatibility changes                 |

## The simulation

The playing field fills the viewport. Its longest edge is normalized to 1000 logical units; the shorter edge is an integer between 100 and 1000, preserving the viewport aspect ratio within those bounds. Every accepted click teleports the dot and creates an expanding wave. Each drop has one visible crest. Rendering may introduce tiny irregularities into a line. Open rectangular arenas use exact circular collision geometry; obstructed arenas use the numerical crest described below.

In open arenas, wave reflections use image sources. For an original source at `(x, y)`, mirrored sources are placed at `(2iW ± x, 2jH ± y)`. Expanding circles from those sources, clipped to the original rectangle, produce reflected arcs with the same travel distance as the physical reflection.

Each Play or Again rerolls a deterministic map seed. Some rounds remain open; others contain circles, rotated polygons, long thin walls, tapered shards, and curved ribbons. Blocks stay separated and leave at least 84 percent of the arena free. Clicks use the actual contour plus the player's radius, not the shape's bounding rectangle.

Each seeded round also has a separate deterministic rain stream. Once per elapsed second, a roll starts at 3% probability. A successful selection uniformly samples open water with a small boundary clearance, shows an open white ink warning mark that fills vermilion from bottom to top over 2000 ms, then falls for 550 ms. There is no opaque backing, numerical timer, surrounding circle, or pulse. Full red triggers the fall; the landing mark fades during descent. The textured droplet, broken brush trail, and resulting water waves remain paper white. Impact creates a wave through the same path as a click, without changing the player, move history, or click count. Elapsed play time raises the chance by one percentage point every ten seconds (4% at 10 s, 5% at 20 s), capped at 100%, independently of selected drops; rounds reset it to 3%. Concurrent warnings and falls are allowed. The canvas plays the existing panned drop effect once per impact, respects sound settings, and suppresses stale audio after stalled frames. Reduced motion keeps the warning color progression and timing but omits the falling translation.

The engine splits elapsed intervals at rain rolls and impacts before checking subsequent collisions. The browser and server use the map seed to recreate the same drops, independent of frame rate or click timing. Seedless geometry fixtures retain classic simulation without rain; all browser rounds and ranked replays supply a seed. Rain stops when a round ends or is interrupted.

Obstructed arenas solve the two-dimensional linear shallow-water wave equation on a grid with cells no wider than four logical units and a fixed 50 ms timestep. Solid faces impose zero normal flow (Neumann boundaries). The field therefore reflects and diffracts around arbitrary contours, including curved boundaries and corners. This is a finite-resolution linear approximation, not a full fluid simulation; each drop is propagated independently. The same deterministic solver runs in the browser and server replay.

Weak velocity diffusion damps grid-scale ringing while retaining reflections and diffraction. Crest connectivity is evaluated before filtering: components shorter than three pulse widths (36 logical units), or with less than 60 percent of their length traveling at the configured water speed, are discarded. A noisy local speed estimate can no longer tear an otherwise coherent arc into flickering islands. Temporal interference peaks that turn a patch around without propagating are excluded. Candidate collisions still require a local traveling maximum and confirmation against the visible front. Proximity searches use the complete filtered component before limiting their distance search, so a nearby lethal arc is not mistaken for a short fragment.

Crest extraction has two clocks. Once per physical step, amplitude bounds reject empty tiles and the engine compacts cells whose velocity can cross zero anywhere in that interval and stores their endpoint coefficients. Each animation frame interpolates only that narrow band at the exact elapsed time. This avoids both the former 20 Hz visual staircase and a full-grid contour scan at display frequency. Numerical-step boundaries use a canonical interval, independent of whether collision processing has already advanced one step. Two compact bands retain the displayed interval and one prefetched interval. Each drop schedules its next physics step and contour preparation at a different deterministic phase within the 50 ms clock, spreading work across display frames even when many clicks share the same birth phase. The third height buffer supplies the previous interval without rewinding the solver; collision and surface sampling select the same canonical fields with or without prefetch. Per-wave scratch buffers are reused, and arena scratch grids are shared without leaking coefficients between waves. The stencil uses direct contiguous offsets in open water and mirrored neighbor indices at solid faces. Initial impulses use exact contour intersections rather than sparse point probes, which could seed water across a sub-cell wall.

The canvas caches static obstacle hatching at the current display resolution, uses an opaque main surface, and updates React statistics at 10 Hz while drawing every display frame. Open-water brush rings reuse unit-circle samples and typed geometry buffers. The physics grid, fixed timestep, wave speed, and lifetime stay independent of rendering performance. See [performance validation](PERFORMANCE.md).

Only a positive traveling crest is drawn: surface velocity crosses zero with negative acceleration. Displacement only rejects weak numerical tails; drawing displacement contours would produce two outlines per pulse and spurious trough loops. The faint duplicate outlines are deliberately excluded. Collision finds that crest across fixed timesteps; teleport destinations and the red proximity gradient measure the rendered crest. Empty arenas likewise draw one brush line without a second hair ring.

The engine checks whether a wave crosses the stationary player anywhere within each elapsed interval, rather than checking only one rendered frame. It also checks the destination immediately when a player moves. The outgoing wave is safe at its own birthplace; all waves, including reflected copies, are harmless for their first two seconds. Collision intervals are clipped to that arming instant so contact that has already passed does not kill the player.

| Rule                            | Value                                                              |
| ------------------------------- | ------------------------------------------------------------------ |
| Wave speed                      | 27.1875 logical units per second                                   |
| Wave lifetime                   | 17 seconds                                                         |
| Wave arming delay               | 2 seconds                                                          |
| Player collision radius         | 5.5 logical units                                                  |
| Minimum accepted click interval | 80 ms                                                              |
| Maximum round duration          | 180 seconds                                                        |
| Rules version                   | 13                                                                 |
| Score                           | Accepted clicks × elapsed seconds, rounded to three decimal places |

A round ends if the playing field is resized, so its dimensions stay fixed for the replay. Changes that affect fairness should update `RULES_VERSION` and explicitly address existing leaderboard records. Version 13 separates the revised crest filtering and thin-wall impulse handling from version 12; old bests and pending runs are not submitted under the new rules. The existing rules-version filters apply this separation; an older personal-best record is replaced only when the player submits a version-13 result.

## Scoring and leaderboard

At the start of a round, the browser requests a run ticket using a random token, normalized field dimensions, and map seed. The server validates and stores those dimensions and seed with the current rules version. Guest play is allowed. A finished round is kept in session storage until submitted or explicitly replaced by a new round. It survives authentication and same-tab reloads. Once Convex authentication is ready, submission runs automatically, with bounded retries for a delayed auth session. Run tickets still expire after 15 minutes.

The server:

1. Requires an authenticated session.
2. Finds a matching, unused, unexpired run ticket.
3. Replays the submitted movement history, validated field dimensions, and saved map seed through the shared engine.
4. Derives the score itself and applies timing checks.
5. Marks the ticket used and updates the player's record only if the score is a new personal best.

Only the best score per player is stored in the leaderboard table. The board shows rules-version-13 results; a player's first version-13 score replaces an older-rules record even if its numeric value is lower. Queries return at most 100 entries and a separate record for the current player's personal best. They return display names and score details, not email addresses or authentication records.

Replay checks reject invalid histories and direct score fabrication. They do not detect skilled bots or prove that input came from a human.

## Authentication compatibility

The published `@convex-dev/better-auth` component currently expects an older Better Auth release. Ripple uses a newer Better Auth release and a committed `patch-package` patch rather than downgrading to the older version.

Better Auth 1.7 removed the deprecated OIDC-provider plugin imported by the component. Ripple uses Convex's custom-JWT verification and email/password authentication. The compatibility patch keeps the component's discovery metadata available without installing an OAuth provider. It also strips the newer adapter's `modelKey` metadata before strict Convex validation, permits the optional JWKS `alg` field, and aligns the React provider declaration with the concrete client plugin types. JWT issuance, password hashing, session handling, and verification remain in the upstream authentication packages.

Review this patch against upstream changes when upgrading either package. Verify account creation, password sign-in, authenticated queries, score submission, logout, and session persistence after every authentication dependency update.

## Audio

The music playlist is supplied as static MP3 assets. Tracks play one at a time and wrap to the first after the last. Water effects use excerpts of actual CC0 water recordings, including a bank of drops and a low, calm water rumble. Web Audio plays and mixes those recorded samples. The effects slider controls drops and ambience together; the music slider controls the playlist separately. See [recording sources and processing](AUDIO_SOURCES.md).

The movement bank has 24 new recorded bubble drops, with 12 intervening choices before a repeat. Two separate recorded plunges alternate at the end of a round. Music defaults to zero. Audio initializes only after a user gesture. Music and effects settings are stored locally. Browsers may suspend audio when backgrounded, and blocked audio must not prevent a game from running.

## Data and privacy

| Data                                         | Location                     | Visibility                                    |
| -------------------------------------------- | ---------------------------- | --------------------------------------------- |
| Sound preferences and local best             | Browser local storage        | This browser                                  |
| Finished run awaiting login/submission       | Browser session storage      | This tab                                      |
| Email, display name, password hash, sessions | Convex Better Auth component | Authentication backend                        |
| Display name and personal-best details       | Convex leaderboard table     | Authenticated players                         |
| Temporary run ticket                         | Convex run table             | Backend functions                             |
| Submitted move history                       | Used during score validation | Backend mutation; not stored as a full replay |

The app does not add advertising or analytics. Hosting and database providers may process operational logs according to their own terms. Run tickets are periodically removed after 24 hours. Deleting an authentication account also removes its leaderboard entry. The current signup flow does not verify email addresses or send transactional email.

When publishing your own instance, configure provider retention and account-deletion handling to match your needs. Do not ask users to place private account information in public GitHub issues.

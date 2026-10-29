# Contributing to Ripple

Thank you for helping make Ripple a little better. Changes should preserve its simple rules, quiet sound, and dark, drawn-on-paper character.

## Before you begin

Check existing issues and pull requests. For a larger gameplay, authentication, or visual change, open an issue first so the direction can be discussed before you invest time.

Useful contributions include reproducible bug reports, accessibility fixes, browser compatibility improvements, and tests for real simulation edge cases.

## Local setup

Follow the [README](README.md#run-locally). Use your own Convex project and development deployment. Never point experimental code at someone else's production database.

```sh
npm ci
npx convex dev
```

In a second terminal:

```sh
npm run dev
```

Installation applies a committed compatibility patch to the Convex authentication component. Do not disable package installation scripts or remove the patch without checking both authentication and backend deployment.

## Making a change

1. Create a branch with a descriptive name.
2. Make one focused change. Explain the user-visible problem and resulting behavior.
3. Add a test when it exercises meaningful game logic or prevents a real regression. Avoid tests that only mirror implementation details.
4. Run the checks below.
5. Open a pull request with a clear description and relevant screenshots.

```sh
npm run check
npm run build
```

For backend changes, also run `npx convex dev --once` against your development deployment. Test authenticated and unauthenticated behavior. For UI or audio changes, verify a narrow touch layout, visible keyboard focus, volume controls, mute, and behavior when the browser tab is hidden.

## Game and design conventions

- Keep user-facing copy in English, brief, and useful.
- Avoid decorative headings, HUD clutter, and unnecessary controls.
- Keep the simulation deterministic. Randomness may shape drawing or select recorded samples, but never collision checks or scores.
- The browser and server must use the same engine rules. Bump `RULES_VERSION` when a change affects scoring or fairness, and discuss how existing leaderboard records should be handled.
- Respect reduced-motion preferences for decorative animation.
- Sound must remain optional and begin only after user interaction.
- Never trust a score, user ID, or display name supplied by the browser as an authoritative leaderboard value.

## Pull requests

Describe the trigger, what changed, how it was verified, and any remaining limits. Include before/after screenshots for visible changes. Do not include secrets, account emails, real user records, or unrelated files in screenshots or test fixtures.

Keep dependency changes deliberate. Check the lockfile and `npm audit`; verify the committed authentication compatibility patch after upgrading Convex or Better Auth.

## Reporting problems

Use the issue templates for ordinary bugs and ideas. Include browser/device, steps to reproduce, expected behavior, and actual behavior. For sound problems, describe volume settings and whether playback began after a click.

Follow [SECURITY.md](SECURITY.md) for vulnerabilities. Do not post credentials or working exploits against the live service in public issues.

## Contribution terms

By submitting a contribution, you confirm that you have the right to share it and agree that your original contribution may be distributed under the [Ripple Noncommercial License](LICENSE). Third-party material must be identified and compatible with its intended use. Adding a file does not change its original license.

# Security

## Report a vulnerability

Do not include credentials, private user information, session tokens, or an exploit against the live deployment in a public issue.

Use [GitHub's private vulnerability reporting](https://github.com/MusicMaster4/Ripple/security/advisories/new) when it is available. If that option is unavailable, open a minimal issue requesting a private reporting channel without publishing exploit details.

Include the affected version or commit, a clear description, reproduction steps using your own local or development deployment, and the expected impact. Screenshots and logs must have credentials and user data removed.

## Deployment boundaries

- `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` are public service addresses embedded in the frontend bundle.
- `BETTER_AUTH_SECRET`, Convex access/deploy keys, Vercel tokens, and session credentials are private. They must never use a `VITE_` prefix or be committed to Git.
- `.env`, `.env.*`, local research/test state, and `.vercel/` are ignored. `.env.example` must contain placeholders only.
- Convex owns the authentication database and password hashing. The leaderboard query returns an explicit public projection, not complete user records.
- Authentication is required to read the leaderboard or submit a score. The anonymous run-ticket endpoint is intentionally public.
- Server-side replay validation does not stop bots or make the client tamper-proof.
- The current email/password flow confirms password entry but does not verify email ownership. There is no configured email delivery or password-reset email service.

## Dependencies

Keep the lockfile and compatibility patches in source control. Run `npm audit` and the project checks after dependency changes. The patch adapting the Convex component to Better Auth 1.7 must be reviewed when either package changes; do not downgrade authentication packages to make a build pass without reviewing the security impact.

## Accidental exposure

If a secret is exposed, revoke or rotate it at the provider immediately. Removing it from a later commit is not enough. Review deployed environment values, build output, repository history, and logs before publishing again.

Never test a suspected issue on another player's account or run disruptive traffic against the hosted service.

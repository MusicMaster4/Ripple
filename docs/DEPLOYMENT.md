# Deploy Ripple

Ripple builds to a static `dist/` directory. Vercel hosts the frontend; Convex hosts functions, authentication, and the leaderboard.

## Environment reference

| Name | Set where | Public? | Purpose |
| --- | --- | --- | --- |
| `CONVEX_DEPLOYMENT` | Local `.env.local` | No need to publish | Select the CLI project/development deployment |
| `VITE_CONVEX_URL` | Local `.env.local` and Vercel | Yes | Matching `.convex.cloud` address |
| `VITE_CONVEX_SITE_URL` | Local `.env.local` and Vercel | Yes | Matching `.convex.site` HTTP/auth address |
| `SITE_URL` | Convex environment | Not a credential | Exact frontend origin trusted by authentication |
| `BETTER_AUTH_SECRET` | Convex environment only | **No** | Cryptographically random secret, at least 32 bytes |
| `CONVEX_DEPLOY_KEY` | Optional private CI environment | **No** | Backend deployment from CI |

Never prefix secrets with `VITE_`: Vite embeds those values in the public JavaScript bundle. Never commit real `.env` files or provider tokens. Client URLs are addresses, not administrative credentials.

## First deployment

### 1. Prepare Convex

Create your own Convex project and production deployment. Connect the checkout:

```sh
npm ci
npx convex dev
```

Select your project. `npx convex dev` targets development; `npx convex deploy` targets the project's production deployment by default.

In the Convex production dashboard, set:

- `SITE_URL`: the exact frontend origin, such as `https://your-ripple.vercel.app`, without a trailing path.
- `BETTER_AUTH_SECRET`: a fresh random secret of at least 32 bytes.

Do not reuse production secrets in development. Configure development separately with `SITE_URL=http://localhost:5173` and its own secret.

Deploy the backend:

```sh
npx convex deploy
```

Keep the reported production `.convex.cloud` address and its matching `.convex.site` address. Do not use development addresses for the public app.

### 2. Configure Vercel

Import the GitHub repository into Vercel:

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |

Add `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` to the **Production** environment. The frontend does not need a Convex deploy key or `BETTER_AUTH_SECRET`.

Installation scripts must run: `postinstall` applies the authentication compatibility patch.

Publish the frontend. Confirm Convex's production `SITE_URL` exactly matches the final public origin. If the origin changes, update it in Convex before testing sign-in.

The routing configuration must serve `index.html` for application routes so `/leaderboard` works on direct visits and refresh.

### 3. Verify production

Test the actual public origin:

- Start a guest round, move, observe reflections, and verify a wave ends the round.
- Check the score equals accepted clicks × elapsed seconds.
- Listen to drops and water ambience; adjust both sliders and reload to check persistence.
- Check mute/unmute and the three-track playlist.
- Visit `/leaderboard` while signed out; account-only data must remain gated.
- Create a disposable account, sign out, and sign in again.
- Finish a round and verify the personal best appears on the board.
- Refresh to check session persistence and route handling.
- Check a narrow touch layout, keyboard focus, and the browser console.

Do not publish screenshots containing private account details or credentials.

## Updates

Frontend-only changes can build from a Git push using Vercel's stored public environment values. Backend or shared-engine changes also need a Convex deploy:

```sh
npm run check
npm run build
npx convex deploy
```

Coordinate shared-engine changes so browser and server use the same rules. Review leaderboard records when `RULES_VERSION` changes. A frontend Git integration does not automatically deploy Convex.

For automated backend deployment, store a scoped deploy key only in the private CI provider environment. It is not needed for ordinary frontend builds.

## Previews

Preview origins are not automatically trusted by production authentication. Use a separate Convex development or preview deployment and explicitly configured origin. Do not add broad wildcard origins.

## Troubleshooting

**Sign-in fails:** Check that both public URLs refer to the same deployment, the backend has its secret, and `SITE_URL` exactly matches the browser origin.

**A route returns 404 after refresh:** Confirm the SPA rewrite is present.

**The authentication dependency fails to bundle:** Run `npm ci` with installation scripts enabled. Confirm the patch applies to the installed component version.

**Audio is silent:** Interact first, then check both sliders, mute, and browser/device audio settings. Autoplay before user interaction is intentionally avoided.

**A run cannot be saved:** Check the network and sign-in state. Tickets expire; interrupted or invalid runs are not accepted. Play a new round after reconnecting.

**An email never arrives:** The current app does not send email. Signup confirms password entry but does not verify email ownership. Email verification and password-reset mail need additional provider configuration and UI work.

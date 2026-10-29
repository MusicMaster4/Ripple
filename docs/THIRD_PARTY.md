# Third-party material

The [Ripple Noncommercial License](../LICENSE) covers original material authored for this project. It does not replace licenses or permissions attached to dependencies and supplied assets.

## Dependencies

Installed JavaScript packages retain their respective licenses. Consult each package's license in `node_modules/` and the exact versions recorded in `package-lock.json`.

The project uses React, Vite, TypeScript, Convex, Better Auth, Lucide, and their dependencies. A committed compatibility patch modifies the installed Convex/Better Auth integration; the upstream component retains its Apache-2.0 license.

## Fonts

Cormorant Garamond, DM Sans, and DM Mono are loaded locally through Fontsource packages. Their font files retain the SIL Open Font License 1.1, preserved here for [Cormorant Garamond](licenses/cormorant-garamond-OFL.txt), [DM Sans](licenses/dm-sans-OFL.txt), and [DM Mono](licenses/dm-mono-OFL.txt). The project license does not restrict rights independently granted by those licenses.

## Audio

The background music consists of these supplied files:

- `public/audio/nostalgic-morning.mp3`
- `public/audio/nostalgic-echoes.mp3`
- `public/audio/cozy-drift.mp3`

These recordings were supplied for the Ripple project. No general redistribution or commercial license to those recordings is granted by this repository's source-code license. Obtain appropriate permission from the rights holder before reusing or redistributing them independently or in your own deployment. You may replace them with recordings you have permission to use, preserving or updating the paths in `src/lib/audio.ts`.

Water effects use actual CC0 water recordings. Their original sources, licenses, and excerpt processing are documented in [AUDIO_SOURCES.md](AUDIO_SOURCES.md). This CC0 material is separate from the supplied background music.

## Artwork

The ring icon and canvas visuals are drawn in SVG and code for this project. Screenshots document the app's interface. Any separately identified third-party content visible in a screenshot retains its original rights.

# Submission checklist

## Product and repository

- [ ] Confirm the current Devpost event rules, eligibility, required fields, and submission deadline on the official event page.
- [ ] Review the README quick start from a clean checkout.
- [ ] Run `pnpm install --frozen-lockfile`, copy `.env.example` to `.env`, and run `pnpm demo` twice.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm format:check`; record any environment-only WebSocket test limitations accurately.
- [ ] Confirm the dashboard demo button works with `DEMO_MODE=true`, two idle channels, and the current source/target overlay pages.
- [ ] Confirm `/chain` and `/chain/<quest-id>` show the persisted demo story and do not expose voter identifiers or rejected proposals.

## Demo video

- [ ] Record a video shorter than three minutes using [docs/DEMO_SCRIPT.md](DEMO_SCRIPT.md).
- [ ] Label the scripted A-to-B story and its 37-viewer party size as simulated.
- [ ] Show naming approval, both faction tallies, welcome card, outcome, and public chain.
- [ ] Keep `.env`, dashboard token, overlay key, Twitch token files, and personal account details off screen.

## Claims and security

- [ ] Keep the distinction between implemented adapters and verified live Twitch delivery clear in the project description.
- [ ] Do not claim live raid counts, two-channel chat, refresh recovery, or NVIDIA inference until each is verified; check all `TODO(verify)` items in [docs/TWITCH_NOTES.md](TWITCH_NOTES.md).
- [ ] Describe incoming-party attribution as an observed cohort; Twitch's raid viewer count does not identify every raider.
- [ ] Confirm `.env`, `.data/twitch-tokens.json`, and SQLite files are not staged or included in the uploaded artifact.
- [ ] Rotate any dashboard or overlay keys that were included in screenshots, links, or shared messages.
- [ ] Ensure the Devpost text matches what the submitted video and current build actually demonstrate.

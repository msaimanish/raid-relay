# Demo video shot list

Target length: about 2:40, under the three-minute limit in the project brief.

| Time      | Shot           | What to show / say                                                                                                                                |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Hook           | “A raid brings people into a new chat without the story. Raid Relay gives both communities a decision to make right away.”                        |
| 0:15–0:30 | Setup          | Show the source-channel dashboard beside the overlay preview. Say the following run is simulated.                                                 |
| 0:30–0:45 | Start          | Click **Run full demo**. Show the naming prompt and proposal count; note proposals remain private until streamer approval.                        |
| 0:45–1:05 | First beat     | Show the approved canon name and the protect/claim vote with faction labels and counts.                                                           |
| 1:05–1:30 | Raid welcome   | Show the target-channel overlay welcome, source channel, simulated party size of 37 (medium tier), recap, and `!join` instruction.                |
| 1:30–1:55 | Community vote | Show Incoming party and Locals tallies and the equal-faction rule. Explain that `!join` is an observed cohort signal, not proof of raid identity. |
| 1:55–2:15 | Outcome        | Show the deterministic beat-two result, state changes, and SIMULATED badge.                                                                       |
| 2:15–2:35 | Story chain    | Open the quest detail and list pages. Point out the persisted public decisions, party count, and outcome.                                         |
| 2:35–2:40 | Close          | “The demo is simulated. Live Twitch EventSub and NVIDIA inference are still being verified.”                                                      |

## Recording checklist

- Set `DEMO_MODE=true`, confirm both configured channels have no active quests, and restart `pnpm dev`.
- Open the source dashboard and target overlay in separate windows. The overlay route is the OBS-facing view.
- Use the dashboard button for the visual walkthrough; `pnpm demo` is the standalone terminal run and does not open the web pages.
- Use a fresh demo run and show its SIMULATED badge. Do not imply the sample 37 viewers came from Twitch.
- Make browser zoom and text readable in the recording; keep dashboard/overlay keys out of frame.
- End on the public chain page. Do not show `.env`, `.data/twitch-tokens.json`, raw account IDs, or credentials.

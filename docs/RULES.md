# Deterministic game rules

## Party size

The raid event's `viewers` value is stored exactly as received. The rules tier is derived separately: small is 1–9, medium is 10–49, and large is 50 or more. A missing value remains `null`; only the rules tier falls back to medium, and the chain event records that fallback. Zero is preserved as zero and treated as small.

## Vote combination: `v1-equal-faction-share`

Each faction's choices are converted to shares within that faction. When both factions have votes, each faction's share contributes one half to the final score; when only one faction voted, its share is the whole score. A faction with no votes contributes zero. When nobody votes, the beat's designated default choice is selected (`protect` for beat 1, `sneak` for beat 2) and `noVotes` is recorded. Ties use higher raw vote total, then the listed fixed choice order.

For every resolution, persist per-choice raw raider/local counts, per-faction shares and combined scores, faction totals, the chosen option, and the rule version. One latest vote per account per round is counted; replacing a vote changes its existing row.

### Worked example

Three Incoming party votes select `protect` and one Local vote selects `claim`. Their shares are `protect: (1/2 × 1) + (1/2 × 0) = 0.5`, and `claim: (1/2 × 0) + (1/2 × 1) = 0.5`. Equal scores tie, so the higher raw total wins: `protect` with 3 votes.

## Beat 2 outcome score

For the selected choice, calculate:

`score = base[choice] + tierBonus[choice][tier] + flagBonus[flag][choice]`

| Choice | Base | Small bonus | Medium bonus | Large bonus | Bond bonus | Power bonus |
| ------ | ---: | ----------: | -----------: | ----------: | ---------: | ----------: |
| fight  |    2 |           0 |            1 |           2 |          0 |           1 |
| trade  |    2 |           1 |            1 |           1 |          1 |           0 |
| sneak  |    2 |           2 |            1 |           0 |          1 |           0 |

Scores of 4 or more are a triumph; 3 is a costly win; 2 or less is a setback. Outcomes and state changes use static text: a trade yields `relic: traded`; fight/sneak yield `kept` for triumph/costly win and `lost` for setback. The bond flag records `bond: +1`; power records `bond: 0`. No randomness is used.

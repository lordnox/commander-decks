# Review-table summarizer flags

`summarize_replays.py` strips `state` from the event log and adds leads.
Every flag needs a human pass against Oracle and the primer.

## Inputs

- `table-games/*.json` schema 1, including gitignored scratch files
- `--deck` matches seat id, brew title, commander name, or folder slug
- `--seat` keeps turn rows and flags for matching seats
- Deck categories come from that seat's `cards.json` when present

## Flag meanings

**missed_land_drops.** That seat had a main phase, never `play_land` that
turn, and still held a land at the last seat event of the turn. Could be
deliberate (spell-land later, bounce land, already made the drop via a
ramp spell). Check the turn actions.

**unused_reactive.** An opponent `cast` or `attack` while this seat had
an instant-speed *answer* in hand and untapped mana sources, and the next
few events show no `cast`/`activate` from that seat. Answers are Instant
or Flash cards whose Oracle matches counter, destroy, exile, bounce,
fog, cantrip, tap, or damage. Reanimation Auras with flash are not
answers. Mana sources are untapped lands plus untapped permanents whose
Oracle contains `: Add`. False positives: unpayable colors, politics, or
a spell that does not actually stop the threat.

**sac_before_attack.** Same seat, same turn: a summary or note matching
`sacrific` happens before the `attack` event, and token creatures were on
that battlefield at the start of the earlier window. The Squirrel case:
tokens that can be sacrificed at instant speed should usually attack
first. Reject when the sac was required to pay for the attack, to grow
the attacker, or to survive a declared blocker/wipe.

**never_deployed.** Names that appeared in hand (keep, draw, or a
snapshot) and were still in the final hand, never listed on `cast`,
`play_land`, or `activate`. Held interaction is often correct. Lands in
this list after a missed drop feed Mode A. Commanders in the command
zone are not in this bag.

## Turn rows

Each turn lists, per seat: life, lands, untapped mana, token creatures,
draws, casts, land drops, attackers, compact zones, and that seat's
actions. Use this instead of the raw replay JSON.

## Do not

- Treat one seed as a metagame or a power rating
- Treat a truncated horizon as a concession
- Infer library cards that were never drawn
- Confuse a sim rules error with a list problem

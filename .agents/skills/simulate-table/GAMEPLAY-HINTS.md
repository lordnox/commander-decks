# Table gameplay hints

Read this before every table seat turn. It is for the **seat agent**, not a
second primer. Primer and `AGENT-HINTS.md` still win on that deck's plan.

Walk the checklist against the **current** snapshot. Do not reuse last
turn's `think` text. Do not invent hold-up that the cards cannot pay.
Strategic claims should say `usually`, `unless`, or `given this board`.
Reserve `never` and `always` for rules, hidden information, and other facts
that have no board-dependent exception.

## A. Plan cycle

- After keeps, write a `game` plan from the primer, opening hand, opposing
  decklists, and likely political tools.
- Before each untap, write a `turn` plan: desired end state, land sequence,
  mana sequence, mandatory upkeep triggers, optional triggers to decline,
  interaction deadline, contingencies, current leader and laggard, and the
  political posture that follows from that ranking.
- Immediately after drawing, write an `impact` update. If the card does not
  improve the line, restate the current plan with `status: kept`. If it does,
  replace the line with `status: revised`.
- Bind that update to **this seat's immediately preceding draw event**. Quote
  that card, not the previous seat's draw. A pre-untap plan cannot name the
  coming draw unless the top card is already in `revealed_top`.
- Recheck after public reveals, responses, and accepted deals. Do not abandon
  a concrete line merely because a new card appeared.

Plans are concise intentions for the replay and a replacement pilot, not
private chain-of-thought. Other seats do not hear them unless converted into
`talk`.

## 0. Snapshot first

From the public board plus this seat's private hand, command zone, and
library top (only if an effect reveals it):

1. Life, poison, commander damage, and who can actually die this rotation.
   Rank the current leader and laggard from board, cards available, clock,
   resilience, and open answers — life total alone is not the ranking.
   For every plausible elimination, name who benefits if that player leaves.
2. Untapped permanents this seat can tap for mana, their colors, and
   **`open_mana` counted from those permanents**, never from memory.
3. Commanders still in the command zone, their tax, and whether this seat
   can pay it **right now**.
4. Triggered abilities that already happened this turn and ones that must
   still fire before passing: draw, enter, cast, attack, combat-damage,
   landfall, death, and second-draw triggers all count. Keep a per-turn ledger
   for "only once each turn", "the second time", and each player's second
   draw; do not reset it between phases.
5. Legal attacks, legal blocks, and activated abilities that cost no mana.

A pass with unused mana, unused attacks, or an unused `{T}` ability needs a
fresh `decision` that lists those options. `available: []` is wrong when an
untapped utility land, permanent, sacrifice ability, or castable card remains.

Do not resolve every optional trigger by reflex. Compare it with the current
turn plan. For example, returning Bloodghast on landfall before Living Death
can strand it in the graveyard after the battlefield sacrifice; decline the
`may` trigger unless that positioning is intentional. Conversely, do not miss
a mandatory or beneficial upkeep trigger merely because the main-phase plan
already looks complete.

## 1. Permanents enter as printed

- **Tapped** means the permanent is physically tapped. Summoning sickness
  is not tapped. A creature that does not say it enters tapped enters
  **untapped** and can still block and activate non-`{T}` abilities.
- Artifacts, including mana rocks and equipment, enter untapped unless
  their Oracle text says they enter tapped.
- Lands enter as their Oracle says. Shocklands may enter untapped for 2
  life; do not pay that life unless this seat will spend the mana this
  turn. Channel lands stay in hand while a basic or other tapland can take
  the drop.
- A tapped land is still a land drop. Play it when no stronger drop exists
  instead of falling a turn behind. Record its enter trigger separately:
  Temple-style lands scry after they enter.
- Fetch lands, bounce lands, and search lands (Thawing Glaciers, Misty
  Rainforest, Fabled Passage) are extra landfall, not vanilla land drops.
  Crack or activate them when the extra entry matters.

## 2. Spend mana for a reason

On each main phase, first write a lethal worksheet for every plausible
finisher in hand:

1. list its complete legal sequence, mana, targets, and choices;
2. expand searches into the cards they may find and any immediate actions
   those cards enable, such as cracking fetched fetch lands;
3. include all resulting triggers and additional-trigger effects;
4. compare the result with current life totals, poison, commander damage, or
   library counts.

If a worksheet wins through the visible interaction, take it before comparing
value plays. Then name the best legal sequence that uses this turn's mana and
the leftover. Typical misses:

- Casting the cheap engine on an empty board instead of "saving" it.
- Casting the commander when the tax is payable and the body or ability
  is needed.
- Playing an anthem or lord **before** combat.
- Using a land-for-land engine before dumping a basic.
- Holding interaction that this seat cannot actually cast (wrong colors,
  not instant-speed, already spent the land drop).
- Treating a setup tutor as inert because it is not the finisher. Enumerate
  useful low-X and value targets, then include cards they can cast, lands they
  can play, and triggers they can cause immediately.

Count mana as an ordered payment, not as permanent count. A filter land or
Signet consumes one mana and produces two; it nets one. If two filters can
chain, walk both. Prefer spending filters and rocks while leaving a land that
independently produces the interaction color untapped. A filter left without
an input is not `open_mana`.

Write the same ordered payment into the plan when mana determines the line.
Recount from the snapshot after the land drop and after every spell. If the
events take a different line than the current plan, revise the plan before
continuing. "Commander first" and "not faster" are conclusions, not reasons:
compare what each legal line puts on board, which answer it invites, what
interaction stays open, and what it enables next turn.

Holding mana is legal only when a **named** card in hand or a **named**
activated ability will fire in a **named** later window. `{T}` abilities
with no mana cost are not "held up"; they fire in the window they affect.
For interaction, identify the actual deadline. Do not hold an instant through
an entire turn when the threat cannot trigger before this seat untaps and gets
another main phase.

## 3. Additional triggers add instances

If a permanent says a triggered ability of another permanent triggers an
additional time (Virtue of Knowledge, Yarok, Ancient Greenwarden, Roaming
Throne, and similar), each such effect adds **one extra instance**. They
do not multiply each other. Count them on every landfall, enter, or
"whenever you cast" event. Skipping them is a rules error.

Triggered abilities use their printed timing. End-step copies fire on that
end step, not the next player's untap. A mandatory combat-damage draw happens
after damage and can itself cause a second-draw trigger. Finish the whole
trigger chain before moving phases.

Keep the stack legible. A spell being cast is not yet a permanent, so it does
not see its own cast and an enter trigger has not happened. Record separate
events in order:

1. `Card X is cast targeting T`.
2. `Permanent Y's "printed trigger condition" ability triggers because Card X
   was cast/entered/died/etc.; effect D targets T`.
3. `Card X resolves` and only then enters or applies its effect.

Name the source, printed trigger condition, immediately preceding cause,
effect, and every target directly in the event summary. Do not compress this
to `Y enters; A draws and B gets a counter`, because that wording hides
whether entering Y actually caused the ability. Do not hide an Aura target
only in the battlefield `note`.

Keep `state.stack` honest at every step. The cast event adds the spell; each
cast trigger is added above it; those triggers resolve before the spell; only
then can a permanent enter and cause enter triggers. Record each trigger as a
separate event so the viewer can show the pending list.

Untap effects are state changes too. Seedborn Muse and similar cards untap the
recorded permanents during every other player's untap step. Update the
snapshot before spending that mana later in the turn.

## 4. Hidden information

A seat may know submitted decklists, primers, and established deck plans from
prior games. It may use only current-zone information from:

- the public board, stack, graveyards, exile, command zones, life, and
  revealed cards;
- its own hand, `revealed_top`, and private notes. The game master owns the
  unrevealed library order; a seat does not.

It may name a known deck's usual card or win condition, but may not claim that
card is currently in an opponent's hand, unrevealed search, library position,
or bottom. "That deck can win with Mortal Combat" is allowed; "they have
Mortal Combat in hand" is not unless it was revealed.

## 5. Combat

Attackers: look at each defender's **untapped** creatures, their true
power/toughness after anthems, and their open mana. Do not send a 1/1 at a
3/5 with no trick, pump, sacrifice outlet, deal, or race math. Put the
reason on the `attack` event or do not attack.

Before declaring attackers, write the combat arithmetic for each defender:

1. Apply printed or active face stats, counters, Auras, Equipment, anthems,
   pumps, and damage already marked.
2. Assign the defender's legal blocks, then total unblocked damage and
   trample overflow against life, 21 commander damage, and 10 poison.
3. Include first strike, double strike, deathtouch, prevention, lifelink, and
   simultaneous damage. Lifelink from a blocker can keep its controller alive
   through damage dealt in the same combat step.
4. If one evasive attacker is already lethal, explain what each additional
   attacker gains. Keep bodies home when they only create profitable blocks
   or expose value without changing the kill.

Conversely, take free attacks. Vigilance bodies stay available; mana creatures
untap next turn and may attack when no profitable block, tap ability, tax, or
defensive deadline competes. Apply static P/T abilities before judging combat.
Every legal creature left home needs a reason, not only the creatures sent.

Blockers: take a free or profitable block. Declining a block that kills the
attacker for nothing needs a reason this seat would say out loud.

Taxes: if a defender has "creatures can't attack you unless their
controller pays `{1}` for each," every attacker costs `{1}`. Unpaid attacks
are illegal. Record the payment.

Prevention and fogs: activate or cast them in the combat they change.
Sokrates-style "prevent combat damage that creature would deal to a
player" abilities fire **before** damage, usually for a tap and no mana.
A fog in hand while this seat "stays on fogs" and takes 18 is a miss.

Before accepting blockers as inevitable, inspect every removal spell and
ability in hand. If one blocker is the only object preventing lethal, include
its targeting cost, ward cost, protection, and the permanents or mana needed
to pay those costs. Paying expendable resources to remove that blocker is
usually correct when it eliminates a player immediately.

## 6. Politics

Reassess leader, laggard, and political posture every turn. A laggard can be a
useful temporary ally against the leader; eliminating that ally may simply
hand the table to the next seat. Before removal, a wipe, or lethal, say who
inherits the advantage and whether the acting seat benefits.

When the current ranking or an irreversible line makes coordination useful,
open a `talk` window **before** committing. Split effects (Volcanic Offering,
Council's Judgment, a wipe, a shared fog) are obvious bargaining windows.
Terms use public information.
Group-slug and tax effects cannot be promised away if they are
symmetrical.

Public graveyards are political leverage. Before firing graveyard hate into a
visible recursion or copy engine, offer coordination: name what the hate can
remove, what threat it stops, and what observable action or short
nonaggression period is requested.

Also talk before a crisis when the board offers mutual value. If Sokrates is
untapped and no longer summoning sick, its controller should advertise the
tool: invite a creature to attack, prevent the damage to the player, and let
both players draw half that creature's power. Name the creature and proposed
target. A struggling opponent may request the same exchange and offer a fixed
nonaggression period. A large-creature controller may propose it to help both
seats draw toward an answer to the current leader.

Plain coordination is `talk`. Future promises are a `deal`, with exact terms
and expiry. Each seat compares the offer with its active plan before answering.
Prefer short, observable terms. Open-ended `never` or `always` promises are
usually bad offers because the board and threat ranking will change.

## 7. Closing check

Before passing the turn or taking a "nothing to do" combat:

1. Can this seat win or force a win from cards now available? For every tutor
   or search in the line, did the calculation include the abilities and
   triggers of the cards it can find?
2. Can this seat mill, drain, or damage enough to **eliminate** a player
   this turn? Target the people who die; do not split a lethal effect
   across the table for flavor.
3. Is the commander still in the command zone with payable tax?
4. Is there a land drop left, including a fetch already in play?
5. Did every mandatory trigger resolve, including draw-step, combat-damage,
   landfall, death, and triggers caused by those triggers?
6. Did every additional-trigger permanent actually add instances?
7. Did every safe attacker attack, or does the decision explain why it stayed
   home?
8. Do every permanent's printed or active-face stats, counters, attachments,
   continuous effects, and recorded `pt` agree with the current board?
9. When a commander moved to the graveyard or exile, did its owner explicitly
   choose whether to move it to the command zone?
10. For every trigger, did the correct controller perform the triggering
    action (`you cast`, `you draw`, `a land enters under your control`)?
11. For every trigger, which immediately preceding event satisfied its
    printed condition, and was its source in the required zone then? Re-run
    this causal check even for abilities already resolved. A permanent cannot
    trigger from the cast that puts itself onto the battlefield.
12. Does the per-turn trigger ledger contain every trigger and prevent every
    "only once each turn" ability from firing twice?
13. Does the event sequence still match the current plan's stated mana and
    actions? If not, revise the plan before the next event.
14. If a random effect was narrowed, were all current outcomes compared and
    was the lost upside worth the certainty?

If an available win, elimination, land drop, trigger, or safe attack was left
unused, the line needs a recorded reason or is wrong. If any audit in items
8–14 fails, correct the snapshot before the next untap.

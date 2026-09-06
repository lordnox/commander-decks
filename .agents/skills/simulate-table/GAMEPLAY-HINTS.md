# Table gameplay hints

Read this before every table seat turn. It is for the **seat agent**, not a
second primer. Primer and `AGENT-HINTS.md` still win on that deck's plan.

Walk the checklist against the **current** snapshot. Do not reuse last
turn's `think` text. Do not invent hold-up that the cards cannot pay.

## A. Plan cycle

- After keeps, write a `game` plan from the primer, opening hand, opposing
  decklists, and likely political tools.
- Before each untap, write a `turn` plan: desired end state, land sequence,
  mana sequence, mandatory upkeep triggers, optional triggers to decline,
  interaction deadline, and contingencies.
- Immediately after drawing, write an `impact` update. If the card does not
  improve the line, restate the current plan with `status: kept`. If it does,
  replace the line with `status: revised`.
- Recheck after public reveals, responses, and accepted deals. Do not abandon
  a concrete line merely because a new card appeared.

Plans are concise intentions for the replay and a replacement pilot, not
private chain-of-thought. Other seats do not hear them unless converted into
`talk`.

## 0. Snapshot first

From the public board plus this seat's private hand, command zone, and
library top (only if an effect reveals it):

1. Life, poison, commander damage, and who can actually die this rotation.
2. Untapped permanents this seat can tap for mana, their colors, and
   **`open_mana` counted from those permanents**, never from memory.
3. Commanders still in the command zone, their tax, and whether this seat
   can pay it **right now**.
4. Triggered abilities that already happened this turn and ones that must
   still fire before passing.
5. Legal attacks, legal blocks, and activated abilities that cost no mana.

A pass with unused mana, unused attacks, or an unused `{T}` ability needs a
fresh `decision` that lists those options.

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
end step, not the next player's untap.

## 4. Hidden information

A seat may know submitted decklists, primers, and established deck plans from
prior games. It may use only current-zone information from:

- the public board, stack, graveyards, exile, command zones, life, and
  revealed cards;
- its own hand, library order, and private notes.

It may name a known deck's usual card or win condition, but may not claim that
card is currently in an opponent's hand, unrevealed search, library position,
or bottom. "That deck can win with Mortal Combat" is allowed; "they have
Mortal Combat in hand" is not unless it was revealed.

## 5. Combat

Attackers: look at each defender's **untapped** creatures, their true
power/toughness after anthems, and their open mana. Do not send a 1/1 at a
3/5 with no trick, pump, sacrifice outlet, deal, or race math. Put the
reason on the `attack` event or do not attack.

Blockers: take a free or profitable block. Declining a block that kills the
attacker for nothing needs a reason this seat would say out loud.

Taxes: if a defender has "creatures can't attack you unless their
controller pays `{1}` for each," every attacker costs `{1}`. Unpaid attacks
are illegal. Record the payment.

Prevention and fogs: activate or cast them in the combat they change.
Sokrates-style "prevent combat damage that creature would deal to a
player" abilities fire **before** damage, usually for a tap and no mana.
A fog in hand while this seat "stays on fogs" and takes 18 is a miss.

## 6. Politics

When one seat is clearly winning the table and this seat has a split
effect (Volcanic Offering, Council's Judgment, a wipe, a shared fog),
open a `talk` window **before** committing. Terms use public information.
Group-slug and tax effects cannot be promised away if they are
symmetrical.

Also talk before a crisis when the board offers mutual value. If Sokrates is
untapped and no longer summoning sick, its controller should advertise the
tool: invite a creature to attack, prevent the damage to the player, and let
both players draw half that creature's power. Name the creature and proposed
target. A struggling opponent may request the same exchange and offer a fixed
nonaggression period. A large-creature controller may propose it to help both
seats draw toward an answer to the current leader.

Plain coordination is `talk`. Future promises are a `deal`, with exact terms
and expiry. Each seat compares the offer with its active plan before answering.

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
5. Did every additional-trigger permanent actually add instances?

If any answer is yes and this seat passed, the line is wrong.

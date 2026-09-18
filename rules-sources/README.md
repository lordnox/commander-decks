# Comprehensive Rules lookup

The Magic: The Gathering Comprehensive Rules are published by Wizards of the Coast.
This directory does **not** vend a full rules snapshot — kernel modules cite rule numbers
in comments; look up the text when you need the exact wording.

**Official download (2026-08-19 file, effective 2026-08-07):**
[Wizards download](https://media.wizards.com/2026/downloads/MagicCompRules%2020260819.txt)

Agents should fetch that URL or use a local copy outside the repo. Refresh when Wizards
publishes a new dated file or a cited rule number is in doubt.

Copyright remains with Wizards of the Coast.

## Sections the rules-engine work cites often

When questions involve **trigger order, priority, or state-based actions**, read the
official file above — do not reconstruct from memory.

While a spell or ability is resolving, players do **not** receive priority (117.3a / 608).
Multiple draws are still **separate draw events** (121.2): replacement effects and
“whenever you draw” triggers can fire per card. Those triggers wait until a player
**would** receive priority (603.3), after the current spell or ability has finished
and state-based actions have been checked (704). Do not insert a priority window
between “draw three” cards.

The same file’s Courser of Kruphix ruling (2021-03-19): with the top card revealed,
reveal each card **before** it is drawn; if several cards are put on top at once,
reveal only the new top card. Cards that became public this way stay **known** in
hand — show their faces among card backs. Do not pause the table for people to look.

| Topic | Rules |
| --- | --- |
| Priority | 117 |
| Draw one at a time | 121.2 |
| Stack (spells and abilities) | 405, 601–608 |
| Triggered abilities | 603 |
| State-based actions | 704 |
| Discard | 701.9 |
| Player choices (hidden zones) | 400.2, 401, 701.15 (scry), 701.46 (surveil) |

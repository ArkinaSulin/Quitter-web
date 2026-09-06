# QuiTTER — Player Manual

**Quick Terrestrial Tactical Encounter Rules**
*A tactical mass-combat wargame for D&D 5e groups.*

This is the complete how-to-play + rules-reference manual. Everything a
player, super-player, or GM needs to run a QuiTTER battle is here, with worked
examples throughout. Rules that only the GM can use are marked
**GM only**. Where a rule is *soft* (the app asks instead of blocking), the
manual says so and tells you what confirming means.

> **About the numbers.** Rules were verified against the running game code.
> Where the game reads a value from a table the GM can edit (formations,
> scenario settings, admin settings), this manual gives the shipped default and
> points you to the on-screen tooltip — the tooltip is always live and final.

---

## Screenshot manifest

When this manual becomes the Word/PDF edition, the placeholders below are
replaced with real images. Drop files into `docs/players/screenshots/` and
paste the same filename where the placeholder sits. All shots: dark app theme,
a fixed, readable zoom; stage one concept per frame (GM sandbox map is fine).

| ID | Chapter | What the shot must show | Staging note |
|---|---|---|---|
| S-01 | 1 · Sign in | Signed-out Lobby header with the **Sign in with Google** button | empty scenario grid is fine |
| S-02 | 1 · Lobby | Signed-in Lobby, cards with **DM Online / Room Open / Password** badges, My Scenarios filter on | hover one card |
| S-03 | 1 · Create | **New Scenario** modal (name + optional password) | modal centered |
| S-04 | 1 · Join | Password-protected Join prompt | after clicking Join on a locked room |
| S-05 | 1 · Profile | Display-name chip + **Change Display Name** modal | header top-right |
| S-06 | 2 · Field | Player view: hex board, top bar (Turn · End Turn · Exit), panel docked on **Messages** | early battle |
| S-07 | 2 · GM panels | Panel docked showing the **Map** tab (map list + background controls) | GM session |
| S-08 | 2 · Tokens | Board with several tokens: different team colors/shapes, morale hearts, an action badge, a routed white-flag unit, one hero | sandbox scene |
| S-09 | 10 · Fog | Fog of war ON, player view: opaque veil + dim sight-edge rings around a unit | fog toggled in Settings |
| S-10 | 10 · Fog GM | The same frame from the **DM** view (translucent overlay) | same map, second session |
| S-11 | 3 · Tooltip | Hover tooltip over a troop unit: full stat card + morale factors section | unit mid-battle |
| S-12 | 3 · Hero | Hero token (portrait + HP bar) and the host+hero two-column tooltip | hero attached front |
| S-13 | 3 · Library | **Unit Library** (read-only browse) with a template highlighted | any template |
| S-14 | 5 · Move | Drag overlay on a unit: **white** reachable hexes, **grey** needs-a-turn, **red** threat hexes | drag held over board |
| S-15 | 5 · Charge | **Charge wedge** overlay (amber = short, white = full 2+ hex) | unit with Charge! active |
| S-16 | 5 · Rotate | Right-click context menu: Rotate 60/180°, formations (current marked), Charge!, weapons | on a Close Order unit |
| S-17 | 8 · Heroes | **Attach** modal: Leader mode (front) / Protected mode (rear) / Cast spell | hero next to a friendly unit |
| S-18 | 4 · Soft rules | A soft-enforcement confirm (e.g. "Move over budget?") **with** the red error line visible in Messages | confirm open |
| S-19 | 6 · Ranged | Ranged drag over an enemy: **range / max-range rings** + valid target tint | bow unit dragging |
| S-20 | 6 · Combat | Combat result in the message log (hits/damage/troops, verbose rolls if on) | one exchange just resolved |
| S-21 | 6 · Magic | **Magic cast** modal: placed circle shape, save stat + DC, "troops affected" | caster aiming |
| S-22 | 7 · Rout | **Retreat card** listing legal hexes (and a rout-through option) with hex highlight | unit just routed |
| S-23 | 9 · Effects | **Effects…** modal with catalog + active-effect list; a token with effect pips | one unit blessed/burning |
| S-24 | 11 · Replay | In-session replay: amber REPLAY frame, timeline, ▲ Turn-1 marker, speed control | GM replay mode |
| S-25 | 12 · GM | **Alliances** tab: team pills in Friendly / Enemy / Neutral boxes | GM panel |
| S-26 | 12 · GM | **Players** tab: roster with role select + team chips | GM panel |
| S-27 | 12 · GM | **Scenario Settings** modal (fog + sight radius, reactions, charge, verbose) | modal open |
| S-28 | 12 · GM | Double-click **DM stat editor** with derived readouts and pinned Save footer | on a unit |
| S-29 | 12 · GM | **Movement** tab: 0–9 terrain pen armed, painted hexes shaded | GM panel |
| S-30 | 3 · Library | Unit Editor three panels + sticky Save bar (name, stats, weapons, token preview) | editing a template |
| S-31 | 3 · Library | **Weapon editor** modal (left form, right weapon-library search) | modal open |
| S-32 | 3 · Library | **Token Preview** test sliders: casualty %, morale modifier, formation radios | right panel |
| S-33 | 12 · AI assist | **AI tab**: teams in the AI control box, a ✓-checked unit, a plotted route + crossed swords | Scenario Settings → AI assist on |

---

## Contents

1. [Getting Started](#1-getting-started)
2. [The Battlefield](#2-the-battlefield)
3. [Units, Stats and the Unit Library](#3-units-stats-and-the-unit-library)
4. [Turns and Actions](#4-turns-and-actions)
5. [Movement and Position](#5-movement-and-position)
6. [Combat](#6-combat)
7. [Morale, Routing and Pursuit](#7-morale-routing-and-pursuit)
8. [Heroes](#8-heroes)
9. [Effects (Buffs, Debuffs, Ground Zones)](#9-effects-buffs-debuffs-ground-zones)
10. [Visibility and Fog of War](#10-visibility-and-fog-of-war)
11. [Undo, Redo and Replay](#11-undo-redo-and-replay)
12. [Running the Game (GM)](#12-running-the-game-gm)
- [Appendix A. Glossary](#appendix-a-glossary)
- [Appendix B. Combat and Economy Reference](#appendix-b-combat-and-economy-reference)
- [Appendix C. Formation Reference](#appendix-c-formation-reference)
- [Appendix D. Token Legend and Controls](#appendix-d-token-legend-and-controls)

---

## 1. Getting Started

### What is QuiTTER?

QuiTTER plays out the *mass battles* that sit between D&D 5e adventures. Each
player commands **units** — blocks of soldiers, monsters, cavalry — on a hex
map. Heroes fight alongside the ranks. Battles are won by breaking the
enemy's **will** (routing them) at least as much as by killing them, so
positioning, formation, morale, and momentum matter as much as raw damage.

One person is the **Game Master (GM)** — usually the person who created the
scenario. Everyone else joins it. GMs and players use the same map; the GM has
extra tools to run the game.

### Signing in

![S-01 Signed-out Lobby](screenshots/s-01-sign-in.png)

Open the site; the header shows **Sign in with Google**. After you sign in you
see the Lobby with your name chip (top-right). Click the chip to change your
**display name** — that name is shown to everyone as your player label.

![S-05 display-name chip](screenshots/s-05-display-name.png)

New accounts start **pending approval** until an admin approves them (Player,
DM, or Admin). Pending users can browse scenarios and watch replays but cannot
join or create yet — the Lobby banner explains how to send an access request.

### The Lobby

![S-02 Lobby with filters](screenshots/s-02-lobby.png)

- **Scenario cards** show a thumbnail, name, creator, and badges:
  **DM Online / Offline** (live presence), **Room Open / Closed** (whether the
  GM still accepts joins), and **Password** (locked room).
- The **filters** switch between **My Scenarios** (rooms you participate in)
  and **Available scenarios** (open rooms you may join); use the search box to
  filter by name or creator.
- Left column buttons: **Unit Library** (browse/edit templates),
  **Archfar's Shipyard** (ship builder — admin only for now),
  **Map Library**, **New Scenario**, **Join Scenario**, **Replay Scenario**;
  admins also see **Admin Panel** and **Settings**.

![S-03 Create Scenario modal](screenshots/s-03-create-scenario.png)

> **GM only — Creating a room:** click **New Scenario**, give it a name, and
> optionally set a password. You become the GM of that room. Creating needs a
> DM or admin account.

![S-04 Join password](screenshots/s-04-join-password.png)

**Joining:** click a card to select it, then **Join Scenario**. If the room is
password-protected you are prompted. The GM must be online for you to join an
open room. Once you're in, the map opens automatically. **Replay Scenario**
opens the battle in read-only playback instead (see §11).

### Roles on a scenario

Inside a scenario each participant has a role the GM assigns:

| Role | What you can do |
|---|---|
| **Player** | Command your own team's units during your alliance's turn. |
| **Super Player** | Player, plus edit your own team's unit stats. |
| **Assist GM** | Move/attack/edit any unit; full battlefield access. |
| **GM** | Everything above plus placing units, maps, terrain, teams, roles, fog, routs, and settings. |

The top bar shows `Scenario Map - Role · Team`. Unassigned players watch
(read-only) until the GM assigns a team.

### Quick start

1. The GM creates a room and (optionally) a Map Library board (or paints
   terrain in the scenario), assigns teams to **alliances** (§12), and drags
   units from the **Unit Selector** onto the board during **free play**.
2. Everyone joins. In free play, placement and repositioning cost nothing —
   the GM presses **End Turn** when the board is set: Turn 1 begins.
3. Play proceeds **friendly → enemy → neutral**. When it is your alliance's
   turn, the **End Turn (…)** button becomes enabled for your side. Move and
   attack your units, then the alliance ends the turn.

---

## 2. The Battlefield

### The board

The map is a hex grid. Each **hex** is a position one unit may occupy.
The hex grid is **axial** — coordinates read like `(q, r)` and appear in the
bottom-right HUD when you hover.

### Camera & mouse

| Input | Action |
|---|---|
| **Left-click** | Select / interact with a hex |
| **Left-click + drag** a unit | Move it (empty hex) or attack (enemy hex) |
| **Middle-click + drag** | Pan |
| **Scroll wheel** | Zoom, centered on the cursor |
| **Right-click** a unit | Context menu (rotate, formation, charge, weapons…) |
| **Double-click** a unit | Open the stat editor (GM / Super Player per role) |
| **Ctrl+Z / Ctrl+Y** | Undo / Redo |

![S-06 Player view](screenshots/s-06-player-view.png)

### The top bar

`Scenario Map - role · team` | **Undo (N)** / **Redo** | **Turn {n}** |
**End Turn (group)** | **Free Move** *(GM)* | **⚙ Settings** *(GM)* |
**Replay scenario** *(GM)* | **Exit to Lobby**.

The **End Turn** button is colored by the active group (blue = friendly,
red = enemy, grey = neutral). It is enabled for the GM always and for a player
when their own alliance holds the turn.

### The side panel

The panel is **tabbed and dockable**. Tabs (GM sees more): **Map · Movement ·
Effects · Players · Alliances · Unit Selector · Messages · Undo debug**; every
player sees **Messages** and **Undo debug**. Click a tab to open/close that
panel; open several to stack them. Drag the panel edges to resize; click the
**hollow triangle** in the tab bar to dock the panel to the other screen edge.

![S-07 GM Map tab](screenshots/s-07-map-tab.png)

### Reading a unit token

![S-08 Token legend scene](screenshots/s-08-tokens.png)

Every token (see Appendix D for the full legend) shows:
- the unit's **team color + shape** (circle/triangle/star/square/diamond/
  cross) as its background;
- an **alliance ring** around the border (blue = friendly, orange = enemy,
  grey = neutral);
- the **troops** as dots (hollow = dead); cavalry units show triangles;
- **morale hearts** in the lower band — red hearts filled to your base morale,
  gold hearts above it, hollow hearts for what's missing;
- an **action badge** (small square with a number: white ≥2 actions, gold 1,
  red 0);
- the **unit name** along the bottom;
- a **white flag** = the unit is **Routed** (broken, fleeing — §7);
- a **hero** token instead shows a portrait + HP bar, no dots/hearts.

**Hover any unit** for its full stat card (see §3 for what each number means).

### The Messages log

Every rule event (moves, combat, routs, undos, over-budget warnings) appears
in **Messages**. Normal rows are white; **red rows are warnings** — usually
you did something *soft-forbidden* (see §4) and the game let you anyway.
Right-click a row to copy it.

---

## 3. Units, Stats and the Unit Library

Units on the map are **instances** created from **templates** in the Unit
Library. The GM builds templates once; players read the resulting tokens.

### The Unit Library (GM authoring)

> **GM only (players browse read-only).** Open **Unit Library**. Create,
> clone, or edit templates; the panel is: left = template list, center = the
> form, right = a live token preview with test sliders (casualties, morale,
> formation, charge) so you can see exactly how the token will read.

![S-30 Unit Editor](screenshots/s-30-unit-editor.png)

A template defines the stats below; when you **Save** you store a blueprint,
and every unit you later drop from the **Unit Selector** is a copy of it.

### Stat glossary

| Stat | What it means | Example / note |
|---|---|---|
| **Race / Level** | What the unit is and its HD/level. | Level drives threat (§7). |
| **Troops / Troop HP / Unit HP** | Number of soldiers, HP each, and total (`troops × troop HP`). | Damage kills troops one at a time (§6). |
| **Base AC** | Armor class before formation. | See the tooltip for the full breakdown. |
| **Movement (MP)** | Max movement points (hexes) per full move pool. | Formations change the *effective* max (§5). |
| **Darkvision** | How far the unit can see in fog, in hexes. | §10. |
| **Weapons** | One or more; the **active** weapon (✓) is used. | See weapon string below. |
| **AGR (Aggressiveness)** | 1–10. Roll d10 ≤ AGR to launch a melee attack. | Threat can penalize it (§6). |
| **Base Morale** | Morale capacity. When effective morale ≤ 0 you **rout**. | §7. |
| **Fearless** | Never routs (undead, elites, heroes). | Shown as `fearless` in the tooltip. |
| **Saves (Str/Dex/Con/Int/Wis/Cha)** | Ability save bonuses for area spells. | §6 · Magic. |
| **Size** | Small/Medium/Large/Huge/Gargantuan; sets row capacity + max troops. | Gargantuan forces Hero. |
| **Mount** | Cavalry mount (must be ≥1 size larger than the rider). | Adds a charge ability + changes MP. |
| **Can Charge** | Whether the unit may use Charge! (§6). | From race/mount, or manual override. |
| **Formation availability** | Which formations it may adopt in play. | Appendix C. |
| **Hero** | A named character token, not a block of troops. | §8. |
| **Equip / Weekly cost** | Gold for the template (campaign bookkeeping). | Not used in battle. |

### Weapons

A unit lists its weapons (the **active** one is used in combat and shown with
a checkmark). The display reads like
`Longsword 1x +5 1d8 1hex` = 1 attack/round, +5 to hit, 1d8 damage,
adjacent only. Extra tags: `2H` = two-handed (drops your shield while active,
no Shield Wall), `F` = free action, `NR` = no retaliation, `(h)` = heals
instead of hurting. Weapons with a **range** > 1 can shoot (§6).

![S-31 Weapon editor](screenshots/s-31-weapon-editor.png)

### The on-map tooltip

Hover any token for the live stat card:
- **Race/Level**, weapons with attack breakdown, **Attacks/rnd**;
- **AGR**, **MOR** = `base + modifiers`, with a **morale factors** breakdown
  (wounds / isolation / threats / formation) when you hover a troop unit;
- **Threat**: the unit's threat rating and the formula behind it (§7);
- **Move**: `available / effective max` (and the formation multiplier if ≠ 1);
- **Actions** `n/2` (units) or `n/5` (heroes) — red at 0;
- **Attacks** `n/5` (units) — the per-turn attack budget;
- **AC** with the formation term and any shield/2H penalty;
- **Active effects** as colored chips with turns remaining (§9);
- Shielded, Formation, Can Charge; save bonuses; hero status.

![S-11 Unit tooltip](screenshots/s-11-tooltip.png)

> **Live numbers win.** The tooltip is computed from the current battle state —
> if this manual and a tooltip disagree, the tooltip is right.

---

## 4. Turns and Actions

### Turn order

Each **game turn** is one pass through the active alliances in order:
**friendly → enemy → neutral**. Alliances with no team assigned are skipped.
A new scenario starts in **free play** (Turn 0): nobody has "a turn" yet —
the GM is setting up. The first **End Turn** starts **Turn 1**.

During your alliance's turn, every unit on your alliance's teams may act. The
**Turn {n}** counter in the top bar shows the global count; it increases once
per full cycle.

### Actions & movement points

Each unit has two pools that together pay for everything:

- **Actions** — the currency of *significant* deeds (attacking, and for units,
  "buying" a move pool).
- **Movement points (MP)** — the currency of movement, in hexes.

| | Unit (troop block) | Hero |
|---|---|---|
| **At your turn start** | **0 MP / 2 actions** | **Full MP / 5 actions** |
| A move "buys" | 1 action = **1 full MP pool** (maxMP hexes) | each action = **maxMP ÷ 5 MP** (fraction carries) |
| One full move | up to `effective max MP` hexes | up to full MP hexes (≈ your max MP + extras) |
| Per-turn attack budget | **5** attacks + retaliations (soft) | bounded by 5 actions |

> **Units, the key rule:** units start a turn with **no MP in hand** — MP is
> materialized when you move: one action converts to one **full MP pool** of
> `effective max` hexes. Leftover MP is kept and spent first; a second action
> only converts a new pool after the current MP is exhausted. So a unit with 2
> actions and max 3 can cover up to **6 MP of movement** across multiple
> drags, but only *sees* one pool's worth (3) as its current drag highlight.

**Example — unit economy (max MP 3, 2 actions, 0 MP):**

```
You start a move. Overlay shows one full pool = 3 hexes.

1st move of 4 MP  → action 1 converts a 3-MP pool; the extra 1 MP opens a
                    2nd pool (action 2) → MP 2 left, actions 0 left
2nd move of 2 MP  → spends the leftover MP  → MP 0, actions 0
                     (your whole 6-MP budget is spent; End Turn resets)
```

**Example — hero economy (max MP 3, 5 actions):**

```
A hero starts with 3 MP AND 5 actions. Each extra action = 0.6 MP (3 ÷ 5),
and fractions carry: converting one action gives 0.6 MP (shows 0), a second
gives 1.2 (shows 1)… so the hero can keep moving well past its first 3 MP.
```

### What costs what

| Action | Action cost | MP cost |
|---|---|---|
| Move (drag) | units: 1 per pool converted · heroes: as above | path cost in MP |
| Attack | **−1** (even if the AGR roll fails) | 0 |
| Free-action weapon (e.g. a quick spell/missile with `F`) | 0 | 0 |
| Reaction shot (§6) | −1 | 0 |
| Rotate 60° | 0 | **−1** MP (units only; heroes & loose free) |
| About-turn 180° | 0 | 1 MP foot / 2 MP mounted + **drop 1 org level** |
| Change formation | 0 | **half your current pool**, rescaled (§5) |
| Attach / detach / swap hero | converts as needed | **−1 hero MP** (§8) |
| Cast a spell | −1 (unless `F`) | 0 |
| Place / team / hide (GM) | 0 | 0 |

**The 5-attack budget (units):** every attack, charge attack, free attack,
reaction shot, and retaliation counts toward **5 per turn** (`Attacks: n/5` in
the tooltip, red at the cap). It refreshes at your turn start.

### Soft rules — the game asks, it doesn't block

QuiTTER never hard-stops you; it **asks first**. Typical prompts:

- "This move is over budget — do it anyway?" (drags past your MP/actions)
- "No actions left — attack anyway?"
- "Attack past the 5-cap?"
- "Let the retaliator exceed its cap?"

If you **confirm**, the game executes at the true cost (points can go
**negative**), records it, and posts a **red message** in the log — your
alliance will notice. If you cancel, nothing happens. Undo (Ctrl+Z) always
unwinds your last action even if it went negative — End Turn resets everyone.

![S-18 Soft-enforcement confirm](screenshots/s-18-soft-confirm.png)

### Ending your alliance's turn

When your side has done all it wants, press **End Turn (your alliance)**. The
turn passes to the next active alliance; its units reset (heroes: full MP +
5 actions; units: 0 MP + 2 actions + fresh 5-attack budget), and any charges
still running on the *ending* side are forfeited (the charger drops one
formation level).

---

## 5. Movement and Position

### Facing

Units face a **vertex** (corner), not a flat side. Their arcs:

```
         /\
        /  \        front (Kill Zone): the 2 hexes before the facing vertex
       /    \
      [      ]      flanks: the 2 side hexes
      [      ]
       \    /       rear: the 2 hexes behind the opposite vertex
        \  /
```

- **Front (kill zone)**: the two hexes touching the faced vertex.
- **Rear**: the two hexes at the opposite vertex.
- **Flanks**: the two in between.

**Heroes, Scattered, and Routed units have no facing** — they can move in any
direction, and attacks against them are treated as front/side/rear per their
formation (Appendix C).

### What a drag means

Drag a unit with the mouse. The game shades where it can move:

- **White hexes** are reachable **right now** without turning — drop there.
- **Grey hexes** need a turn first: the hint says "rotate, then move."
- **Red hexes** are enemy **threat hexes** (kill-zone / zone-of-control):
  reachable as a *destination*, never through.
- Occupied hexes can't be entered.

![S-14 Drag overlay](screenshots/s-14-drag-overlay.png)

Movement costs **1 MP per hex entered** from your front arc (more for
difficult terrain — below). Turning is paid separately: 60° = 1 MP (units),
about-turn = 1 MP foot / 2 MP mounted **and** −1 organization level. **Loose
units** (Routed, Scattered, Heroes) ignore facing entirely: 1 MP/hex in any
direction, always droppable. Rotating/charging a hero is free.

![S-16 Context menu rotate](screenshots/s-16-context-menu.png)

> Right-click a unit for **Rotate Left/Right**, **Rotate 180°**, formations,
> Charge!, and weapon select. Heroes hide rotate/formation (they have neither).

### Formation movement multipliers

Your effective move pool is `movement × formation multiplier`:

| Formation | Movement | Row capacity |
|---|---|---|
| Shield Wall / Phalanx | ×0.5 | ×2 |
| Close Order / Open Order | ×1.0 | ×1 |
| Scattered / Routed | ×1.5 | ×1 |

So a unit with **MP 4 in Phalanx** has an effective pool of **2**; in
**Scattered** it's **6**.

### Terrain

Hexes can carry a painted **entry cost** (0–9):

- **0** = free (still counts as one step)
- **1** = clear (default)
- **2+** = difficult: entering costs that many MP

A 0-cost chain can't roam forever — each hex still costs one *step* and your
pool caps both total MP and total hexes. The GM paints costs in the
**Movement** tab (see §12) or assigns a reusable map.

### Changing formation

Right-click → pick a formation you know. A change costs **half of your current
effective pool** (rounded up, minimum 1 MP), then your leftover MP is rescaled
to the new formation's max. It never costs more than one action.

**Example (unit, MP 4 base, Scattered → Open Order):**

```
Scattered effective max = 6  →  change costs ceil(6 × 0.5) = 3 MP
Open Order effective max = 4  →  leftover MP is rescaled (floor, ×4/6)
```

**Formation change rules:** you can drop any amount, rise at most **one
organization level per change** (org levels in Appendix C), Phalanx and Shield
Wall can't charge, Shield Wall is unavailable while you wield a two-handed
weapon, and a Routed unit may **rally** by changing to a formed formation when
its morale is above 0 (its Routed state clears).

### Charge!

Cavalry (or any unit that **Can Charge**) can **Charge!** from the context
menu. It locks rotation and formation and shows a **front wedge**: amber hexes
= short charge, white = a full charge (2+ hexes — but the wedge fans to your
whole pool).

![S-15 Charge wedge](screenshots/s-15-charge-wedge.png)

- Move only within the wedge; each step adds to your charge distance.
- **Charge a full distance** (≥2 hexes) onto an enemy → a **free, double-damage
  attack** — then your formation drops **one organization level** (momentum
  spent).
- Charge **less than 2 hexes** → you're prompted (you attack normally but
  still lose the bonus and drop the level).
- After a full charge that plows through the target, you may be offered
  **charge-over**: ride over them and land on the far side (costs 2 MP) if the
  hex behind is empty.
- If your turn ends while still charging, the charge is forfeited and you
  still drop one level.

> The GM can turn Charge! for mounted units on/off in Scenario Settings.

---

## 6. Combat

### The attack

To attack an enemy, **drag your unit onto it** (a ranged unit can also click
over an enemy to see its range rings). The game shows range before you commit:

- within **range**: full effect;
- between **range** and **max range**: you attack at **disadvantage**
  (roll two D20, take the lower);
- beyond **max range**: blocked.

![S-19 Range rings](screenshots/s-19-ranged-drag.png)

Attacking costs **1 action** — and it is spent even if your AGR roll fails.
Charging onto an enemy with a full charge is a *free* attack. Weapons marked
`F` (free action) don't cost an action at all.

### Step 1 — Will to attack (AGR)

Roll **d10**. You attack if `roll ≤ AGR`. A unit facing a scarier enemy takes
a **threat penalty** equal to `round(their threat ÷ your threat) − 1`
(minimum 0) — see §7 for threat. No AGR roll is needed for: heroes, ranged
attacks, **rear attacks**, Routed targets, attacks that can't be retaliated
against, or attacks led by a front-attached hero.

If AGR fails, the unit **hesitates** — no attacks, no damage, and the action
is spent.

### Step 2 — Who strikes first (reach & position)

Compare weapons for **reach** (pike, lance…). Equal reach (or neither) = the
attacker first; one-sided reach = the reach side first. **Equal reach means
simultaneous** — both sides trade blows even if one is killed/routed by the
first strike. One-sided reach is **ordered**: if the first strike kills or
routs the non-reach side, it never gets to counter. Rear attacks and ranged
attacks always let the attacker strike with no counter.

### Step 3 — Attacks, hits, damage

Each attack: roll **D20** vs the target's AC:

```
hit  = roll + weapon attack bonus + formation attack bonus ≥ target AC
natural 1  = automatic miss
natural 20 = automatic hit + CRITICAL (damage dice doubled)
```

The number of attacks a unit makes comes from its engaged ranks:
`troops engaged × weapon attacks/round`, roughly `min(troops, rows × capacity
multiplier)`. Heroes always make their weapon's attacks directly. A defender
that survives retaliates with its engaged **front rows** (Appendix B).

Damage per hit is capped at one troop's HP (a single swing kills at most one
soldier). Damage pools into the unit; troop count drops as `HP ÷ troop HP`.

**Example — a full melee exchange (attacker has reach, 10 troops, spear +3
1d8; defender 10 troops, shortsword +2 1d6, AC 13; both base morale 6):**

```
1. AGR: d10 = 4 ≤ 7 ✓
2. First strike: attacker (reach) → 10 attacks, +3 vs AC 13 (need roll ≥ 10)
   rolls   → 11  5 18  1 16 20  9 14  7 12
   hits    → 11, 18, 16, 14, 12, and 20 = CRITICAL (dice doubled)
   damage  → 3 + 5 + 2 + 4 + 1 = 15 from hits, plus crit d8 = 4 ×2 = 8
             total 23 → defender 100 HP → 77 → 8 troops (2 lost)
3. Defender morale (see §7): 6 − 2 (wounds) − 1 (isolated) − 1 (enemy in
   its kill zone) = 2 → holds.
4. Retaliation (ordered — the defender survived): 10 attacks, +2 vs AC 14
   (need roll ≥ 12):  13  6 19  2 11 15  3  8 17 10
   hits → 13, 19, 15, 17 → 5 + 3 + 4 + 2 = 14
   attacker 100 HP → 86 → 9 troops left
```

Every roll lands in the **message log**; if the GM enables **verbose combat**
in Settings, the log also prints every d20 and damage face so you can verify
the math.

![S-20 Combat log](screenshots/s-20-combat-log.png)

### Step 4 — Retaliation

A defender who survives and isn't in the attacker's safe arc **strikes back**
automatically — no AGR roll (it's reflexive). How much:
- from the defender's **front**: full engaged rows;
- from the **flank**: its engaged rows (half-ish);
- from the **rear**: none (that's the point of rear attacks);
- ranged attacks provoke retaliation only for formations that can shoot back
  (most can't — their `NR` bows don't either); Routed units never retaliate.

### Formation effects in combat

The defender's formation changes how it can be attacked (Appendix C lists
arcs):
- **Routed** takes **2× melee attacks** and **0.5× ranged** (it's a rout!);
- **Scattered** takes **1.5× melee**, **0.5× ranged**;
- **Open Order** takes **0.5× ranged**;
- attacking a **Scattered** defender always counts as a flank, a **Routed**
  one as rear, and a **Hero** has no rear at all.

**Heroes under attack:** only **50%** of a unit's troops can reach a lone (or
front-attached) hero in melee — heroes aren't surrounded by 80 swords. Ranged
fire at heroes is uncapped.

### Magic & area spells

Spells are weapons with a **magic dimension** (feet) and a **shape**
(circle = radius, cube = side, cone = a 60° wedge). Drag the spell onto the
board: you get a **cast window** showing the area, its rotation (mouse wheel
for cube/cone), and a live **troops affected** count.

![S-21 Magic cast](screenshots/s-21-magic-cast.png)

Resolution:
1. Roll the spell's damage dice **once** (base damage).
2. Every affected troop rolls **D20 + its save bonus** vs the spell's
   **Save DC** (the caster sets the DC and which of the six saves resists).
3. On a successful save the troop takes **half** (floored) or **nothing** —
   the weapon decides "half or negate".
4. Damage per troop is capped at its HP; casualties and morale are applied.

**Healing** (`(h)` weapons) recovers HP instead: single target heals up to max
unit HP; an area heal restores each affected troop up to its HP — no save.
Magic costs an action unless marked free. A Routed unit cannot cast.

### Reactions (opportunity fire)

With the GM's **Reactive archery** setting on, when an enemy **moves** within
an eligible archer's range, that archer's owner sees a blinking **bow** marker.
Click it to enter reaction mode (you control only that archer):

- fire a **reaction shot** at the mover (costs 1 action, counts to the attack
  cap, can rout), or
- **reposition** the archer to a hex within **half its move** (costs 1 action).

An archer reacts **once per turn**; the reaction refreshes when its own turn
begins. Your reaction is not limited to your own alliance's turn — that's the
point of opportunity fire.

---

## 7. Morale, Routing and Pursuit

> **The heart of QuiTTER:** a unit doesn't need to be killed to be beaten.
> Drive its **effective morale** to 0 and it **routs** — then the routing and
> pursuit rules take over.

### Threat rating

Every unit projects **threat** — a measure of how scary it is:

```
threat = level component + size component + troop component
  level  band  19+ → 6, 13+ → 5, 8+ → 4, 5+ → 3, 3+ → 2, 2+ → 1, 1 → 0
  size   (size ÷ 100)²            (Medium = 1, Large = 4, Huge = 9 …)
  troops 50+ → 4, 20+ → 3, 10+ → 2, 5+ → 1, fewer → 0
```

**Examples:** L3 Medium soldiers at 20 troops → 2 + 1 + 3 = **6**. L5
Medium at 50 → 3 + 1 + 4 = **8**. A lone L10 hero → 4 + 1 + 0 = **5**.

### What pressures your morale

Only enemies **facing you in their kill zone** (their front two hexes)
pressure you — adjacency alone is nothing, and Scattered/Routed enemies and
routing units exert none. Your morale penalty is
`their summed threat ÷ your own threat` (rounded).

**Effective morale** on a given moment:

```
effective = base morale + current modifier
          − wounds − isolation − kill-zone threats + formation bonus
  wounds:    −floor((1 − HP/max) × 10)          (factor 10)
  isolation: −1 when no friendly is adjacent
  threats:   normalized kill-zone threat sum (above)
  formation: from your formation (data-driven)
```

**Example — the "shaky" unit:**

```
Base morale 6. HP 77/100 (wounds −2). Not isolated. One enemy (threat 6)
is in its own kill zone; your threat is 6 → −1. Open Order (+0).
  effective = 6 + 0 − 2 − 0 − 1 + 0 = 3 → holds.
Had the same unit been at HP 60 (wounds −4) with 2 enemies facing it:
  effective = 6 − 4 − 2 − 0 = 0 → ROUT.
```

The tooltip shows the whole breakdown (and the formula behind the Threat row),
so you can always see *why* a unit is about to break.

### Routing

A unit routs when its effective morale hits **0 or less** — and **only after
an attack** (a spell or a blade). Just standing in scary positions never routs
you by itself; it primes you to break when the next blow lands. Fearless units
never rout.

When a unit routs: it flips to **Routed** (white flag), and units **adjacent**
to it check morale too — a break can **cascade** through a line.

**A Routed unit:** moves any direction (loose), **cannot attack or cast**,
can't hold a formation, is easier to hit (drops its shield) and much easier to
overrun (2× melee attacks against it). It can **rally** by adopting a formed
formation when its morale recovers above 0.

### Retreat (you choose the rout path)

When your unit routs, its **retreat card** appears. Legal retreat hexes are
empty hexes **outside enemy kill zones**. You may:
- **rout 1 hex** to a legal neighbor;
- if none exists, **rout through** one adjacent friendly in **Open Order or
  Scattered** (2 hexes total) — running through an Open Order friendly
  **disrupts it to Scattered**;
- if literally nowhere is legal, the unit **stands** (still Routed — and the
  attacker gets a free "as-if-pursued" attack at it).

![S-22 Retreat card](screenshots/s-22-rout-modal.png)

> **Routed units never yield:** a rout never passes through another Routed
> friendly (two crowds don't part), and ordered ranks (Close/Phalanx/Shield
> Wall) can't be pushed through either.

### Pursuit (automatic — you can't decline)

When an enemy routs away, the best-placed adjacent hostile **pursues**:
- eligible = can reach the vacated hex in one move, is at least **1.5× the
  routed unit's speed**, and can pay the MP;
- preference: the **attacker who caused the rout** → the fastest → the one
  with the most MP → random;
- the pursuer follows in (pays 1 MP), **attacks** (fast follow = no reaction),
  and **drops one formation level** (they threw order away to chase);
- if the rout scattered a friendly Open Order unit, the pursuer hits **that
  disrupted unit** instead (the routed one is now behind cover).

Routs, retreats, disruptions, pursuit moves and pursuit attacks all land as
**one undoable group** — Ctrl+Z unwinds the entire bloody episode.

---

## 8. Heroes

A **hero** is a named character (portrait token + HP bar, no troop dots). They
fight as part of the army but with special rules.

### Hero economy

- A hero starts its turn at **full MP + 5 actions**, and every extra action
  converts to **maxMP ÷ 5 MP** (fractions carry). Effectively heroes move more,
  act more, and never pay to rotate or change formation.
- Heroes make their weapon's attacks directly (no row math), don't roll AGR
  (they're individuals, they commit), and are **Fearless** (never rout).
- When a hero is reduced to 0 HP it **goes down** (grayscale) rather than
  dying — it can be recovered. If your D&D party's hero is aboard a ship or
  engaged in personal combat, the table transitions to your VTT.

### Attaching a hero to a unit

Drag a hero onto an adjacent friendly unit (or use the context menu → Attach)
and choose:

- **Leader mode (front)** — the hero stands at the unit's front vertex. A
  front hero:
  - **shares damage**: 30% of every incoming volley is directed at the hero;
  - **steadies the troops**: the host's attacks **ignore AGR**;
  - still makes the host's charge/retaliation share, etc.
- **Protected mode (rear)** — the hero hides behind the ranks and **cannot be
  hit at all** until the host falls.

![S-17 Attach modal](screenshots/s-17-attach-hero.png)

Attaching, detaching, or swapping front/back costs **1 hero MP** (the game
converts hero actions to cover it when MP is short — it asks first if you want
to convert `#` actions for 1 MP). Detaching via drag-away costs nothing extra
(the move already paid).

### Hero + host movement

Dragging a host with an attached hero moves both — the hero **drains its own
MP** for the same path, and its reach is capped by whichever pool is smaller.
The hero token rides the host's front/back vertex. You can drag the hero away
from the host to detach it, or use the context menu (on either token) to move
the hero to the front/back.

### Heroes in melee

Only **half** of an enemy unit's troops can reach a hero in melee (ranged fire
is uncapped). A hero's all-sides-are-front means enemies gain no rear-attack
bonus against it, but it also means a hero charging in is always "in front."
---

## 9. Effects (Buffs, Debuffs, Ground Zones)

Right-click a unit → **Effects…** to open the effect modal. Effects are
temporary, undoable, and synced to everyone.

### The catalog

| Effect | Kind | Default | What it does |
|---|---|---|---|
| **Bless** | AC | +2 · 3 | +2 AC |
| **Bane** | AC | −2 · 3 | −2 AC |
| **Haste** | Movement | +2 · 3 | +2 to your movement (hexes) |
| **Slow** | Movement | −2 · 3 | −2 movement |
| **Rally** | Morale | +3 · 3 | +3 morale |
| **Fear** | Morale | −3 · 3 | −3 morale |
| **Burning** | Damage | 4 · 3 | 4 damage every tick |
| **Regen** | Damage | −4 · 3 | heal 4 every tick |

You pick the magnitude and duration; the GM can also paint a **ground zone**
(an effect tied to a hex) instead of a unit.

### How durations work (read this twice)

Effect duration counts **activations of the caster**, not the victim. An
effect ticks when play moves into the **caster's alliance's** turn — so
"3 turns" means "3 of the caster's own turns," which may span several enemy
turns. Damage-over-time lands at the start of the caster's activation; when the
countdown hits 0 the effect ends and stat effects **restore** their snapshot.
If the caster is destroyed, the effect ends immediately.

> **Ground zone tip:** stand in a Burning zone and you take the tick damage;
> stat zones (Bless/Bane/etc. painted on a hex) apply only while you stand
> there — you "pick up" the effect when your own activation starts inside it.

### Reading effects on the battlefield

- Active effects show as **colored chips** in the unit tooltip with turns
  remaining.
- Tokens get small **effect pips** under them.
- A unit can carry only **one effect per kind** — a second Bless won't stack.

![S-23 Effects modal](screenshots/s-23-effects.png)

Every apply/remove/expiry goes through the command log — Ctrl+Z undoes an
effect application.

---

## 10. Visibility and Fog of War

The GM can switch on **Fog of war** (Scenario Settings) plus a **sight
radius** (default 2 hexes). With fog on, each alliance sees only what its
units can see; the rest of the board is veiled.

![S-09 Fog player view](screenshots/s-09-fog-player.png)

### How sight works

- Every unit reveals hexes within `max(scenario sight, darkvision)` hexes —
  a unit with **darkvision 5** sees 5 hexes even in a sight-2 scenario.
- Sight is **shared across your alliance**: if any of your units can see a
  hex, your side sees it (each unit's own hex is always visible).
- **Hidden units reveal nothing** — a concealed ambusher doesn't light up your
  map even if it's technically on your team.
- The **edge of sight is soft**: the outermost ring is dimmed (60%), the next
  (40%), the next (20%) — a "torchlight" falloff, not a hard line. Where two
  of your units overlap sight, the clearest view wins.

### What fog changes

- You can **hover and target only what you can see**. Attacking into an
  unseen hex is blocked with an error (your own side can't shoot what it can't
  see — applies to the DM's units too).
- The GM sees the board **translucently** through the veil (they adjudicate,
  and can paint reveals with the brush/click tools).

![S-10 Fog GM view](screenshots/s-10-fog-gm.png)

### Replays & fog

Replays show fog from the **acting alliance's** perspective at each step, so
you watch the battle the way each side saw it. Darkvision-based sight is
factored in throughout.

---

## 11. Undo, Redo and Replay

### Undo & Redo

- **Ctrl+Z** (or the **Undo** button) rewinds the last action — your own, or
  the GM's, or the most recent action by anyone on the shared timeline.
- **Ctrl+Y** (or **Redo**) replays it.
- The button shows a count when the undo covers a **chain** (e.g. a move that
  routed two units: one undo undoes the move *and* both routs).
- Undo is a **rewind to stored state** — it always restores MP/actions/HP to
  exactly what they were. Rules are enforced: you can only undo the most
  recent action, and a player can't undo through someone else's move (the GM
  can undo anything). If your undo is rejected ("another player has moved"),
  the log refreshes and shows you the new top.
- Undo works even for **soft-forbidden** actions that pushed points negative.

> Everyone on the map shares one command timeline. When the GM undoes a
> mistake, everyone sees it rewind. This is a *trust* feature — the **Undo
> debug** panel (bottom tab) lists every command with its actor and status so
> the table can audit.

### Replay

Anyone with the permission can **Replay Scenario** from the Lobby; the GM can
also flip the live session into replay mode mid-game ("Replay scenario" →
"Back to Play").

![S-24 Replay](screenshots/s-24-replay.png)

- The amber **REPLAY** frame + playback bar: play/pause, scrub the timeline,
  step one action at a time, and speed (0.5×–4×). A small amber **▲** marks
  where **Turn 1 begins**.
- Replay is read-only — controls are locked; pan/zoom/tooltips still work.
- **Co-watch**: everyone in the room can watch together; the "controller"
  drives and others follow (they keep their own speed). Late arrivals join
  the same place on the timeline.

---

## 12. Running the Game (GM)

Everything in this chapter is **GM only** (or needs the appropriate role).
Players can skim it to know what the GM can do.

### Before the battle

1. **Create the scenario** (see §1) and open it.
2. **Assign teams → alliances.** Open **Alliances** and drag each team pill
   into Friendly / Enemy / Neutral. Teams in the same box fight together;
   the turn order is friendly → enemy → neutral.

![S-25 Alliances tab](screenshots/s-25-alliances.png)

3. **Set up players.** In **Players**, keep the room open/closed, set each
   player's role (Player / Super Player / Assist GM) and team, or kick.
   A player with no team watches read-only.

![S-26 Players tab](screenshots/s-26-players.png)

4. **Choose the board.** Map tab: assign a reusable Map Library board or align
   a background image (offset/scale/grid radius) directly; then use the
   **Movement** tab to paint entry costs (0–9; right-click clears to 1).
   Optionally paint **ground effects** in the Effects tab.

![S-07 Map tab](screenshots/s-07-map-tab.png)

5. **Drop units.** Open **Unit Selector**, hover for the blueprint, and drag
   templates onto the board. Dropped units default to the black team in Open
   Order (or Scattered). Right-click a token for GM actions: assign team,
   hide/unhide, **Rout Unit** (force a rout), delete.
6. During **free play** everyone arranges freely. When ready, press **End
   Turn (Free Play)** — Turn 1 begins and free movement turns off.

### Scenario Settings

![S-27 Scenario Settings](screenshots/s-27-settings.png)

- **Reactive archery** — opportunity fire on/off.
- **Mounted charge** — Charge! for mounted units on/off.
- **Verbose combat** — print every dice roll in the log (great for teaching).
- **Fog of war** + **Sight radius** (1–9).

(Admin-only **Settings** in the Lobby edits game-wide JSON values — balance
knobs like the 5-attack cap, hero actions, threat bands. Change with care;
there is no per-value validation.)

### AI assist (GM tool)

Enable **AI assist** in Scenario Settings and an **AI** tab appears in the
left panel. Drag teams into the *AI control box*; eligible units (of the team
on the currently-active alliance) wear a small ✓. **Preview** plots their
moves (blue routes with crossed swords on attack targets), **Reset** clears
it — nothing happens until **Execute**. Execute runs the plot one action at a
time through the real rules (retaliation, routs and reactions all apply), and
you can **Pause / Step / Resume / Cancel remainder** anytime — e.g. to let a
player's reaction resolve, then re-Preview against the changed board.
Everything is undoable unit-by-unit (Ctrl+Z), and **Undo Execute** rewinds the
last batch. Units the AI can't sensibly move keep their actions for you. AI
assist never moves hidden, dead or downed units, never attacks what its side
can't see, and only acts on the marked team's own turn. Click a ✓ token to
exclude that one unit (it switches to a grey badge) — click again to include
it; exclusions reset at each End Turn.

### During play

- **Turn {n}** / **End Turn (group)** in the top bar; the GM can end any
  alliance's turn.
- **Free Move** toggle re-opens free placement any time.
- **Double-click a unit** to edit its stats live (HP, morale, formation,
  weapons, image…). Edits are undoable commands and broadcast a **red**
  message to everyone.
- **Rout Unit** on the context menu force-routs a unit (undoable).
- **Replay scenario** flips the session into the replay timeline and back.
- When you exit, the map auto-screenshots to the scenario card.

### GM tools reference

| Tool | Where | Purpose |
|---|---|---|
| Background/map | Map tab | Assign reusable maps or align an image |
| Terrain pen | Movement tab | 0–9 entry-cost per hex |
| Ground effects | Effects tab | Paint stat/DoT zones on hexes |
| Effects… | unit context menu | Buff/debuff/DoT a unit or place a zone |
| Players | Players tab | Roles, teams, room open/close, kick |
| Alliances | Alliances tab | friendly/enemy/neutral assignment |
| Unit Selector | Unit Selector tab | Place units from templates |
| DM stat editor | double-click a unit | Edit any unit stat (undoable) |
| Scenario Settings | ⚙ in top bar | Reactions, charges, verbose, fog |
| Free Move / End Turn | top bar | Start Turn 1 or reset the cycle |
| Replay | top bar / Lobby | Watch or co-watch the log |

---

## Appendix A. Glossary

| Term | Meaning |
|---|---|
| **AGR** | Aggressiveness, 1–10. Roll d10 ≤ AGR to commit a melee attack. |
| **AC** | Armor Class. D20 roll + bonuses must meet or beat it to hit. |
| **Action** | A unit's deed currency: 2 for units, 5 for heroes per turn. |
| **Alliance** | Friendly / Enemy / Neutral; teams grouped into them; turn order. |
| **Baseline/effective** | Base stat vs the live value after formation/effects. |
| **Charge** | A locked-straight run in your front wedge ending in a double-damage attack. |
| **Critical** | Natural 20: auto-hit, damage dice doubled. |
| **Darkvision** | Sight in hexes beyond the scenario radius (fog). |
| **Disadvantage** | Roll 2 D20, keep the lower (long-range fire). |
| **DoT** | Damage over time (Burning), dealt on the caster's activation. |
| **Facing** | The vertex a unit points at; defines front/flank/rear. |
| **Free play** | Turn 0: setup with no costs or turn gates. |
| **Hero** | A character token (portrait + HP). Full MP + 5 actions, fearless. |
| **Kill zone** | A unit's front two hexes — the only place it threatens. |
| **Loose** | No facing: Scattered, Routed, and heroes move any direction. |
| **MP** | Movement points (hexes). 1 MP per front-arc hex entered normally. |
| **Morale (MOR)** | Effective = base + modifiers; at ≤ 0 after an attack you rout. |
| **Org level** | 0 Routed/Scattered/Hero · 1 Open · 2 Close · 3 Phalanx/Shield Wall. |
| **Reach** | Weapon property; decides first-strike and retaliation order. |
| **Reaction** | Opportunity fire/reposition an archer takes when an enemy moves. |
| **Rout** | A broken unit (white flag): flees, can't fight, must retreat/rally. |
| **Threat** | A unit's scariness rating; presses enemy morale via kill zones. |
| **Unit** | A block of troops on the board (vs a Hero). |
| **Zone of control** | A formation's front hexes that block enemy passage. |

## Appendix B. Combat and Economy Reference

**To hit:** `D20 + attack bonus + formation bonus ≥ AC`; 1 = miss, 20 = crit.

**Attacks per volley (unit):** engaged troops, capped by
`row capacity × attack-capacity multiplier`, × weapon attacks.
Row capacity: Small/Medium **10**, Large **5**, Huge **2**, Gargantuan **1**.
Heroes: weapon attacks only.

**Damage:** dice + bonus; crit or charge doubles **dice only**; per-hit damage
capped at troop HP. HP ↓ by damage; troops = `ceil(HP ÷ troop HP)`.

**Retaliation:** engaged front rows of the surviving defender; flank = fewer,
rear = none; ranged provokes only when the formation shoots back.

**AGR check:** skip for heroes/ranged/rear/routed/no-retaliation/free-action/
front-hero-led attacks. Penalty = `max(0, round(their threat ÷ your threat) − 1)`.

**Economy:** units 0 MP / 2 actions per turn (1 action = 1 full pool).
Heroes: full MP / 5 actions (action = maxMP ÷ 5 MP). Attacks cap 5/turn (soft).
End Turn resets and clears charges.

**Soft prompts:** over-budget move/attack/formation, no-actions attack, 5-cap
attacks, at-cap retaliation, premature charge, charge-over. Confirm = execute
at true cost + red message.

## Appendix C. Formation Reference

Org levels: **0** Routed · Scattered · Hero — **1** Open Order — **2** Close
Order — **3** Phalanx · Shield Wall. Change cost = half your current pool
(min 1 MP), leftover rescaled; rise at most +1 level per change.

| Formation | Move | Row cap | Melee at | Ranged at | Charge | Blocks move | vs it: melee / ranged |
|---|---|---|---|---|---|---|---|
| **Scattered** | ×1.5 | ×1 | any arc | any arc | no | no | ×1.5 / ×0.5 |
| **Open Order** | ×1.0 | ×1 | front only | any arc | yes | front | ×1 / ×0.5 |
| **Close Order** | ×1.0 | ×1 | front only | any arc | yes | front | ×1 / ×1 |
| **Phalanx** | ×0.5 | ×2 | front only | any arc | no | front | ×1 / ×1 |
| **Shield Wall** | ×0.5 | ×2 | front only | any arc | no | front | ×1 / ×1 |
| **Routed** | ×1.5 | ×1 | — | — | no | no | ×2 / ×0.5 |
| **Hero** | ×1 | ×1 | any arc | any arc | no | no | ×1 / ×1 |

Position arcs (retaliation): a **front** attack = full engaged rows, **flank**
= fewer, **rear** = none — except Scattered (always flank) / Routed (always
rear) / Hero (always front). AC/attack/morale modifiers and exact row/attack
capacity multipliers are data-driven per formation — hover any unit in that
formation and read the tooltip for live numbers.

## Appendix D. Token Legend and Controls

**Token anatomy** (unit): team-color background at 75% + team border · alliance
ring · grey team shape · troop dots (hollow = dead; triangles = mounted) ·
formation extras (pikes/shields/white Routed flag) · morale hearts (red =
base, gold = boosted, hollow = missing) · action badge (white ≥2, gold 1,
red 0) · race + unit-type icons · name.
**Hero token:** portrait or custom image, HP bar + HP numbers, name; grayscale
when down; half-size when attached to a host.

**Team colors/shapes:** Blue circle · Yellow triangle · Violet star · Black
square · Orange diamond · Green cross.

**Controls:** left-drag move/attack · middle-drag pan · wheel zoom · right-click
menu · double-click edit (per role) · Ctrl+Z/Y undo/redo.

**Legend notes:** a red-ringed hex during a drag = enemy zone of control
(reachable, not passable); white = droppable now; grey = rotate first; amber
wedge = short charge; bow marker = reaction available.

![S-08 Token legend scene](screenshots/s-08-tokens.png)

*End of manual. Rulings not covered here fall to the GM — the code is the
final reference for edge cases (`docs/dev/`), and the tooltip is always live.*

# Campaign ship rules

*Last verified: 2026-11-22. Applies to the Spelljammer module.*

A **campaign ship** is a ship family that survives between scenario maps. Each
map holds a ship token; the family holds the versions.

## Making one

- A ship must first exist on a map. The DM right-clicks it and chooses
  **Make Campaign Ship**, then gives it a name.
- The name is the **family name** (“Jenny”); the family is not tied to one
  scenario. Every later version is “Jenny II”, “Jenny III”, … A refit asks for
  the name and uses that numbered name by default; renaming starts a fresh name
  with no numeral.
- The DM who declares it owns it. Other DMs cannot see or edit it.
- A campaign ship is un-teamed like an ordinary ship: anyone may board or pilot
  it under the normal helm and captain rules.

## Placing one

Drag the family from the Ship Selector. On drop, choose:

- the **version** you want;
- **Full** — 100% hull and crew, all damage forgotten;
- **Latest** — the damage and crew state last recorded for that version;
- whether this placement should **become a new campaign ship** in this
  scenario.

If you answer **Yes**, the placed ship counts as a new version and can be
refitted later. If you answer **No**, it is only a copy for this map: damage
taken here is not remembered by the family.

A scenario can hold only one *new* version of the same ship at a time. If the
answer “Yes” is refused, the scenario already has a version of that ship; refit
that one first.

## Dry dock

The DM opens **Dry Dock** from the ship’s right-click menu (only for a ship that
is a campaign ship, not a plain copy). The whole table sees the window and one
person edits at a time. The window can be moved and resized from either bottom
corner to fit your screen; each player’s size is their own. The game’s left panel
(including Messages) stays available while the dry dock is open, but placing new
units or ships is paused.

The left side shows what the refit changes and what it costs. Labour and
equipment are charged; **crew and cargo changes are free**. Total ship mass is
locked.

Three buttons (only the DM sees **Cancel**):

- **Save refit** — keep the same version, with the new design.
- **Save as new version** — commit a new numbered version. The old one freezes.
  This **cannot be undone**.
- **Cancel** — the same as **End dry dock**: close the shared session and unlock
  the table. Only the DM can do this; players see “The DM ends the dry dock”.

## Versions and the manager

A version never disappears when its scenario is deleted; its scenario name is
kept in the label.

The **Campaign Ship Manager** (lobby, DM only) lists your versions:

| Status | Meaning |
|---|---|
| Active | currently on a scenario map |
| Frozen | not on a map, but a newer version exists |
| Orphaned | not on a map and has no newer version |

You can rename the family, delete orphaned versions, and delete a frozen version
(its newer versions move up to the previous one).

If two versions ended up with the same numeral (a bug fixed on 2026-11-22), use
**Renumber** on the family: it numbers the versions 1, 2, 3 … in creation order
and updates their names on the map.

Use the ‹ › buttons or the version list in the dry dock to look at an older
version: the middle and right panels show its design read-only, and the left side
shows what changed and what it cost compared with the version before it. The first
version has nothing earlier to compare. Switch back with the same version list or
arrows.

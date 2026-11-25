# 22 — Content ownership (creator-locked editors)

Who may edit authored content. This chapter covers the **editors only**; a
scenario map's tokens (units, heroes, ships) keep the normal turn/team/helm
rules and are not ownership-gated.

Key files: `src/packages/infra/lib/contentOwnership.ts`,
`src/hooks/useContentOwnership.ts`,
`src/components/shared/ContentOwnership.tsx`, migration 177.

## Rule

Every authoring row records `owner_id`.

| `owner_id` | Who may read | Who may edit / delete |
|---|---|---|
| `auth.uid()` | everyone with the view capability | that user, or an admin |
| `NULL` (legacy / seeded / system) | everyone with the view capability | **admins only** |
| a user who no longer exists | everyone with the view capability | **admins only** (shown as “Owner deleted”) |

This is the database `owns_content(owner_id)` helper:
`is_admin_user() OR owner_id = auth.uid()`.

Scenario tokens are deliberately **not** covered: DMs can still move, damage,
refit, board and delete tokens on a map regardless of who placed them.

## Tables

`unit_templates`, `unit_races`, `unit_mounts`, `unit_weapons`, `unit_armors`,
`unit_types`, `ship_templates`, `ship_components`, `ship_weapons`,
`ship_armors`, `ship_cargo`, `maps`, `map_effect_templates`,
`map_structure_templates`, `halloween_siege_presets`.

Child rows (`ship_crews`, `ship_template_weapons`, `ship_template_components`)
inherit their parent template's ownership and have no `owner_id` of their own.
`unit_formations` and `unit_size_categories` are game-rule lookups and stay
system-managed.

## Enforcement

RLS keeps its existing capability policies. A single row trigger
(`enforce_content_owner`) adds ownership on top:

- **INSERT** forces `owner_id = auth.uid()` — a client can never spoof an owner.
- **UPDATE** refuses if the actor is not the owner/admin and forces
  `owner_id = OLD.owner_id` (ownership never transfers through an edit).
- **DELETE** refuses if the actor is not the owner/admin.

Seeded built-in catalogs (`ship_components.built_in`) and all pre-177 rows have
`owner_id = NULL`, so they fall under the admin-only rule automatically.

## UI

- Every editor list has an ownership filter, default **All content** so a DM can
  find existing work instead of reinventing it: `All content`, `Mine`,
  `System / legacy`, and — admins only — `Owner deleted`.
- Rows you do not own show an owner chip and open read-only, with a notice and a
  **Clone to edit** button. Clone copies the children (ship joins/crew, template
  payloads) and creates a new row owned by you.
- Admins see a “System / legacy” and “Owner deleted” filter to review orphaned
  content, clone it if useful, or delete it.
- Creating new content is never restricted beyond the existing editor capability.
- Deleting a catalog row **cascades** into every template that uses it. To avoid
  one DM breaking another DM's ship, the Component Workshop refuses the delete
  when a using ship template belongs to someone else (admins may override).
  Clone the component under a new name instead.

## Justification

Per-creator editing stops one DM from silently rewriting another DM's race,
weapon, ship or map, while keeping the shared library readable so nobody has to
rebuild content that already exists. Locking `owner_id IS NULL` to admins makes
legacy and seeded rows safe: they cannot be quietly changed by a DM, and an
admin can still curate them.

## Example

DM Sam opens the Unit Editor. The list is filtered to **All content** and shows
“Elf” with an owner chip reading `Ark`. Selecting it opens read-only with a
`Clone to edit` button. Sam clicks it, names the copy “Elf (River)”, and edits
that; the original stays untouched. If Ark's account is deleted, “Elf” shows as
“Owner deleted — …” and only an admin can edit or remove it.

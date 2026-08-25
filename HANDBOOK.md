# QuiTTER – Complete Technical Handover Document

## 1. Project Overview
**Project Name:** QuiTTER (Quick Terrestrial Tactical Encounter Rules)
**Purpose:** A digital tabletop wargame / tactical RPG designed to complement D&D 5e, providing a simple yet historically- and logically-grounded mass combat system for DMs and their players.
**Target Audience:** D&D DMs and players (expected ~50 users max). The system is designed to be intuitive for anyone familiar with D&D 5e, with special focus on tactical positioning, morale, and formation-based combat.
**Current Phase:** Scenario Mode is operational — hex grid with tokens, drag-and-drop movement, morale system, formation changes, GM tools, alliance management, real-time multiplayer sync, and map editor for background image alignment. Combat resolution (AGR checks, damage, routing trigger) is the next milestone.

## 2. Tech Stack & Architecture
| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend/UI | Next.js 14 (TypeScript / React) + Tailwind CSS | UI rendering, routing, styling |
| Simulation Core | Web Workers (Browser) | Offload heavy calculations (combat, pathfinding, AI) – currently skeleton |
| Multiplayer Backend | Supabase (Postgres + Realtime WebSockets) | Sync unit positions, lock events, game state |
| Hosting | Vercel (Free hobby tier) | Automatic CI/CD from GitHub |
| State Saving | localStorage / IndexedDB (future) | Autosave, session migration, backup |

**Key Design Decisions:**
- Map Renderer: HTML5 Canvas 2D (inside React with useRef) – faster than SVG, handles thousands of hexes.
- Hex Grid: Cube Coordinates (q, r, s where s = -q - r).
- Hex Radius: 100px.
- Token Sizing: Independent width/height control.
- Map tokens: width = hex_width × 1.6, height = width × 0.75.
- Preview tokens: width and height set independently (4:3 ratio in Unit Editor).
- Authentication: Supabase Auth with Google OAuth (cross-device persistence).
- Multiplayer Sync: Supabase Realtime with soft locking for concurrent unit manipulation.

## 3. Game Design Philosophy

### 3.1 Core Principle: Morale Overkill
"Battles are won by breaking the enemy's will as much as by taking their lives."
The game is designed around two psychological stats that interact dynamically:
- **Aggressiveness (AGR)** – The will to attack.
  A unit rolls a d10 each turn to attack; the roll must be ≤ AGR.
  Failure = Hesitation (cannot attack, but may Brace for +1 AC).
  Modified by level differences.
- **Morale Capacity (MOR)** – The resilience to break.
  A static threshold (not rolled).
  Units accumulate Threat from melee contacts, rear attacks, wounds, and isolation.
  If Threat ≥ MOR, the unit routs instantly.

### 3.2 Combat Flow Summary
```
1. Movement
2. Roll AGR to attack. Fail = Brace.
3. Resolve melee damage.
4. Calculate Total Threat (position + wounds + isolation)
5. If Threat ≥ Morale Capacity → Rout (drop to Scattered, move 1 hex away)
6. If routed and a faster enemy is adjacent → Enemy may Pursue (drop formation, free attack, move 1 hex)
```

### 3.3 Formation Effects
| Formation | Speed Modifier | AC Bonus | Morale Bonus | Special |
|-----------|---------------|----------|-------------|---------|
| Shield Wall | ×0.5 | +3 | +1 | Attack/retaliate at 50% damage |
| Phalanx | ×0.5 | +1 | +1 | Double damage vs FIRST enemies entering Kill Zone |
| Close Order | ×1.0 | +1 | +1 | Standard |
| Open Order | ×1.0 | 0 | 0 | No bonuses or penalties |
| Scattered | ×1.5 | 0 | -1 | No Zone of Control |
| Routed | ×1.5 | 0 | 0 | No ZoC, must flee; can be rallied by Heroes |

## 4. Database Schema (Supabase Tables)

### 4.1 races
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Race name (e.g., "Human", "Elf", "Ogre") |
| base_hd | INTEGER | Base hit dice (HP) |
| acBonus | INTEGER | Natural AC bonus |
| icon_url | TEXT | Icon filename (e.g., "human.png") |
| size_category | INTEGER | 75 (Small), 100/200/300/400 (Medium/Large/Huge/Gargantuan) |
| visual_scale | INTEGER | 50–149 (minor visual dot scaling for race variants) |
| can_charge | BOOLEAN | Whether this race can perform a charge attack (e.g., centaurs) |

### 4.2 mounts
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| name | TEXT | Mount name |
| speed | INTEGER | Movement points |
| cost_gp | INTEGER | Gold cost |
| size_category | INTEGER | 75 (Small), 100/200/300/400 (Medium/Large/Huge/Gargantuan); mount must be > rider's size |
| can_charge | BOOLEAN | Whether this mount can perform a charge attack |

### 4.3 weapons
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| name | TEXT | Weapon name (unique) |
| damage_dice | TEXT | e.g., "1d8", "2d6+2" |
| cost_gp | INTEGER | Gold cost |
| attack_bonus | INTEGER | Optional to‑hit bonus |
| magic_radius | INTEGER | Area radius in feet (0 for single‑target) |
| range | INTEGER | Effective range in hexes |
| target_type | TEXT | 'single' or 'area' |
| is_reach | BOOLEAN | True if weapon has Reach (e.g., pike, lance) |
| is_two_handed | BOOLEAN | True if weapon is two-handed (occupies both hands — no shield, no Shield Wall) |

### 4.4 Lookup Tables (armors, formations, unit_types)
Standard lookup tables with:
- id (UUID)
- name (TEXT)
- ac_bonus / movement_penalty / cost_gp (numeric)
- icon_url (TEXT, optional)
- formations also has four modifier columns, all consumed at runtime via `unitStats.ts`:
  - `ac_modifier` (INTEGER) — added to `baselineAc` for effective AC
  - `movement_modifier` (INTEGER) — added to `movementPoints` for effective max movement
  - `attack_modifier` (INTEGER) — added to each weapon's `attackBonus` for effective attack
  - `morale_modifier` (INTEGER, default 0) — added as a term in the effective morale formula (Routed: -2, Scattered: +1, Open Order: 0, Close Order: +1, Phalanx: +2, Shield Wall: +2)

### 4.5 unit_templates – The Core Table (Blueprint)
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| unit_name | TEXT | Unit name (unique) |
| race_id | UUID | FK to races |
| model_type_id | UUID | FK to unit_types (visual type) |
| is_hero | BOOLEAN | Hero unit (affects morale) |
| troop_count | INTEGER | Number of troops |
| level | INTEGER | HD / level |
| troop_hp | INTEGER | HP per troop |
| max_unit_hp | INTEGER | Total HP (auto‑calculated = troop_hp × troop_count) |
| number_of_attacks | INTEGER | Number of attacks per action |
| armor_id | UUID | FK to armors |
| weapon_string | JSON | JSON array of Weapon objects |
| is_shielded | BOOLEAN | Shield equipped (+2 AC) |
| base_ac | INTEGER | Natural AC from race |
| baseline_ac | INTEGER | AC after equipment adjustments (enters battle with this) |
| mount_id | UUID | FK to mounts |
| movement_points | INTEGER | Base movement |
| aggressiveness | INTEGER | 1–10 |
| base_morale | INTEGER | 1–10 (Morale Capacity) |
| size_category | INTEGER | 75 (Small), 100/200/300/400 (Medium/Large/Huge/Gargantuan) |
| visual_scale | INTEGER | 50–149 (dot size modifier) |
| formation_availability | JSON | Array of formation names |
| equip_cost_gp | INTEGER | Equipment cost |
| weekly_cost_gp | INTEGER | Weekly maintenance cost = 4 * level^2 |
| can_charge | BOOLEAN | Override for race/mount charge ability |
| custom_image_url | TEXT | Custom hero/unit image URL |
| unit_type_icon_url | TEXT | URL for unit type icon |
| created_at | TIMESTAMPTZ | Timestamp |
| updated_at | TIMESTAMPTZ | Timestamp |

### 4.6 scenarios
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| name | TEXT | Scenario name |
| creator_id | UUID | User ID (from auth) |
| creator_name | TEXT | Display name |
| password_hash | TEXT | Optional password (hashed) |
| map_data | JSON | Map state (future) |
| screenshot_url | TEXT | URL of screenshot (deterministic filename) |
| created_at | TIMESTAMPTZ | Timestamp |
| updated_at | TIMESTAMPTZ | Timestamp |

### 4.7 scenario_participants
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| scenario_id | UUID | FK to scenarios |
| user_id | UUID | User ID |
| role | TEXT | 'GM', 'AssistGM', 'SuperPlayer', 'Player' |
| joined_at | TIMESTAMPTZ | Timestamp |

### 4.8 profiles – Global User Display Name
`auth.users` is reserved by Supabase, so profile data lives here, keyed on `auth.uid()`.
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK, FK to auth.users (ON DELETE CASCADE) |
| display_name | TEXT | User-editable global display name |
| created_at | TIMESTAMPTZ | Timestamp |
| updated_at | TIMESTAMPTZ | Timestamp |

RLS: any signed-in user can SELECT names; users INSERT/UPDATE only their own row. Rows are created lazily by each user's client (`src/hooks/useProfile.ts`), seeded from `user_metadata` fallback (`full_name → name → email`). Edited via the clickable name chip in the Lobby header; consumed by ScenarioMap's `playerName` (message/command-log senders).

### 4.9 units – Instance Table (Battlefield State)
Stores actual on‑map units (copied from templates with per‑instance stats).
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| scenario_id | UUID | FK to scenarios |
| template_id | UUID | FK to unit_templates |
| unit_name | TEXT | Unit name (copied from template) |
| race_id | UUID | FK to races (copied from template) |
| race_name | TEXT | Race name (copied from template, for display) |
| armor_name | TEXT | Armor name (copied from template, for display) |
| mount_id | UUID | FK to mounts (null = not mounted) |
| mount_name | TEXT | Mount name (copied from template, for display) |
| is_hero | BOOLEAN | Hero flag (copied from template) |
| current_troop_count | INTEGER | Current troop count |
| max_troop_count | INTEGER | Maximum troops |
| level | INTEGER | Level (copied from template) |
| troop_hp | INTEGER | Per-troop HP (copied from template) |
| max_unit_hp | INTEGER | Maximum total HP |
| current_unit_hp | INTEGER | Current total HP |
| number_of_attacks | INTEGER | Attacks per action (copied from template) |
| is_shielded | BOOLEAN | Shield flag (copied from template) |
| baseline_ac | INTEGER | AC after equipment (copied from template); armor AC bonus baked in |
| current_ac | INTEGER | Current AC (modified by brace, formation) |
| weapon_string | TEXT | Weapon data (JSON) |
| movement_points | INTEGER | Max movement (copied from template) |
| movement_points_available | INTEGER | Remaining movement for current turn |
| aggressiveness | INTEGER | 1–10 (copied from template) |
| base_morale | INTEGER | 1–10 (copied from template) |
| current_morale_modifier | INTEGER | Modifier to base morale (dynamic, additive) |
| size_category | INTEGER | 75 (Small), 100/200/300/400 (Medium/Large/Huge/Gargantuan); copied from template |
| visual_scale | INTEGER | 50–149 (copied from template) |
| current_formation | TEXT | Current formation |
| formation_availability | JSON | Available formations (copied from template) |
| equip_cost_gp | INTEGER | Equipment cost (copied from template) |
| can_charge | BOOLEAN | Whether unit can charge (race OR mount can_charge) |
| race_icon_url | TEXT | Icon URL from race template |
| unit_type_icon_url | TEXT | Unit type icon URL |
| custom_image_url | TEXT | Custom image URL |
| hex_q, hex_r, hex_s | INTEGER | Cube coordinates |
| facing | INTEGER | Facing vertex (0–5) |
| team | TEXT | 'blue', 'yellow', 'violet', 'black', 'orange', 'green' |
| is_routing | BOOLEAN | Routing flag |
| hidden | BOOLEAN | Hidden from non-GM players |
| actions_available | INTEGER | Remaining actions for current turn |
| active_weapon_index | INTEGER | Index of the active weapon in weapon_string (0 = first) |
| updated_at | TIMESTAMPTZ | Timestamp |

## 5. File Structure
```
src/
├── app/
│   ├── layout.tsx                    # Root layout with MessageProvider
│   ├── page.tsx                      # Home page (Lobby → ScenarioMap)
│   └── api/
│       └── map-images/route.ts       # GET — lists map background images from /public/images/maps/
│
├── components/
│   ├── Lobby.tsx                     # Scenario management
│   ├── UnitEditor.tsx                # Unit template editor (complete)
│   ├── Toast.tsx                     # Toast notifications
│   │
│   ├── ScenarioMap/                  # Scenario map components
│   │   ├── ScenarioMap.tsx           # Main map component
│   │   ├── LeftPanel.tsx             # Floating left panel — tabbed (Map / Alliances / Unit Selector / Messages)
│   │   ├── PanelsContainer.tsx       # Resizable, tabbed container shell
│   │   ├── PanelSection.tsx          # Scrollable content region for one open panel
│   │   ├── UnitSelector.tsx          # Searchable template list with drag
│   │   ├── MessagesPanel.tsx         # Game log with auto-scroll
│   │   ├── AlliancePanel.tsx         # GM-only team alliance assignment (3 boxes)
│   │   ├── MapEditorPanel.tsx        # GM-only background image alignment (tab in LeftPanel)
│   │   ├── ContextMenu.tsx           # Right-click context menu
│   │   └── UnitTooltip.tsx           # Hover tooltip with unit stats
│   │
│   └── TokenRenderer/                # Token rendering (shared)
│       ├── TokenRenderer.tsx         # React component (Unit Editor preview)
│       ├── TokenPreview.tsx          # Simple wrapper
│       ├── drawToken.ts              # Pure rendering function (core)
│       ├── tokenUtils.ts             # Colors, formations, dot generation
│       └── useTokenRenderer.tsx      # Hook for preview
│
├── game/
│   └── GameEngine.ts                 # Pure undo/redo stack + command execution
│
├── contexts/
│   └── MessageContext.tsx            # Message bus for game log
│
├── hooks/
│   ├── useHexGrid.ts                 # Hex grid rendering + mouse interactions
│   ├── useGameEngine.ts              # React bridge to GameEngine + command_log persistence
│   ├── useSupabaseSync.ts            # Unit state management with Realtime sync
│   ├── useScenarios.ts               # Scenario CRUD + presence
│   └── useTeamAlliances.ts           # Team-to-alliance mapping per scenario
│
├── lib/
│   ├── supabaseClient.ts             # Supabase client setup
│   ├── weaponParser.ts               # Weapon JSON serialization/deserialization
│   ├── templateMappers.ts            # Shared UnitTemplate ↔ Database mappers
│   ├── unitMorale.ts                 # Morale calculation helpers: wounds, isolation, enemy threats, routing check
│   ├── unitCombat.ts                 # Combat resolution: row capacity, AGR, attack rolls, damage, retaliation
│   ├── unitStats.ts                  # Formation stat modifier computations (AC, movement, attack, morale)
│
├── types/
│   └── gameProtocol.ts               # Unit, Hex, Scenario, UnitTemplate types + alliance/formation constants
│
```
│
## 6. Key Components & Data Flow

### 6.1 Lobby (src/components/Lobby.tsx)
**Purpose:** Scenario management and entry point.
**Features:**
- Google OAuth sign-in.
- List, create, join, and delete scenarios.
- Presence tracking via Supabase Realtime (GM online/offline).
- Screenshots captured automatically when the GM exits.
**Data Flow:**
```
User → Lobby → useScenarios → Supabase
                 ↓
            (create/join) → Active Scenario → ScenarioMap
```

### 6.2 Unit Editor (src/components/UnitEditor.tsx)
**Status:** Complete
**Features:**
- Left Panel: List of all user-created templates.
- Center Panel: Form fields for all stats (including new fields: baseline AC, weekly cost, can charge).
- Right Panel: Token preview with test sliders (Casualty, Morale, Formation).
- Preview Aspect Ratio: 4:3 (width:height).
- Weapon Modal: Add/edit weapons with searchable weapon library.
- Image Picker Modal: Select race image, user-uploaded image, or upload new.
- Size Category Slider: Snaps to 75 (Small), 100/200/300/400 (Medium/Large/Huge/Gargantuan).
- Hero Logic: Forces Troop Count = 1.
- Gargantuan Logic: Forces Hero = true, Troop Count = 1, disables formations.
- Mount Filter: Only shows mounts with size_category > unit.size_category.
**Data Flow:**
```
User → UnitEditor → Supabase (unit_templates, lookups)
                      ↓
                  TokenPreview (live rendering)
```

### 6.3 Token Renderer (src/components/TokenRenderer/)
**Purpose:** Render unit tokens as HTML5 Canvas images, shared between Unit Editor preview and Scenario Map.
**Status:** Complete
**Core Files:**
- `TokenRenderer.tsx` – React component wrapper (Unit Editor preview).
- `drawToken.ts` – Pure rendering function (used by both TokenRenderer and ScenarioMap).
- `tokenUtils.ts` – Shared utilities (colors, formations, dot generation).
- `TokenPreview.tsx` – Simple wrapper.

**Rendering Features:**
- Dimensions: Uses width and height separately (not a single size).
- Team Colors: Blue (#0072B2), Yellow (#F0E442), Violet (#CC79A7), Black (#333333), Orange (#D55E00), Green (#009E73).
- Team Shapes: Circle, Triangle, Star, Square, Diamond, Cross (grey overlay on token background, shifted left to peek behind hero images).
- Troop Dots: Row-by-row centering with dead troop visualization. Capped at 200 max.
- Formation-Specific Rendering:
  - Phalanx: pikes drawn behind dots.
  - Shield Wall: shields drawn behind front row dots.
  - Mounted Units: Rendered as triangles when mount_id is not null.
  - Routed Flag: White flag icon when isRouting = true.
- Morale Hearts: 2 rows of 5, side-touching, filled based on morale (non-hero only). Positioned in bottom 1/3 area, centered.
- Action Badge: A small square at the token's right edge, sitting directly above the bottom info band (non-hero) or above the HP bar (hero, bottom-right). Shows remaining `actionsAvailable` as a bold number color-coded by remaining count: white = full (≥2), yellow = 1, red = 0. Skips attached heroes and units with no `actionsAvailable`.
- Hero Rendering: Custom image centered in top 2/3, HP bar (`currentUnitHp / maxUnitHp`, left 75%) + HP numbers (right 25%), name at bottom edge.
- Facing Rotation: When `unit.facing` is set, the entire token rotates by `facing × π/3` radians around its center. Implemented via `ctx.save()` + `ctx.translate(center)` + `ctx.rotate(angle)` + `ctx.translate(-center)` at the top, with a single `ctx.restore()` in a `finally` block. The rotation scope is guaranteed synchronous — all `await` calls happen before `ctx.save()`, and all icon drawing uses synchronous cache lookup with fallback rectangles (no `.then()` callbacks).
- Alliance Ring: A 4px-thick border ring in the alliance color (blue for friendly, orange-red for enemy, gray for neutral) is stroked on top of the team border.
- Icon Priority: custom_image_url overrides race_icon_url.
- Name Placement: Unit name (`unitName`) sits flush with the bottom edge (1px padding) under the morale hearts.

**Async Rendering Pattern:**
- Hero image is preloaded before `ctx.save()`: checks `preloadedImages`, then `imageCache`, then `await loadImage()`. The loaded image is stored in a local `heroImage` variable; the hero path inside the rotation scope uses it synchronously with zero `await` calls.
- Bottom-info icons (race/weapon-type) check `preloadedImages?.get(url) || imageCache.get(url)` synchronously. If uncached, a fallback rectangle is drawn and `loadImage(url)` is fired purely to warm the module-level cache for the next redraw. No `.then()` callbacks draw to the canvas.
- The `loadImage` function (module-level, with in-memory `imageCache`) is exported for screenshot preloading from `ScenarioMap.tsx`.

**Key Function:**
```
// Dot positioning with row-by-row centering
const spacing = tokenWidth / (countInRow + 1);
const x = spacing + col * spacing; // perfect centering
```

### 6.4 ScenarioMap (src/components/ScenarioMap/ScenarioMap.tsx)
**Purpose:** Render the game map with floating UI panels.
**UI Layout:**
- Top Bar: Title "Scenario Map - {DM/Player}" + Exit Session button (top-right).
- Floating Left Panel: Positioned under top bar, uses the tabbed PanelsContainer framework (see §6.11). Contains tabbed sections (fixed DM use order):
  - Map (GM-only) – Background image alignment (pick image, offset X/Y, scale, Save). Changes apply live to the map canvas and persist via `map_data`.
  - Alliances (GM-only) – Drag-and-drop team alliance assignment (3 boxes: Friendly, Enemy, Neutral).
  - Unit Selector (GM-only) – Searchable template list with drag-to-place.
  - Messages – Real-time game log with auto-scroll.
- Canvas: Full map area with hex grid and tokens.
- Debug Panel: Lower-right corner (hover coords, selected hex, unit count).

**Panel Behavior:**
- Tab bar at top lists every available panel (icon + label); clicking a tab toggles that panel open/closed.
- Multiple panels can be open at once — they stack vertically in fixed order (Map top, then Alliances, then Unit Selector, then Messages), each sharing the container height equally.
- On entry, the first *available* panel is open by default (GM: Map; Player: Messages); all others closed.
- When all panels closed, the panel shrinks to just the tab strip.
- Panel is anchored top-left by default; bottom and right edges are draggable to resize height/width.
- Docking: a large hollow triangle moves the panel between the left and right edges. When docked left the triangle sits at the **right end** of the tab bar pointing `>`; when docked right it sits at the **left end** pointing `<`. When docked right, the width-resize handles mirror to the left edge / bottom-left corner (with inverted drag math) so the panel stays resizable; the bottom handle is unchanged. Dock side is in-memory only (resets on reload).

**Map Interaction:**
- Left-click: Select hex.
- Left-click + drag on unit: Move unit (if target empty) or attack (if target occupied).
- Middle-click + drag: Pan map.
- Right-click on unit: Context menu.
- Scroll wheel: Zoom (centered on mouse position).

**Token Rendering (customDraw):**
- The `customDraw` callback is an `async` function that iterates over all units and `await`s each `drawToken()` call sequentially. This guarantees one unit's rotation scope (`ctx.save()`→drawing→`ctx.restore()`) completes before the next unit begins, preventing transform leaks.
- The screenshot capture path preloads all unique image URLs into the module cache via `Promise.all(loadImage(url))` before the draw loop, ensuring every image is rendered on the first capture attempt.

**Context Menu:**
- Rotate Left/Right: Changes unit facing. Hidden for hero units (heroes have no facing per game rules).
- Formations: Only shows formations available in formation_availability. Hidden for hero units (heroes have no formation mechanics). Options are filtered by organization level:
  - Target org level < current org level: always selectable (downward change, any amount).
  - Target org level = current org level: already selected, disabled.
  - Target org level = current org level + 1: selectable (upward by +1 per action).
  - Target org level > current org level + 1: greyed out / disabled.
- Weapons: Lists all weapons from weapon_string.
- Team Assignment (GM only): Any of 6 teams.
- Hide/Unhide (GM only): Toggle visibility.
- Delete Unit (GM only): Remove unit with confirmation.

**Token Placement:**
- Drag template from Unit Selector panel onto map hex.
- Default team: 'black' (DM/monster side).
- Default formation: 'Open Order' if available, otherwise 'Scattered'.

**Data Flow:**
```
Scenario → ScenarioMap → useHexGrid (render)
              ↓
         useSupabaseSync (units)
              ↓
         Screenshot → updateScreenshot → Supabase
```

### 6.5 useSupabaseSync Hook (src/hooks/useSupabaseSync.ts)
**Purpose:** Manage unit state with Supabase sync.
**Key Functions:**
```
moveUnit(unitId: string, targetHex: Hex)            // Optimistic update with rollback
addUnitFromTemplate(template: UnitTemplate, hex: Hex, team: string) // Instantiate from template
deleteUnit(unitId: string)                          // Remove unit
updateUnit(unitId: string, updates: Partial<Unit>)  // Update any field
clearUnits()                                        // Remove all units from scenario
```

**Default Formation Logic:**
```
let defaultFormation = 'Scattered';
  if (template.formation_availability?.includes('Open Order')) {
    defaultFormation = 'Open Order';
}
```

### 6.6 useHexGrid Hook (src/hooks/useHexGrid.ts)
**Purpose:** Hex grid rendering and mouse interaction.
**Features:**
- Hex grid rendering with cube coordinates.
- Zoom (centered on mouse position) using requestAnimationFrame batching.
- Pan (middle-click drag).
- Unit drag detection and movement.
- Mouse hover detection (for tooltips).
- Custom draw callback for token rendering.
- autoCenter parameter for initial centering.
- Exposed centerMap() function for parent components.

### 6.7 Message Context (src/contexts/MessageContext.tsx)
**Purpose:** Message bus for game log.
**Features:**
- `messages: GameMessage[]` where `GameMessage = { text: string, tone: 'default' | 'error' }`.
- `addMessage(msg: string)` – Append a default-tone message to log.
- `addError(msg: string)` – Append an error-tone message (rendered red in MessagesPanel); used for soft-enforcement over-budget notifications.
- `clearMessages()` – Clear all messages.
- Messages automatically scroll to bottom.

### 6.8 Shared Mappers (src/lib/templateMappers.ts)
**Purpose:** Centralized conversion between database rows and TypeScript UnitTemplate objects.
**Functions:**
- `mapTemplate(row: any): UnitTemplate` – Converts snake_case database row to camelCase TypeScript object.
- `mapTemplateToRow(template: UnitTemplate)` – Converts camelCase TypeScript object to snake_case database row.
- Usage: Shared between UnitEditor and UnitSelector to ensure consistent field mapping.

### 6.9 Game Engine (src/game/GameEngine.ts)
**Purpose:** Pure TypeScript class for action execution and undo stack management.

- `execute(action, state)` — Apply action to state, push entry to stack.
- `undo()` — Pop top entry, revert state via stored deltas.
- `canUndo()`, `peekUndo()` — Introspection for UI.
- Stack capped at 50 entries.
- Each entry stores `{ actionType, delta: { field, from, to }[] }` for rewind (not counter-action).
- Unit DELETE is reversible: stores `{ field: 'hidden', from: false, to: true }` so undo restores visibility.

### 6.10 Game Engine Bridge (src/hooks/useGameEngine.ts)
**Purpose:** React hook bridging GameEngine to Supabase persistence and UI.

- Wraps `GameEngine` execute/undo with `command_log` DB inserts (RLS-protected).
- Convenience methods: `rotateUnit`, `changeFormation`, `assignTeam`, `toggleHide`, `placeUnit`, `moveUnitRecorded(unit, targetHex, cost)`, `attachHero`, `detachHero`, `endTurn`.
- MP/action deltas ride along in each command's sub-steps so undo restores them: `MOVE` −path cost MP & −1 action; `ROTATE` −1 MP; `FORMATION` uses `applyFormationChange` (org-level steps + proportional floor rescale); `ATTACH_HERO`/`DETACH_HERO` −1 MP; `ATTACK` −1 action (spent even on AGR failure); `END_TURN` resets MP + 2 actions.
- `undo(scenarioId)` — rewind by permission:
  - Player can undo their own top-of-stack entry.
  - GM can undo any entry (notified via toast).
- Persists action + deltas to `command_log` table; soft-deletes on undo (`deleted_at`).
- Messages pushed through MessageContext on success/failure.

### 6.11 Panel Framework (src/components/ScenarioMap/)

**Purpose:** A resizable, anchored panel container that can host any number of collapsible sections. Designed as a "put more panels in it" framework — new sections are added declaratively in `LeftPanel.tsx`.

**Architecture:**

| Component | Role |
|-----------|------|
| `PanelsContainer.tsx` | Outer container — docked to the left or right edge (`side` prop), resizable via drag handles (right or left edge, bottom edge, bottom-right or bottom-left corner). Manages width/height state with configurable min/max constraints (default: 400×500, min: 200×200). Uses a `flex flex-col` shell (tab bar `flex-none`, body `flex-1 min-h-0`) so open panels never overflow the container. Renders a tab bar (from `tabs` prop) above the stacked open panels, with a large hollow dock-toggle triangle at the leading end of the tab bar (right end when docked left, left end when docked right). Collapses to auto-size when no tab is active. |
| `PanelSection.tsx` | One open panel's scrollable content region. Uses `flex-1 min-h-0 overflow-y-auto` so open panels share height equally. |
| `LeftPanel.tsx` | Orchestrator — defines the panel list declaratively, filters by role (`isGM`), manages open/closed state per panel (default: first available tab open). Currently hosts (in order): Map (GM), Alliances (GM), Unit Selector (GM), Messages (all). |

**Adding a new panel:**
In `LeftPanel.tsx`, add an entry to the `panels` array:
```tsx
{
  id: 'my-panel',
  label: 'My Panel',
  requiresGM: true,       // false = visible to all
  content: <MyComponent />,
}
```
The panel automatically gets a tab, open/close toggling, vertical stacking, resize support, and role gating. No changes to `PanelsContainer` or `PanelSection` needed.

**Resize behavior:**
- Right edge: horizontal drag handle — changes width (min 200px).
- Bottom edge: vertical drag handle — changes height (min 200px, max viewport - 100px).
- Bottom-right corner: 45° triangle — drags both axes simultaneously.
- Handles highlight on hover (yellow/50). State is reset on each drag (no persistence).

**Role gating:**
- Panels with `requiresGM: true` are only rendered when `isGM` is true.
- `isGM` currently checks `role === 'GM'` from `scenario_participants`. No "Assist GM" role exists yet — to add it, broaden the check in `ScenarioMap.tsx:595` (e.g., `role === 'GM' || role === 'ASSISTANT_DM'`).

## 7. Core Game Mechanics (Design Document)

### 7.1 Unit Facing (Vertex-based)
Units face a vertex (pointy corner), not an edge.
```
    Kill Zone
      [  ][  ]
         /\         (unit faces upward)
        /  \
       /    \
      /      \
     [  ][  ][  ]
      Flanks   Rear (behind)
```
- Front (Kill Zone): The 2 hexes touching the faced vertex.
- Rear: The 2 hexes touching the opposite vertex.
- Flanks: The remaining 2 hexes (left/right).
- Special Cases: Heroes and Scattered formations have NO facing.

### 7.2 Combat Resolution (Implemented)

Combat is resolved via pure functions in `unitCombat.ts`. The flow:

**Step 1 — Combat Position:** Determined from attacker hex, defender hex, and defender facing.
- Front (Kill Zone): attacker in defender's front 2 hexes → full retaliation
- Flank: attacker on either side hex → half retaliation
- Rear: attacker behind defender → no AGR check, no retaliation

**Step 2 — AGR Check:** Roll D10 ≤ attacker's `aggressiveness`. Fails → no attack (action wasted). Skipped for rear attacks.

**Step 3 — First Strike:** The one with Reach attacks first. If both have or both lack Reach, attacker attacks first.

**Step 4 — Attack Rolls:** Number of attacks = `rowCapacity × numberOfAttacks`. Row capacity based on size category (Medium=10, Large=5, Huge=2, Gargantuan=1). Each attack:
- Roll D20 (1=auto-miss, 20=auto-hit + double damage)
- Hit if `D20 + weapon.attackBonus + formation.attack_modifier + 8 ≥ target.currentAc`
- Damage = weapon damage dice roll, doubled on crit
- Capped at target's `troopHp` (one troop max per hit)
- Damage subtracted from `currentUnitHp`; troop count = `ceil(newHp / troopHp)`

**Step 5 — Morale Check:** After first strike, the target checks effective morale using `computeEffectiveMoraleModifier` (wounds at new HP, isolation, enemy threats, formation). If `baseMorale + currentMoraleModifier + effectiveMod ≤ 0` → routs with chained ROUT cascade to adjacent non-hero units.

**Step 6 — Retaliation:** If target didn't rout and position ≠ rear:
- Front: full attacks (`defender.rowCapacity × defender.numberOfAttacks`)
- Flank: half attacks (rounded down)
- No AGR check needed (reflexive response)

**Step 7 — Attacker Morale Check:** After retaliation, attacker checks effective morale (same formula). If broken → routs with cascade.

**Undo:** The entire ATTACK command stores damage deltas (`currentUnitHp`, `currentTroopCount`) as sub-steps, with any ROUT entries chained for batch undo.

### 7.3 Aggressiveness (AGR)
- Roll d10 at start of turn.
- To attack: roll ≤ AGR.
- Failure: Hesitate (cannot attack this action).
- Level Modifier: Higher-level enemies shake attacker's nerves; modifier = floor(Defender Level ÷ Attacker Level) - 1.
  - Higher Attacker: +1 bonus (look down at target).
  - Defender equal or less than double Attacker level: 0 penalty (fair fight).
  - Defender equal or more than double Attacker level: +[# of times] penalty (intimidated).
- Minimum: AGR = 1.

> **(Optional rule — Brace on Hesitation):** The original design gave a unit that failed AGR +1 AC (Brace) as a consolation. This creates a timing dilemma: how long does the brace last? Until the unit's next turn? Until it attacks again? Both answers cause problems — a braced unit that attacks again immediately gets no defensive benefit (making the mechanic pointless), while a brace that lasts until next turn gives an unearned defensive bonus. The current implementation omits brace entirely. Groups that want it should define a clear expiration trigger (e.g., "lasts until the unit's next activation").

### 7.4 Morale Capacity (MOR) & Effective Morale

**Effective Morale Formula:**
```
effectiveMorale = baseMorale + currentMoraleModifier + situationalModifier
```

**Situational Modifier (computed on the fly, never persisted):**
```
situationalModifier = wounds + isolatedPenalty - enemyThreats + formationMoraleModifier
```

| Factor | Calculation | Range |
|--------|------------|-------|
| Wounds | `-Math.floor((1 - currentHp/maxHp) * 10)` | 0 to -10 |
| Isolation | `-1` if no same-alliance unit in 6 adjacent hexes | 0 or -1 |
| Enemy front/side threats | Sum of `threatFromLevel(enemy.level)` for enemies in front or side hexes | 0 to -N |
| Enemy rear threats | Sum of `threatFromLevel(enemy.level) + 1` for enemies in rear hexes | 0 to -N |
| Formation morale modifier | `formations.morale_modifier` looked up by `currentFormation` name | varies (Routed -2, Scattered +1, Close Order +1, Phalanx +2, Shield Wall +2) |

**Threat from Level:**
| Level Range | Threat Value |
|------------|-------------|
| 1–4 | 1 |
| 5–10 | 2 |
| 11–15 | 3 |
| 16–19 | 4 |
| 20 | 5 |

**Morale Display:**
- Tooltip shows MOR line: `effectiveMorale = baseMorale + modifier` with modifier color-coded. Includes "(incl. formation +N)" when formation modifier is non-zero.
- Morale factors section lists each factor (wounds, isolation, enemies, formation) individually. Formation line only shown when non-zero, color-coded green (positive) or red (negative).
- Token hearts: `totalHearts = min(10, max(baseMorale, effectiveMorale))`. Hearts up to `effectiveMorale` are filled (red up to baseMorale, gold above). Remaining hearts are hollow (dashed outline with `[1,1]` pattern).
- Heroes do not display morale or morale factors in their tooltip and are immune to routing.

**Routing Trigger — Cascade:**
- After a MOVE action, a synthetic post-move state is built (mover placed at target hex, all other units unchanged). The mover PLUS every non-hero, non-routing unit **adjacent** to the target hex is evaluated for routing.
- For each candidate whose `effectiveMorale ≤ 0`, a separate `ROUT` entry is recorded with `chained: true`, linking each ROUT to the preceding MOVE. All ROUT entries spawned by one MOVE are `chained=true`, so Ctrl+Z unwinds the entire cascade (MOVE → ROUT(A) → ROUT(B)) as one batch.
- Each ROUT sets `isRouting=true` and `currentFormation='Routed'`.
- Heroes and already-routing units skip evaluation entirely.

### 7.5 Routing & Pursuit
**Routing:**
- Any broken unit drops to Scattered and moves 1 hex away.
- One unit can do this once per turn.

**Pursuit (Cavalry):**
- Eligibility: Effective Speed > routing unit's Speed × 1.5.
- Cost: Drop one Formation level.
- Reward: Free attack + move 1 hex into vacated space.

### 7.6 Multiplayer Concurrency (Soft Lock)
- When user starts dragging a unit, broadcast lock_unit via Supabase Realtime.
- Other clients disable drag events on that unit until lock released (on drop or timeout).

### 7.7 Undo/Redo System (Command Log)
Undo is "rewind" not "counter-action":

- Each action stores deltas: `[{ field, from, to }]` describing what changed.
- Undo pops entries from the stack and replays `from` values to revert; entries pushed to redo stack.
- Redo pops from redo stack, re-applies `to` values, restores DB entries (removes `deleted_at`).
- Stack size: 50 entries max (oldest dropped). Separate redo stack also 50 max.
- Persistence: command_log table in Supabase (`scenario_id, user_id, action_type, delta, removed_by, deleted_at`).
- RLS: insert own action, select scenario-scoped, update own entry or any GM entry.
- Action types: `MOVE | ROTATE | FORMATION | TEAM | HIDE | TOGGLE_HIDE | PLACE | ATTACK | DAMAGE | HEAL | ROUT | DELETE | ALLIANCE`.

**Chained undo:** A `chained` boolean on `CommandEntry` (and `command_log.chained` column) marks an entry as a direct consequence of the entry before it. When undoing, the engine collects all consecutive `chained=true` entries plus their root cause (`chained=false`) from the top of the stack and returns the entire chain as a batch. The batch is soft-deleted atomically. Permission is checked against every entry in the chain (player can only undo through their own entries; GM bypasses).

Example: `MOVE(chained=false) → ROUT(Troop A, chained=true) → ROUT(Troop B, chained=true)` — one undo unwinds all three entries (cascade from a single MOVE spawning multiple routs). If no routing occurs, `MOVE` is recorded with no chain. `MOVE(chained=false) → MOVE(chained=false) → ROUT(chained=true)` — first undo unwinds ROUT+last MOVE; second undo unwinds the first MOVE alone.

- `ALLIANCE` actions: sub-steps store `{ field: 'alliance_group', from, to }`. Undo/redo route through `updateAlliance` callback instead of `updateUnit`, updating both local state and the `team_alliances` DB table.
- Deleting a unit sets `{ field: 'isDeleted', from: false, to: true }` so undo restores the unit (no DB DELETE).
- Undo button in ScenarioMap top bar shows "Undo (N)" when chain length > 1 (amber when undo available, gray when disabled). Ctrl+Z/Ctrl+Y for keyboard.
- Keyboard shortcuts: Q/E rotate selected non-hero unit, Ctrl+Z undo, Ctrl+Y redo.

### 7.8 Alliance Groups
Teams are assigned to alliance groups per scenario (GM-only):

| Group | Color | Behavior |
|-------|-------|----------|
| Friendly | Blue (`#0072B2`) | Same side — no threat generated |
| Enemy | Orange-red (`#D55E00`) | DM-controlled — generates threat to all friendly units |
| Neutral | Light gray (`#E0E0E0`) | Does not generate threat but receives threat from any group |

- GM assigns teams via AlliancePanel (3 group boxes — Friendly, Enemy, Neutral — with draggable team pills).
- Each token gets a thick border ring in the alliance color.
- Alliance changes are recorded in the command log as `ALLIANCE` action type and are fully undoable/redoable via Ctrl+Z/Ctrl+Y. Undo restores the previous alliance group.
- Storage: `team_alliances` table (scenario_id, team, alliance_group).

### 7.9 Formation Stat Modifiers

The `formations` lookup table has four modifier columns. All are applied on-the-fly (never persisted to unit DB fields):

| Modifier | Computation | Display |
|----------|-------------|---------|
| `ac_modifier` | `effectiveAc = baselineAc + formation.ac_modifier` | Tooltip: "20 = 18 + 2 (Shield Wall)" |
| `movement_multiplier` | `effectiveMaxMovement = max(1, floor(movementPoints × movement_multiplier))` | Tooltip shows `Move: {available}/{effectiveMax}` with `(base N × mult)` breakdown when ≠ 1 |
| `attack_modifier` | `effectiveAttackBonus = weapon.attackBonus + formation.attack_modifier` | Tooltip weapon list: "+5 atk [base +3, formation +2]" |
| `morale_modifier` | Added as term in `computeEffectiveMoraleModifier` | Tooltip morale factors: "formation +1" |

**Utility module** (`unitStats.ts`): `computeEffectiveAc`, `computeEffectiveMovement`, `computeEffectiveAttackBonus`, `getFormationModifier`, `getFormationMultiplier`.

**Data flow**: Formations are fetched on mount in `ScenarioMap` as `Record<string, Formation>` keyed by name. Each unit's current formation is looked up by `unit.currentFormation`. The modifiers are passed to `UnitTooltip` and the `customDraw` pipeline (for morale).

### 7.10 Turn Economy — Movement Cost, Actions & Soft Enforcement

**Turn reset (End Turn):** when a group's turn starts, every non-deleted unit on a team in that group resets `movementPointsAvailable = 0` and `actionsAvailable = 2`. MP is **not granted up front** — it is materialized only when a move converts an action into a full pool (see below). Turn order cycles friendly → enemy → neutral, skipping empty groups; `turn_number` increments on a full cycle. See §6.10 `endTurn` / `src/lib/turnState.ts`.

**Action cost table** (`useGameEngine.ts` / `ScenarioMap.tsx`) — MP comes from the **acting unit** (the hero for attach/detach):

| Player action | Command | Action | MP |
|---|---|---|---|
| Move (drag to hex) | `MOVE` | −1 per full MP pool (`ceil(pathCost / maxMP)`) | −path cost |
| Attack (drag onto enemy) | `ATTACK` | −1 (even on AGR failure) | 0 |
| Rotate (context menu / Q/E) | `ROTATE` | 0 (1 only if MP < 1 triggers a refill) | −1 — **units only, heroes ignore** |
| Formation change | `FORMATION` | 0 | org-level steps + proportional floor rescale — **heroes skip MP** |
| Attach / Detach hero | `ATTACH_HERO` / `DETACH_HERO` | 0 (1 only if hero MP < 1) | −1 — **from the hero, not the host unit** |
| Hide / Team / Delete / Place | `TOGGLE_HIDE` / `TEAM` / `DELETE` / `PLACE` | 0 | 0 |
| Rout (morale-induced) | `ROUT` | 0 | 0 |

**Movement — "1 action = 1 full MP pool"** (`src/lib/moveCost.ts`): `computeReachableMap(unit, maxMP, occupied, threatHexes)` over state space `(hex, facing)` — 1 MP per hex entered from the front arc, 1 MP per 60° turn. Threat hexes are reachable as destinations but never passed through; occupied hexes are never reachable; Routed/Scattered/**Hero** units move any direction at 1 MP/hex (no facing cost). Units start at **2 actions / 0 MP**; MP is **materialized when a move converts an action** into a full pool. A move's cost is spent from **already-materialized MP first**, and an action converts to a fresh full pool only when MP is exhausted. **Movement budget** = `movementPointsAvailable + maxMP × max(1, actionsAvailable)` (`computeMoveBudget`): leftover MP + every remaining action as a full pool, so a unit with 2 actions and maxMP 5 can cover up to 10 hexes. `applyMoveCost` computes the executed accounting (final MP = remainder of the last pool — 0 on an exact pool — final actions = unconverted pools left); `applyMpSpend` does the same for single-MP spends, converting an action into a full pool when MP is insufficient. The executed move accepts any hex within that budget; the **drag overlay shades one move's reach** (`computeMovePool`, i.e. a full pool when actions ≥ 1) so players see where the current move can go — dropping beyond it just spends leftover MP / refills the next pool.

**Formation rescale** (`src/lib/formationCost.ts`): `applyFormationChange(currentMP, steps, oldMax, newMax)` — 1 MP per organizational-level step, then `(currentMP − steps) × newMax/oldMax`, floored and clamped to `[0, newMax]`. MP is tracked as an integer throughout.

**Soft enforcement (never hard-blocks):**
- A move to a hex outside its action-budget reach is rejected with a message.
- A move with **0 actions left** (MP already depleted) triggers a **confirm modal**; confirming deducts the full cost (MP/actions may go negative) and pushes a **red notification** (`addError`) to the message log.
- An attack with `actionsAvailable < 1` triggers the same confirm modal + red notification (covers haste double-attack and detach-reposition edge cases).
- Points going negative is a visible over-budget flag; `END_TURN` resets everything.

**Tooltip:** shows `Move: {floor(movementPointsAvailable)}/{max}` (actual materialized MP — drains 3→2→1→0 per action pool) and `Actions: {n}/2` with a `(1 = full move)` hint (red when ≤ 0). Tokens show an action badge (white ≥2 / yellow 1 / red ≤0) — see §6.3.

## 8. Role Permissions (RBAC)
| Role | Abilities |
|------|-----------|
| Player | Move/attack own units. View own stats. |
| Super Player | Player abilities + Adjust own unit stats. |
| Assist GM | Super Player abilities + Move/attack ANY unit. Edit ANY unit's stats. View all stats. |
| GM | Assist GM abilities + Choose map. Change ANY user's role. Change ANY unit's team. Hide/unhide units. Add units from library. Add props. |

**Implementation:**
- Role enum in scenario_participants table.
- Creator vs GM: Creator is not necessarily GM. First player to join defaults to GM.

## 9. (Legacy) Web Worker Protocol
*The web worker was removed in favor of direct GameEngine execution. This section is kept for reference.*

**Example Messages:**
```
{ type: 'MOVE_UNIT', payload: { unitId: 'abc123', targetHex: { q: 5, r: 3, s: -8 } } }
{ type: 'ATTACK', payload: { attackerId: 'abc123', targetId: 'xyz789' } }
{ type: 'LOCK_UNIT', payload: { unitId: 'abc123', lockedBy: 'user-google-id' } }
{ type: 'UNDO', payload: {} }
```

## 10. Data Safety Philosophy
- Use Supabase upsert to avoid primary-key conflicts.

## 11. Screenshot System
- Filename: `scenario_{id}.png` (deterministic, overwritten on each upload).
- Capture: On GM exit, captures the map with zoom-to-fit:
  - If units exist: zoom to include all units with padding.
  - If no units: zoom to show entire grid area.
- Upload: Uses `updateScreenshot` with upsert: true.
- Display: Scenario cards show the screenshot thumbnail.

## 12. Supabase Storage Buckets
| Bucket | Purpose | Public | Filename Pattern |
|--------|---------|--------|-----------------|
| scenario_screenshots | Scenario thumbnails | Yes | scenario_{id}.png |
| unit_images | Custom unit/hero images | Yes | {unitId}_{timestamp}.png |

**Policies:**
- scenario_screenshots: Public read, authenticated upload/delete.
- unit_images: Public read, authenticated upload/delete.

## 13. Authentication
- Provider: Google OAuth via Supabase Auth.
- User ID: Stored as creator_id in scenarios.
- Role: Stored in scenario_participants.
- Why Google: Cross-device persistence, no password management.

## 14. Current Status

### 14.1 What's Complete
- Unit Editor (full CRUD, size system, weapons, heroes, custom images, new fields)
- Token Renderer (hero/normal rendering, row-by-row centering, hearts, formations, width/height support)
- Weapon Parser (JSON with is_reach, auto-migration)
- Lobby (scenario CRUD, presence, screenshot upload)
- ScenarioMap (grid rendering, floating UI panels, Unit Selector, Messages)
- Screenshot System (deterministic filenames, automatic cleanup)
- Context Menu (rotate, formations filtered by availability, weapons, team assignment, hide, delete)
- Mouse Interaction (left-click select, left-drag move/attack, middle-drag pan, scroll zoom)
- Token Placement (drag from Unit Selector panel, default team: black, default formation: Open Order/Scattered)
- Shared Mappers (templateMappers.ts for consistent UnitTemplate mapping)
- Database Schema Refactor (renamed fields, new fields, consistent naming across UnitTemplate and Unit)
- Pure mouse-tracking drag: Unit selector drag replaced native HTML5 `draggable` with custom `mousedown`/`mousemove`/`mouseup` matching existing token move pattern in `useHexGrid`
- Unit field alignment: `troopCount` → `currentTroopCount`, `currentMorale` → `currentMoraleModifier`, `armorId` removed from `Unit` interface and all mappers
- TypeScript type cleanup: lookup table types (`Armor`, `Race`, `UnitType`, `Mount`) switched to snake_case matching Supabase columns; `Weapon.is_reach` replaces `reach`; `notes` removed from `Weapon` and `WeaponLookup`
- Morale heart display: boosted morale (base+modifier > base) shows gold hearts; `drawHeart` accepts optional `fillColor` string instead of `filled: boolean`; `drawBottomInfo` uses `(baseMorale, moraleModifier)` signature
- Action badge on tokens: small square above the info band (non-hero, right edge) or above the HP bar (hero, bottom-right) shows remaining `actionsAvailable` — white (≥2) / yellow (1) / red (0); skips attached heroes and preview units without `actionsAvailable`
- Token rendering improvements: Shield Wall shields use `ctx.ellipse` with separate X/Y radii for wider flatter shape; troop count `??` fallback so zero troops shows zero dots
- Morale test slider in UnitEditor changed from percentage to modifier range `[-baseMorale, 10-baseMorale]`
- Zero TypeScript errors outside pre-existing `next.config.ts`
- Token rotation synced: all `await` calls moved before `ctx.save()`; all icon drawing uses synchronous cache lookup with fallback; `.then()` callbacks eliminated from canvas drawing
- `customDraw` loop sequential: each `drawToken` is `await`ed, preventing rotation transform leaks between units
- Screenshot image preload: all unique image URLs loaded into cache before the draw loop so screenshots render completely on first capture
- Alliance undo: `ALLIANCE` action type added to GameEngine; `useGameEngine` branches on `step.type === 'ALLIANCE'` in execute/undo/redo, routing through `updateAlliance` callback; Alliance changes recorded in command_log and fully reversible
- Alliance panel drag-and-drop: native HTML5 DnD replaces click-to-cycle; team pills draggable between Friendly/Enemy/Neutral boxes with visual highlight
- Alliance button text: uses luminance-based `getDotColor()` for readable text on all team colors (black on yellow/violet/orange, white on blue/black/green)
- Hero context menu reduced: Rotate and Formations options hidden for heroes; Q/E keyboard shortcuts skip hero units
- Delete confirm deduplicated: removed redundant `confirm()` from ScenarioMap callback (single confirm in ContextMenu only)
- Morale system: `computeEffectiveMoraleModifier` utility in `unitMorale.ts` — computes wounds, isolation, enemy threats by facing; tooltip shows MOR breakdown with all factors; token hearts reflect effective morale (hollow for reduced)
- Token visual polish: unit names always white with dark shadow; team background at 75% opacity (`'BF'`); team shape alpha varies per team (violet 1.0, yellow/orange 0.7, others 0.35); violet/orange dot color black via explicit override; hollow hearts use `[1,1]` dash pattern
- Map Editor: background image alignment moved into the ScenarioMap left panel (`MapEditorPanel.tsx` in the Map tab — image dropdown from `/api/map-images`, offset X/Y sliders, scale slider, manual Save button). GM-only; changes apply live to the map canvas and persist via `map_data`. The full-screen `MapEditorView.tsx` and its Lobby button were removed.
- Canvas sizing fix: `useHexGrid` draw function reads `canvas.getBoundingClientRect()` instead of `parentElement?.getBoundingClientRect()`, so canvas correctly fills flex-allocated space alongside panels
- Background image rendering: drawn in world-space at `(offsetX * zoom, offsetY * zoom)` with `naturalSize * scale * zoom` dimensions, stays locked to the grid at any zoom level
- Panel framework: `PanelsContainer` + `PanelSection` declarative pattern for the resizable left panel — tab bar on top (icon + label), multiple open panels stack vertically in fixed order (Map → Alliances → Unit Selector → Messages) sharing height equally; `flex flex-col` shell keeps open panels inside the container; auto-size when all tabs closed; drag handles on right, bottom, and corner
- UnitSelector custom image: prefers `template.customImageUrl` over `template.raceIconUrl`
- Formation context menu restrictions: organization level filtering (+1 per action, any down allowed, unavailable options greyed out)
- Routing cascade: after MOVE, evaluates mover + adjacent non-hero, non-routing units at target hex; each routing unit gets its own `ROUT` entry with `chained: true`; all entries from one MOVE form a single undo chain
- Hero morale immunity: MOR line, Threat, and morale factors hidden in hero tooltip; routing check skips heroes
- Formation modifiers propagation: all four formation modifier columns (`ac_modifier`, `movement_modifier`, `attack_modifier`, `morale_modifier`) now consumed at runtime via `unitStats.ts`. Effective AC, movement, attack bonus, and morale include formation modifiers.
- Tooltip formation breakdowns: AC shows "base + formation", movement denominator is effective max, weapons show effective attack bonus with breakdown, morale factors include "formation" line.
- Chained undo: `chained` boolean on `command_log` links causally related entries. `GameEngine` chain-aware undo/redo returns `CommandEntry[]`. UI shows "Undo (N)" for chain length. ROUT entries chain to their triggering MOVE.
- Database migration `006_add_chained_to_command_log.sql` — adds `chained BOOLEAN NOT NULL DEFAULT false` column.
- Combat system (`unitCombat.ts`): pure functions for row capacity, combat position, AGR check, reach-based first strike, attack rolls (D20 vs AC), damage capped at troopHp, retaliation (front full/flank half/rear none), morale routing cascade after each combat phase. All wired into `ScenarioMap.onAttack` as async execute with chained ROUT.

### 14.2 What's Next
- Weapon selection (attacker picks which weapon to use in combat)
- Role Permissions (enforce RBAC in UI)
- Facing & Kill Zone (visual feedback)
- Unit Locking (soft lock via Supabase Realtime)
- Hex Grid Extensibility (auto-expand)
- Web Worker (skeleton only, not integrated)
- Mobile Responsiveness (not a priority)
- Troop count soft caps per size category (Medium 80, Large 20, Huge 6 – enforcement style pending)
- Spelljammer module implementation (spec: `.scratch/spelljammer-mod/spec.md`): ship entity + subsystem tables, `shipMoveCost`/`shipCombat`/`shipStats` libs, `useShipEngine`, ShipPanel UI, sub-turn toggle engine setting
- Archfar's Shipyard ship builder (button + placeholder modal shipped; builder gated by `canUseShipEditor`)

### 14.3 Known Gaps
- Web Worker: Skeleton only; not integrated.
- Mobile Responsiveness: Not a priority.
- TokenRenderer flickering: Can be optimized with debounce.
- Spelljammer: design + docs + admin access caps are in place; no ship entities, ship combat, or sub-turn engine yet.
- Boarding combat is explicitly out of scope — hand off to a dedicated D&D VTT.

## 15. Code Examples & Patterns

### 15.1 Weapon JSON
```
[
  {
    "name": "Longsword",
    "attackBonus": 5,
    "targetType": "single",
    "damageDice": "1d8",
    "range": 1,
    "magicRadius": 0,
    "is_reach": false
  }
]
```

The runtime `weapon_string` is a CSV, not JSON: 11 fields separated by commas, weapons by semicolons.
```
Name,AttackBonus,TargetType,DamageDice,Range,MagicRadius,Reach,NoRetaliation,FreeAction,IgnoreAttackMultiplier,IsTwoHanded
Longsword,5,single,1d8,1,0,false,false,false,false,false
Greatsword,5,single,2d6,1,0,false,false,false,false,true
```
Missing trailing fields (older strings) default to `false`.

### 15.2 Size Category Logic (Rank Capacity)
```
if (sizeCategory >= 200) baseRows = Math.floor(baseRows / 2); // 10 → 5
if (sizeCategory >= 300) baseRows = Math.floor(baseRows / 3); // 5 → 3
if (sizeCategory >= 400) baseRows = 1; // hero only
```

### 15.3 Hero Rendering
```
if (isHero) {
  const imageUrl = customImageUrl || raceIconUrl;
  drawImage(imageUrl, x, y, imageSize, imageSize); // Top 2/3, centered
  drawTeamShapeOverlay(ctx, team, width, height, true);
  drawName(ctx, unitName, x, y, width, height, team);
  drawHeroHpBar(ctx, x, y, width, height, currentUnitHp, maxUnitHp);
  return; // No dots, no hearts, no formation dots
}
```

### 15.4 Row-by-Row Centering
```
for (let row = 0; row < rows; row++) {
  const countInRow = endIdx - startIdx;
  const spacing = tokenWidth / (countInRow + 1);
  const y = startY + row * rowSpacing;
  for (let col = 0; col < countInRow; col++) {
    const x = spacing + col * spacing; // Perfect centering
    positions.push({ x, y, isDead });
  }
}
```

### 15.5 Screenshot Capture
```
const fileName = `scenario_${scenarioId}.png`;
const file = new File([blob], fileName, { type: 'image/png' });
await updateScreenshot(scenarioId, file); // upsert: true
```

### 15.6 Default Formation Logic
```
let defaultFormation = 'Scattered';
  if (template.formation_availability?.includes('Open Order')) {
    defaultFormation = 'Open Order';
}
```

### 15.7 Token Dimensions (Map)
```
const HEX_SIZE = 100;
const TOKEN_WIDTH = HEX_SIZE * 1.6;  // ~160px
const TOKEN_HEIGHT = TOKEN_WIDTH * 0.75; // ~120px
```

### 15.8 Icon Priority
```
const imageUrl = customImageUrl || raceIconUrl; // custom overrides race
```

### 15.9 Shared Template Mapping
```
// src/lib/templateMappers.ts
export function mapTemplate(row: any): UnitTemplate {
  return {
    id: row.id,
    unitName: row.unit_name || '',
    raceId: row.race_id || '',
    // ... all fields mapped consistently
  };
}

export function mapTemplateToRow(template: UnitTemplate) {
  return {
    id: template.id,
    unit_name: template.unitName,
    // ... all fields mapped consistently
  };
}
```

## 16. User Manual – Draft Outline
**Title:** QuiTTER – Quick Terrestrial Tactical Encounter Rules
**Subtitle:** A Tactical Wargame for D&D 5e

### Chapter 1: Getting Started
1.1 What is QuiTTER?
1.2 Signing In (Google OAuth)
1.3 The Lobby (Scenarios, Joining, Creating)
1.4 Quick Start (Your First Scenario)

### Chapter 2: The Unit Editor
2.1 Creating a Unit
2.2 Unit Stats Explained
  2.2.1 Name, Race, Level
  2.2.2 Troop HP, Troop Count, Max Unit HP
  2.2.3 Baseline AC, Attack, Movement
  2.2.4 Armor, Shield, Mount
  2.2.5 Size Category (Medium, Large, Huge, Gargantuan)
  2.2.6 Aggressiveness & Morale Capacity
  2.2.7 Hero Unit (What changes, custom images)
  2.2.8 Weapons (Adding, Editing, Library)
  2.2.9 Formation Availability (What each formation does)
  2.2.10 Unit Type Icon (Visual identification)
  2.2.11 Can Charge (Race or mount ability)
  2.2.12 Weekly Cost (Maintenance cost)
2.3 Token Preview (What you see)
  2.3.1 Team Selection
  2.3.2 Casualty Test (Visual simulation)
  2.3.3 Morale Test (Visual simulation)
  2.3.4 Formation Preview
  2.3.5 Custom Image (Hero/Unit portraits)
  2.3.6 Preview Aspect Ratio (4:3)
2.4 Saving, Cloning, Deleting

### Chapter 3: The Scenario Map
3.1 Creating a Scenario
3.2 Joining a Scenario (Password protection)
3.3 The Hex Grid
  3.3.1 Cube Coordinates (q, r, s)
  3.3.2 Zoom with mouse wheel (centered on cursor)
  3.3.3 Pan with middle-click drag
  3.3.4 Hex Size: 100px
3.4 Units on the Map (Instances, placement)
  3.4.1 Dragging from Unit Selector panel
  3.4.2 Default team: Black (DM/monster side)
  3.4.3 Default formation: Open Order (or Scattered if unavailable)
3.5 Screenshots (Automatic, manual upload)
3.6 The Interface
  3.6.1 Top Bar (Title, role, Exit button)
  3.6.2 Left Panel (Unit Selector, Messages log)
  3.6.3 Collapsible sections (▶/▼ toggles)
3.7 Right-Click Context Menu
  3.7.1 Rotate Left/Right
  3.7.2 Formations (only available ones shown)
  3.7.3 Weapons
  3.7.4 Team Assignment (GM only)
  3.7.5 Hide/Unhide (GM only)
  3.7.6 Delete Unit (GM only)

### Chapter 4: Gameplay Basics
4.1 Turns and Actions
4.2 Moving Units (Drag-and-drop)
  4.2.1 Drag to empty hex → Move
  4.2.2 Drag to occupied hex → Attack (with warning if same team)
4.3 Attacking (AGR check, damage, retaliation)
4.4 Formations (What they do, when to use them)
4.5 Morale and Routing (Threat system, Breaking Point)
4.6 Facing and Positioning (Kill Zone, Flanks, Rear)
4.7 Pursuit (Cavalry rules, free attacks)

### Chapter 5: Roles & Permissions
5.1 Player (Basic abilities)
5.2 Super Player (Adjust stats)
5.3 Assist GM (Move/attack any unit)
5.4 Game Master (GM) (Full control, map selection)

### Chapter 6: Advanced Tactics
6.1 Using Formations Effectively
6.2 Flanking and Rear Attacks
6.3 Hero Placement and Rallying
6.4 Pursuit Tactics (Cavalry)
6.5 Morale Management

### Chapter 7: UI Reference
7.1 Keyboard Shortcuts
7.2 Mouse Controls
  7.2.1 Left-click: Select hex
  7.2.2 Left-click + drag on unit: Move or Attack
  7.2.3 Middle-click + drag: Pan map
  7.2.4 Right-click on unit: Context menu
  7.2.5 Scroll wheel: Zoom (centered on cursor)
7.3 Context Menus
7.4 Collapsible Panels (Unit Selector, Messages)

### Appendix A: Glossary
### Appendix B: Combat Reference Card
### Appendix C: Formation Reference Card
### Appendix D: Unit Stat Sheet Template

---

## 16.1 Token Design – Complete Specification

### Aspect Ratio
4:3 (width:height)

### Token Structure
A token is divided into:
- Upper ⅔: Troop/hero display area
- Lower ⅓: Information area (icons, morale hearts, name)

### Background & Team Colors
- The token background fill is the team color at 75% opacity (`teamColor + 'BF'`). The full-opacity team color is used for the border stroke.
- Team Colors: Blue (#0072B2), Yellow (#F0E442), Violet (#CC79A7), Black (#333333), Orange (#D55E00), Green (#009E73).
- Chosen for colorblind-friendliness (red-green safe).

### Team Shape Overlay
- A grey (`#999999`) team shape overlay appears on top of the background. Alpha varies per team via `getTeamShapeAlpha`: violet=1.0 (full opacity for color-blind visibility), yellow/orange=0.7, others=0.35.
- Team Shapes: Circle, Triangle, Star, Square, Diamond, Cross.
- For heroes, the shape is shifted to the left (30% offset) so it peeks out from behind the hero image.
- Dot color (used for troop counters, status indicators): yellow returns black via luminance rule; violet and orange explicitly return black via override; all others follow the luminance formula.

### Unit Name
- Unit name is drawn along the bottom edge of the token in white (`#FFFFFF`) with a dark shadow (`rgba(0,0,0,0.8)`, 6px blur) for readability on any team background.

### Unit Token Variations

#### 1. Army Unit (Foot)
Each troop is displayed as a dot. Display Dot Size = baseDotSize × sizeCategory × visualScale.
Each row (rank) of dots aligns to the center.
Casualties are represented as hollow dots (circles) of the same size.

| Formation | Medium (100%) | Large (200%) | Huge (300%) |
|-----------|--------------|-------------|-------------|
| Open Order | 10 / 8 | 5 / 4 | 3 / 2 |
| Close Order | 20 / 4 | 10 / 2 | 6 / 1 |
| Phalanx / Shield Wall | 20 / 4 | 10 / 2 | 6 / 1 |
| Scattered | Random distribution, maintain distance | Random distribution, maintain distance | Random distribution, maintain distance |
| Routed | Random distribution + white flag | Random distribution + white flag | Random distribution + white flag |

#### 2. Mounted Unit
Each troop is displayed as a triangle.
The mount must be at least 1 size category larger than the rider.
Triangle width:height ratio = 3:5.
Display Triangle Size = baseTriangleSize × sizeCategory.
Each row (rank) of triangles aligns to the center.
Casualties are represented as hollow triangles.

| Formation | Medium (100%) | Large (200%) | Huge (300%) |
|-----------|--------------|-------------|-------------|
| Loose | 10 / 6 | 5 / 4 | 3 / 2 |
| Tight | 20 / 3 | 10 / 2 | 6 / 1 |
| Phalanx / Shield Wall | N/A | N/A | N/A |
| Scattered | 2 concentric circles, tips point along circle path | 2 concentric circles, tips point along circle path | 2 concentric circles, tips point along circle path |
| Routed | Random distribution + white flag | Random distribution + white flag | Random distribution + white flag |

#### 3. Hero Unit
- The upper ⅔ displays the racial portrait or custom image, centered vertically in the top area.
- The left 75% of the lower ⅓ is an HP bar showing `currentUnitHp / maxUnitHp` (white = lost HP, red = remaining HP; lost HP removed from the left end).
- The right 25% shows two rows: `currentUnitHp` on top, `maxUnitHp` at bottom (horizontally centered in this area).
- No troop dots, no hearts, no formation effects.

### Lower ⅓ Information Area (All Non-Hero Units)
- Left 25%: Racial portrait or custom image (custom overrides race).
- Right 25%: Unit type image (showing primary weapon or unit type icon).
- Middle 50%: Up to 10 hearts representing morale capacity, arranged in 2 rows of 5 when >5 hearts.
  - Hearts are centered horizontally and vertically within the middle 50%.
  - `totalHearts = min(10, max(baseMorale, effectiveMorale))` to leave room for boosted hearts.
  - Effective morale = `baseMorale + currentMoraleModifier + computedSituationalModifier` (wounds, isolation, enemy threats).
  - Hearts up to `min(baseMorale, effectiveMorale)` are filled in red (#FF4444).
  - Hearts from `baseMorale+1` to `effectiveMorale` are filled in gold (#FFD700) (boosted by positive modifiers).
  - Remaining hearts are hollow — drawn with a `[1,1]` dash pattern to avoid deforming the bezier curve at small sizes.
  - Drawn via `drawHeart(ctx, x, y, size, fillColor?)` — accepts optional `fillColor` string.
- Shield Wall formation: shields drawn behind front-row dots using `ctx.ellipse` with separate X/Y radii for a wider, flatter shape.
- Unit Name (`unitName`): Along the lower edge of the token, flush with the bottom (1px padding), in white with dark shadow.

## 17. Spelljammer Module (Design Document)

All spelljammer rules live in this chapter and in the spec at `.scratch/spelljammer-mod/spec.md`. Ships are **hero-like** entities: full actions, full movement, **no retaliation, no morale, no rout, no formation economy**. They never enter the ground-game 5-attack+retaliation cap — rate of fire is bounded by weapons × loading × crew.

### 17.1 Mode Toggle

- **Sub-turn toggle OFF** (default): normal QuiTTER. Spelljammers on a planetary map are **ground combatants** — big units on the shared map alongside troops, fought under normal rules with their own movement rules (§17.3) and no retaliation.
- **Sub-turn toggle ON**: a **space scenario**. All heroes are aboard ships (one or multiple per ship). The turn splits into **5 segments**; each hero gets **1 action per segment** (5 × 1 = their 5 full actions). Ship movement is decided **on the fly** each segment — no pre-plotted vectors.
- Land and space battles are played as **separate scenarios**; the game never simulates parallel fronts. The war is wherever the heroes are.

### 17.2 Segment Economy

- One game turn = 5 segments (each = one D&D round of the merged turn).
- Each hero takes **1 action per segment**: *personal* (fight, cast, move on deck) or *station duty* (Helm, Weapons, Repairs, Engineering, Sails, Rudder, Bridge).
- **Undo/redo are per-action within a segment**; segment boundaries only pace ship movement and reload counters.
- Reload/repair counters tick at **segment end** (space) / **turn end** (planet map).
- Some duties are **full-turn long** (repair, engineering speed boost): the hero commits for all 5 segments.

### 17.3 Ship Movement

- A ship occupies a **single core hex** for movement/distance/collision; bow/stern art may overhang but tactics use the core hex.
- **Speed state**: current speed (hexes per segment-action). A **Helm action** moves the ship up to its current speed in hexes along its facing.
- **Propulsion Surplus = Thrust Points − Mass** governs speed-step changes per Helm action: light vessels multi-step jumps (+3/action), heavy vessels +0.5–1 step/action.
- **Universal speed cap**: Speed 10 (Speed 12 via Overthrust), independent of class.
- **Mandatory straight movement**: between consecutive 60° turns the ship must move `current speed / 3` straight hexes. Turning reuses the existing vertex-facing rules (no MP charge — the speed commitment replaces it).

### 17.4 Stations & Crew

- **Stations** (each a subsystem with units): **Sails** (speed boost), **Rudder** (turning boost), **Weapons** (firing), **Helm** (helmsman), **Bridge** (Captain's commands), **Engineering** (repair / speed-boost duty).
- A hero mans a station by spending their segment action. **Crew reserve**: players assign NPC crew from a shared per-ship pool to automate loading (e.g. crew loads a ballista over 3 segments → "ballista ready" reminder message).
- **Firing a loaded weapon requires an active command action** (PC or NPC officer). Ready weapons show a **firing-arc fan overlay**.

### 17.5 Damage & Destruction

- **Ship HP** = ship integrity pool, class-determined, **independent** of station HP. At 0 the ship is destroyed **regardless of remaining station HP**.
- **Subsystem units**: every subsystem (Sails, Rudder, Weapons, Hull Core, …) is built from *units*, each with **its own HP**. At 0 a unit is **removed from the component list** and ship performance is **recalculated** (lost Sail = −1 propulsion, lost Rudder = −1 turning, lost weapon unit = weapon gone, lost Hull Core unit = −Ship HP max).
- **Hit selection**: a hit picks a component **uniformly at random from the alive component list** (6 Sails units → 60% of hits). Not spread — the same component can be hit repeatedly; destroyed components are never hit.
- **Double-wound**: every hit damages the struck subsystem unit's HP **and** Ship HP by the same amount → ships die well before their stations.
- **Ship-wide damage threshold** (one per ship, not per station): a hit **exceeding** it spills the same damage to the **hero manning the struck station** (hero HP). Under-threshold hits are absorbed. Unstationed heroes take no spill.
- **Crits**: attacker chooses a **targeted subsystem strike** (explicit subsystem; Helm and Bridge are protected) or **random double damage** (proportional table ×2).
- **Ship destroyed**: ship removed from the sim regardless of stations; heroes do **not** auto-die — if their HP survives, play continues in the D&D VTT (optional: a Helm eject action lifeboats heroes to an adjacent hex).

### 17.6 Captain's Command

- Captain (Bridge) manages crew efficiency via **Intelligence modifier** (baseline Int 16 / +3).
- **Positive** (+1/point above baseline): 1 extra **Command Action** per turn per point — **Reroll/Redo** (a PC redoes their last action, via the undo/redo system) or **Tactical Boost** (acceleration, tight turning, or an immediate extra weapon fire).
- **Negative** (−1/point below baseline): 1 random PC action **fails softly** per point — cancelled with a **red notification** ("order lost"); never a hard block or rolled failure.

### 17.7 Equipment Modifiers

- **Seasoned Crew**: station crew requirement ±20% (can reduce a weapon's crew by 1).
- **Well-Tuned Gears**: weapon reload −1 sub-turn.
- **Scheduled Maintenance**: rudder responsiveness +1 (min-straight hexes −1).
- **Pulley System / Enhanced Rigging**: Propulsion Surplus +1.

### 17.8 Access Capabilities (Archfar's Shipyard)

- `access_roles.can_view_ship_editor` / `can_use_ship_editor` (both **admin-only**, migration 059). `user_has_access('view_ship_editor' | 'use_ship_editor')` extended accordingly.
- **Archfar's Shipyard** button in the Lobby (visible with `canViewShipEditor`) — placeholder modal in v1; the builder itself is future work gated by `canUseShipEditor`.

### 17.9 Future Implementation Map

All spelljammer rules live in dedicated modules (see spec): `src/lib/shipMoveCost.ts`, `src/lib/shipCombat.ts`, `src/lib/shipStats.ts`, `src/types/ship.ts` + `shipMappers.ts`, `src/hooks/useShipEngine.ts`, `src/components/ScenarioMap/ShipPanel.tsx`, `src/components/Shipyard/`; planned tables `ships`, `ship_subsystems`, `ship_weapons`, `ship_crew`, `ship_stations`. The random component pick rides the command log so undo restores the identical outcome.

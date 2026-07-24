# QuiTTER – Complete Technical Handover Document

## 1. Project Overview
**Project Name:** QuiTTER (Quick Terrestrial Tactical Encounter Rules)
**Purpose:** A digital tabletop wargame / tactical RPG designed to complement D&D 5e, providing a simple yet historically- and logically-grounded mass combat system for DMs and their players.
**Target Audience:** D&D DMs and players (expected ~50 users max). The system is designed to be intuitive for anyone familiar with D&D 5e, with special focus on tactical positioning, morale, and formation-based combat.
**Current Phase:** Unit Editor is complete. Scenario Mode (ScenarioMap with token movement and game logic) is the next major milestone.

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
| Tight line | ×1.0 | +1 | +1 | Standard |
| Loose Line | ×1.0 | 0 | 0 | No bonuses or penalties |
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

### 4.4 Lookup Tables (armors, formations, unit_types)
Standard lookup tables with:
- id (UUID)
- name (TEXT)
- ac_bonus / movement_penalty / cost_gp (numeric)
- icon_url (TEXT, optional)

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
| is_shielded | BOOLEAN | Shield equipped (+2 AC) |
| base_ac | INTEGER | Natural AC from race |
| baseline_ac | INTEGER | AC after equipment adjustments (enters battle with this) |
| weapon_string | JSON | JSON array of Weapon objects |
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

### 4.8 units – Instance Table (Battlefield State)
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
| updated_at | TIMESTAMPTZ | Timestamp |

## 5. File Structure
```
src/
├── app/
│   ├── layout.tsx                    # Root layout with MessageProvider
│   └── page.tsx                      # Home page (Lobby → ScenarioMap)
│
├── components/
│   ├── Lobby.tsx                     # Scenario management
│   ├── UnitEditor.tsx                # Unit template editor (complete)
│   ├── Toast.tsx                     # Toast notifications
│   │
│   ├── ScenarioMap/                  # Scenario map components
│   │   ├── ScenarioMap.tsx           # Main map component
│   │   ├── LeftPanel.tsx             # Floating left panel with collapsible sections
│   │   ├── UnitSelector.tsx          # Searchable template list with drag
│   │   ├── MessagesPanel.tsx         # Game log with auto-scroll
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
├── contexts/
│   └── MessageContext.tsx            # Message bus for game log
│
├── hooks/
│   ├── useHexGrid.ts                 # Hex grid rendering + mouse interactions
│   ├── useSupabaseSync.ts            # Unit state management with Realtime sync
│   └── useScenarios.ts               # Scenario CRUD + presence
│
├── lib/
│   ├── supabaseClient.ts             # Supabase client setup
│   ├── weaponParser.ts               # Weapon JSON serialization/deserialization
│   └── templateMappers.ts            # Shared UnitTemplate ↔ Database mappers
│
├── types/
│   └── gameProtocol.ts               # Unit, Hex, Scenario, UnitTemplate types
│
└── workers/
    └── gameWorker.ts                 # Web Worker skeleton (not yet used)
```

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
- Hero Rendering: Custom image centered in top 2/3, HP bar (`currentUnitHp / maxUnitHp`, left 75%) + HP numbers (right 25%), name at bottom edge.
- Icon Priority: custom_image_url overrides race_icon_url.
- Name Placement: Unit name (`unitName`) sits flush with the bottom edge (1px padding) under the morale hearts.

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
- Floating Left Panel: Positioned under top bar, contains:
  - Unit Selector (collapsible) – Searchable list of templates with drag-to-place.
  - Messages Panel (collapsible) – Real-time game log with scroll.
- Canvas: Full map area with hex grid and tokens.
- Debug Panel: Lower-right corner (hover coords, selected hex, unit count).

**Panel Behavior:**
- Both sections independently collapsible (▶/▼ toggle).
- When one section collapses, the other expands to fill available space.
- When both collapsed, panel shrinks to minimal width (~48px) showing only toggle icons.

**Map Interaction:**
- Left-click: Select hex.
- Left-click + drag on unit: Move unit (if target empty) or attack (if target occupied).
- Middle-click + drag: Pan map.
- Right-click on unit: Context menu.
- Scroll wheel: Zoom (centered on mouse position).

**Context Menu:**
- Rotate Left/Right: Changes unit facing.
- Formations: Only shows formations available in formation_availability.
- Weapons: Lists all weapons from weapon_string.
- Team Assignment (GM only): Any of 6 teams.
- Hide/Unhide (GM only): Toggle visibility.
- Delete Unit (GM only): Remove unit with confirmation.

**Token Placement:**
- Drag template from Unit Selector panel onto map hex.
- Default team: 'black' (DM/monster side).
- Default formation: 'Loose' if available, otherwise 'Scattered'.

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
if (template.formation_availability?.includes('Loose')) {
  defaultFormation = 'Loose';
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
- addMessage(msg: string) – Append message to log.
- clearMessages() – Clear all messages.
- Messages automatically scroll to bottom.

### 6.8 Shared Mappers (src/lib/templateMappers.ts)
**Purpose:** Centralized conversion between database rows and TypeScript UnitTemplate objects.
**Functions:**
- `mapTemplate(row: any): UnitTemplate` – Converts snake_case database row to camelCase TypeScript object.
- `mapTemplateToRow(template: UnitTemplate)` – Converts camelCase TypeScript object to snake_case database row.
- Usage: Shared between UnitEditor and UnitSelector to ensure consistent field mapping.

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

### 7.2 Combat Resolution
1. Attack: Roll AGR to attack. Fail = Brace.
2. Damage: Resolve melee damage.
3. Retaliation: If attacker is in target's kill zone or flank:
   - Defender retaliates (100% if kill zone, 50% if flank) if they have Reach and attacker doesn't.
   - Else, attacker strikes first, then defender retaliates.
4. Rear Attack: Attacker resolves damage. The defender does not retaliate.
5. Threat Calculation: Total Threat = sum of all attacker's position bonuses + attacker's level bonus + defender's wounds (reduced current MOR) + defender's isolation penalty.
6. Morale Check: If Threat ≥ Morale Capacity → Rout instantly.

### 7.3 Aggressiveness (AGR)
- Roll d10 at start of turn.
- To attack: roll ≤ AGR.
- Failure: Hesitate (cannot attack, but Brace for +1 AC).
- Level Modifier: Higher-level enemies shake attacker's nerves; modifier = floor(Defender Level ÷ Attacker Level) - 1.
  - Higher Attacker: +1 bonus (look down at target).
  - Defender equal or less than double Attacker level: 0 penalty (fair fight).
  - Defender equal or more than double Attacker level: +[# of times] penalty (intimidated).
- Minimum: AGR = 1.

### 7.4 Morale Capacity (MOR) & Threat
**Threat Sources:**
| Source | Threat |
|--------|--------|
| Front/Side Contact | 1 |
| Rear Contact | 2 |
| Level Bonus | +0 (1-4), +1 (5-9), +2 (10-14), +3 (15-19), +4 (20+) |
| Wounds | -1 MOR per 10% HP lost |
| Isolation | -1 MOR if not adjacent to friendly unit |

**Breaking Point:**
- Threat ≥ current MOR → unit breaks instantly.
- Drops to Scattered formation.
- Moves 1 hex away from the biggest threat.
- One movement per turn.

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

### 7.7 Undo + Game Log
- Undo: Snapshot of entire game state before each action.
- Game Log: Text box in Messages Panel logging all events.

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

## 9. Web Worker Protocol
All communication follows `{ type, payload }` format.

**Example Messages:**
```
{ type: 'MOVE_UNIT', payload: { unitId: 'abc123', targetHex: { q: 5, r: 3, s: -8 } } }
{ type: 'ATTACK', payload: { attackerId: 'abc123', targetId: 'xyz789' } }
{ type: 'LOCK_UNIT', payload: { unitId: 'abc123', lockedBy: 'user-google-id' } }
{ type: 'UNDO', payload: {} }
```

**Worker Response:**
```
{ type: 'STATE_UPDATED', payload: { ... } }
{ type: 'ERROR', error: '...' }
```

## 10. Data Safety Philosophy
- Wrap all Web Worker calculations in try...catch – never crash the UI.
- Use Supabase upsert to avoid primary-key conflicts.
- Autosave full game state to IndexedDB before any Worker processes a turn.
- On page load, restore from IndexedDB if available.

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
- Token Placement (drag from Unit Selector panel, default team: black, default formation: Loose/Scattered)
- Shared Mappers (templateMappers.ts for consistent UnitTemplate mapping)
- Database Schema Refactor (renamed fields, new fields, consistent naming across UnitTemplate and Unit)
- Pure mouse-tracking drag: Unit selector drag replaced native HTML5 `draggable` with custom `mousedown`/`mousemove`/`mouseup` matching existing token move pattern in `useHexGrid`
- Unit field alignment: `troopCount` → `currentTroopCount`, `currentMorale` → `currentMoraleModifier`, `armorId` removed from `Unit` interface and all mappers
- TypeScript type cleanup: lookup table types (`Armor`, `Race`, `UnitType`, `Mount`) switched to snake_case matching Supabase columns; `Weapon.is_reach` replaces `reach`; `notes` removed from `Weapon` and `WeaponLookup`
- Morale heart display: boosted morale (base+modifier > base) shows gold hearts; `drawHeart` accepts optional `fillColor` string instead of `filled: boolean`; `drawBottomInfo` uses `(baseMorale, moraleModifier)` signature
- Token rendering improvements: Shield Wall shields use `ctx.ellipse` with separate X/Y radii for wider flatter shape; troop count `??` fallback so zero troops shows zero dots
- Morale test slider in UnitEditor changed from percentage to modifier range `[-baseMorale, 10-baseMorale]`
- Zero TypeScript errors outside pre-existing `next.config.ts`

### 14.2 What's Next
- Combat Resolution (AGR check, damage, Threat, routing, pursuit)
- Role Permissions (enforce RBAC in UI)
- Formation Changes (on-the-fly via context menu)
- Facing & Kill Zone (visual feedback)
- Unit Locking (soft lock via Supabase Realtime)
- Undo & Game Log (snapshots, events)
- Hex Grid Extensibility (auto-expand)
- Map Editor (button exists, not implemented)
- Web Worker (skeleton only, not integrated)
- Mobile Responsiveness (not a priority)
- Troop count soft caps per size category (Medium 80, Large 20, Huge 6 – enforcement style pending)

### 14.3 Known Gaps
- Map Editor: Button exists but does nothing.
- Web Worker: Skeleton only; not integrated.
- Mobile Responsiveness: Not a priority.
- TokenRenderer flickering: Can be optimized with debounce.

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
if (template.formation_availability?.includes('Loose')) {
  defaultFormation = 'Loose';
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
  3.4.3 Default formation: Loose (or Scattered if unavailable)
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
- The top ⅔ background is a lighter hue of its team color.
- Team Colors: Blue (#0072B2), Yellow (#F0E442), Violet (#CC79A7), Black (#333333), Orange (#D55E00), Green (#009E73).
- Chosen for colorblind-friendliness (red-green safe).

### Team Shape Overlay
- A grey team shape overlay appears on top of the background.
- Team Shapes: Circle, Triangle, Star, Square, Diamond, Cross.
- For heroes, the shape is shifted to the left (30% offset) so it peeks out from behind the hero image.

### Unit Token Variations

#### 1. Army Unit (Foot)
Each troop is displayed as a dot. Display Dot Size = baseDotSize × sizeCategory × visualScale.
Each row (rank) of dots aligns to the center.
Casualties are represented as hollow dots (circles) of the same size.

| Formation | Medium (100%) | Large (200%) | Huge (300%) |
|-----------|--------------|-------------|-------------|
| Loose | 10 / 8 | 5 / 4 | 3 / 2 |
| Tight | 20 / 4 | 10 / 2 | 6 / 1 |
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
- Left 25%: Racial portrait or custom image.
- Right 25%: Unit type image (showing primary weapon or unit type icon).
- Middle 50%: Up to 10 hearts representing morale capacity, arranged in 2 rows of 5 when >5 hearts.
  - Hearts are centered horizontally and vertically within the middle 50%.
  - `totalHearts = min(10, max(baseMorale, effectiveMorale))` to leave room for boosted hearts.
  - Effective morale = `baseMorale + currentMoraleModifier`.
  - Hearts up to `baseMorale` are filled. Hearts from `baseMorale+1` to `effectiveMorale` are filled in gold (boosted).
  - Remaining hearts are hollow (reduced morale).
  - Drawn via `drawHeart(ctx, x, y, size, fillColor?)` — accepts optional `fillColor` string (defaults to team color, gold for boosted).
- Shield Wall formation: shields drawn behind front-row dots using `ctx.ellipse` with separate X/Y radii for a wider, flatter shape.
- Unit Name (`unitName`): Along the lower edge of the token, flush with the bottom (1px padding).

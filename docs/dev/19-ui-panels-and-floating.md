# 19 — Left-panel tabs & floating UI (tooltips / menus)

How the floating left panel is assembled and — importantly — **how any tooltip
or pop-up menu must be rendered** so it is bound to the browser viewport, not to
a panel's frame. Follow this when adding a new left-panel tab or any hover
tooltip / context menu.

Key files: `src/components/ScenarioMap/LeftPanel.tsx`,
`PanelsContainer.tsx`, `PanelSection.tsx`, `Floating.tsx`,
`useTooltipClamp.ts`, `UnitEditorModal.tsx`.

## 1. Left-panel tab standard

`LeftPanel.tsx` is the single registry of tabs. Each tab is a `PanelDef`:

```ts
interface PanelDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  requiresGM: boolean;
  content: React.ReactNode;
}
```

- The `panels[]` array (`LeftPanel.tsx`) lists every tab; `visiblePanels`
  filters by role (`requiresGM`, and the Effects tab's `canUseEffects`).
- `PanelsContainer` renders the tab bar and the **open** tabs' content, each
  wrapped in a `PanelSection` (`flex-1 min-h-0 overflow-y-auto`). A tab's
  component only supplies its body — it does not own the scroll container.
- Open/closed tab state persists per scenario+user in
  `localStorage['leftPanelOpen:<scenarioId>:<playerId>']`.

**To add a tab:** add one `PanelDef` to `panels[]` (id, label, icon,
`requiresGM`, and a `content` component). Do not add bespoke chrome, scroll
containers, or positioning — those are owned by `PanelsContainer`/
`PanelSection`. If the tab needs tooltips or menus, follow §2.

## 2. Floating UI standard (the one rule)

**Render every tooltip and pop-up menu through `Floating`** (`Floating.tsx`).
It portals to `document.body` and positions with `position: fixed`, so it is
always clamped to the **browser** viewport. It owns portal + measured clamp +
z-index; callers supply only the visual `className` and content.

```tsx
<Floating x={clientX} y={clientY}>{/* tooltip body */}</Floating>
<Floating x={clientX} y={clientY} z={250} interactive className="…menu…">…</Floating>
```

Props: `x`, `y` (viewport coords), `offset` (default 12), `z`, `interactive`
(`true` for menus that take clicks; `false`/omitted for hover tooltips), and
`className` (background/border/padding/width only).

**The single positioning rule** (context menus included — there is no separate
behavior): the panel opens at `anchor + offset`, and slides up/left **only as far
as needed** so its bottom/right edge stays inside the viewport
(`innerHeight/Width − size − 8`). It **never flips above the anchor** — a tall
menu near the bottom just bottom-aligns; it is not thrown to the top.

### Why a portal (the trap to avoid)

`PanelsContainer`'s root has **`backdrop-blur-sm`**. A `backdrop-filter` creates
a **containing block for `position: fixed` descendants** — so a `fixed` tooltip
inside the panel is secretly re-anchored to the panel and clipped by its
`overflow-hidden`. `absolute` is worse (clipped by the nearest positioned
ancestor). Portaling to `document.body` removes the panel from the element's
ancestry, so `fixed` is genuinely viewport-relative. **Never** render a floating
tooltip/menu as a plain child of a tab.

### Rules

1. Use `Floating`; do **not** hand-roll `Math.min(x, window.innerWidth - …)` or
   hard-code element sizes — `useFloatingPosition` measures the real
   `offsetWidth/offsetHeight`.
2. Pass **viewport (client) coordinates**. Map-canvas hover handlers already pass
   `e.clientX/e.clientY` (`useHexGrid`), not canvas-local offsets.
3. Tooltips: omit `interactive`. Menus / context menus: set `interactive`.
4. Don't put `fixed`/`z-*`/`pointer-events-*` in `className` — `Floating` adds
   them (use `z` prop for stacking). Don't add flip/clamp logic of your own; the
   shared rule already keeps the bottom/right edge on-screen.
5. A menu that needs outside-click detection (e.g. `data-msg-menu`) puts the
   attribute on an inner wrapper **inside** `Floating`; `closest()` still walks
   up through the menu contents.

### Current floating consumers (all use `Floating`)

| UI | `z` | interactive |
|---|---|---|
| `UnitTooltip` (map unit) | 200 | no |
| `MapInfoTooltip` (hex/edge) | 200 | no |
| `UnitTemplateTooltip` (Unit Selector tab) | 200 | no |
| `ShipTemplateTooltip` (ship pickers) | 200 | no |
| `StructureTooltip` (Structure tab) | 200 | no |
| `EffectTooltip` (Effects tab) | 200 | no |
| `StatValueHint` | 200 | no |
| `ContextMenu` (unit right-click) | 250 | yes |
| `ShipContextMenu` (ship right-click) | 250 | yes |
| `TeamContextMenu` (boarded hero) | 250 | yes |
| `ShipWindow` card/slot menu | 250 | yes |
| `MessagesPanel` menu | 200 | yes |

Every context menu (existing or new) opens at the pointer and bottom-aligns when
it would overflow — no flip, no per-menu clamp. Register it in this table.

### Layer table (one stacking order)

The ship window is a **non-modal** `DraggablePanel`, so everything interactive
must be able to draw above it. Never pick an ad-hoc `z`; use this table:

| Layer | `z` | Examples |
|---|---:|---|
| Ship window | 100 | `ShipWindow` (`DraggablePanel z={100}`) |
| Other draggable panels | 120 | speed declaration (`DraggablePanel` default) |
| Dry dock window | 150 | `DryDockWindow` (`DraggablePanel`, resizable, per-client size) |
| Tooltips / popovers / banners | 200 | unit + hex tooltips, `StatValueHint`, red error banner, reaction toolbar, messages popover |
| Context menus | 250 | `ContextMenu`, `ShipContextMenu`, `TeamContextMenu`, ship-window card menu |
| Menu backdrops | 240 | the transparent full-screen click-catcher under the zone/effects menu |
| Modal overlays | 260 | unit editor, effects, confirmations, free placement, magic cast, siege, stats, ship confirms, cargo/crew dialogs, Ship Editor clone/delete |
| Nested pickers | 300 | image picker and its preview |
| Full-screen blockers | 400 | kicked-from-scenario |

The dry dock is a **window** (`DraggablePanel`) at **z 150**, above the ship
window and other panels but below tooltips/menus so the editor's own tooltips
stay readable. It is not a full-screen blocker; the table is paused by
`dry_dock_open`, not by an overlay. `DraggablePanel` also takes `closeLabel`,
`bodyClassName` and `initialSize`; a stored size is clamped to the current
viewport on load and on window resize, so each client can resize independently
without overflowing a smaller screen. Resizable panels have **two** lower
handles: bottom-right (grows right/down) and bottom-left (right edge fixed,
grows left/down).

**Rule:** a context menu must sit above every panel, and every modal must sit
above the ship window. Add new UI at 150 / 200 / 250 / 260 / 400 rather than
inventing another value.

## 3. Tooltip lifecycle (the other one rule)

A hover tooltip is shown **only on idle hover** and must never linger over a
drag or another window:

- It is driven by **hover events alone** (`onUnitHover`/`onUnitLeave`,
  `onHexHover`/`onEdgeHover`/… in `useHexGrid`). `useHexGrid`'s target filter
  (`structure` mode skips every unit) and a unit drag suppress unit hover.
- Every suppression point funnels through one clear: `ScenarioMap`'s
  `dismissTooltips()` (clears the unit + hex/edge tooltips). It is called on
  **mouse-leave**, whenever a **modal opens**, and from global **`keydown`** and
  **`pointerdown`** listeners — so any key press or mouse-down drops the tooltip.
  **Exception:** the five target-filter modifiers (**Shift**, **Space**, **1**,
  **2**, **3**) are skipped — they gate hovering/aiming, so their per-mode tooltip
  must stay (or re-show) while held.
- In short: **idle hover shows; any key, pointer-down, drag, or open modal
  dismisses — except the target-filter modifiers.** Add new tooltips under this
  rule rather than bespoke timers.

## 4. Draggable modals

The unit editor (`UnitEditorModal.tsx`) is a draggable `position: absolute`
panel inside a full-screen overlay. Its position must be **clamped using the
modal's measured size** on mount, on every drag move, and on window resize
(`clampPos` + `useLayoutEffect`), so it can never be dragged off-screen. Keep
`max-h-[92vh]` with an inner `overflow-y-auto` for tall content. Do not center
with a hard-coded height.

## 5. Scenario toasts

Transient, non-anchored notifications use the shared `Toast` component
(`src/components/Toast.tsx`) via `src/hooks/useScenarioToast.ts` (per-scenario
broadcast `toasts:{scenarioId}`, event `scenario-toast`). It is a **fixed**
panel at the **bottom-centre of the map** (`bottom-20`, above the reaction
toolbar) so it never covers the top bar, and it stays until dismissed with its
**×** button or replaced by the next toast — there is no auto-hide timer. Use
this path for table-wide notices; use `addMessage` for routine confirmations that
belong in the Messages log. This path is reserved for the **Halloween Siege
completion** notice; every normal ship/action confirmation goes to Messages.

The top bar reports its rendered height (`TopBar` `onHeightChange` +
`ResizeObserver`); `ScenarioMap` positions the left panel at
`topBarHeight + 8`, so the panel drops automatically when narrow screens wrap
the bar buttons instead of being covered.

## Invariants / gotchas

- **Every saveable library editor uses the shared unsaved-changes guard.**
  `useUnsavedChanges` + `UnsavedChangesModal` own the dirty prompt and
  `beforeunload`; selection/tab/New/Clone/Main Menu go through `requestAction`,
  and Save takes the pending action only after a successful save. Applies to
  Ship Editor, Unit Editor, Component Workshop (components/weapons/armors),
  Structure Editor, Effect Editor and Weapon Editor. `MapEditor` autosaves and
  therefore has no dirty prompt.
- **Never `scrollIntoView` from a panel/overlay list.** It walks every scrollable
  ancestor, including the document, and can scroll the map top bar out of view.
  Scroll the owning container directly (`el.scrollTo({ top: el.scrollHeight })`
  or an offset inside it) instead. This applies to `MessagesPanel`,
  `UndoDebugPanel`, and the Halloween Siege wave list.
- Panel/tab content is clipped by `PanelsContainer` (`overflow-hidden`) — any
  non-`Floating` pop-up inside it WILL be cropped.
- The map root (`ScenarioMap`) is `relative w-full h-screen overflow-hidden` at
  the viewport origin, so viewport coords == map coords today; `Floating` keeps
  that true even if that ever changes.

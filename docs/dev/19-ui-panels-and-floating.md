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
<Floating x={clientX} y={clientY} z={80}>{/* tooltip body */}</Floating>
<Floating x={clientX} y={clientY} z={50} interactive className="…menu…">…</Floating>
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
| `UnitTooltip` (map unit) | 50 | no |
| `MapInfoTooltip` (hex/edge) | 50 | no |
| `UnitTemplateTooltip` (Unit Selector tab) | 50 | no |
| `StructureTooltip` (Structure tab) | 80 | no |
| `EffectTooltip` (Effects tab) | 80 | no |
| `ContextMenu` (unit right-click) | 50 | yes |
| `MessagesPanel` menu | 100 | yes |

Every context menu (existing or new) opens at the pointer and bottom-aligns when
it would overflow — no flip, no per-menu clamp. Register it in this table.

## 3. Draggable modals

The unit editor (`UnitEditorModal.tsx`) is a draggable `position: absolute`
panel inside a full-screen overlay. Its position must be **clamped using the
modal's measured size** on mount, on every drag move, and on window resize
(`clampPos` + `useLayoutEffect`), so it can never be dragged off-screen. Keep
`max-h-[92vh]` with an inner `overflow-y-auto` for tall content. Do not center
with a hard-coded height.

## Invariants / gotchas

- Panel/tab content is clipped by `PanelsContainer` (`overflow-hidden`) — any
  non-`Floating` pop-up inside it WILL be cropped.
- The map root (`ScenarioMap`) is `relative w-full h-screen overflow-hidden` at
  the viewport origin, so viewport coords == map coords today; `Floating` keeps
  that true even if that ever changes.

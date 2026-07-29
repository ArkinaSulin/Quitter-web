Status: ready-for-agent

# Token Rotation & Image Sync

## Problem Statement

The canvas token renderer has two synchronous-structure bugs that cause visual corruption when units have a `facing` rotation applied:

1. **Race/weapon icons don't rotate**: The `drawBottomInfo` helper uses fire-and-forget `.then()` callbacks on `loadImage()` to draw race and weapon icons. These callbacks fire asynchronously — after the `finally { ctx.restore(); }` block has already run — so the rotation transform is gone by the time the image renders. The icon appears unrotated inside a rotated token.

2. **Rotation transform leaks to adjacent units**: The `customDraw` loop that iterates over all units and calls `drawToken()` for each does **not** `await` the returned promise. When a hero unit's image isn't cached, `drawToken` hits `await loadImage(imageUrl)` inside the rotation scope and yields execution. The `for` loop immediately starts the next unit's `drawToken`, which calls `ctx.save()` while the first unit's rotation transform is still on the canvas. That save captures the leaked rotation, so the second unit renders rotated even if it has no facing of its own. With multiple heroes, the interleaving of async image loads produces chaotic visual results — some elements of one hero drawn over another, some not rotated, some missing entirely.

Both bugs share the same root cause: **async operations inside a canvas transform scope that must be synchronous to be reliable**. The `ctx.save()` / `ctx.restore()` pair that brackets the rotation can only isolate the transform if every draw call inside the `try` block — including image loads — completes synchronously before the `finally` clause runs.

## Solution

1. **Move all `await` outside the rotation scope** — Hero image loading happens before `ctx.save()`. The image is preloaded into a local variable and consumed synchronously inside the rotation scope. Zero `await` calls remain inside the `try` block.

2. **Remove all fire-and-forget `.then()` callbacks from icon drawing** — Replace the async callback pattern with synchronous cache-then-fallback drawing. Images cached in the module-level `imageCache` are drawn immediately via `ctx.drawImage()`. Uncached images draw a fallback rectangle synchronously and fire a cache-warming `loadImage()` call whose result is ignored — the image will render on the next canvas redraw when it's found in the cache.

3. **Make the draw loop sequential** — The `customDraw` callback `await`s each `drawToken` call so one unit's rotation scope is fully entered and exited before the next unit begins.

4. **Preload all images before the screenshot path** — The screenshot capture loop collects every unique image URL across all units, fires `Promise.all(loadImage(url))` to warm the cache, then runs the draw loop. Every image is found synchronously in the cache, producing a complete screenshot on the first render.

## User Stories

1. As a GM, I want the race icon and weapon-type icon on a rotated unit's token to rotate with the rest of the token, so that the entire token appears as one coherent rotated element.
2. As a GM, I want rotating one unit to have no visual effect on any other unit on the map, so that each token is rendered independently.
3. As a GM, I want placing two hero units with uncached images to render both correctly on the first frame, so that heroes don't appear corrupted or share visual elements.
4. As a developer, I want the `customDraw` loop to complete one token entirely before starting the next, so that canvas state (transforms, clip regions) is predictable between units.
5. As a developer, I want all `await` calls to happen before any `ctx.save()`, so that `ctx.restore()` in a `finally` block can reliably undo whatever transform was applied in the `try` block.
6. As a developer, I want no `.then()` callbacks writing to the canvas, so that no canvas renders happen outside the intended draw scope.
7. As a developer, I want the screenshot capture path to render all images on the first pass, so that screenshot quality doesn't degrade on the first capture of a session.
8. As a GM, I want uncached race/weapon icons to appear as a fallback rectangle (not missing or broken) until they load, so that the token is always readable.

## Implementation Decisions

### Image loading moved before transform scope

`drawToken` preloads the hero image at the top of the function, before `ctx.save()` is called. It checks (in order): `preloadedImages`, module-level `imageCache`, then `await loadImage()`. The loaded image is stored in a local `heroImage` variable. Inside the `try` block, the hero path uses this variable synchronously — no `await`, no try/catch for image loading. Fallback rendering (gray rectangle with "?") occurs only if all three lookups fail.

A non-hero unit never hits `await loadImage()`, so `drawToken` executes entirely synchronously from `ctx.save()` to `ctx.restore()`.

### Synchronous fallback for bottom-info icons

`drawBottomInfo` checks `preloadedImages?.get(url) || imageCache.get(url)` for both the race/left icon and the weapon-type/right icon. If found, `ctx.drawImage()` fires synchronously. If not found, `loadImage(url).catch(() => {})` is called purely to warm the module cache for the next redraw, and a fallback rectangle is drawn synchronously in its place.

The `.then()` pattern is eliminated entirely — no callback in the codebase draws to the canvas after `drawToken` returns.

### Sequential draw loop

`customDraw` is an `async` function. Its `for...of` loop uses `await drawToken(...)` inside a try/catch per unit. The returned promise is not consumed by the grid component (its return value is ignored), but the sequential await within each invocation guarantees that `ctx.save()`→drawing→`ctx.restore()` for unit N completes before `ctx.save()` for unit N+1 begins.

This is the only change to `customDraw` — the token position calculation and option construction are unchanged.

### Screenshot image preloading

Before the unit draw loop in the screenshot capture function, a `Set<string>` collects all unique image URLs (`raceIconUrl`, `unitTypeIconUrl`, `customImageUrl`) from non-deleted units. `await Promise.all([...urls].map(url => loadImage(url).catch(() => {})))` warms the module-level `imageCache`. The subsequent `await drawToken(...)` loop finds every image in the cache and draws synchronously, producing a complete screenshot on the first attempt.

### Module-level image cache remains unchanged

The existing `imageCache` (`Map<string, HTMLImageElement>`) is retained as the sole caching mechanism. No new cache layer is introduced. The `loadImage` function is exported from the renderer module to enable screenshot preloading from the scenario map component. No circular dependency is introduced (the scenario map already imports `drawToken` from the same module).

## Testing Decisions

**Highest seam**: `drawToken` is a canvas-rendering function with a `CanvasRenderingContext2D` parameter — testing it requires either a canvas mock or a headless browser. Neither exists in the current test setup. The function is not easily unit-testable at the Vitest level.

**No new tests are proposed**. The existing 45 tests in `weaponParser`, `templateMappers`, and `tokenUtils` verify pure-function logic that this change does not touch. The `drawToken` function's behavior (rotation correctness, icon placement, async timing) would require visual regression or Playwright-style integration tests that are out of scope for the current testing infrastructure.

**Manual verification path**:
- Open scenario with units of different teams and facing values
- Rotate a normal unit: all elements (background, dots/arrows, icons, name) rotate together
- Place a hero with an uncached image: hero renders correctly on first frame
- Place a second hero while the first hero's image is still loading: both render independently, no cross-contamination
- Take a screenshot: all unit images appear on the first capture, no missing icons

## Out of Scope

- Image preloading on scenario load (the current approach warms cache on first miss; a proactive preloader is a performance optimization deferred to future work)
- Visual regression tests for canvas rendering
- Animation of rotation transitions (instant snap, no tweening)
- Rotation of the `drawTeamShape` overlay (it already rotates correctly — no change needed)
- The `TokenRenderer` component or any non-canvas rendering path
- Non-rotation transforms (scale, skew) on tokens
- `drawBottomInfo` icon animations or loading spinners

## Further Notes

- The `imageCache` map is exported as part of `loadImage`'s module scope but is not directly exposed to consumers. The `loadImage` function is now the public API for cache warming.
- The `customDraw` callback signature did not change — it is still `(ctx, width, height, zoom, offsetX, offsetY) => Promise<void>`. The grid component ignores the returned promise, which is fine — the sequential draw happens inside the async function regardless.
- Screenshot preloading adds a small latency before drawing begins (time to load all unique images). This is acceptable for a user-triggered capture action.
- The fix removes the only two `await` call sites inside the rotation scope: the hero image `await loadImage()` (moved before `ctx.save()`) and the `.then()` callbacks in `drawBottomInfo` (replaced with synchronous fallback). After this change, the `try` block contains zero `await` or Promise callback invocations.

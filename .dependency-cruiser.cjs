// @ts-check
// Deep-module enforcement for dependency-cruiser (adapted for this repo).
//
// Each package under src/packages is a DEEP MODULE: a package's public surface is
// its ENTRY POINTS (the files at the package root); implementation lives in
// subfolders (`lib/`) and is private; tests live in `tests/`.
//
// Adaptations from the stock config:
//   - `no-circular` is a WARNING, not an error: this game's rules are
//     cross-cutting (unitStats <-> unitMorale, settingsCache <-> units, …), so a
//     strictly acyclic package graph is not achievable without a major domain
//     re-modelling. Tracked as tech debt; the entry-point boundary is still hard.
//   - Tests ARE allowed to import their own package's `lib/` (relaxed rule 3), so
//     there is no strict `tests-through-entrypoints` rule; instead the
//     across-packages rule (which includes tests) forbids OTHER packages'
//     internals.

/** Where packages live. One immediate child dir per package (flat, no nesting). */
const PACKAGES_ROOT = 'src/packages';

const R = PACKAGES_ROOT;
/** A package's private internals: anything nested inside a package subfolder. */
const PACKAGE_INTERNALS = `^${R}/[^/]+/[^/]+/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'entrypoint-boundary-from-app',
      comment:
        "App/root code may import a package's entry points (its root files), but nothing inside its subfolders.",
      severity: 'error',
      from: { pathNot: `^${R}/` },
      to: { path: PACKAGE_INTERNALS },
    },
    {
      name: 'entrypoint-boundary-across-packages',
      comment:
        "A package's own files (and its tests) may reach its OWN lib freely, but OTHER packages only through their entry points — never their internals.",
      severity: 'error',
      from: { path: `^${R}/([^/]+)/` },
      to: { path: PACKAGE_INTERNALS, pathNot: `^${R}/$1/` },
    },
    {
      name: 'tests-folder-is-private',
      comment: 'A package tests/ folder is reachable only from tests — nothing else may import fixtures.',
      severity: 'error',
      from: { pathNot: `^${R}/[^/]+/tests/` },
      to: { path: `^${R}/[^/]+/tests/` },
    },
    {
      name: 'packages-must-not-depend-on-app',
      comment: 'Packages are the domain layer: they must never import app UI, components, hooks or contexts.',
      severity: 'error',
      from: { path: `^${R}/` },
      to: { path: '^(app|src/(components|hooks|contexts))/' },
    },
    {
      name: 'types-are-leaves',
      comment: 'src/types is a leaf: it may only import other files in src/types.',
      severity: 'error',
      from: { path: '^src/types/' },
      to: { pathNot: '^src/types/' },
    },
    {
      name: 'no-circular',
      comment:
        'WARN: cross-package cycles are currently tolerated (cross-cutting rules) — see the header comment.',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },

    // --- Layering (optional, off by default) ----------------------------------
    // Interface-hiding controls HOW you import (through the entry points).
    // Layering controls WHICH packages may depend on which. Add rules here, e.g.
    // { name: 'world-only-imported-by-app', from: { path: `^${R}/(combat|movement)/` }, to: { path: `^${R}/world/` } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // Count type-only imports too, so `types-are-leaves` and the boundaries see
    // `import type { … }`/type-only value imports (e.g. a type file reaching a package).
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
  },
};

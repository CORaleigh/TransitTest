# Frontend Development Conventions (React + TypeScript)

This document codifies the architecture pattern used in iMAPS so it can be applied
consistently across other React + TypeScript efforts. It is stack-specific (React 18/19,
TypeScript, Vite) but the principles generalize. Copy this file into new repos and adapt
the examples.

---

## 1. The core rule: one feature = one folder of three files

Every feature (a panel, a tool, a screen, a widget) is a **self-contained folder** split
along one axis — **presentation vs. logic vs. styling**:

```
components/tools/Print/
  index.tsx          # VIEW  — JSX only: markup, wiring props, rendering state
  usePrint.ts        # LOGIC — state, effects, side effects, external SDK/API calls
  Print.module.css   # STYLE — scoped CSS Modules (locally-hashed class names)
```

**Rules:**
- `index.tsx` stays thin and declarative. If it contains a `useEffect`, a data fetch, or
  imperative SDK calls, that code belongs in the hook.
- All imperative and stateful work lives in `use<Feature>.ts`. The hook returns a plain
  object of values + handlers the view renders.
- Styles are always CSS Modules (`*.module.css`), never global class names, never inline
  style objects for anything reusable.
- Folder name = feature name, PascalCase. Hook = `use` + feature name. The view file is
  always `index.tsx` so imports are `import Print from "components/tools/Print"`.

**Why:** the view/logic split makes logic unit-testable without rendering, keeps components
readable, and makes every feature look identical to the next — a new contributor learns the
shape once.

---

## 2. Directory layout

Group by **role**, then by **feature**:

```
src/
  main.tsx                 # bootstrap: mount root, wrap in providers
  App.tsx                  # top-level composition
  context/                 # global state (providers, hooks, types)
  components/
    Shell/                 # app shell / layout host
    panels/                # major feature surfaces
    tools/                 # discrete tools (each a feature folder)
  utils/                   # framework-agnostic helpers + service singletons
  assets/                  # static imports (svg, images)
```

- `panels/` and `tools/` (or your domain equivalents) hold feature folders.
- `utils/` holds pure helpers AND service singletons (see §4).
- Keep the tree shallow. A feature with sub-pieces nests them (`Sketch/symbols/...`), but
  don't build deep hierarchies for their own sake.

---

## 3. State: one global Context, feature state stays local

- **Global/shared state** lives in a single React Context provider (`context/`), exposed
  through one consumer hook (e.g. `useMap()` / `useApp()`). Keep it to genuinely shared
  concerns — the ~15–20 values multiple features need.
- **Feature-local state** stays inside that feature's `use<Feature>` hook. Do not promote
  state to the global context just because it's convenient.
- No Redux/Zustand/MobX by default. Reach for a state library only when the single context
  causes real re-render pain or the shared state graph outgrows one provider.
- The context file set: `Provider.tsx` (logic), `Context.tsx` (createContext),
  `Context.types.ts` (the shape), `use<Name>.ts` (the consumer hook).

> **Watch-out:** a single context re-renders all consumers on any change. If a hot value
> (e.g. mouse coords) changes often, split it into its own context rather than bloating the
> main one.

---

## 4. Isolate imperative / third-party work in a service layer

Non-React imperative logic — SDK objects, heavy algorithms, persistence — goes into a
**service singleton** in `utils/`, not into components or hooks:

```ts
// utils/layerService.ts
class LayerService { /* build, persist, reorder ... */ }
export const layerService = new LayerService();
```

Hooks call the service; the service knows nothing about React. This keeps the gnarly,
stateful, side-effecting code in one testable place and out of the render path.

---

## 5. Config-driven, not hard-coded

- Read runtime configuration from fetched JSON / env, parameterized by URL params or build
  config — never compile environment specifics into components.
- One helper owns config loading; every call site reuses it (don't copy-paste the
  fetch idiom). This enables multi-tenant / multi-environment variants off one build.

---

## 6. Performance & delivery defaults

- **Lazy-load** large or secondary features with `React.lazy` + `Suspense` so each is its
  own chunk. The shell renders a fallback while a panel loads.
- Prefer composition and small components over prop-drilling; use the context for
  genuinely cross-cutting values.
- Keep bundles honest: declare every runtime dependency you import directly in
  `package.json` (don't rely on transitive/peer resolution), and remove unused deps.

---

## 7. Non-negotiables the iMAPS codebase was missing — build these in from day one

These are gaps observed in the source pattern. Bake them into the convention so new efforts
don't inherit them:

### 7a. Testing is part of the feature folder
A feature isn't done without a test file. Add Vitest + `@testing-library/react`:

```
components/tools/Print/
  index.tsx
  usePrint.ts
  usePrint.test.ts      # <- required for non-trivial logic
  Print.module.css
```

Prioritize pure logic (hooks, services, helpers) — they test without a live SDK/DOM.

### 7b. Error handling is a convention, not an afterthought
- Wrap every `await fetch(...)` / `res.json()` on a critical path in try/catch.
- Surface failures through a shared, user-visible mechanism (an app-level alert/toast),
  never a bare `console.error` swallow or an empty `catch {}`.
- Put a **React error boundary** at the shell so render/effect throws show a recovery UI
  instead of a blank screen.

### 7c. No God components
Content and data belong in data files, not in JSX. If a component crosses ~300–400 lines or
disables `no-explicit-any` for the whole file, split it: extract content to a typed data
module and render it generically.

### 7d. CI gates quality
The pipeline runs `lint` + `test` + dependency audit **before** build/deploy. Add Prettier
and an `.editorconfig`; optionally a pre-commit hook (Husky + lint-staged).

---

## 8. Checklist for a new feature

- [ ] Folder named for the feature, under the right role dir (`panels/`, `tools/`, …)
- [ ] `index.tsx` — view only, no effects/fetches/imperative SDK calls
- [ ] `use<Feature>.ts` — all logic/state, returns values + handlers
- [ ] `<Feature>.module.css` — scoped styles
- [ ] `use<Feature>.test.ts` — covers the non-trivial logic
- [ ] Shared state added to context ONLY if multiple features need it
- [ ] Imperative/third-party/heavy work delegated to a `utils/` service
- [ ] All async paths have try/catch + user-visible error surfacing
- [ ] Lazy-loaded if large or secondary
- [ ] Every direct import declared in `package.json`

---

## TL;DR

> A config-driven React/TS app where **one feature = view component + logic hook + CSS
> module**, global state lives in a **single Context**, imperative/third-party work is
> isolated in **service singletons**, features **lazy-load**, and — added on top of the
> original pattern — **tests, error boundaries/handling, and CI gates are built in from the
> start**.

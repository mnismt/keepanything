# 013 — Everything is a devDependency except the one native package

**Status:** Accepted

## Context

electron-builder ships whatever is in `dependencies` into the packaged app. Anything the bundler can
inline does not need to be shipped as a node_modules tree.

## Decision

`@huggingface/transformers` is the only runtime `dependency`; it has native/ONNX assets that must be
external and is marked so by `externalizeDepsPlugin()`. Every other package is a `devDependency` and
gets bundled by electron-vite into `out/`. Package manager is pnpm only, with `pnpm-lock.yaml`
committed. Version pins that matter: `@vitejs/plugin-react` 5.x (6.x requires Vite 8), TypeScript 5.9,
`lucide-react` 1.40. Scripts anchor their paths on the repo root, never on the caller's cwd.

## Consequences

- A small packaged app and a single obvious question when adding a dependency: does it need to be
  external, or can it be bundled?
- pnpm 11 ignores build scripts unless allowed in `pnpm-workspace.yaml`; if the Electron binary is
  missing, `pnpm run postinstall` re-runs `node_modules/electron/install.js`.
- Use `node_modules/.bin/tsc`, not a globally shadowed `tsc`, or typechecks fail for unrelated reasons.

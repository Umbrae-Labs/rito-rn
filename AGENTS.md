# Rito React Native adapter

The npm package is `@umbrae-labs/rito-rn`. This repository owns the TypeScript
session API, wire protocol adapter, Nitro C++ bindings and platform build setup.

Edit kernel Rust only in the `upstream/rito` fork on a topic branch. Capture
committed changes with `pnpm run engine:capture`; regenerate with
`pnpm run engine:export`. `native/rito` and `.engine` are generated outputs.
Preserve `engine.lock.json` full commit hashes and exported patch checksums.

Keep platform build configuration relative to the installed package. The package
must work without Lunar source directories. Expose consumer contracts through
`src/index.ts`; application code uses the package entry point.

Run `pnpm run check` for adapter changes and `pnpm run engine:test` for kernel
changes. Use `pnpm pack --pack-destination artifacts` to validate the actual npm
artifact. The working directory contains a Git submodule; preserve topic branches
and existing user changes when updating its base. Read CONTRIBUTING.md for the
capture, update and publication process.

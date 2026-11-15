These wire codec files and type declarations come from
`Ringyuki/Rito` tag `@ritojs/core@4.2.0`, commit
`f33aeb34bd0f94ae198a18bc8f5fba3e8e1b660b`, under AGPL-3.0-only.

The JavaScript runtimes and their `.d.ts` files are copied from
`packages/rito-core-wasm/src/`; the TypeScript types are copied from
`packages/rito-core-wasm/src/types/`. `types.ts` re-exports the copied types
for the runtime declarations, and `reader-session-query-request-runtime.d.ts`
and `reader-session-query-decoder-runtime.d.ts` are written for this adapter,
since upstream declares those runtimes only through its worker.

Update this directory alongside `native/rito` and the React Native adapter
when the pinned Rito revision changes. The Rust-generated fixtures
`tests/fixtures/rito-3-primitive-list.hex`, `tests/fixtures/rito-3-artifact.hex`
and `tests/fixtures/rito-3-page-records.hex` check decoder compatibility; copy
them from `packages/rito-core-wasm/tests/fixtures/reader-session-*.hex`.

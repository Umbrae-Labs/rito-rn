These wire decoder files and type declarations come from
`Ringyuki/Rito` tag `@ritojs/core@4.1.0`, commit
`ed0284f3703244da28b3e6efd80cf29267cf6e65`, under AGPL-3.0-only.

The JavaScript decoder is copied from `packages/rito-core-wasm/src/`.
The TypeScript types are copied from `packages/rito-core-wasm/src/types/`.
Update this directory alongside `native/rito` and the React Native adapter
when the pinned Rito revision changes. The Rust-generated fixtures
`tests/fixtures/rito-3-primitive-list.hex`, `tests/fixtures/rito-3-artifact.hex`
and `tests/fixtures/rito-3-page-records.hex` check decoder compatibility; copy
them from `packages/rito-core-wasm/tests/fixtures/`.

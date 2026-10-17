These wire decoder files and type declarations come from
`Ringyuki/Rito` tag `@ritojs/core@3.2.1`, commit
`9c9111ca2fc57f63ce81c65d3c4f80cb513610ae`, under AGPL-3.0-only.

The JavaScript decoder is copied from `packages/rito-core-wasm/src/`.
The TypeScript types are copied from `packages/rito-core-wasm/src/types/`.
Update this directory alongside `native/rito` and the React Native adapter
when the pinned Rito revision changes. The Rust-generated fixtures
`tests/fixtures/rito-3-primitive-list.hex` and `tests/fixtures/rito-3-artifact.hex`
check decoder compatibility; copy them from `packages/rito-core-wasm/tests/fixtures/`.

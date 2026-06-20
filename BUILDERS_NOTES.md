# Builder's Notes: Friction Points And v0.16.1 Follow-Up

This document records friction encountered while building a transaction builder
for CellScript `amm_pool.cell` and `token.cell`. It also records what changed
after ArthurZhang's `v0.16.1` release.

## Verified on Devnet (CKB v0.205.0, offckb v0.4.6)

- `offckb deploy` works for single-ELF deployment.
- CCC `prepareTransaction()` before signing is required for correct secp256k1 sighash.
- `getKnownScript` must return cellDeps with singular `cellDep` wrapper:
  `[{cellDep: {outPoint: {txHash, index}, depType}}]`
- Genesis tx hash changes on every `offckb node start`.
- Cells can be created on devnet with secp256k1 locks.
- ckb2023 fork uses 1 CKB per byte occupied capacity.

## Original Blocker

In CellScript `v0.16.0`, `token.cell` began with `mint`, which required an
existing `MintAuthority` input. No action in `token.cell` created the first
`MintAuthority`, so real token-cell creation was blocked.

That blocker was real. It was fixed in CellScript `v0.16.1`.

## v0.16.1 Resolution

- `token.cell::mint` is now `mint_with_authority`.
- `launch.cell::bootstrap_token` creates the first `MintAuthority` and token outputs.
- `launch.cell::launch_token` creates the first `MintAuthority`, token distribution,
  pool topology, LP receipt, and change token directly.
- `launch_token` does not call `amm_pool.seed_pool` implicitly. It materializes
  the initial pool topology itself.

Official guide in CellScript checkout:

```text
docs/examples/token_amm_bootstrap.md
```

## Builder Integration Rules

CellScript `v0.16.1` makes the intended builder path CLI-first:

1. Compile scoped artifacts with `--entry-action <action>`.
2. Inspect entry ABI with `cellc abi`.
3. Generate CellScript entry witness bytes with `cellc entry-witness`.
4. Inspect builder assumptions with `cellc explain-assumptions`.
5. Validate transaction JSON with `cellc validate-tx` before signing.

The Rust builder should not hand-encode `CSARGv1` payloads. It should consume
`cellc entry-witness` output. Do not wrap those bytes in CKB `WitnessArgs` by
default. The generated CellScript entry wrapper reads raw entry-witness bytes
from the current script group's witness surface. Use `WitnessArgs.input_type` or
`WitnessArgs.output_type` only when the CellScript source explicitly reads those
surfaces.

## Current Local Result

The first `launch_token` fixture transaction has been accepted on local devnet:

```text
0xaeeb1274c865df3d81216729b6491229cf955184f9800c723e6475012d62676d
```

This transaction was dry-run first and then committed. It used:

- scoped `launch_token.elf` as the input lock script;
- `cellc entry-witness` output as the direct witness;
- fixture-style resource type scripts for `MintAuthority`, `Token`, `Pool`, and `LPReceipt`;
- the output topology described by `launch.cell::launch_token`.

`cellc validate-tx` still fails because the transaction JSON lacks
`builder_assumption_evidence` for capacity policy. CKB acceptance is therefore
ahead of builder-validation completeness.

## Remaining Work

- Clarify whether fixture-style resource type scripts are acceptable for external builders.
- Add structured `builder_assumption_evidence` from `cellc explain-assumptions`
  or `cellc solve-tx` output so `cellc validate-tx` passes before signing.
- Move from fake `always_success` token cells to explicit scoped CellScript artifacts.
- Run `seed_pool` only when using standalone token cells.
- Run `swap_a_for_b` against a live pool cell.
- Integrate `cellc validate-tx` into the builder workflow.

## Lessons

- Do not rely on source order or first-action behavior for builder fixtures.
  Select entries explicitly with `--entry-action`.
- Do not hand-encode EntryWitness payloads when the compiler can generate them.
- Do not assume transaction-global `witnesses[0]`; witness index 0 is script-group-relative.
- Keep `always_success` only for lock scaffolding, not token or pool state.
- Treat `amm_pool.cell` as a reference example, not production AMM code.

# Builder's Notes: CellScript Builder Integration

This document records friction encountered while building an external transaction
builder for CellScript `amm_pool.cell` and `token.cell`. It separates historical
fixture work from the current compiler-supported builder path.

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

## v0.16.2 Builder Path

CellScript `v0.16.2` adds the missing builder-facing UX:

- `cellc resource-identity` generates passive resource type-script identities.
- `cellc builder manifest` emits one action-scoped builder contract.
- `cellc builder check` validates a candidate transaction against the manifest.

The current CLI-first path is:

1. Generate passive resource identity artifacts and plans with `cellc resource-identity`.
2. Compile scoped action artifacts with `--entry-action <action>`.
3. Generate action manifests with `cellc builder manifest`.
4. Generate raw entry witness bytes with `cellc entry-witness`.
5. Run `cellc builder check --production` before CKB dry-run and signing.

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

After attaching structured evidence for capacity assumption
`ba-eabc81b64927584b`, the saved transaction passes `cellc validate-tx`:

```bash
cellc validate-tx --against build/launch_token.elf.meta.json --json /tmp/opencode/launch_token_tx_with_evidence.json
```

This validates the evidence shape gate. Production acceptance evidence still
comes from CKB dry-run, final transaction size, occupied-capacity measurement,
fee/change calculation, and signatures.

## v0.16.2 Outputs Generated Locally

Generated passive token identities:

```bash
cellc resource-identity examples/token.cell --target-profile ckb --primitive-strict 0.16 \
  --type MintAuthority --type Token \
  --identity MintAuthority=launch01-auth --identity Token=launch01-token \
  --output /tmp/opencode/cellscript-v0162/token_resource_identity.elf \
  --plan-output /tmp/opencode/cellscript-v0162/token_resource_identity.plan.json
```

Generated passive AMM identities:

```bash
cellc resource-identity examples/amm_pool.cell --target-profile ckb --primitive-strict 0.16 \
  --type Pool --type LPReceipt \
  --identity Pool=launch01-pool --identity LPReceipt=launch01-lp \
  --output /tmp/opencode/cellscript-v0162/amm_resource_identity.elf \
  --plan-output /tmp/opencode/cellscript-v0162/amm_resource_identity.plan.json
```

Both plans use a compiler-generated passive identity artifact:

```text
code_hash: 0x735490d86a2a15012cd2d5aa0794e1358b8b57e701bd365ee618b06056f16ce4
hash_type: data1
witness: none; this passive badge only decodes Script.args
```

Generated manifests for:

- `mint_with_authority`
- `seed_pool`
- `swap_a_for_b`

## Remaining Work

- Deploy the generated passive resource identity artifact on the current devnet.
- Rebuild bootstrap and mint scripts using resource identity plan scripts instead of fixtures.
- Run `cellc builder check --production` on each candidate transaction before signing.
- Then run CKB dry-run and submit only if both checks pass.
- Continue to `seed_pool` and `swap_a_for_b` after real token cells are live.

## Scoped Mint Experiment

`scripts/scoped_mint_flow.js` tests whether the scoped
`token_mint_with_authority.elf` artifact can be used directly as the
`MintAuthority` resource type script.

The setup transaction fails when creating the authority output:

```text
Outputs[0].Type -> CellScript error 25: entry-witness-abi-invalid
```

That is useful negative evidence. An action artifact cannot simply be used as a
passive resource type script during bootstrap, because output type verification
still runs the scoped artifact and expects the action entry witness ABI.

This gap is fixed in CellScript `v0.16.2` by `cellc resource-identity` and
`cellc builder manifest/check`. The script remains as negative evidence for why
the new flow is necessary.

## Lessons

- Do not rely on source order or first-action behavior for builder fixtures.
  Select entries explicitly with `--entry-action`.
- Do not hand-encode EntryWitness payloads when the compiler can generate them.
- Do not assume transaction-global `witnesses[0]`; witness index 0 is script-group-relative.
- Keep `always_success` only for lock scaffolding, not token or pool state.
- Treat `amm_pool.cell` as a reference example, not production AMM code.

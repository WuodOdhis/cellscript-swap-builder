# cellscript-swap-builder

A local-devnet transaction builder experiment for CellScript's `amm_pool.cell`.

The repo exists to document what an off-chain builder must know before it can
construct valid CellScript AMM transactions on CKB. It is not a finished swap
implementation.

## Current Direction

CellScript `v0.16.2` adds the builder-facing path this repo was missing:

- `cellc resource-identity` for passive resource type-script identities
- `cellc builder manifest` for one action-scoped builder contract
- `cellc builder check` for pre-sign transaction validation

CellScript `v0.16.1` resolved the original token bootstrap blocker. The first
`MintAuthority` path lives in `examples/launch.cell`:

```text
launch.bootstrap_token or launch.launch_token
  -> MintAuthority output
  -> token.mint_with_authority
  -> Token outputs
  -> amm_pool.seed_pool, unless launch_token already created the Pool
  -> amm_pool.swap_a_for_b
```

The builder path is CLI-first. This repo treats `cellc` as the canonical source
for passive resource identity, entry ABI, entry witness bytes, assumptions, and
transaction-shape validation.

## What Exists

- CCC scripts for deploy, funding, signing, and test-cell creation
- A verified CCC signing flow using `prepareTransaction()` before signing
- A Rust builder that encodes token data, pool data, swap math, and witness bytes
- Builder notes recording verified devnet behavior and resolved or unresolved assumptions

## Status

Pre-alpha. The Rust code builds a mock swap transaction shape. A separate
`launch_token` fixture script has produced a CKB-accepted CellScript transaction
on local devnet.

The next step is not more implementation. The next step is clarifying which
parts of the accepted fixture are acceptable builder practice and which are
only CellScript acceptance-harness scaffolding.

## Verified Locally

- `offckb deploy` for single ELF deployment
- CCC transaction construction and secp256k1 signing
- CellDep format and script structure
- ckb2023 capacity rules (1 CKB per byte)
- Devnet cell lifecycle (create, fund, consume)
- Molecule `WitnessArgs` offset behavior for absent fields
- `cellc 0.16.2` resource-identity, builder manifest, and builder check commands
- Scoped `launch_token.elf` deployed and accepted on local devnet
- `launch_token` transaction committed: `0xaeeb1274c865df3d81216729b6491229cf955184f9800c723e6475012d62676d`
- Saved `launch_token` transaction passes `cellc validate-tx` after attaching structured capacity evidence
- A manifest-built `mint_with_authority` candidate passes `cellc builder check --production`
- `scripts/build_launch_tx.py` builds a launch transaction from compiler-generated resource identities and live devnet funding-cell data; default mode is dry-run only.

## What is Unproven

- `seed_pool` transaction accepted on local devnet
- `swap_a_for_b` transaction accepted on local devnet
- `cellc builder check` integrated into the end-to-end builder scripts
- The Rust builder's output accepted by CKB consensus
- A non-fixture `mint_with_authority`, `seed_pool`, or `swap_a_for_b` transaction accepted on devnet
- Final `launch_token` broadcast using the cleaned CLI builder; current verified state is devnet dry-run, not chain submission.

## CLI-First Workflow

Generate passive resource identities first. These are the resource cell "ID
badges". Do not use scoped action artifacts or `always_success` as passive
resource identities:

```bash
cellc resource-identity examples/token.cell --target-profile ckb --primitive-strict 0.16 \
  --type MintAuthority --type Token \
  --identity MintAuthority=launch01-auth --identity Token=launch01-token \
  --output build/token_resource_identity.elf \
  --plan-output build/token_resource_identity.plan.json
```

Compile scoped artifacts explicitly:

```bash
cellc examples/launch.cell --entry-action launch_token --target riscv64-elf --target-profile ckb -o build/launch_token.elf
cellc examples/token.cell --entry-action mint_with_authority --target riscv64-elf --target-profile ckb -o build/token_mint_with_authority.elf
cellc examples/amm_pool.cell --entry-action swap_a_for_b --target riscv64-elf --target-profile ckb -o build/amm_swap_a_for_b.elf
```

Inspect ABI and generate witness bytes with `cellc`:

```bash
cellc abi examples/amm_pool.cell --target-profile ckb --action swap_a_for_b
cellc entry-witness examples/amm_pool.cell --target-profile ckb --action swap_a_for_b --arg 2 --arg 0x1111111111111111111111111111111111111111111111111111111111111111 --json
```

Use the resulting `witness_hex` as `entry_witness` in `example_input.json`. The
Rust builder passes those canonical bytes as the raw CellScript entry witness.
Do not wrap entry-witness bytes in `WitnessArgs.input_type` by default. Use
`WitnessArgs.input_type` or `WitnessArgs.output_type` only when the CellScript
source explicitly reads those witness surfaces.

Generate a builder manifest and check candidate transactions before signing:

```bash
cellc builder manifest examples/token.cell --target-profile ckb --primitive-strict 0.16 \
  --entry-action mint_with_authority \
  --resource-identities build/token_resource_identity.plan.json \
  -o build/mint_with_authority.manifest.json

cellc builder check \
  --manifest build/mint_with_authority.manifest.json \
  --resource-identities build/token_resource_identity.plan.json \
  --tx /tmp/candidate_tx.json \
  --production
```

## Project Structure

```text
swap-builder/
  src/main.rs              swap math, data encoding, tx construction
  example_input.json       template with placeholder values
  scripts/
    deploy.js              ELF deployment via CCC
    create_tokens.js       old test cells using always_success workaround
    fund_always_success.js funding tx helper
    create_always_success.js always_success cell creation
    launch_token_flow.js    local launch_token fixture flow
    sign.js                transaction signing
  BUILDERS_NOTES.md        friction log (verified vs unresolved)
```

## Current Boundary

The committed `launch_token` transaction used fixture-style type scripts. It is
kept as historical evidence only. It proves the scoped CellScript launch action
can validate and commit a topology transaction locally, but it is not the
reusable builder path.

`v0.16.2` fixes the resource identity gap by generating passive identity
artifacts and a resource identity plan. The next implementation target is a
fresh transaction path that uses those generated identities and passes
`cellc builder check --production` before dry-run.

Open implementation points:

- Deploy the generated passive resource identity artifact.
- Replace placeholder candidate inputs with live cells and signatures.
- Treat script-group witness placement as group-relative, not necessarily transaction-global `witnesses[0]`.
- Use `cellc builder check --production` before CKB dry-run and submission.

## Usage

```bash
cargo run -- --example
cargo run -- example_input.json
```

For the launch fixture script, set `LAUNCH_TX_JSON` to write a validation JSON
with `builder_assumption_evidence` attached before submission:

```bash
CKB_PRIVKEY=... LAUNCH_TX_JSON=/tmp/opencode/launch_token_tx_with_evidence.json node scripts/launch_token_flow.js
cellc validate-tx --against build/launch_token.elf.meta.json --json /tmp/opencode/launch_token_tx_with_evidence.json
```

To attach evidence to an existing transaction JSON without submitting a new tx:

```bash
node scripts/attach_builder_evidence.js /tmp/opencode/launch_token_tx.json /tmp/opencode/launch_token_tx_with_evidence.json /home/badman/Projects/amm-swap-builder/cellscript/examples/launch.cell 400000000000
cellc validate-tx --against build/launch_token.elf.meta.json --json /tmp/opencode/launch_token_tx_with_evidence.json
```

To build a manifest-based mint candidate and check it before live-cell wiring:

```bash
node scripts/build_mint_candidate_from_manifest.js
cellc builder check \
  --manifest /tmp/opencode/cellscript-v0162/mint_with_authority.manifest.json \
  --resource-identities /tmp/opencode/cellscript-v0162/token_resource_identity.plan.json \
  --tx /tmp/opencode/cellscript-v0162/mint_candidate_tx.json \
  --production
```

To build and dry-run the current `launch_token` devnet transaction without consuming the funding cell:

```bash
python3 scripts/build_launch_tx.py \
  --package-dir /tmp/opencode/cellscript-v0162/pkg \
  --identity-plan /tmp/opencode/cellscript-v0162/pkg/build/latest.resource-identities.json
```

The script reads the paired funding token from devnet, loads output type identities
from the CellScript resource identity plan, generates the raw entry witness with
`cellc`, writes `launch_tx_final.json`, and calls `dry_run_transaction`. Add
`--submit` only when you intend to consume the launch funding cell.

## Acknowledgments

Contracts and CellScript guidance by ArthurZhang and the CellScript team.

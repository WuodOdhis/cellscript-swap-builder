# cellscript-swap-builder

A local-devnet transaction builder experiment for CellScript's `amm_pool.cell`.

The repo exists to document what an off-chain builder must know before it can
construct valid CellScript AMM transactions on CKB. It is not a finished swap
implementation.

## Current Direction

CellScript `v0.16.1` resolved the original token bootstrap blocker. The first
`MintAuthority` path now lives in `examples/launch.cell`:

```text
launch.bootstrap_token or launch.launch_token
  -> MintAuthority output
  -> token.mint_with_authority
  -> Token outputs
  -> amm_pool.seed_pool, unless launch_token already created the Pool
  -> amm_pool.swap_a_for_b
```

The builder path is CLI-first. This repo should treat `cellc` as the canonical
source for entry ABI, entry witness bytes, assumptions, and transaction-shape
validation.

## What Exists

- CCC scripts for deploy, funding, signing, and test-cell creation
- A verified CCC signing flow using `prepareTransaction()` before signing
- A Rust builder that encodes token data, pool data, swap math, and CKB WitnessArgs
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
- `cellc 0.16.1` ABI and entry-witness commands for CellScript actions
- Scoped `launch_token.elf` deployed and accepted on local devnet
- `launch_token` transaction committed: `0xaeeb1274c865df3d81216729b6491229cf955184f9800c723e6475012d62676d`

## What is Unproven

- `seed_pool` transaction accepted on local devnet
- `swap_a_for_b` transaction accepted on local devnet
- ProofPlan validation integrated into this builder
- The Rust builder's output accepted by CKB consensus
- `cellc validate-tx` passing with builder-assumption evidence
- Whether always_success resource type scripts are acceptable outside fixture scaffolding

## CLI-First Workflow

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
Rust builder only wraps those canonical bytes into CKB `WitnessArgs.input_type`.

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

The committed `launch_token` transaction used fixture-style type scripts for
`MintAuthority`, `Token`, `Pool`, and `LPReceipt`, matching the kind of scaffolding
used by CellScript's local acceptance harness. It proves the scoped CellScript
launch action can validate and commit a topology transaction locally.

It does not prove the final production artifact model for token or AMM resource
cells. Before building further, this repo should clarify the intended external
builder pattern with the CellScript team.

Open clarification points:

- Should external builder fixtures use simple type scripts for resource cells, or scoped CellScript artifacts?
- What `builder_assumption_evidence` shape is required for `cellc validate-tx` capacity policy?
- When exactly should entry witness bytes be passed directly versus wrapped in `WitnessArgs`?
- What is the canonical source for resource, shared, and receipt data layout?

## Usage

```bash
cargo run -- --example
cargo run -- example_input.json
```

## Acknowledgments

Contracts and CellScript guidance by ArthurZhang and the CellScript team.

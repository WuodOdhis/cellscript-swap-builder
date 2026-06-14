# cellscript-swap-builder

A local-devnet transaction builder experiment for CellScript's `amm_pool.cell`.

The repo exists to document what an off-chain builder must know before it can
construct valid CellScript AMM transactions on CKB. It is not a finished swap
implementation yet.

## Goal

Reach this real transaction path on a local CKB devnet:

```text
MintAuthority bootstrap -> mint real token.elf token cells -> seed_pool -> swap_a_for_b
```

The current blocker is the first step: understanding how `token.cell` expects
the genesis `MintAuthority` cell to be created.

## What Exists

- `amm_pool.elf`, `token.elf`, and `always_success.elf` deployed locally
- CCC scripts for deploy, funding, signing, and test-cell creation
- A verified CCC signing flow using `prepareTransaction()` before signing
- A Rust builder that encodes token data, pool data, swap math, and WitnessArgs
- Builder notes recording verified devnet behavior and unresolved assumptions

## Status

Pre-alpha. The repo is useful as a builder friction report and an encoding
experiment. It has not produced a CKB-accepted AMM transaction.

The project intentionally stops before pretending the AMM path works. Real
`token.elf` token-cell creation is unresolved.

## Verified Locally

- `offckb deploy` for single ELF deployment
- CCC transaction construction and secp256k1 signing
- CellDep format and script structure
- ckb2023 capacity rules (1 CKB per byte)
- Devnet cell lifecycle (create, fund, consume)
- Molecule `WitnessArgs` offset behavior for absent fields

## What is Unproven

- Token cell creation with `token.elf` type script
- `seed_pool` transaction (consuming two token cells, creating pool + receipt)
- Swap transaction against a pool
- EntryWitness encoding validated by a running CellScript contract
- The Rust builder's output accepted by CKB consensus
- ProofPlan validation in the builder

## Main Constraint

`token.cell` starts with `mint(auth_before: MintAuthority, to: Address, amount: u64)`.
That action needs an existing `MintAuthority` input. I have not found the
intended path for creating the first `MintAuthority` cell.

Until that is clear, using `always_success.elf` as a token type is only a local
test shortcut. It does not validate token rules.

## Project Structure

```
swap-builder/
  src/main.rs              swap math, data encoding, tx construction
  example_input.json       template with placeholder values
  scripts/
    deploy.js              ELF deployment via CCC
    create_tokens.js       test token cells (uses always_success workaround)
    fund_always_success.js funding tx helper
    create_always_success.js always_success cell creation
    sign.js                transaction signing
  BUILDERS_NOTES.md        friction log (verified vs unresolved)
```

## Usage

```
# Generate example input
cargo run -- --example

# Build a mock swap transaction shape (not devnet accepted yet)
cargo run -- example_input.json
```

## Open Questions

- How should the first `MintAuthority` cell be created for `token.cell`?
- Is first-action-on-creation a guaranteed CellScript rule?
- What is the canonical builder path for CellScript EntryWitness encoding?
- Which ProofPlan assumptions should an off-chain builder enforce before signing?
- What is the recommended local fixture pattern for testing `token.cell`?

## Acknowledgments

Contracts by ArthurZhang and the CellScript team at cell-labs.

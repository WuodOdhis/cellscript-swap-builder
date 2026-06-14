# cellscript-swap-builder

Deterministic swap transaction builder that constructs valid CKB transactions by ingesting CellScript contract metadata (ProofPlan), targeting the `amm_pool` AMM protocol.

## Status

Pre-alpha — the builder correctly computes swap amounts, encodes Pool/Token/LPReceipt molecule data, and constructs the CKB transaction JSON with proper EntryWitness and WitnessArgs. Currently using mock live cells — wiring to real devnet cells in progress.

## Project Structure

```
swap-builder/
├── src/main.rs              # Builder logic: encoding, math, tx construction
├── Cargo.toml
├── builder_assumptions.json # ProofPlan assumptions extracted via `cellc explain-proof`
├── evidence.json            # Builder evidence for runtime-required assumptions
├── example_input.json       # Example swap input (uses real deployed contract hashes)
├── scripts/
│   ├── deploy.js            # CCC-based ELF deployment
│   └── sign.js              # CCC-based transaction signing
└── README.md
```

## Usage

```bash
# Generate example input
cargo run -- --example

# Build a swap transaction from input
cargo run -- example_input.json
```

## CellScript Contracts Used

- `amm_pool.elf` — code_hash `0x3406e2a1…`, deployment tx `0x30c25a1a…`
- `token.elf` — code_hash `0xff9c0f12…`, deployment tx `0x82963c9d…`

Both compiled from [`cellscript/examples/`](https://github.com/a19q3/CellScript) at v0.16.0.

## How It Works

1. **Parse input** — pool cell data (42 bytes), user token cell data (16 bytes), outpoints, lock/type scripts, cell deps
2. **Compute** — constant product k = reserve_a * reserve_b, apply fee, verify amount_out >= min_output
3. **Encode** — pool_after (42 bytes), token_out (16 bytes), EntryWitness (48 bytes), WitnessArgs (variable)
4. **Output** — complete CKB transaction JSON with ProofPlan assumptions embedded

## Encountered Friction Points

- **EntryWitness format** reverse-engineered from CellScript source; no public spec
- **Creation vs mutation dispatch** — first listed action runs on creation, witness-determined on mutation
- **Token type identity** — `type_hash()` must differ between token A and B; type script args convention unclear
- **CCC signing pipeline** — `prepareTransaction` required before `signOnlyTransaction` for correct sighash

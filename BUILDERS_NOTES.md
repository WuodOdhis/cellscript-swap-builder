# Builder's Notes: CellScript Swap Builder Friction Report

## Context

This document records friction points encountered while building the first off-chain ProofPlan-aware transaction builder for CellScript's `amm_pool` protocol. It's intended as direct feedback for ArthurZhang and the CellScript team, and as a reference for other builders.

Compiled with `cellc` v0.16.0. Contracts: `amm_pool.cell` (seed_pool + swap_a_for_b + add_liquidity + remove_liquidity) and `token.cell` (fungible_token).

---

## 1. EntryWitness Encoding

The biggest time sink. The EntryWitness payload format was reverse-engineered from the CellScript source code with no public specification.

**What we know:**
- Magic prefix: `CSARGv1\0` (8 bytes)
- Then action-specific scalar parameters in order: e.g., for `swap_a_for_b`, it's `min_output: u64` (LE) + `to: Address` (32 bytes) = 48 bytes total
- Wrapped in a CKB Molecule `WitnessArgs` table with only the `input_type` field set

**What's unclear:**
- Is there a canonical function in `cellc` or the CellScript SDK for constructing this?
- How do actions with different parameter shapes encode their EntryWitness? E.g., `seed_pool` takes `fee_rate_bps: u16` + `provider: Address` as witness params, but also two Token inputs
- Are there variable-length fields in any action's EntryWitness?
- Where is the EntryWitness spec documented?

**Error experience:** Using the wrong ELF or encoding produces `EntryWitnessAbiInvalid` (error 25) with no additional debug info. The only way to debug is to dump the witness hex and manually compare bytes.

## 2. Creation vs Mutation Dispatch

CellScript dispatches differently on creation vs mutation, and this is not obvious:

- **Creation** (no typed input cell in the script group): runs the **first listed action** in the source
- **Mutation** (typed input exists): reads action name from the EntryWitness in the witness

We deployed `amm_pool_swap.elf` (which lists `swap_a_for_b` first) as the pool type script and got error 25 on creation. The fix was using `amm_pool.elf` (which lists `seed_pool` first).

**Questions:**
- Is the "first action on creation" rule a guaranteed CellScript invariant?
- Can you batch multiple actions in one transaction (e.g., swap + add_liquidity atomically)?
- What happens if there's a typed input but no EntryWitness? Error? Default action?

## 3. Token Type Identity Model

`seed_pool` checks `token_a.type_hash() != token_b.type_hash()`, meaning the two input tokens must have different type scripts.

**Our assumption:** Tokens A and B use the same `token.elf` ELF (same `code_hash`) but different type script `args`. For example, args `0x01` for USDC and `0x02` for CKB.

**Questions:**
- Is this the canonical pattern for token identity in CellScript?
- Or should each token type use a separately deployed ELF?
- Looking at `token.cell`, no resource field or action references type script args — what args does `token.elf` expect at the type script level?

## 4. Data Encoding Schemas

We derived the byte layouts from the CellScript source:

- `Token`: 16 bytes = `amount: u64` (LE) + `symbol: [u8; 8]`
- `Pool`: 42 bytes = `a_sym: [u8; 8]` + `b_sym: [u8; 8]` + `reserve_a: u64` (LE) + `reserve_b: u64` (LE) + `total_lp: u64` (LE) + `fee_rate_bps: u16` (LE)
- `LPReceipt`: assumed = `pool_id: Hash` (32) + `lp_amount: u64` (8) + `provider: Address` (32) = 72 bytes (not yet tested)

**Questions:**
- Is there a `cellc explain-data` command or are these schemas documented somewhere?
- Is the molecule schema the same as the field order in the `resource` declaration?

## 5. ProofPlan builder_assumptions

The `amm_pool.elf.meta.json` contains 50+ ProofPlan entries per action with `builder_assumptions` fields. These have statuses like:
- `ckb-runtime` — "requires the CKB-style transaction context"
- `checked-runtime` — compiler-emitted runtime checks (e.g., `consume-input:Token:token_a`)
- `runtime-required` — unresolved protocol components (e.g., `pool-create:Pool`)
- `builder-required` — e.g., capacity planning

**Our question:** Which of these must the off-chain builder validate vs which are the CKB runtime's responsibility? Specifically, the `runtime-required` assumptions with `failure_mode: "reject-before-signing"` — should the builder reject the transaction if it can't prove these, or is the failure_mode aspirational?

## 6. CCC Signing Pipeline

Discovered through trial and error:

1. `getKnownScript` must return `ScriptInfo` with `cellDeps: [{cellDep: {outPoint: {txHash, index, depType}}}]` — note the singular `cellDep` wrapper
2. `prepareTransaction()` must be called **before** `signOnlyTransaction()` — it injects the 65-byte zeroed witness placeholder that the sighash needs
3. Without `prepareTransaction`, the sighash is computed over an empty witness array, producing error -31

This is not a CellScript issue per se, but it tripped us up because the CCC docs don't explicitly document the call order requirement.

## 7. Genesis Hash Mismatch

If `get_live_cell` returns "unknown" for cells you just deployed, check that you're using the correct genesis transaction hash. `offckb` devnet generates a fresh genesis at each `offckb node start`. Ours was `0x1bb87da3…`, not the hash from a previous session.

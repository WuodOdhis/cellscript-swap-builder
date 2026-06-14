# Builder's Notes: Friction Points (Verified vs Unresolved)

This document records friction encountered while building a transaction
builder for CellScript amm_pool and token contracts. It separates what
has been verified on the devnet from what is assumed or unresolved.

## Verified on Devnet (CKB v0.205.0, offckb v0.4.6)

- `offckb deploy` works for single-ELF deployment (deploys ELF as code cell
  with secp256k1 lock, returns change)
- CCC `prepareTransaction()` before `signOnlyTransaction()` is required for
  correct sighash (65-byte zeroed witness placeholder)
- `getKnownScript` must return cellDeps with singular `cellDep` wrapper:
  `[{cellDep: {outPoint: {txHash, index}, depType}}]`
- Genesis tx hash changes on every `offckb node start`
- CellDep format: `{cellDep: {outPoint: {txHash, index: number}, depType}}`
- Cells can be created on devnet (secp256k1 lock, always_success type)
- ckb2023 fork: 1 CKB per byte occupied capacity

## Unverified Assumptions (Not Tested On Chain)

- The swap builder (Rust) has never produced a transaction sent to devnet.
  Witness encoding was recently fixed but end-to-end validation is pending.
- Token.elf creation path is unknown. The first action `mint` requires a
  `MintAuthority` input cell, but no action in token.cell creates one.
  This is a circular dependency not yet resolved.
- The always_success ELF (hash_type data2) is used as a type script stand-in
  for token cells. This bypasses all token validation.
- EntryWitness format for seed_pool action parameters is reverse-engineered
  from CellScript source, not validated against a running contract.
- ProofPlan metadata exists in compiled artifacts, but this repo does not yet
  validate ProofPlan assumptions in the builder.

## Friction Points

1. WitnessArgs molecule offset semantics -- ambiguous documentation on how
   absent BytesOpt fields are encoded. Verified via CKB source: if a field's
   offset equals total_size, the field is absent.

2. EntryWitness spec -- no public document describing the CSARGv1 format.
   Reverse-engineered from CellScript source at v0.16.0.

3. Creation vs mutation dispatch -- CellScript runs the first action on
   creation (no typed input). Mutation reads action from witness. This is
   inferred from behavior, not documented.

4. CCC signing pipeline -- prepareTransaction order dependence is not
   mentioned in CCC docs. Found by trial and error.

5. Genesis hash changes -- offckb devnet generates a new genesis at each
   `offckb node start`. Cells from a previous session become unreachable.

## Open Questions for Arthur / CellScript Team

- How is the genesis MintAuthority cell created for token.cell?
- Is there a canonical encode_witness_args function or utility?
- Where is the EntryWitness format specified?
- Is "first action on creation" a guaranteed CellScript invariant?

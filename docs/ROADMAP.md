# ProveIt — Book 2 Roadmap

**Theme:** Everyday proofs of necessity — expanding ProveIt from a single threshold-check demo into a library of real-world ZK proof circuits, unified behind one commit → prove → verify architecture.

**Status:** Idea captured, not yet started. Book 1 (core protocol + devnet deployment) must be complete first.

---

## Concept

Book 1 proved the pattern works: one circuit, one condition (balance ≥ threshold), fully private, fully verifiable on-chain.

Book 2 keeps the same skeleton — ledger, witness, commit circuit, proof circuit, verifier — and swaps in a new circuit per real-world use case. The goal is a small library of proofs people actually need in daily life, eventually presented behind a single dropdown-style interface: pick a proof type, supply your private input, get a verifiable on-chain result.

---

## Prerequisite: Multi-User Ledger Scoping

Before Book 2 circuits are added, ProveIt's ledger needs to move from single global fields to per-user mappings. Right now, `owner`, `threshold`, `commitment`, and `verified` are single values — a second user committing a credential overwrites the first user's state entirely. This blocks real cross-dApp composability (a lending dApp can't check "is *this specific user* verified" if there's only ever one shared `verified` value).

**Confirmed correct Compact syntax** (verified against real working Midnight contracts, not just inferred):

```compact
export ledger verified: Map<Opaque<"string">, Boolean>;
export ledger commitments: Map<Opaque<"string">, Bytes<32>>;
export ledger thresholds: Map<Opaque<"string">, Uint<64>>;
```

Reading and writing follow the standard Compact Map pattern:

```compact
// Read
if (verified.member(userAddress)) {
  return verified.lookup(userAddress);
}
return false;

// Write
verified.insert(disclose(ownerAddress), true);
```

**Circuits affected:** all three — `commitCredential`, `proveEligibility`, and `verifyCredential` — since each currently reads/writes the single global fields and would need to be updated to take a `userAddress`/`ownerAddress` parameter and operate on the correct map entry.

**Also consider:** guarding against accidental overwrites using the same idiom seen in real Midnight voting contracts — `assert(disclose(!verified.member(userAddress)), "Already committed")` — to prevent a user from unintentionally clobbering an existing entry.

**README update required once this ships:** the current README line — *"reference implementation scoped to a single dApp use case (multi-party trust and third-party verifier support planned for v2)"* — should change to reflect that multi-user verification is now supported, and the Circuits table description for `verifyCredential` should note it now takes a `userAddress` parameter.

**Timing:** this is a prerequisite for Book 2's circuits to be useful in practice (multiple real users, multiple proof types compounds the single-value overwrite problem), but does not need to be built before Book 1's devnet deployment is tested and confirmed working. Candidate for either a "v1.1 hardening pass" after Book 1 ships, or as the first task inside Book 2 itself.

---

## Circuit List (build order: easy → hard)

### 1. Age Verification
- **Pattern:** Threshold comparison (near-identical to Book 1's `proveEligibility`)
- **Private witness:** Actual birthdate or age
- **Public:** Minimum age required
- **Real-world use:** Alcohol/tobacco delivery, adult content access, gambling platforms
- **Est. effort:** 2–4 days

### 2. Income / Solvency Proof
- **Pattern:** Threshold comparison — reuses Book 1's circuit almost as-is
- **Private witness:** Actual income or asset balance
- **Public:** Minimum required threshold
- **Real-world use:** Loan applications, rental applications, visa applications
- **Est. effort:** 2–4 days (mostly relabeling + testing)

### 3. Residency / Location Proof
- **Pattern:** Equality / match check (new pattern — not threshold-based)
- **Private witness:** Actual region or country
- **Public:** Allowed region(s)
- **Real-world use:** Tax eligibility, regional service access, voting eligibility
- **Est. effort:** 4–7 days

### 4. Credential / Certification Proof
- **Pattern:** Hash preimage / commitment matching (extends Book 1's stale-proof check)
- **Private witness:** Underlying credential data
- **Public:** Commitment hash of the credential
- **Real-world use:** Job applications, professional licensing checks
- **Est. effort:** 4–7 days

### 5. Membership / Allowlist Proof
- **Pattern:** Set-membership (Merkle-proof style)
- **Private witness:** The specific member value + Merkle path
- **Public:** Merkle root of the allowed set
- **Real-world use:** DAO governance, whitelist access, insurance pools
- **Est. effort:** 1–2 weeks (new pattern, needs research into Midnight's supported primitives)

### 6. Uniqueness / Personhood Proof
- **Pattern:** Nullifier-based (proves a value hasn't been used before, without revealing it)
- **Private witness:** Unique identity value
- **Public:** Nullifier registry / set of spent nullifiers
- **Real-world use:** Sybil resistance, airdrops, one-person-one-vote governance
- **Est. effort:** 1–2 weeks (new pattern, likely most advanced in this batch)

---

## Timeline Estimate

- **Full-time-equivalent, back-to-back:** ~6–10 weeks total across all six circuits
- **Realistic, part-time alongside freelance work + content series:** ~3–5 months
- **Recommendation:** Do not commit to a fixed deadline yet. Finish Book 1 (devnet deployment + audit report + Post 6) first, then re-scope Book 2 with real velocity data from one complete build cycle.

---

## Content Angle

Each circuit is a natural Compact 101 post — a difficulty ramp from "near-identical to what you already built" (age, income) to "genuinely new ZK pattern" (membership, uniqueness). ProveIt stays the running example throughout, reinforcing the "infrastructure, not just a contract" pitch.

---

## Open Questions / Research Needed

- Confirm Midnight's current documented support for Merkle/set-membership circuits (needed for #5)
- Confirm Midnight's current documented support for nullifier patterns (needed for #6)
- Decide whether Book 2 circuits live in the same `proveit` contract/repo, or as separate contracts under a shared ProveIt "protocol" umbrella
- Revisit per-user scoping question flagged in the Book 1 security audit (`commitment`/`threshold` currently global, not keyed per-owner) — likely needs resolving before Book 2 circuits are added, since multiple proof types per user will compound the issue

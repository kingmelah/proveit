# ProveIt — Roadmap

---

## Phase 1 — Core Protocol (current)

**Theme:** Prove the commit → prove → verify pattern works, end to end, with a single real-world proof type (balance/threshold eligibility).

**Status as of latest work session:**

| Item | Status |
|---|---|
| `commitCredential`, `proveEligibility`, `verifyCredential` circuits written | ✅ Done |
| Circuits compile clean (k=13, k=13, k=6) | ✅ Done |
| Rebranded from hello-world template (README, package.json, cli.ts, deploy.ts) | ✅ Done |
| `cli.ts` / `deploy.ts` fixed and type-check clean | ✅ Done |
| Fixed broken SDK imports (`InMemoryTransactionHistoryStorage` relocation, witness signature mismatch) | ✅ Done |
| Fixed dependency version conflict (`compact-js` 2.5.1 vs 2.5.0 mismatch across nested SDK packages, switched npm → Yarn to properly respect `resolutions`) | ✅ Done |
| `npm audit` reviewed and low-risk fix applied | ✅ Done |
| Mini security audit written (4 findings: fake hash, stale proof, threshold manipulation, proof server compromise) | ✅ Done |
| Pushed to private GitHub repo (`github.com/kingmelah/proveit`) | ✅ Done |
| **Actual devnet deployment + live commit → prove → verify test run** | ✅ Done |

**Phase 1 confirmed working — real devnet run, real transactions:**
- Contract deployed: `f123639fb57f21793fc20253dd23c9904178750d4ce3bed10bcd5f228afdd466`
- Commit tx: `009d8fbe9bde3e751feac529ebf0939104e23684fb59a91d3091726dfc71b0d802` (balance 5000, threshold 1000)
- Prove tx: `00c7128c87cb5ef0f4cf7b8fb7df20e6a460af43d0e28021d3f2e5379d4efbfbd5` (eligibility proven, balance never revealed)
- Verify result: `verified: true` — read independently from the blockchain, confirming the proof holds

**Known v1 limitation (see Prerequisite section below):** ledger fields (`owner`, `threshold`, `commitment`, `verified`) are single global values, not scoped per-user. Fine for single-user testing (as confirmed above); blocks real multi-dApp composability until fixed.

**Phase 1 is complete.** The full commit → prove → verify cycle has been run end-to-end on a live local devnet, with real transaction IDs confirming each step. Everything that was previously "should work" is now "confirmed working."

**Post-completion hardening (ongoing):**
- ✅ ProveIt now ships its own self-contained `docker-compose.yml` (node + indexer + proof server), matching the working reference config from `midnight-local-dev`. No longer depends on a separate tool being cloned elsewhere — `docker compose up -d` inside the ProveIt repo is enough. README updated with full local setup instructions.
- ✅ `compact-runtime` version mismatch resolved — pinned to `0.15.0` in both `dependencies` and `resolutions`, matching what `compact-js@2.5.0` actually declares. Confirmed via `yarn why` (single resolved version, no warning) and re-verified with a clean `tsc --noEmit` and `compact compile`. Investigated upgrading to a newer `compact-js` release instead (which would want `0.16.0`+), but no stable release exists — the only versions requiring newer runtimes are release candidates depending on `ledger-v9` (itself pre-release), so pinning down to the known-working `0.15.0` was the correct, stable choice.

---

## Phase 2 — Everyday Proofs of Necessity

**Theme:** Everyday proofs of necessity — expanding ProveIt from a single threshold-check demo into a library of real-world ZK proof circuits, unified behind one commit → prove → verify architecture.

**Status:** Idea captured, not yet started. Phase 1 is complete — Phase 2 can begin whenever ready.

---

## Concept

Phase 1 proved the pattern works: one circuit, one condition (balance ≥ threshold), fully private, fully verifiable on-chain.

Phase 2 keeps the same skeleton — ledger, witness, commit circuit, proof circuit, verifier — and swaps in a new circuit per real-world use case. The goal is a small library of proofs people actually need in daily life, eventually presented behind a single dropdown-style interface: pick a proof type, supply your private input, get a verifiable on-chain result.

---

## Prerequisite: Multi-User Ledger Scoping

Before Phase 2 circuits are added, ProveIt's ledger needs to move from single global fields to per-user mappings. Right now, `owner`, `threshold`, `commitment`, and `verified` are single values — a second user committing a credential overwrites the first user's state entirely. This blocks real cross-dApp composability (a lending dApp can't check "is *this specific user* verified" if there's only ever one shared `verified` value).

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

**Timing:** this is a prerequisite for Phase 2's circuits to be useful in practice (multiple real users, multiple proof types compounds the single-value overwrite problem), but does not need to be built before Phase 1's devnet deployment is tested and confirmed working. Candidate for either a "v1.1 hardening pass" after Phase 1 ships, or as the first task inside Phase 2 itself.

---

## Circuit List (build order: easy → hard)

### 1. Age Verification
- **Pattern:** Threshold comparison (near-identical to Phase 1's `proveEligibility`)
- **Private witness:** Actual birthdate or age
- **Public:** Minimum age required
- **Real-world use:** Alcohol/tobacco delivery, adult content access, gambling platforms
- **Est. effort:** 2–4 days

### 2. Income / Solvency Proof
- **Pattern:** Threshold comparison — reuses Phase 1's circuit almost as-is
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
- **Pattern:** Hash preimage / commitment matching (extends Phase 1's stale-proof check)
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
- **Recommendation:** Do not commit to a fixed deadline yet. Finish Phase 1 (devnet deployment + audit report + Post 6) first, then re-scope Phase 2 with real velocity data from one complete build cycle.

---

## Content Angle

Each circuit is a natural Compact 101 post — a difficulty ramp from "near-identical to what you already built" (age, income) to "genuinely new ZK pattern" (membership, uniqueness). ProveIt stays the running example throughout, reinforcing the "infrastructure, not just a contract" pitch.

---

## Open Questions / Research Needed

- Confirm Midnight's current documented support for Merkle/set-membership circuits (needed for #5)
- Confirm Midnight's current documented support for nullifier patterns (needed for #6)
- Decide whether Phase 2 circuits live in the same `proveit` contract/repo, or as separate contracts under a shared ProveIt "protocol" umbrella
- Revisit per-user scoping question flagged in the Phase 1 security audit (`commitment`/`threshold` currently global, not keyed per-owner) — likely needs resolving before Phase 2 circuits are added, since multiple proof types per user will compound the issue

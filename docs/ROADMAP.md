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
- ✅ `compact-js` / `compact-runtime` version conflict fully resolved — pinned to `2.5.1` / `0.16.0` (in both `dependencies` and `resolutions`), matching what the `compactc` compiler (v0.31.0) actually expects at runtime. An earlier pass had pinned to `2.5.0` / `0.15.0` to match `compact-js`'s own declared dependency, which fixed the *duplicate-version* problem but caused a *different* mismatch against the compiled contract's embedded runtime version check. `2.5.1` is the correct target — it satisfies the compiler while still depending on stable `ledger-v8` (not the alpha `ledger-v9`).
- ✅ Multi-user ledger scoping implemented — `thresholds`, `commitments`, `verified` converted from single ledger values to `Map<Opaque<"string">, ...>`, keyed by owner address. All three circuits (`commitCredential`, `proveEligibility`, `verifyCredential`) updated to take an `ownerAddress` parameter. Design decision: re-committing is allowed (not blocked), and always resets `verified` to `false` — no guard needed, since a fresh commitment naturally requires a fresh proof. Re-proof frequency policy (e.g., "can't reuse a proof for the same loan offer twice") is intentionally left to the consuming dApp, not enforced by ProveIt itself — keeping the protocol an unopinionated, reusable primitive.
- ✅ ProveIt's own standalone genesis-wallet funding script (`src/fund-wallet.ts`, `yarn fund <address>`) — built after discovering `midnight-local-dev`'s funding tool couldn't be reused against ProveIt's self-contained Docker setup (container name mismatch caused a port collision). Rather than renaming ProveIt's containers to match another tool's expectations, wrote ProveIt's own funding logic using the well-known genesis seed, keeping ProveIt genuinely dependency-free.
- ✅ **Multi-user scoping confirmed live, with real independent test data:** deployed the rewritten multi-user contract to ProveIt's own devnet, funded via the standalone script, and ran a two-user isolation test end-to-end:
  - **Alice** committed (balance 500, threshold 200) — commit tx `007ea8483803e4b1db18f7d6eb7f0ec216702b61ba2d9102aeba3a4c7483fbc0e8`
  - Alice proved eligibility successfully (500 ≥ 200) — prove tx `0046929a06b34f69fa8e080fb74a948b044c8014c9b58e6a284d70fa1642e3f86c`
  - **Bob** committed *after* Alice (balance 50, threshold 200) — commit tx `0035b32d51c6fac152d52b35763bd489a586fe5050aa7b15b282bd97c6905444cf`
  - Bob's proof attempt **correctly failed** (50 < 200) — `Balance does not meet the required threshold`, no transaction submitted
  - Alice re-verified *after* Bob's commit and failed attempt — still `verified: true`, confirming Bob's activity never touched Alice's data
  - This is the concrete proof the old single-value design would have broken: under Phase 1's original ledger, Bob's commit alone would have already overwritten Alice's `commitment` and `threshold`, before Bob even attempted to prove anything.

**⚠️ Priority flag before continuing to Phase 2 circuits:** Security Audit finding #5 (Unverified Self-Asserted Data) identifies that ProveIt's current witness data is entirely self-reported, with no trusted attestation or signature layer tying claimed values to real-world facts. Every Phase 2 Mod (age, income, residency, etc.) will inherit this same gap unless addressed first. See `docs/SECURITY_AUDIT.md` §5 for the full finding and the proposed signature-based attestation fix. Recommend resolving this — or at minimum designing Mod 1 with attestation in mind from the start — before building out the full Mod list below.

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

**Status: Complete and confirmed working live.** Deployed to a fresh contract instance and tested with two independent addresses — Alice committed and proved eligibility (balance 5000, threshold 1000, verified: true), then Bob committed a separate, unrelated credential (balance 200, threshold 1000). Checking Alice's verification status again afterward correctly still showed `true`, confirming Bob's commit did not overwrite or interfere with Alice's data. Multi-user isolation is genuinely working, not just compiling.

Before Phase 2 circuits are added, ProveIt's ledger needs to move from single global fields to per-user mappings. Right now, `owner`, `threshold`, `commitment`, and `verified` are single values — a second user committing a credential overwrites the first user's state entirely. This blocks real cross-dApp composability (a lending dApp can't check "is *this specific user* verified" if there's only ever one shared `verified` value).

**Status: Complete and confirmed working.** All three circuits (`commitCredential`, `proveEligibility`, `verifyCredential`) rewritten to Map-based, per-user storage. Contract compiles clean, `cli.ts` updated to match, and a fresh multi-user contract deployed live on ProveIt's own self-contained devnet.

**Live multi-user isolation test — passed:**
- Committed and proved eligibility for `alice` (threshold 1000, balance 5000) → `Verified: true`
- Committed a second, independent credential for `bob` (threshold 1000, balance 200 — below threshold)
- Re-checked `alice`'s verification status after `bob`'s commit → **still `Verified: true`**, confirming `bob`'s commit did not overwrite or affect `alice`'s data

This is the concrete evidence the multi-user rewrite solves the exact problem it was designed for — the single global ledger fields have been fully replaced with per-user Maps, and independent users' credentials genuinely coexist without interference.

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

**Timing — resolved:** this prerequisite is complete, tested, and confirmed working (see live isolation test above). Phase 2 circuits can now be built on solid, genuinely multi-user ground.

---

## Module List (Mod 1–6, build order: easy → hard)

### Mod 1: Age Verification
- **Pattern:** Threshold comparison (near-identical to Phase 1's `proveEligibility`)
- **Private witness:** Actual birthdate or age
- **Public:** Minimum age required
- **Real-world use:** Alcohol/tobacco delivery, adult content access, gambling platforms
- **Est. effort:** 2–4 days

### Mod 2: Income / Solvency Proof
- **Pattern:** Threshold comparison — reuses Phase 1's circuit almost as-is
- **Private witness:** Actual income or asset balance
- **Public:** Minimum required threshold
- **Real-world use:** Loan applications, rental applications, visa applications
- **Est. effort:** 2–4 days (mostly relabeling + testing)

### Mod 3: Residency / Location Proof
- **Pattern:** Equality / match check (new pattern — not threshold-based)
- **Private witness:** Actual region or country
- **Public:** Allowed region(s)
- **Real-world use:** Tax eligibility, regional service access, voting eligibility
- **Est. effort:** 4–7 days

### Mod 4: Credential / Certification Proof
- **Pattern:** Hash preimage / commitment matching (extends Phase 1's stale-proof check)
- **Private witness:** Underlying credential data
- **Public:** Commitment hash of the credential
- **Real-world use:** Job applications, professional licensing checks
- **Est. effort:** 4–7 days

### Mod 5: Membership / Allowlist Proof
- **Pattern:** Set-membership (Merkle-proof style)
- **Private witness:** The specific member value + Merkle path
- **Public:** Merkle root of the allowed set
- **Real-world use:** DAO governance, whitelist access, insurance pools
- **Est. effort:** 1–2 weeks (new pattern, needs research into Midnight's supported primitives)

### Mod 6: Uniqueness / Personhood Proof
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

- Confirm Midnight's current documented support for Merkle/set-membership circuits (needed for Mod 5)
- Confirm Midnight's current documented support for nullifier patterns (needed for Mod 6)
- Decide whether Phase 2 circuits live in the same `proveit` contract/repo, or as separate contracts under a shared ProveIt "protocol" umbrella
- Revisit per-user scoping question flagged in the Phase 1 security audit (`commitment`/`threshold` currently global, not keyed per-owner) — likely needs resolving before Phase 2 circuits are added, since multiple proof types per user will compound the issue

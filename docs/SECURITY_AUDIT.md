# ProveIt — Mini Security Audit Report

**Protocol:** ProveIt — ZK Credential Verification Protocol
**Author:** Midas ([@iamkingmelah](https://x.com/iamkingmelah))
**Scope:** `contracts/proveit.compact` (commitCredential, proveEligibility, verifyCredential)
**Status:** Early-stage proof-of-concept, local devnet

---

## Overview

This report documents six vulnerability classes and design-property limitations identified during the design and implementation of ProveIt, a privacy-first credential verification protocol built on Midnight using Compact. Three are contract-logic level risks; one is an infrastructure-level trust boundary; two are design-scope limitations inherent to what a self-contained ZK proof can honestly guarantee.

For each finding: description, why it matters, and how ProveIt's current design addresses (or should address) it.

---

## 1. Fake Hash

**Risk:** A malicious actor commits a hash that does not correspond to any real, honestly-computed value — attempting to pass off an arbitrary or malformed commitment as legitimate.

**Why it matters:** If the contract accepted any 32-byte value as a valid commitment without constraint, an attacker could submit garbage data, potentially disrupting downstream logic or enabling denial-of-service against verifiers expecting well-formed commitments.

**Mitigation in ProveIt:** The `commitCredential` circuit computes the hash *inside the circuit itself* using `persistentHash<Uint<64>>(rawBalance)`, rather than accepting a pre-computed hash as a raw argument. This ensures the commitment stored on-chain is always the genuine output of hashing a real `Uint<64>` value — an attacker cannot submit an arbitrary hash without also providing an underlying value that produces it.

---

## 2. Stale Proof

**Risk:** A prover commits to one value (e.g., a balance of 5,000) but later generates an eligibility proof using a *different* value (e.g., 50,000) that was never actually committed — effectively proving something they didn't originally attest to.

**Why it matters:** Without a binding check between commit and prove, the two steps become disconnected. This breaks the core guarantee of the Commit → Prove → Verify architecture: that the value being proven eligible is the *same* value that was committed earlier, not a substituted one.

**Mitigation in ProveIt:** The `proveEligibility` circuit re-hashes the witness-provided balance and asserts it matches the stored `commitment`:

```
const recomputed = persistentHash<Uint<64>>(balance);
assert(recomputed == commitment, "Proof is stale");
```

This closes the gap — a proof can only succeed if the balance used matches the one originally committed to.

---

## 3. Threshold Manipulation

**Risk:** A malicious actor alters the eligibility threshold after a credential has been committed — either lowering it to make an ineligible balance pass, or manipulating it in a way that benefits one party unfairly.

**Why it matters:** If `threshold` were mutable by anyone other than the original committer, the entire eligibility check becomes meaningless — proofs could be generated against thresholds that were never agreed upon at commitment time.

**Mitigation in ProveIt:** `threshold` is set once, at commitment time, inside `commitCredential`, and is not exposed via any circuit that would allow it to be altered afterward. Because `proveEligibility` reads the threshold from the existing public ledger state (not from a fresh argument), a prover cannot supply their own preferred threshold at proof time — it's locked to whatever was committed.

**Update — multi-user scoping resolved:** the original open question here (single global `threshold`/`commitment`/`verified` fields, allowing one user's commit to overwrite another's) has been resolved. All three fields are now `Map<Opaque<"string">, ...>` types keyed by owner address, giving each user an independent, non-overwritable entry. Confirmed working via live devnet test: two separate addresses committing and proving independently, with each address's `verified` status remaining correct and unaffected by the other's activity.

---

## 4. Proof Server Compromise (Privacy Leak)

**Risk:** Unlike the above three, this is not a contract-logic vulnerability — it's an infrastructure trust boundary. Proof generation happens off-chain, on a proof server, using the prover's private witness data (e.g., `actualBalance`). If a user routes their private inputs through a proof server they do not control or trust, the operator of that server could observe the plaintext private data during proof generation — even though that data never reaches the blockchain.

**Why it matters:** The zero-knowledge guarantee protects data *on-chain* — the blockchain itself never sees the private balance, and cannot be tricked into accepting an invalid proof. But the proof server is not bound by the same guarantee. It sees the raw witness value in order to compute the proof. This is a privacy leak vector distinct from a *correctness* vulnerability: a compromised or malicious proof server cannot forge a false proof that passes verification, but it can leak the private data it was given.

**Mitigation / recommendations:**
- For development, use a local proof server (as ProveIt currently does — `127.0.0.1:6300`, never exposed beyond localhost).
- For production, document this trust boundary explicitly for users: proof generation requires trusting whoever operates the proof server with your private inputs.
- Recommend self-hosted proof servers for privacy-sensitive users, or client-side/browser-based proving where the ecosystem supports it, to eliminate the third-party trust requirement entirely.
- Proof server compromise cannot produce a forged, verification-passing proof for a false statement — this is guaranteed by the underlying SNARK math, independent of the proof server's integrity. The residual risk is confidentiality of inputs, not correctness of outputs.

---

## 5. Unverified Self-Asserted Data (No Trusted Attestation)

**Risk:** In the current implementation, a user can assert *any* value as their private balance — there is nothing that ties `actualBalance()` to a real, externally verifiable fact. The circuit correctly proves internal consistency ("this number satisfies the threshold, and matches what was committed"), but it has no way to verify the number itself reflects reality.

**Why it matters:** This is a fundamental distinction in what zero-knowledge proofs actually guarantee, and it's important not to overstate ProveIt's current capability. ZK proofs prove that a computation was performed correctly on some claimed input — they do not, on their own, prove that the input is *true*. A user could type in "5,000,000" as their balance with no actual funds behind that number, generate a fully valid proof, and pass eligibility — because the proof only checks "does this claimed number satisfy the threshold," not "does this person actually possess this amount."

**Why ProveIt doesn't currently solve this:** the witness (`actualBalance`) is entirely self-reported, supplied directly by the user's own client code (see `cli.ts`), with no external source of truth involved anywhere in the flow.

**How production ZK identity/credential systems solve this (and what ProveIt should adopt):** the standard pattern is **trusted attestation via digital signature**. Instead of the witness being a raw, user-typed number, it becomes a **signed statement from a trusted issuer** — e.g., a bank, employer, or KYC provider cryptographically signs "this account holds ≥ $X" using a known, public verification key. The circuit then verifies two things instead of one:
1. The claimed value satisfies the threshold (as it already does)
2. The claimed value is accompanied by a *valid signature* from a recognized, trusted issuer's public key

Only the second check actually prevents a user from fabricating data — the math alone, without a signature check, cannot distinguish a real claim from an invented one.

**Status:** Not yet implemented. This is a significant, honestly-scoped limitation of the current proof-of-concept, not something to be quietly assumed away. Any production deployment of ProveIt must incorporate a signed-attestation layer before its eligibility proofs can be treated as trustworthy by a relying dApp (e.g., a lender should not treat today's `verified: true` as proof of real solvency — only as proof that a self-reported number satisfied a threshold).

**Architectural direction — a separate attestation protocol ("Classified"):** rather than building signature verification directly into ProveIt, the cleaner design — consistent with ProveIt's own "protocol, not policy" principle (see Section 3, Threshold Manipulation, and the multi-user design notes in the roadmap) — is a dedicated, separate dApp responsible for producing signed, hashed attestations about a user's data (wallet balance, documents, credentials). ProveIt and other verification dApps would then consume those signed hashes as trusted witnesses, rather than raw self-reported values. This keeps ProveIt focused on proving conditions about data, while a separate system is responsible for vouching that the underlying data is real. This concept has been captured as a distinct future project, working name "Classified."

---

## 6. Point-in-Time Proof, Not Sustained-State Proof

**Risk:** `proveEligibility` checks `balance >= threshold` at the exact moment a proof is generated — it is a snapshot check with no concept of time, history, or duration. This means a user could, in principle, temporarily acquire funds sufficient to pass the threshold, generate a valid proof, and immediately move those funds elsewhere afterward. The resulting `verified: true` is entirely genuine and mathematically correct — the balance genuinely met the threshold at that instant — but it says nothing about whether the user holds, or ever meaningfully held, that balance beyond the moment of proving.

**Why it matters:** a relying dApp that treats `verified: true` as evidence of an ongoing or durable financial position (e.g., "this user is creditworthy," "this user meaningfully holds this much capital") would be over-interpreting what the proof actually guarantees. This is a distinct risk from Finding #5: even with a fully trusted, externally-attested balance (solving #5), a snapshot proof is still just a snapshot — attestation solves *is the number real*, not *is the number meaningfully sustained*.

**Whose responsibility this is:** consistent with the "protocol, not policy" principle established elsewhere in this document, ProveIt's job is to honestly prove a condition held at a specific moment — nothing more, nothing less. Whether a single snapshot is sufficient evidence, or whether a decision requires proof sustained across multiple points in time, is a risk-tolerance decision that belongs to the consuming dApp, not to ProveIt itself.

**Recommendation for relying dApps (not a ProveIt-side fix):** applications with meaningful financial or legal stakes should consider requiring multiple independent proofs across separate points in time (e.g., proof of eligibility on several different days) rather than accepting a single proof as sufficient, or pairing ProveIt's proof with their own additional on-chain checks (transaction history, holding-period analysis) outside ProveIt's scope.

**Status:** Not a defect — an inherent, honestly-scoped property of what a single ZK proof can and cannot demonstrate. Documented here so relying dApps do not mistake a point-in-time proof for a durable guarantee.

---

| # | Vulnerability Class | Layer | Status in ProveIt |
|---|---|---|---|
| 1 | Fake Hash | Contract logic | Mitigated — hash computed in-circuit |
| 2 | Stale Proof | Contract logic | Mitigated — commitment re-check enforced |
| 3 | Threshold Manipulation | Contract logic | Mitigated — threshold immutable post-commit; multi-user scoping resolved and confirmed live |
| 4 | Proof Server Compromise | Infrastructure / trust boundary | Documented — local-only proof server recommended; no on-chain correctness risk |
| 5 | Unverified Self-Asserted Data | Trust model / design | **Open — not yet implemented.** Requires a signed-attestation layer before proofs can be treated as trustworthy in production |
| 6 | Point-in-Time Proof, Not Sustained-State Proof | Design property, not a defect | Documented — relying dApps should not treat a single proof as a durable guarantee; mitigation (multiple proofs over time) is the consuming dApp's responsibility |

---

## Notes

This audit reflects the current proof-of-concept scope of ProveIt. Multi-user scoping (#3) is now resolved and confirmed working via live devnet test. The most significant remaining gap is #5 — without a trusted attestation/signature layer, ProveIt's current proofs demonstrate correct math on self-reported data, not verified real-world facts. This should be treated as the top priority before any production or relying-party use, ahead of expanding to additional proof types in Phase 2. Finding #6 is not a defect requiring a fix, but an honest scope boundary that relying dApps must design around — a proof demonstrates a condition held at one moment, not that it holds continuously.

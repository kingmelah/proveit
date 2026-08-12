# ProveIt — Mini Security Audit Report

**Protocol:** ProveIt — ZK Credential Verification Protocol
**Author:** Midas ([@iamkingmelah](https://x.com/iamkingmelah))
**Scope:** `contracts/proveit.compact` (commitCredential, proveEligibility, verifyCredential)
**Status:** Early-stage proof-of-concept, local devnet

---

## Overview

This report documents four vulnerability classes identified during the design and implementation of ProveIt, a privacy-first credential verification protocol built on Midnight using Compact. Three of these are contract-logic level risks; the fourth is an infrastructure-level trust boundary inherent to the proof-generation process itself.

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

**Open question for further hardening:** the current design assumes a single credential per contract instance (no multi-user namespacing). A production version should consider whether `threshold` and `commitment` need to be scoped per-owner (e.g., keyed by `owner` address) to prevent one user's commitment from overwriting another's.

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

## Summary Table

| # | Vulnerability Class | Layer | Status in ProveIt |
|---|---|---|---|
| 1 | Fake Hash | Contract logic | Mitigated — hash computed in-circuit |
| 2 | Stale Proof | Contract logic | Mitigated — commitment re-check enforced |
| 3 | Threshold Manipulation | Contract logic | Mitigated — threshold immutable post-commit; multi-user scoping is an open question |
| 4 | Proof Server Compromise | Infrastructure / trust boundary | Documented — local-only proof server recommended; no on-chain correctness risk |

---

## Notes

This audit reflects the current single-credential, proof-of-concept scope of ProveIt. As the protocol expands toward multi-party trust and third-party verifier support (v2), each of these findings should be revisited — particularly threshold/commitment scoping (#3) and proof server trust models for a broader user base (#4).

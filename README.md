# ProveIt

**A privacy-first credential verification protocol on Midnight.**

ProveIt lets users prove they meet eligibility criteria — without revealing the underlying data that proves it. Built with Compact on the Midnight Network.

## Architecture

ProveIt follows a **Commit → Prove → Verify** flow:

1. **Commit** — A credential is committed on-chain as a cryptographic hash, not the raw data itself.
2. **Prove** — The holder generates a zero-knowledge proof that their credential satisfies some eligibility condition (e.g. "over 18", "holds valid certification") without revealing the credential's actual contents.
3. **Verify** — Any party can verify the proof on-chain, confirming eligibility without ever seeing the private data.

## Circuits

| Circuit | Purpose |
|---|---|
| `commitCredential` | Commits a hashed credential to the ledger |
| `proveEligibility` | Generates a ZK proof of eligibility against a committed credential |
| `verifyCredential` | Verifies a submitted proof on-chain |

## Why This Matters

Traditional credential checks require revealing the credential itself — an ID, a certificate, a balance. ProveIt demonstrates that eligibility can be verified with zero data exposure, a core promise of privacy-preserving blockchain infrastructure.

## Status

Early-stage proof-of-concept. Currently targeting devnet deployment, with a reference implementation scoped to a single dApp use case (multi-party trust and third-party verifier support planned for v2).

## Tech Stack

- **Compact** — smart contract language
- **TypeScript / Node.js** — deployment and client tooling
- **Midnight Network** — privacy-preserving L1

## Running Locally

ProveIt includes a self-contained local devnet — no external tools required.

**Prerequisites:**
- Node.js 22+
- Docker and Docker Compose
- Yarn (`yarn --version` to check; this project uses Yarn, not npm)

**1. Install dependencies:**
```bash
yarn install
```

**2. Start the local devnet (node, indexer, proof server):**
```bash
docker compose up -d
```

**3. Compile the contract:**
```bash
yarn compile
```

**4. Deploy to your local devnet:**
```bash
yarn deploy
```

**5. Interact with the deployed contract:**
```bash
yarn cli
```

**To stop the devnet:**
```bash
docker compose down
```

## Author

Midas ([@iamkingmelah](https://x.com/iamkingmelah))
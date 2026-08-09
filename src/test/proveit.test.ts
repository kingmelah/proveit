import { describe, it, expect } from 'vitest';
import { Contract } from '../../contracts/managed/proveit/contract/index.js';

// ============================================================
// ProveIt - Test Suite
// Chapter 6: Testing the Commit → Prove → Verify flow
// ============================================================


// ── Level 2: Contract Interface Tests ──────────────────────
describe('ProveIt Contract Interface', () => {

  it('should instantiate contract with actualBalance witness', () => {
    const contract = new Contract({
      actualBalance: (_context: any) => [_context, 500n]
    });
    expect(contract).toBeDefined();
    expect(contract.circuits).toBeDefined();
    expect(contract.witnesses).toBeDefined();
  });

  it('should expose all three circuits', () => {
    const contract = new Contract({
      actualBalance: (_context: any) => [_context, 500n]
    });
    expect(contract.circuits.commitCredential).toBeDefined();
    expect(contract.circuits.proveEligibility).toBeDefined();
    expect(contract.circuits.verifyCredential).toBeDefined();
  });

  it('witness should return bigint balance', () => {
    const expectedBalance = 500n;
    const contract = new Contract({
      actualBalance: (_context: any) => [_context, expectedBalance]
    });
    const [_, balance] = contract.witnesses.actualBalance({} as any);
    expect(typeof balance).toBe('bigint');
    expect(balance).toBe(expectedBalance);
  });

});
/**
 * Standalone genesis wallet funding script for ProveIt's local devnet.
 * Sends NIGHT from the well-known genesis wallet to a target address,
 * without depending on any external tool.
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { InMemoryTransactionHistoryStorage, TransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { WebSocket } from 'ws';
import { Buffer } from 'buffer';
import * as Rx from 'rxjs';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

setNetworkId('undeployed');

const CONFIG = {
  indexer: 'http://127.0.0.1:8088/api/v3/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
  node: 'http://127.0.0.1:9944',
  proofServer: 'http://127.0.0.1:6300',
};

// Well-known genesis mint wallet seed — gives access to tokens minted
// in the genesis block of any local Midnight devnet. Not a secret.
const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const NIGHT_AMOUNT = 50_000n * 10n ** 6n; // 50,000 NIGHT in smallest unit

async function buildWallet(seedHex: string) {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seedHex, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Invalid seed');
  const result = hdWallet.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
  hdWallet.hdWallet.clear();

  const networkId = getNetworkId();
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(result.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(result.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(result.keys[Roles.NightExternal], networkId);

  const walletConfig = {
    networkId,
    indexerClientConnection: { indexerHttpUrl: CONFIG.indexer, indexerWsUrl: CONFIG.indexerWS },
    provingServerUrl: new URL(CONFIG.proofServer),
    relayURL: new URL(CONFIG.node.replace(/^http/, 'ws')),
    txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistoryStorage.TransactionHistoryCommonSchema),
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  };

  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: async (config) => ShieldedWallet(config).startWithSecretKeys(shieldedSecretKeys),
    unshielded: async (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: async (config) => DustWallet(config).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}

async function main() {
  const targetAddressStr = process.argv[2];
  if (!targetAddressStr) {
    console.error('\n❌ Usage: tsx src/fund-wallet.ts <recipient-address>\n');
    process.exit(1);
  }

  console.log('\n  Building genesis wallet...');
  const genesisWallet = await buildWallet(GENESIS_SEED);

  console.log('  Syncing genesis wallet...');
  await Rx.firstValueFrom(genesisWallet.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('  ✓ Genesis wallet synced.\n');

  const parsed = MidnightBech32m.parse(targetAddressStr);
  const networkId = getNetworkId();
  const receiverAddress = UnshieldedAddress.codec.decode(networkId as any, parsed);

  console.log(`  Transferring ${NIGHT_AMOUNT.toLocaleString()} (smallest units) NIGHT to:`);
  console.log(`  ${targetAddressStr}\n`);

  const ttl = new Date(Date.now() + 30 * 60 * 1000);
  const recipe = await genesisWallet.wallet.transferTransaction(
    [{
      type: 'unshielded',
      outputs: [{ type: ledger.nativeToken().raw, receiverAddress, amount: NIGHT_AMOUNT }],
    }],
    { shieldedSecretKeys: genesisWallet.shieldedSecretKeys, dustSecretKey: genesisWallet.dustSecretKey },
    { ttl },
  );
  const signed = await genesisWallet.wallet.signRecipe(recipe, (payload) =>
    genesisWallet.unshieldedKeystore.signData(payload),
  );
  const finalized = await genesisWallet.wallet.finalizeRecipe(signed);
  const txId = await genesisWallet.wallet.submitTransaction(finalized);

  console.log(`  ✅ Transfer submitted: ${txId}\n`);

  await genesisWallet.wallet.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
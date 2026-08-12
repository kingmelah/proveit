/**
 * Deploy ProveIt contract to Midnight Preprod network
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';
import { Buffer } from 'buffer';

// Midnight SDK imports
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet, UnshieldedSectionSchema } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { TransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { CompiledContract } from '@midnight-ntwrk/compact-js';

// Enable WebSocket for GraphQL subscriptions
// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// Set network to preprod
setNetworkId('undeployed');

// Preprod network configuration
const CONFIG = {
  indexer: 'http://127.0.0.1:8088/api/v3/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
  node: 'http://127.0.0.1:9944',
  proofServer: 'http://127.0.0.1:6300',
};

// ─── Proof Server Health Check ─────────────────────────────────────────────────

async function waitForProofServer(maxAttempts = 30, delayMs = 2000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fetch(CONFIG.proofServer, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return true;
    } catch (err: any) {
      const errMsg = err?.cause?.code || err?.code || '';
      if (errMsg !== 'ECONNREFUSED' && errMsg !== 'UND_ERR_CONNECT_TIMEOUT') {
        return true;
      }
    }
    if (attempt < maxAttempts) {
      process.stdout.write(`\r  Waiting for proof server... (${attempt}/${maxAttempts})   `);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'proveit');

// Load compiled contract
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

// Check if contract is compiled
if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

const ProveIt = await import(pathToFileURL(contractPath).href);

const witnesses = {
  actualBalance: (context: any): [never, bigint] => {
    return [context.privateState as never, 0n];
  },
};

const compiledContract = CompiledContract.make('proveit', ProveIt.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

// ─── Wallet Functions ──────────────────────────────────────────────────────────

function deriveKeys(seed: string) {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Invalid seed');
  const result = hdWallet.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
  hdWallet.hdWallet.clear();
  return result.keys;
}

async function createWallet(seed: string) {
  const keys = deriveKeys(seed);
  const networkId = getNetworkId();
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);

  const walletConfig = {
    networkId,
    indexerClientConnection: { indexerHttpUrl: CONFIG.indexer, indexerWsUrl: CONFIG.indexerWS },
    provingServerUrl: new URL(CONFIG.proofServer),
    relayURL: new URL(CONFIG.node.replace(/^http/, 'ws')),
    txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistoryStorage.TransactionHistoryCommonSchema),
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  };

  const wallet = await WalletFacade.init({
    configuration: walletConfig as any,
    shielded: async (config) => ShieldedWallet(config).startWithSecretKeys(shieldedSecretKeys),
    unshielded: async (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: async (config) => DustWallet(config).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}

async function createProviders(walletCtx: ReturnType<typeof createWallet> extends Promise<infer T> ? T : never) {
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Dev3lopment_Local!';

  const state = await walletCtx.wallet.waitForSyncedState();

  const walletProvider = {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signedRecipe = await walletCtx.wallet.signRecipe(recipe, (payload) =>
        walletCtx.unshieldedKeystore.signData(payload),
      );
      return walletCtx.wallet.finalizeRecipe(signedRecipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'proveit-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(CONFIG.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─── Main Deploy Script ────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           Deploy ProveIt to Midnight Local Dev              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    let existingSeed: string | undefined;
    let existingContract: string | undefined;

    if (fs.existsSync('.midnight-seed')) {
      try {
        existingSeed = fs.readFileSync('.midnight-seed', 'utf-8').trim();
      } catch {
        // Ignore read errors
      }
    }

    if (fs.existsSync('deployment.json')) {
      try {
        const existing = JSON.parse(fs.readFileSync('deployment.json', 'utf-8'));
        if (existing.contractAddress) existingContract = existing.contractAddress;
      } catch {
        // Ignore parse errors
      }
    }

    if (existingContract) {
      console.log('─── Existing Deployment Found ──────────────────────────────────\n');
      console.log(`  Contract: ${existingContract}`);
      const redeploy = await rl.question('\n  Deploy a new contract? [y/N] ');
      if (redeploy.toLowerCase() !== 'y') {
        console.log('  Next: Run `npm run cli` to interact with ProveIt.\n');
        return;
      }
      existingSeed = undefined;
    }

    // 1. Wallet setup
    console.log('─── Step 1: Wallet Setup ───────────────────────────────────────\n');

    let seed: string;

    if (existingSeed) {
      console.log('  Found saved seed from previous attempt.');
      const useSaved = await rl.question('  Use saved wallet? [Y/n] ');
      if (useSaved.toLowerCase() !== 'n') {
        seed = existingSeed;
        console.log('  Using saved wallet...\n');
      } else {
        const choice = await rl.question('  [1] Create new wallet\n  [2] Restore from seed\n  > ');
        seed = choice.trim() === '2'
          ? await rl.question('\n  Enter your 64-character seed: ')
          : toHex(Buffer.from(generateRandomSeed()));

        if (choice.trim() !== '2') {
          fs.writeFileSync('.midnight-seed', seed, { mode: 0o600 });
          console.log('\n  ⚠️  A new wallet seed has been generated.');
          console.log('  It has been saved to .midnight-seed (chmod 600).');
          console.log('  Back it up securely and never commit this file.\n');
        }
      }
    } else {
      const choice = await rl.question('  [1] Create new wallet\n  [2] Restore from seed\n  > ');
      seed = choice.trim() === '2'
        ? await rl.question('\n  Enter your 64-character seed: ')
        : toHex(Buffer.from(generateRandomSeed()));

      if (choice.trim() !== '2') {
        fs.writeFileSync('.midnight-seed', seed, { mode: 0o600 });
        console.log('\n  ⚠️  A new wallet seed has been generated.');
        console.log('  It has been saved to .midnight-seed (chmod 600).');
        console.log('  Back it up securely and never commit this file.\n');
      }
    }

    console.log('  Creating wallet...');
    const walletCtx = await createWallet(seed.trim());

    console.log('  Syncing with network...');
    console.log('  ℹ  This may take several minutes depending on network size.');
    console.log('     RPC disconnection messages during sync are normal and can be safely ignored.\n');
    const syncStart = Date.now();
    const syncInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - syncStart) / 1000);
      process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
    }, 5000);
    const state = await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncInterval);
    process.stdout.write('\r  ✓ Synced with network.                                      \n');
    const address = walletCtx.unshieldedKeystore.getBech32Address();
    const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;

    console.log(`\n  Wallet Address: ${address}`);
    console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

    // 2. Fund wallet if needed
    if (balance === 0n) {
      console.log('─── Step 2: Fund Your Wallet ───────────────────────────────────\n');
      console.log(`  Visit: https://faucet.midnight.network`);
      console.log(`  Address: ${address}\n`);
      console.log('  Waiting for funds...');

      await Rx.firstValueFrom(
        walletCtx.wallet.state().pipe(
          Rx.throttleTime(10000),
          Rx.filter((s) => s.isSynced),
          Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
          Rx.filter((b) => b > 0n),
        ),
      );
      console.log('  Funds received!\n');
    }

    // 3. Register for DUST
    console.log('─── Step 3: DUST Token Setup ───────────────────────────────────\n');
    const dustState = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
    const unregisteredUtxos = dustState.unshielded?.availableCoins.filter(
      (coin: any) => coin.meta.registeredForDustGeneration === false
    ) ?? [];

    if (unregisteredUtxos.length > 0) {
      console.log(`  Registering ${unregisteredUtxos.length} NIGHT UTXOs for DUST generation...`);
      const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
        unregisteredUtxos,
        walletCtx.unshieldedKeystore.getPublicKey(),
        (payload: any) => walletCtx.unshieldedKeystore.signData(payload),
      );
      const finalizedTx = await walletCtx.wallet.finalizeRecipe(recipe);
      const txId = await walletCtx.wallet.submitTransaction(finalizedTx);
      console.log(`  DUST registration submitted: ${txId}`);
      console.log('  Waiting for DUST to be generated...');
      await Rx.firstValueFrom(
        walletCtx.wallet.state().pipe(
          Rx.throttleTime(5_000),
          Rx.filter((s: any) => (s.dust?.balance(new Date()) ?? 0n) > 0n),
        ),
      );
      console.log('  ✓ DUST tokens ready!\n');
    } else {
      const dustBalance = dustState.dust?.balance(new Date()) ?? 0n;
      if (dustBalance > 0n) {
        console.log(`  DUST already registered (balance: ${dustBalance})\n`);
      } else {
        console.log('  No unregistered NIGHT UTXOs — skipping.\n');
      }
    }

    // 4. Deploy contract
    console.log('─── Step 4: Deploy Contract ────────────────────────────────────\n');

    console.log('  Checking proof server...');
    const proofServerReady = await waitForProofServer();
    if (!proofServerReady) {
      console.log('\n  ❌ Proof server not responding\n');
      console.log('  ┌─ Start it with ──────────────────────────────────────────────┐');
      console.log('  │  $ docker compose up -d                                      │');
      console.log('  │  Then retry:  $ npm run deploy                               │');
      console.log('  └──────────────────────────────────────────────────────────────┘\n');

      fs.writeFileSync('.midnight-seed', seed, { mode: 0o600 });
      const partialInfo = { address, network: 'preprod', status: 'proof_server_unavailable' };
      fs.writeFileSync('deployment.json', JSON.stringify(partialInfo, null, 2));

      await walletCtx.wallet.stop();
      process.exit(1);
    }
    process.stdout.write('\r  Proof server ready!                    \n');

    console.log('  Setting up providers...');
    const providers = await createProviders(walletCtx);

    console.log('  Deploying contract...\n');

    const MAX_RETRIES = 8;
    const RETRY_DELAY_MS = 15000;

    let deployed: Awaited<ReturnType<typeof deployContract>> | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log('DEBUG compiledContract keys:', Object.getOwnPropertySymbols(compiledContract));
        console.log('DEBUG compiledContract:', compiledContract);
        deployed = await deployContract(providers, {
        compiledContract: compiledContract as any,
        args: [],
      });
        break;
      } catch (err: any) {
        const errMsg = err?.message || err?.toString() || '';
        const errCause = err?.cause?.message || err?.cause?.toString() || '';
        const fullError = `${errMsg} ${errCause}`;

        if (fullError.includes('Failed to connect to Proof Server') ||
            fullError.includes('Failed to prove') ||
            fullError.includes('127.0.0.1:6300')) {
          console.log('  ❌ Proof server error\n');
          fs.writeFileSync('.midnight-seed', seed, { mode: 0o600 });
          await walletCtx.wallet.stop();
          process.exit(1);
        }

        if (fullError.includes('Not enough Dust')) {
          const currentState = await walletCtx.wallet.waitForSyncedState();
          const dustBalance = currentState.dust.balance(new Date());

          if (attempt < MAX_RETRIES) {
            console.log(`  ⏳ DUST balance: ${dustBalance.toLocaleString()} (need more for tx fees)`);
            console.log(`     Attempt ${attempt}/${MAX_RETRIES} - waiting for DUST to accumulate...`);

            for (let i = RETRY_DELAY_MS / 1000; i > 0; i -= 5) {
              process.stdout.write(`\r     Retrying in ${i}s...   `);
              await new Promise((r) => setTimeout(r, 5000));
            }
            process.stdout.write('\r                              \r\n');
          } else {
            console.log('  ❌ Not enough DUST for transaction fees\n');
            fs.writeFileSync('.midnight-seed', seed, { mode: 0o600 });
            const partialInfo = { address, network: 'preprod', status: 'pending_dust', lastAttempt: new Date().toISOString() };
            fs.writeFileSync('deployment.json', JSON.stringify(partialInfo, null, 2));
            await walletCtx.wallet.stop();
            process.exit(1);
          }
        } else {
          throw err;
        }
      }
    }

    if (!deployed) {
      throw new Error('Deployment failed after all retries');
    }

    const contractAddress = deployed.deployTxData.public.contractAddress;
    console.log('  ✅ Contract deployed successfully!\n');
    console.log(`  Contract Address: ${contractAddress}\n`);

    fs.writeFileSync('.midnight-seed', seed, { mode: 0o600 });
    const deploymentInfo = {
      contractAddress,
      network: 'local',
      deployedAt: new Date().toISOString(),
    };
    fs.writeFileSync('deployment.json', JSON.stringify(deploymentInfo, null, 2));
    console.log('  Saved to deployment.json\n');

    await walletCtx.wallet.stop();
    console.log('─── Deployment Complete! ───────────────────────────────────────\n');
    console.log('  Next: Run `npm run cli` to interact with ProveIt.\n');
  } finally {
    rl.close();
  }
}

main().catch(console.error);
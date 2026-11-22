import "dotenv/config";
import * as StellarSdk from "@stellar/stellar-sdk";

const TESTNET_RPC_URL =
  process.env.TESTNET_RPC_URL || "https://soroban-testnet.stellar.org";
const FRIENDBOT_URL =
  process.env.FRIENDBOT_URL || "https://friendbot.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

interface SeedResult {
  network: "testnet";
  rpcUrl: string;
  account: {
    publicKey: string;
    secretKey: string;
  };
  contract: {
    assetCode: string;
    contractId: string;
    deployTxHash: string;
    deployTxXdr: string;
  };
  sampleInvokeTxXdr: string;
}

async function fundAccount(publicKey: string): Promise<void> {
  const response = await fetch(
    `${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`,
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Friendbot funding failed (${response.status}): ${body || response.statusText}`,
    );
  }
}

async function waitForTransaction(
  server: StellarSdk.rpc.Server,
  hash: string,
  maxAttempts = 20,
  delayMs = 1500,
): Promise<StellarSdk.rpc.Api.GetSuccessfulTransactionResponse> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const txResponse = await server.getTransaction(hash);
    if (
      txResponse.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS
    ) {
      return txResponse;
    }
    if (txResponse.status === StellarSdk.rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction ${hash} failed on-chain`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `Timed out waiting for transaction ${hash} after ${maxAttempts} attempts`,
  );
}

async function seedTestnet(): Promise<SeedResult> {
  const jsonOutput = process.argv.includes("--json");
  const log = (message: string) => {
    if (!jsonOutput) {
      console.warn(message);
    }
  };

  const server = new StellarSdk.rpc.Server(TESTNET_RPC_URL);
  const keypair = StellarSdk.Keypair.random();

  log(`1. Funding test account ${keypair.publicKey()} via Friendbot...`);
  await fundAccount(keypair.publicKey());

  const assetCode = "MOCK";
  const mockAsset = new StellarSdk.Asset(assetCode, keypair.publicKey());
  const contractId = mockAsset.contractId(NETWORK_PASSPHRASE);

  log(`2. Deploying Stellar Asset Contract (${assetCode}) -> ${contractId}...`);
  const sourceAccount = await server.getAccount(keypair.publicKey());

  const deployTx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.createStellarAssetContract({ asset: mockAsset }),
    )
    .setTimeout(30)
    .build();

  const preparedDeployTx = await server.prepareTransaction(deployTx);
  preparedDeployTx.sign(keypair);
  const deployTxXdr = preparedDeployTx.toXDR();

  const sendResponse = await server.sendTransaction(preparedDeployTx);
  if (sendResponse.status === "ERROR") {
    throw new Error(
      `Failed to submit deployment transaction: ${JSON.stringify(sendResponse.errorResult)}`,
    );
  }

  log(`3. Waiting for confirmation (tx: ${sendResponse.hash})...`);
  await waitForTransaction(server, sendResponse.hash);

  log("4. Building sample contract invocation XDR for simulation testing...");
  const refreshedAccount = await server.getAccount(keypair.publicKey());
  const contract = new StellarSdk.Contract(contractId);
  const sampleInvokeTx = new StellarSdk.TransactionBuilder(refreshedAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "balance",
        new StellarSdk.Address(keypair.publicKey()).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  return {
    network: "testnet",
    rpcUrl: TESTNET_RPC_URL,
    account: {
      publicKey: keypair.publicKey(),
      secretKey: keypair.secret(),
    },
    contract: {
      assetCode,
      contractId,
      deployTxHash: sendResponse.hash,
      deployTxXdr,
    },
    sampleInvokeTxXdr: sampleInvokeTx.toXDR(),
  };
}

seedTestnet()
  .then((result) => {
    if (process.argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    process.stdout.write(
      [
        "",
        "=== Stellar Testnet Seed Complete ===",
        `Network:           ${result.network}`,
        `RPC URL:           ${result.rpcUrl}`,
        `Public Key:        ${result.account.publicKey}`,
        `Secret Key:        ${result.account.secretKey}`,
        `Contract ID:       ${result.contract.contractId}`,
        `Deploy Tx Hash:    ${result.contract.deployTxHash}`,
        `Deploy Tx XDR:     ${result.contract.deployTxXdr}`,
        `Sample Invoke XDR: ${result.sampleInvokeTxXdr}`,
        "",
      ].join("\n"),
    );
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Seed script failed: ${message}`);
    process.exit(1);
  });

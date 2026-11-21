import * as StellarSdk from "@stellar/stellar-sdk";

export interface MockFootprintOptions {
  readOnly?: StellarSdk.xdr.LedgerKey[];
  readWrite?: StellarSdk.xdr.LedgerKey[];
}

export interface MockTxOptions {
  sourceAccount: string | StellarSdk.Keypair;
  sequence: string | number;
  fee: string | number;
  networkPassphrase: string;
  timeout: number;
  contractId: string;
  method: string;
  args: StellarSdk.xdr.ScVal[];
  footprint: MockFootprintOptions;
  auth: (StellarSdk.Keypair | StellarSdk.xdr.SorobanAuthorizationEntry)[];
  signers: StellarSdk.Keypair[];
  operations: StellarSdk.xdr.Operation[];
}

export const DEFAULT_TEST_SOURCE_KEYPAIR =
  StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));

export const DEFAULT_TEST_CONTRACT_ID = StellarSdk.Address.contract(
  Buffer.alloc(32, 7),
).toString();

function buildSignatureScVal(keypair: StellarSdk.Keypair): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvVec([
    StellarSdk.xdr.ScVal.scvMap([
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol("public_key"),
        val: StellarSdk.xdr.ScVal.scvBytes(keypair.rawPublicKey()),
      }),
      new StellarSdk.xdr.ScMapEntry({
        key: StellarSdk.xdr.ScVal.scvSymbol("signature"),
        val: StellarSdk.xdr.ScVal.scvBytes(keypair.sign(Buffer.alloc(32))),
      }),
    ]),
  ]);
}

function buildAuthEntryForSigner(
  signer: StellarSdk.Keypair,
  contractId: string,
  method: string,
  args: StellarSdk.xdr.ScVal[],
): StellarSdk.xdr.SorobanAuthorizationEntry {
  const rootInvocation = new StellarSdk.xdr.SorobanAuthorizedInvocation({
    function:
      StellarSdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new StellarSdk.xdr.InvokeContractArgs({
          contractAddress: new StellarSdk.Address(contractId).toScAddress(),
          functionName: method,
          args,
        }),
      ),
    subInvocations: [],
  });

  return new StellarSdk.xdr.SorobanAuthorizationEntry({
    rootInvocation,
    credentials: StellarSdk.xdr.SorobanCredentials.sorobanCredentialsAddress(
      new StellarSdk.xdr.SorobanAddressCredentials({
        address: new StellarSdk.Address(signer.publicKey()).toScAddress(),
        nonce: 1n,
        signatureExpirationLedger: 1000,
        signature: buildSignatureScVal(signer),
      }),
    ),
  });
}

/**
 * Fluent builder for constructing mock Soroban transactions in unit tests.
 */
export class MockTransactionBuilder {
  private sourceAccount: string;
  private sequence: string;
  private fee: string;
  private networkPassphrase: string;
  private timeout: number;
  private contractId: string;
  private method: string;
  private args: StellarSdk.xdr.ScVal[];
  private footprint?: MockFootprintOptions;
  private authEntries: (
    | StellarSdk.Keypair
    | StellarSdk.xdr.SorobanAuthorizationEntry
  )[];
  private envelopeSigners: StellarSdk.Keypair[];
  private customOperations?: StellarSdk.xdr.Operation[];

  constructor(options: Partial<MockTxOptions> = {}) {
    const source = options.sourceAccount ?? DEFAULT_TEST_SOURCE_KEYPAIR;
    this.sourceAccount =
      typeof source === "string" ? source : source.publicKey();
    this.sequence = String(options.sequence ?? "1");
    this.fee = String(options.fee ?? "100");
    this.networkPassphrase =
      options.networkPassphrase ?? StellarSdk.Networks.TESTNET;
    this.timeout = options.timeout ?? 0;
    this.contractId = options.contractId ?? DEFAULT_TEST_CONTRACT_ID;
    this.method = options.method ?? "hello";
    this.args = options.args ?? [];
    this.footprint = options.footprint;
    this.authEntries = options.auth ?? [];
    this.envelopeSigners = options.signers ?? [];
    this.customOperations = options.operations;
  }

  withContractCall(
    contractId: string,
    method: string,
    args: StellarSdk.xdr.ScVal[] = [],
  ): this {
    this.contractId = contractId;
    this.method = method;
    this.args = args;
    return this;
  }

  withFootprint(footprint: MockFootprintOptions): this {
    this.footprint = footprint;
    return this;
  }

  withAuth(
    signers: (StellarSdk.Keypair | StellarSdk.xdr.SorobanAuthorizationEntry)[],
  ): this {
    this.authEntries = signers;
    return this;
  }

  withSource(source: string | StellarSdk.Keypair): this {
    this.sourceAccount =
      typeof source === "string" ? source : source.publicKey();
    return this;
  }

  withNetworkPassphrase(networkPassphrase: string): this {
    this.networkPassphrase = networkPassphrase;
    return this;
  }

  withFee(fee: string | number): this {
    this.fee = String(fee);
    return this;
  }

  withSequence(sequence: string | number): this {
    this.sequence = String(sequence);
    return this;
  }

  withTimeout(timeout: number): this {
    this.timeout = timeout;
    return this;
  }

  withSignatures(...signers: StellarSdk.Keypair[]): this {
    this.envelopeSigners.push(...signers);
    return this;
  }

  build(): StellarSdk.Transaction {
    const builder = new StellarSdk.TransactionBuilder(
      new StellarSdk.Account(this.sourceAccount, this.sequence),
      {
        fee: this.fee,
        networkPassphrase: this.networkPassphrase,
      },
    );

    if (this.customOperations) {
      for (const op of this.customOperations) {
        builder.addOperation(op);
      }
    } else {
      const resolvedAuth = this.authEntries.map((entry) =>
        entry instanceof StellarSdk.Keypair
          ? buildAuthEntryForSigner(
              entry,
              this.contractId,
              this.method,
              this.args,
            )
          : entry,
      );

      builder.addOperation(
        StellarSdk.Operation.invokeHostFunction({
          func: StellarSdk.xdr.HostFunction.hostFunctionTypeInvokeContract(
            new StellarSdk.xdr.InvokeContractArgs({
              contractAddress: new StellarSdk.Address(
                this.contractId,
              ).toScAddress(),
              functionName: this.method,
              args: this.args,
            }),
          ),
          auth: resolvedAuth,
        }),
      );
    }

    if (this.footprint) {
      const sorobanData = new StellarSdk.SorobanDataBuilder()
        .setReadOnly(this.footprint.readOnly ?? [])
        .setReadWrite(this.footprint.readWrite ?? [])
        .build();
      builder.setSorobanData(sorobanData);
    }

    const tx = builder.setTimeout(this.timeout).build();

    if (this.envelopeSigners.length > 0) {
      tx.sign(...this.envelopeSigners);
    }

    return tx;
  }

  toXDR(): string {
    return this.build().toXDR();
  }
}

/**
 * Create a fluent MockTransactionBuilder for Soroban transaction tests.
 */
export function mockTransaction(
  options?: Partial<MockTxOptions>,
): MockTransactionBuilder {
  return new MockTransactionBuilder(options);
}

/**
 * Build a mock Soroban StellarSdk.Transaction from partial options.
 */
export function buildMockTransaction(
  options?: Partial<MockTxOptions>,
): StellarSdk.Transaction {
  return new MockTransactionBuilder(options).build();
}

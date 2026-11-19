import * as StellarSdk from "@stellar/stellar-sdk";

// Independently hashed XDR preimage: envelope type 8, testnet network hash,
// address preimage type 0, account address type 0, Ed25519 type 0, key and salt.
export const PREDICTED_CONTRACT =
  "CAAAEPQQMUHTSIDDPVJM57JHCKH7YJEGW2QW6FRONO373Q4HOCGWJSB2";

export function deploymentHostFunction(
  constructor: boolean,
): StellarSdk.xdr.HostFunction {
  const contractIdPreimage =
    StellarSdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new StellarSdk.xdr.ContractIdPreimageFromAddress({
        address: StellarSdk.Address.account(Buffer.alloc(32, 1)).toScAddress(),
        salt: Buffer.alloc(32, 2),
      }),
    );
  const executable = StellarSdk.xdr.ContractExecutable.contractExecutableWasm(
    Buffer.alloc(32, 3),
  );
  return constructor
    ? StellarSdk.xdr.HostFunction.hostFunctionTypeCreateContractV2(
        new StellarSdk.xdr.CreateContractArgsV2({
          contractIdPreimage,
          executable,
          constructorArgs: [StellarSdk.nativeToScVal(42, { type: "u32" })],
        }),
      )
    : StellarSdk.xdr.HostFunction.hostFunctionTypeCreateContract(
        new StellarSdk.xdr.CreateContractArgs({
          contractIdPreimage,
          executable,
        }),
      );
}

export function deploymentTransaction(
  constructor = true,
): StellarSdk.Transaction {
  return new StellarSdk.TransactionBuilder(
    new StellarSdk.Account(
      StellarSdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1)),
      "0",
    ),
    {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    },
  )
    .addOperation(
      StellarSdk.Operation.invokeHostFunction({
        func: deploymentHostFunction(constructor),
      }),
    )
    .setTimeout(30)
    .build();
}

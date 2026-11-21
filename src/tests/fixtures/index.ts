import blendDeposit from "./tokens/blend-deposit.json";
import sacXlmTransfer from "./tokens/sac-xlm-transfer.json";
import sep41UsdcApprove from "./tokens/sep41-usdc-approve.json";
import sep41UsdcTransfer from "./tokens/sep41-usdc-transfer.json";
import soroswapSwap from "./tokens/soroswap-swap.json";

export interface SimulateTransactionFixtureResult {
  transactionData: string;
  minResourceFee: string;
  cost: {
    cpuInsns: string;
    memBytes: string;
  };
  events: unknown[];
  latestLedger: number;
}

export interface TokenFixture {
  name: string;
  protocol: string;
  operation: string;
  contractId: string;
  functionName: string;
  network: string;
  simulateTransaction: SimulateTransactionFixtureResult;
}

export const TOKEN_FIXTURES = {
  "sac-xlm-transfer": sacXlmTransfer as TokenFixture,
  "sep41-usdc-transfer": sep41UsdcTransfer as TokenFixture,
  "sep41-usdc-approve": sep41UsdcApprove as TokenFixture,
  "soroswap-swap": soroswapSwap as TokenFixture,
  "blend-deposit": blendDeposit as TokenFixture,
} as const;

export type TokenFixtureName = keyof typeof TOKEN_FIXTURES;

export const TOKEN_CONTRACT_IDS = {
  XLM_SAC: sacXlmTransfer.contractId,
  USDC_SEP41: sep41UsdcTransfer.contractId,
  SOROSWAP_ROUTER: soroswapSwap.contractId,
  BLEND_POOL: blendDeposit.contractId,
} as const;

/**
 * Load a pre-recorded Soroban RPC token fixture by its fixture name.
 */
export function getTokenFixture(name: TokenFixtureName): TokenFixture {
  return TOKEN_FIXTURES[name];
}

/**
 * Look up a pre-recorded Soroban RPC fixture by contract ID and optional function name.
 */
export function getFixtureByContractId(
  contractId: string,
  functionName?: string,
): TokenFixture | undefined {
  const matches = Object.values(TOKEN_FIXTURES).filter(
    (fixture) => fixture.contractId === contractId,
  );
  if (matches.length === 0) return undefined;
  if (functionName) {
    const exact = matches.find(
      (fixture) => fixture.functionName === functionName,
    );
    if (exact) return exact;
  }
  return matches[0];
}

/**
 * Return all available pre-recorded Soroban ecosystem token fixtures.
 */
export function listTokenFixtures(): TokenFixture[] {
  return Object.values(TOKEN_FIXTURES);
}

export * from "./deployment";
export * from "./footprints";
export * from "./xdr";

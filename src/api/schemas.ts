import { z } from "zod";

export const CostBreakdownQuerySchema = z.object({
  cpuInsns: z.string().regex(/^\d+$/, "cpuInsns must be a non-negative integer string"),
  memBytes: z.string().regex(/^\d+$/, "memBytes must be a non-negative integer string"),
  network: z.enum(["mainnet", "testnet", "futurenet"]).optional(),
});

export type CostBreakdownQuery = z.infer<typeof CostBreakdownQuerySchema>;

export const DecodeQuerySchema = z.object({
  xdr: z.string().min(1, "XDR is required"),
  type: z.enum(["transaction", "operation", "ledger_key", "auth_entry"]).optional().default("transaction"),
});

export type DecodeQuery = z.infer<typeof DecodeQuerySchema>;

export const SimulateHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
  status: z.enum(["success", "failed"]).optional(),
});

export type SimulateHistoryQuery = z.infer<typeof SimulateHistoryQuerySchema>;

export const NetworkStatusQuerySchema = z.object({
  network: z.enum(["mainnet", "testnet", "futurenet", "all"]).optional().default("testnet"),
});

export type NetworkStatusQuery = z.infer<typeof NetworkStatusQuerySchema>;

export const SimulateBatchStreamQuerySchema = z.object({
  xdrs: z.string().optional(),
  network: z.enum(["mainnet", "testnet", "futurenet"]).optional().default("testnet"),
});

export type SimulateBatchStreamQuery = z.infer<typeof SimulateBatchStreamQuerySchema>;

export const FootprintDiffQuerySchema = z.object({
  format: z.enum(["json", "markdown"]).optional().default("json"),
});

export type FootprintDiffQuery = z.infer<typeof FootprintDiffQuerySchema>;

export const DecodeBatchBodySchema = z.object({
  items: z.array(
    z.object({
      id: z.string().optional(),
      xdr: z.string().min(1, "XDR is required"),
      type: z.enum(["transaction", "operation", "ledger_key", "auth_entry"]).optional().default("transaction"),
    }),
  ).max(25, "Maximum batch size is 25 items").min(1, "At least one item is required"),
});

export type DecodeBatchBody = z.infer<typeof DecodeBatchBodySchema>;

export const ContractTtlParamsSchema = z.object({
  contractId: z.string().regex(/^C[A-Z2-7]{55}$/, "Invalid contract ID: must be a valid Stellar contract StrKey"),
});

export type ContractTtlParams = z.infer<typeof ContractTtlParamsSchema>;

export const ContractTtlQuerySchema = z.object({
  network: z.enum(["mainnet", "testnet", "futurenet"]).optional().default("testnet"),
});

export type ContractTtlQuery = z.infer<typeof ContractTtlQuerySchema>;

export function validateQuery<T>(
  schema: z.ZodSchema<T>,
  query: Record<string, unknown>,
): { success: true; data: T } | { success: false; error: string; issues: z.ZodIssue[] } {
  const result = schema.safeParse(query);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: "Invalid query parameters",
    issues: result.error.issues,
  };
}

export function validateBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
): { success: true; data: T } | { success: false; error: string; issues: z.ZodIssue[] } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: "Invalid request body",
    issues: result.error.issues,
  };
}
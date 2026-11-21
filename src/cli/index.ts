#!/usr/bin/env node
/**
 * sfe — Stellar Footprint Engine CLI
 *
 * Commands
 * --------
 *   sfe simulate <xdr> [--network <net>] [--json]
 *       Simulate a Soroban transaction XDR via the service and display the
 *       footprint, cost, and fee breakdown in a colourised terminal table.
 *
 *   sfe diff <xdr1> <xdr2> [--network <net>] [--json]
 *       Compare the footprints of two transaction XDRs and show additions,
 *       removals, and entries that moved between read-only / read-write.
 *
 *   sfe decode <xdr> [--type <type>] [--json]
 *       Decode an XDR envelope into human-readable JSON without hitting the RPC.
 *
 *   sfe cost <xdr> [--network <net>] [--json]
 *       Simulate a transaction and render the detailed fee / cost breakdown.
 *
 * Configuration
 * -------------
 *   SFE_BASE_URL   Base URL of the running service (default: http://localhost:3000)
 *   SFE_API_KEY    API key forwarded as the `x-api-key` header (optional)
 *   SFE_NETWORK    Default network when --network is omitted (default: testnet)
 */

import { Command } from "commander";
import * as https from "https";
import * as http from "http";
import * as url from "url";

// ─────────────────────────────────────────────────────────────────────────────
// Colour helpers (no external dep — ANSI escapes directly)
// ─────────────────────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY && process.env.NO_COLOR === undefined;

const c = {
  reset: (s: string) => (isTTY ? `\x1b[0m${s}\x1b[0m` : s),
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
  magenta: (s: string) => (isTTY ? `\x1b[35m${s}\x1b[0m` : s),
};

// ─────────────────────────────────────────────────────────────────────────────
// HTTP client (Node built-in — no additional dep required)
// ─────────────────────────────────────────────────────────────────────────────

interface RequestOptions {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  baseUrl?: string;
  apiKey?: string;
}

function request<T>(opts: RequestOptions): Promise<T> {
  const baseUrl = opts.baseUrl ?? process.env["SFE_BASE_URL"] ?? "http://localhost:3000";
  const apiKey = opts.apiKey ?? process.env["SFE_API_KEY"];

  const parsed = url.parse(baseUrl);
  const isHttps = parsed.protocol === "https:";
  const transport = isHttps ? https : http;
  const port = parsed.port
    ? parseInt(parsed.port, 10)
    : isHttps
      ? 443
      : 3000;

  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
  if (apiKey) headers["x-api-key"] = apiKey;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: parsed.hostname ?? "localhost",
        port,
        path: `${parsed.path ?? ""}${opts.path}`,
        method: opts.method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            const parsed = JSON.parse(raw) as T;
            resolve(parsed);
          } catch {
            reject(new Error(`Non-JSON response (${res.statusCode}): ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Table renderer
// ─────────────────────────────────────────────────────────────────────────────

function table(rows: [string, string][], title?: string): void {
  if (title) console.log(`\n${c.bold(title)}`);

  const keyWidth = Math.max(...rows.map(([k]) => k.length));
  for (const [key, value] of rows) {
    const padded = key.padEnd(keyWidth);
    console.log(`  ${c.dim(padded)}  ${value}`);
  }
}

function footprintSection(label: string, entries: FootprintEntry[]): void {
  if (!entries.length) return;
  console.log(`\n${c.bold(label)} ${c.dim(`(${entries.length} entries)`)}`);
  for (const e of entries) {
    const type = e.type ?? "Unknown";
    const coloured =
      type === "ContractData" || type === "contractData"
        ? c.cyan(type)
        : type === "ContractCode" || type === "contractCode"
          ? c.magenta(type)
          : type === "Account" || type === "account"
            ? c.yellow(type)
            : c.dim(type);

    const id = e.contractId ? c.dim(` · ${e.contractId.slice(0, 12)}…`) : "";
    console.log(`  ${coloured}${id}`);
    console.log(`    ${c.dim(e.xdr.slice(0, 60))}…`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared service types (minimal shapes; enough to render output)
// ─────────────────────────────────────────────────────────────────────────────

interface FootprintEntry {
  xdr: string;
  type?: string;
  contractId?: string;
}

interface SimulateResponse {
  success: boolean;
  data?: {
    success?: boolean;
    footprint?: {
      readOnly: FootprintEntry[];
      readWrite: FootprintEntry[];
    };
    footprintStats?: {
      readOnlyCount: number;
      readWriteCount: number;
      totalEntries: number;
      estimatedSizeBytes: number;
    };
    cost?: { cpuInsns: string; memBytes: string };
    resourceFee?: string;
    contracts?: string[];
    warnings?: string[];
  };
  error?: string;
}

interface DiffResponse {
  success: boolean;
  data?: {
    added: { readOnly: FootprintEntry[]; readWrite: FootprintEntry[] };
    removed: { readOnly: FootprintEntry[]; readWrite: FootprintEntry[] };
    moved: { toReadOnly: FootprintEntry[]; toReadWrite: FootprintEntry[] };
    unchanged: { readOnly: FootprintEntry[]; readWrite: FootprintEntry[] };
  };
  error?: string;
}

interface DecodeResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface CostResponse {
  success: boolean;
  data?: {
    baseFee: string;
    resourceFee: string;
    totalFee: string;
    feeInXLM: string;
    breakdown?: {
      baseFee: string;
      writeFee: string;
      refundableFee: string;
      otherResourceFee: string;
    };
    cpuInsns?: string;
    memBytes?: string;
  };
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleSimulate(
  xdr: string,
  opts: { network: string; json: boolean; baseUrl?: string; apiKey?: string },
): Promise<void> {
  const spinner = isTTY ? startSpinner("Simulating transaction…") : null;

  let result: SimulateResponse;
  try {
    result = await request<SimulateResponse>({
      method: "POST",
      path: "/api/v1/simulate",
      body: { xdr, network: opts.network },
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
    });
  } catch (err) {
    if (spinner) stopSpinner(spinner);
    die(`Request failed: ${(err as Error).message}`);
  }

  if (spinner) stopSpinner(spinner);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.success || !result.data) {
    die(`Simulation error: ${result.error ?? "unknown error"}`);
  }

  const data = result.data;

  console.log(
    `\n${c.bold("Simulate")} · network=${c.cyan(opts.network)} · ${
      data.success ? c.green("✓ success") : c.red("✗ failed")
    }`,
  );

  // Footprint summary
  if (data.footprintStats) {
    const s = data.footprintStats;
    table(
      [
        ["Read-only entries", String(s.readOnlyCount)],
        ["Read-write entries", String(s.readWriteCount)],
        ["Total entries", String(s.totalEntries)],
        ["Footprint size", `${s.estimatedSizeBytes} bytes`],
      ],
      "Footprint",
    );
  }

  // Cost
  if (data.cost) {
    table(
      [
        ["CPU instructions", Number(data.cost.cpuInsns).toLocaleString()],
        ["Memory bytes", Number(data.cost.memBytes).toLocaleString()],
        ...(data.resourceFee
          ? ([["Resource fee", `${data.resourceFee} stroops`]] as [string, string][])
          : []),
      ],
      "Resource Cost",
    );
  }

  // Contracts
  if (data.contracts?.length) {
    table(
      data.contracts.map((id) => ["Contract", c.cyan(id)]),
      "Contracts Touched",
    );
  }

  // Footprint entries
  if (data.footprint) {
    footprintSection("Read-only", data.footprint.readOnly);
    footprintSection("Read-write", data.footprint.readWrite);
  }

  // Warnings
  if (data.warnings?.length) {
    console.log(`\n${c.yellow("Warnings")}`);
    for (const w of data.warnings) {
      console.log(`  ${c.yellow("⚠")} ${w}`);
    }
  }

  console.log();
}

async function handleDiff(
  xdr1: string,
  xdr2: string,
  opts: { network: string; json: boolean; baseUrl?: string; apiKey?: string },
): Promise<void> {
  const spinner = isTTY ? startSpinner("Diffing footprints…") : null;

  let result: DiffResponse;
  try {
    result = await request<DiffResponse>({
      method: "POST",
      path: "/api/v1/footprint/diff",
      body: { xdr1, xdr2, network: opts.network },
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
    });
  } catch (err) {
    if (spinner) stopSpinner(spinner);
    die(`Request failed: ${(err as Error).message}`);
  }

  if (spinner) stopSpinner(spinner);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.success || !result.data) {
    die(`Diff error: ${result.error ?? "unknown error"}`);
  }

  const d = result.data;

  console.log(`\n${c.bold("Footprint Diff")} · network=${c.cyan(opts.network)}`);

  const addedCount =
    (d.added.readOnly?.length ?? 0) + (d.added.readWrite?.length ?? 0);
  const removedCount =
    (d.removed.readOnly?.length ?? 0) + (d.removed.readWrite?.length ?? 0);
  const movedCount =
    (d.moved.toReadOnly?.length ?? 0) + (d.moved.toReadWrite?.length ?? 0);

  table([
    ["Added entries", addedCount > 0 ? c.green(`+${addedCount}`) : "0"],
    ["Removed entries", removedCount > 0 ? c.red(`-${removedCount}`) : "0"],
    ["Moved entries", movedCount > 0 ? c.yellow(`~${movedCount}`) : "0"],
    [
      "Unchanged entries",
      String(
        (d.unchanged.readOnly?.length ?? 0) + (d.unchanged.readWrite?.length ?? 0),
      ),
    ],
  ]);

  if (addedCount) {
    footprintSection(c.green("+ Added (read-only)"), d.added.readOnly ?? []);
    footprintSection(c.green("+ Added (read-write)"), d.added.readWrite ?? []);
  }
  if (removedCount) {
    footprintSection(c.red("- Removed (read-only)"), d.removed.readOnly ?? []);
    footprintSection(c.red("- Removed (read-write)"), d.removed.readWrite ?? []);
  }
  if (movedCount) {
    footprintSection(c.yellow("~ Moved → read-only"), d.moved.toReadOnly ?? []);
    footprintSection(c.yellow("~ Moved → read-write"), d.moved.toReadWrite ?? []);
  }

  console.log();
}

async function handleDecode(
  xdr: string,
  opts: { type: string; json: boolean; baseUrl?: string; apiKey?: string },
): Promise<void> {
  const spinner = isTTY ? startSpinner("Decoding XDR…") : null;

  let result: DecodeResponse;
  try {
    const qs = `?xdr=${encodeURIComponent(xdr)}&type=${encodeURIComponent(opts.type)}`;
    result = await request<DecodeResponse>({
      method: "GET",
      path: `/api/v1/decode${qs}`,
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
    });
  } catch (err) {
    if (spinner) stopSpinner(spinner);
    die(`Request failed: ${(err as Error).message}`);
  }

  if (spinner) stopSpinner(spinner);

  if (!result.success || !result.data) {
    die(`Decode error: ${result.error ?? "unknown error"}`);
  }

  // Always output JSON — this command's purpose is to show the decoded structure.
  console.log(JSON.stringify(result.data, null, 2));
}

async function handleCost(
  xdr: string,
  opts: { network: string; json: boolean; baseUrl?: string; apiKey?: string },
): Promise<void> {
  // First simulate to get cpuInsns and memBytes
  const spinner = isTTY ? startSpinner("Simulating to retrieve cost…") : null;

  let simResult: SimulateResponse;
  try {
    simResult = await request<SimulateResponse>({
      method: "POST",
      path: "/api/v1/simulate",
      body: { xdr, network: opts.network },
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
    });
  } catch (err) {
    if (spinner) stopSpinner(spinner);
    die(`Request failed: ${(err as Error).message}`);
  }

  if (!simResult.success || !simResult.data?.cost) {
    if (spinner) stopSpinner(spinner);
    die(`Simulation error: ${simResult.error ?? "No cost data returned"}`);
  }

  const { cpuInsns, memBytes } = simResult.data.cost;

  // Then fetch the detailed cost breakdown
  let costResult: CostResponse;
  try {
    const qs = `?cpuInsns=${encodeURIComponent(cpuInsns)}&memBytes=${encodeURIComponent(memBytes)}&network=${encodeURIComponent(opts.network)}`;
    costResult = await request<CostResponse>({
      method: "GET",
      path: `/api/v1/simulate/cost-breakdown${qs}`,
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
    });
  } catch (err) {
    if (spinner) stopSpinner(spinner);
    die(`Cost request failed: ${(err as Error).message}`);
  }

  if (spinner) stopSpinner(spinner);

  if (opts.json) {
    console.log(
      JSON.stringify(
        { simulate: simResult.data, cost: costResult.data },
        null,
        2,
      ),
    );
    return;
  }

  if (!costResult.success || !costResult.data) {
    die(`Cost error: ${costResult.error ?? "unknown error"}`);
  }

  const c2 = costResult.data;

  console.log(`\n${c.bold("Fee Summary")} · network=${c.cyan(opts.network)}`);

  table([
    ["CPU instructions", Number(cpuInsns).toLocaleString()],
    ["Memory bytes", Number(memBytes).toLocaleString()],
  ]);

  table(
    [
      ["Base fee", `${c2.baseFee} stroops`],
      ["Resource fee", `${c2.resourceFee} stroops`],
      ["Total fee", c.bold(`${c2.totalFee} stroops`)],
      ["Total fee (XLM)", c.green(c2.feeInXLM)],
    ],
    "Fee Breakdown",
  );

  if (c2.breakdown) {
    table(
      [
        ["Base fee component", `${c2.breakdown.baseFee} stroops`],
        ["Write fee", `${c2.breakdown.writeFee} stroops`],
        ["Refundable fee", `${c2.breakdown.refundableFee} stroops`],
        ["Other resource fee", `${c2.breakdown.otherResourceFee} stroops`],
      ],
      "Detailed Breakdown",
    );
  }

  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// Spinner (TTY only — avoids polluting piped output)
// ─────────────────────────────────────────────────────────────────────────────

function startSpinner(message: string): NodeJS.Timeout {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  process.stderr.write(`  ${frames[0]} ${message}`);
  return setInterval(() => {
    process.stderr.write(`\r  ${frames[i++ % frames.length]} ${message}`);
  }, 80);
}

function stopSpinner(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  process.stderr.write("\r\x1b[K");
}

function die(message: string): never {
  console.error(`\n${c.red("Error:")} ${message}\n`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Program definition
// ─────────────────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("sfe")
  .description("Stellar Footprint Engine CLI — simulate, diff, decode, and cost Soroban transactions")
  .version("1.0.0")
  .option("--base-url <url>", "Override the service base URL (env: SFE_BASE_URL)")
  .option("--api-key <key>", "Override the API key (env: SFE_API_KEY)");

// sfe simulate <xdr>
program
  .command("simulate <xdr>")
  .description("Simulate a Soroban transaction XDR and display footprint + cost")
  .option("-n, --network <net>", "Stellar network", process.env["SFE_NETWORK"] ?? "testnet")
  .option("--json", "Output raw JSON instead of formatted table", false)
  .action(async (xdr: string, opts: { network: string; json: boolean }, cmd) => {
    const parent = cmd.parent as Command;
    const globalOpts = parent.opts<{ baseUrl?: string; apiKey?: string }>();
    await handleSimulate(xdr, { ...opts, ...globalOpts });
  });

// sfe diff <xdr1> <xdr2>
program
  .command("diff <xdr1> <xdr2>")
  .description("Compare footprints of two transaction XDRs")
  .option("-n, --network <net>", "Stellar network", process.env["SFE_NETWORK"] ?? "testnet")
  .option("--json", "Output raw JSON instead of formatted table", false)
  .action(
    async (xdr1: string, xdr2: string, opts: { network: string; json: boolean }, cmd) => {
      const parent = cmd.parent as Command;
      const globalOpts = parent.opts<{ baseUrl?: string; apiKey?: string }>();
      await handleDiff(xdr1, xdr2, { ...opts, ...globalOpts });
    },
  );

// sfe decode <xdr>
program
  .command("decode <xdr>")
  .description("Decode an XDR string into human-readable JSON (no RPC call)")
  .option("-t, --type <type>", "XDR type hint (e.g. TransactionEnvelope, LedgerKey)", "TransactionEnvelope")
  .option("--json", "Output raw JSON (default for this command)", false)
  .action(async (xdr: string, opts: { type: string; json: boolean }, cmd) => {
    const parent = cmd.parent as Command;
    const globalOpts = parent.opts<{ baseUrl?: string; apiKey?: string }>();
    await handleDecode(xdr, { ...opts, ...globalOpts });
  });

// sfe cost <xdr>
program
  .command("cost <xdr>")
  .description("Simulate a transaction and display detailed fee/cost breakdown")
  .option("-n, --network <net>", "Stellar network", process.env["SFE_NETWORK"] ?? "testnet")
  .option("--json", "Output raw JSON instead of formatted table", false)
  .action(async (xdr: string, opts: { network: string; json: boolean }, cmd) => {
    const parent = cmd.parent as Command;
    const globalOpts = parent.opts<{ baseUrl?: string; apiKey?: string }>();
    await handleCost(xdr, { ...opts, ...globalOpts });
  });

program.parseAsync(process.argv).catch((err: Error) => {
  die(err.message);
});

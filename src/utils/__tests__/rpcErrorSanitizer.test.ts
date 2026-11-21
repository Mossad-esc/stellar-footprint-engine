import { sanitizeRpcError } from "../rpcErrorSanitizer";

describe("sanitizeRpcError", () => {
  // Known pattern mappings
  it("maps contract not found error", () => {
    expect(sanitizeRpcError("no such contract on ledger")).toBe(
      "Contract not found on the specified network.",
    );
  });

  it("maps invalid XDR error", () => {
    expect(sanitizeRpcError("failed to decode transaction XDR")).toBe(
      "Invalid transaction XDR provided.",
    );
  });

  it("maps insufficient balance error", () => {
    expect(sanitizeRpcError("account not found in ledger")).toBe(
      "Source account not found or has insufficient balance.",
    );
  });

  it("maps CPU limit error", () => {
    expect(sanitizeRpcError("exceeded instructions limit")).toBe(
      "Transaction exceeded CPU instruction limit.",
    );
  });

  it("maps memory limit error", () => {
    expect(sanitizeRpcError("exceeded memory limit")).toBe(
      "Transaction exceeded memory limit.",
    );
  });

  it("maps host/wasm error", () => {
    expect(sanitizeRpcError("wasm trap: unreachable")).toBe(
      "Contract execution failed during simulation.",
    );
  });

  it("maps network timeout error", () => {
    expect(sanitizeRpcError("ECONNREFUSED")).toBe(
      "RPC network error. Please try again.",
    );
  });

  // Stack trace stripping
  it("strips stack traces from error strings", () => {
    const raw =
      "Something went wrong\n    at Object.<anonymous> (/app/src/services/simulator.ts:42:10)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)";
    const result = sanitizeRpcError(raw);
    expect(result).not.toContain("at Object");
    expect(result).not.toContain("simulator.ts");
  });

  // Internal URL stripping
  it("strips internal RPC provider URLs", () => {
    const raw =
      "Request failed: https://mainnet.stellar.validationcloud.io/v1/SECRETAPIKEY123456789";
    const result = sanitizeRpcError(raw);
    expect(result).not.toContain("validationcloud.io");
    expect(result).not.toContain("SECRETAPIKEY");
  });

  // File path stripping
  it("strips Unix file paths", () => {
    const raw = "Error loading /etc/stellar/config.json: permission denied";
    const result = sanitizeRpcError(raw);
    expect(result).not.toContain("/etc/stellar/config.json");
  });

  // Provider identifier stripping
  it("strips provider-specific API key identifiers in URL paths", () => {
    const raw = "Failed at /v1/abcdefghijklmnopqrstuvwxyz123456";
    const result = sanitizeRpcError(raw);
    expect(result).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });

  // Actionable fallback
  it("returns a non-empty fallback for unknown errors", () => {
    const result = sanitizeRpcError("some unknown rpc error");
    expect(result.length).toBeGreaterThan(0);
  });

  // Diverse RPC error shape matrix (#100)
  describe("error shape matrix", () => {
    it("handles standard Soroban JSON-RPC error with code and message", () => {
      const jsonRpcError = {
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32602,
          message: "failed to decode transaction XDR",
        },
      };
      expect(sanitizeRpcError(jsonRpcError)).toBe(
        "Invalid transaction XDR provided.",
      );
      expect(sanitizeRpcError(JSON.stringify(jsonRpcError))).toBe(
        "Invalid transaction XDR provided.",
      );
    });

    it("handles raw HTML error page from Cloudflare proxy without leaking markup", () => {
      const htmlPage = `<!DOCTYPE html>
<html>
  <head><title>502 Bad Gateway | Cloudflare</title></head>
  <body><h1>502 Bad Gateway</h1><p>Ray ID: 8a1b2c3d4e5f</p></body>
</html>`;
      const result = sanitizeRpcError(htmlPage);
      expect(result).toBe(
        "RPC service returned an unexpected error. Please try again.",
      );
      expect(result).not.toContain("<html");
      expect(result).not.toContain("Cloudflare");
    });

    it("handles Axios network timeout error (ETIMEDOUT)", () => {
      const axiosTimeout = {
        isAxiosError: true,
        code: "ETIMEDOUT",
        message: "timeout of 10000ms exceeded",
        config: { url: "https://internal-rpc.example.com/v1/secretkey1234567890" },
      };
      const result = sanitizeRpcError(axiosTimeout);
      expect(result).toBe("RPC network error. Please try again.");
      expect(result).not.toContain("internal-rpc");
    });

    it("handles Stellar Core host panic error with nested diagnostic events", () => {
      const hostPanic = {
        error: {
          code: -32000,
          message:
            "HostError: Error(Contract, #1) - panicked at 'explicit panic' in /usr/src/soroban-env-host/src/vm.rs:120",
          diagnosticEvents: [
            {
              event: {
                type: "diagnostic",
                contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
                topics: ["fn_call"],
              },
            },
          ],
        },
      };
      const result = sanitizeRpcError(hostPanic);
      expect(result).toBe("Contract execution failed during simulation.");
      expect(result).not.toContain("soroban-env-host");
      expect(result).not.toContain("diagnosticEvents");
    });

    it("handles malformed error object missing message property", () => {
      expect(sanitizeRpcError({})).toBe("An unexpected RPC error occurred.");
      expect(sanitizeRpcError({ status: 500 })).toBe(
        "An unexpected RPC error occurred.",
      );
      expect(sanitizeRpcError(null)).toBe("An unexpected RPC error occurred.");
      expect(sanitizeRpcError(undefined)).toBe(
        "An unexpected RPC error occurred.",
      );
    });
  });
});

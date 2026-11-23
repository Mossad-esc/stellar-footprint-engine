/**
 * Tests for Issue #25 — WebSocket gateway (src/api/wsGateway.ts)
 *
 * These tests use Jest's module mocking to isolate the gateway from real
 * RPC calls and from the `ws` package (which may not be installed).
 */

import EventEmitter from "events";
import http from "http";

// ---------------------------------------------------------------------------
// Mock the `ws` package so the tests run without it being installed.
// ---------------------------------------------------------------------------

type FakeListener = (...args: unknown[]) => void;

class FakeWebSocket extends EventEmitter {
  isAlive = true;
  subscriptions?: Set<string>;
  readyState = 1; // OPEN
  sent: string[] = [];
  terminated = false;
  pinged = false;

  send(data: string): void {
    this.sent.push(data);
  }

  ping(): void {
    this.pinged = true;
    // Simulate immediate pong to keep alive in heartbeat tests
    this.emit("pong");
  }

  terminate(): void {
    this.terminated = true;
  }
}

class FakeWsServer extends EventEmitter {
  clients = new Set<FakeWebSocket>();
  path: string;

  constructor(opts: { path?: string } = {}) {
    super();
    this.path = opts.path ?? "/ws";
  }

  close(): void {
    this.clients.clear();
  }

  // Helper: simulate a new connection
  simulateConnection(ws: FakeWebSocket): void {
    this.clients.add(ws);
    this.emit("connection", ws);
  }
}

jest.mock("ws", () => ({ Server: FakeWsServer }), { virtual: true });

// ---------------------------------------------------------------------------
// Mock simulator so we don't hit real RPC
// ---------------------------------------------------------------------------

jest.mock("@services/simulator", () => ({
  simulateTransaction: jest.fn().mockResolvedValue({
    success: true,
    footprint: { readOnly: [], readWrite: [] },
    cost: { cpuInsns: "0", memBytes: "0" },
  }),
}));

// ---------------------------------------------------------------------------
// Mock networkStatus
// ---------------------------------------------------------------------------

const ledgerCloseListeners = new Set<
  (network: string, status: unknown) => void
>();

jest.mock("../services/networkStatus", () => ({
  onLedgerClose: (listener: (n: string, s: unknown) => void) => {
    ledgerCloseListeners.add(listener);
    return () => ledgerCloseListeners.delete(listener);
  },
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------

import { simulateTransaction } from "@services/simulator";

import { attachWsGateway } from "../api/wsGateway";

const mockSimulate = simulateTransaction as jest.MockedFunction<
  typeof simulateTransaction
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServer(): http.Server {
  return http.createServer();
}

function getWss(): FakeWsServer {
  // After attachWsGateway is called the FakeWsServer constructor was called;
  // the last instance is the one in use.
  const { Server } = jest.requireMock("ws") as { Server: typeof FakeWsServer };
  // We retrieve it from the module's internal state via the mock
  // by accessing the most-recently constructed instance.
  return (Server as unknown as { _instance: FakeWsServer })._instance;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("attachWsGateway", () => {
  let teardown: () => void;
  let wss: FakeWsServer;

  beforeEach(() => {
    jest.clearAllMocks();
    ledgerCloseListeners.clear();

    const { Server } = jest.requireMock("ws") as {
      Server: new (opts: Record<string, unknown>) => FakeWsServer;
    };

    // Patch Server constructor to record the last instance
    const OriginalServer = Server;
    // Reset any prior patching
    let lastInstance: FakeWsServer | null = null;
    jest
      .spyOn(
        jest.requireMock("ws") as { Server: typeof OriginalServer },
        "Server",
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(function (this: any, opts: Record<string, unknown>) {
        lastInstance = new OriginalServer(opts) as FakeWsServer;
        return lastInstance;
      });

    const server = makeServer();
    teardown = attachWsGateway(server);

    // Grab the server from the last constructed instance
    wss = lastInstance!;
  });

  afterEach(() => {
    teardown();
  });

  it("returns a teardown function", () => {
    expect(typeof teardown).toBe("function");
  });

  it("sets up a WebSocket server on path /ws", () => {
    expect(wss.path).toBe("/ws");
  });

  it("registers a ledger-close listener", () => {
    expect(ledgerCloseListeners.size).toBeGreaterThan(0);
  });

  it("clears the ledger-close listener on teardown", () => {
    teardown();
    expect(ledgerCloseListeners.size).toBe(0);
  });

  describe("message handling", () => {
    let ws: FakeWebSocket;

    beforeEach(() => {
      ws = new FakeWebSocket();
      wss.simulateConnection(ws);
    });

    it("responds with error for invalid JSON", () => {
      ws.emit("message", "not json");
      expect(ws.sent.length).toBeGreaterThan(0);
      const msg = JSON.parse(ws.sent[0]) as { type: string; message: string };
      expect(msg.type).toBe("error");
    });

    it("subscribes to simulate channel", () => {
      ws.emit(
        "message",
        JSON.stringify({ action: "subscribe", channel: "simulate" }),
      );
      const reply = JSON.parse(ws.sent[0]) as { type: string; channel: string };
      expect(reply.type).toBe("subscribed");
      expect(reply.channel).toBe("simulate");
      expect(ws.subscriptions?.has("simulate")).toBe(true);
    });

    it("subscribes to network_status channel", () => {
      ws.emit(
        "message",
        JSON.stringify({ action: "subscribe", channel: "network_status" }),
      );
      const reply = JSON.parse(ws.sent[0]) as { type: string; channel: string };
      expect(reply.type).toBe("subscribed");
      expect(reply.channel).toBe("network_status");
    });

    it("returns error for unknown channel", () => {
      ws.emit(
        "message",
        JSON.stringify({ action: "subscribe", channel: "foo" }),
      );
      const reply = JSON.parse(ws.sent[0]) as { type: string };
      expect(reply.type).toBe("error");
    });

    it("unsubscribes from a channel", () => {
      ws.emit(
        "message",
        JSON.stringify({ action: "subscribe", channel: "simulate" }),
      );
      ws.sent = [];
      ws.emit(
        "message",
        JSON.stringify({ action: "unsubscribe", channel: "simulate" }),
      );
      const reply = JSON.parse(ws.sent[0]) as { type: string };
      expect(reply.type).toBe("unsubscribed");
      expect(ws.subscriptions?.has("simulate")).toBe(false);
    });

    it("returns error for missing xdr on simulate action", async () => {
      ws.emit("message", JSON.stringify({ action: "simulate" }));
      await Promise.resolve(); // flush microtasks
      const reply = JSON.parse(ws.sent[0]) as { type: string; error: string };
      expect(reply.type).toBe("simulation_error");
      expect(reply.error).toMatch(/xdr/i);
    });

    it("calls simulateTransaction and sends simulation_result", async () => {
      ws.emit(
        "message",
        JSON.stringify({
          action: "simulate",
          xdr: "AAAA==",
          network: "testnet",
        }),
      );
      await new Promise((r) => setImmediate(r)); // flush promises
      const reply = JSON.parse(ws.sent[ws.sent.length - 1]) as { type: string };
      expect(reply.type).toBe("simulation_result");
      expect(mockSimulate).toHaveBeenCalledWith("AAAA==", "testnet");
    });

    it("sends simulation_error when simulateTransaction rejects", async () => {
      mockSimulate.mockRejectedValueOnce(new Error("RPC failure"));
      ws.emit(
        "message",
        JSON.stringify({
          action: "simulate",
          xdr: "AAAA==",
          network: "testnet",
        }),
      );
      await new Promise((r) => setImmediate(r));
      const reply = JSON.parse(ws.sent[ws.sent.length - 1]) as {
        type: string;
        error: string;
      };
      expect(reply.type).toBe("simulation_error");
      expect(reply.error).toMatch(/RPC failure/);
    });

    it("returns error for unknown action", () => {
      ws.emit("message", JSON.stringify({ action: "unknown_action" }));
      const reply = JSON.parse(ws.sent[0]) as { type: string };
      expect(reply.type).toBe("error");
    });
  });

  describe("network_status broadcasting", () => {
    it("broadcasts ledger-close events to network_status subscribers", () => {
      const ws = new FakeWebSocket();
      wss.simulateConnection(ws);
      ws.emit(
        "message",
        JSON.stringify({ action: "subscribe", channel: "network_status" }),
      );
      ws.sent = [];

      // Simulate a ledger close
      for (const listener of ledgerCloseListeners) {
        listener("testnet", {
          ledger: 42,
          baseFee: "100",
          networkPassphrase: "Test SDF Network ; September 2015",
          rpcLatencyMs: 10,
        });
      }

      expect(ws.sent.length).toBeGreaterThan(0);
      const msg = JSON.parse(ws.sent[0]) as {
        type: string;
        network: string;
        ledger: number;
      };
      expect(msg.type).toBe("network_status");
      expect(msg.network).toBe("testnet");
      expect(msg.ledger).toBe(42);
    });

    it("does not broadcast to clients not subscribed to network_status", () => {
      const ws = new FakeWebSocket();
      wss.simulateConnection(ws);
      // subscribe to simulate, NOT network_status
      ws.emit(
        "message",
        JSON.stringify({ action: "subscribe", channel: "simulate" }),
      );
      ws.sent = [];

      for (const listener of ledgerCloseListeners) {
        listener("testnet", { ledger: 99 });
      }

      expect(ws.sent).toHaveLength(0);
    });
  });

  describe("disconnect cleanup", () => {
    it("clears subscriptions on socket close", () => {
      const ws = new FakeWebSocket();
      wss.simulateConnection(ws);
      ws.emit(
        "message",
        JSON.stringify({ action: "subscribe", channel: "simulate" }),
      );
      expect(ws.subscriptions?.has("simulate")).toBe(true);

      ws.emit("close");
      expect(ws.subscriptions?.size).toBe(0);
    });
  });
});

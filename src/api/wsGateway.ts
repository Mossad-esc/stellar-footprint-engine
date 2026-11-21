/**
 * Issue #25 — WebSocket Gateway for Live Network Status & Simulation Streams
 *
 * Attaches a WebSocket server on path `/ws` to the existing HTTP server.
 *
 * Message protocol (JSON):
 *   Client → Server:
 *     { action: 'subscribe',  channel: 'simulate' | 'network_status' }
 *     { action: 'unsubscribe', channel: 'simulate' | 'network_status' }
 *     { action: 'simulate',   xdr: string, network?: string }
 *
 *   Server → Client:
 *     { type: 'subscribed',       channel }
 *     { type: 'simulation_result', ...result }
 *     { type: 'simulation_error',  error: string }
 *     { type: 'network_status',    network, ...status }
 *     { type: 'error',             message: string }
 *
 * Heartbeat: server pings every 30 s; sockets that do not pong in time are
 * terminated.
 *
 * NOTE: This module requires the `ws` package at runtime.  It degrades
 * gracefully (logs a warning and skips WS setup) when `ws` is not installed,
 * which allows the HTTP server to start normally in environments that have not
 * yet added the dependency.
 */

import http from "http";

import { Network } from "../config/stellar";
import { DEFAULT_NETWORK } from "../constants";
import { onLedgerClose, NetworkStatusResult } from "../services/networkStatus";
import { simulateTransaction } from "../services/simulator";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Minimal type stubs so TypeScript compiles without the `ws` package installed
// ---------------------------------------------------------------------------

interface WsLike {
  isAlive?: boolean;
  subscriptions?: Set<string>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  ping(): void;
  terminate(): void;
  send(data: string): void;
  readyState: number;
}

interface WsServerLike {
  on(event: "connection", listener: (ws: WsLike) => void): void;
  clients: Set<WsLike>;
  close(): void;
}

// ---------------------------------------------------------------------------
// Heartbeat interval (ms)
// ---------------------------------------------------------------------------
const HEARTBEAT_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Gateway singleton
// ---------------------------------------------------------------------------

let wss: WsServerLike | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let removeLedgerCloseListener: (() => void) | null = null;

function sendJson(ws: WsLike, payload: unknown): void {
  try {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(payload));
    }
  } catch (err) {
    logger.warn({ err }, "wsGateway: failed to send message");
  }
}

function handleMessage(ws: WsLike, raw: string): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    sendJson(ws, { type: "error", message: "Invalid JSON" });
    return;
  }

  const action = msg.action as string | undefined;

  switch (action) {
    case "subscribe": {
      const channel = msg.channel as string | undefined;
      if (channel !== "simulate" && channel !== "network_status") {
        sendJson(ws, {
          type: "error",
          message: "Unknown channel. Valid channels: simulate, network_status",
        });
        return;
      }
      ws.subscriptions!.add(channel);
      sendJson(ws, { type: "subscribed", channel });
      break;
    }

    case "unsubscribe": {
      const channel = msg.channel as string | undefined;
      if (channel) ws.subscriptions!.delete(channel);
      sendJson(ws, { type: "unsubscribed", channel });
      break;
    }

    case "simulate": {
      const xdr = msg.xdr as string | undefined;
      const network = (msg.network as Network | undefined) || DEFAULT_NETWORK;

      if (!xdr) {
        sendJson(ws, {
          type: "simulation_error",
          error: "Missing required field: xdr",
        });
        return;
      }

      simulateTransaction(xdr, network)
        .then((result) => {
          sendJson(ws, { type: "simulation_result", ...result });
        })
        .catch((err: unknown) => {
          sendJson(ws, {
            type: "simulation_error",
            error: err instanceof Error ? err.message : "Simulation failed",
          });
        });
      break;
    }

    default:
      sendJson(ws, {
        type: "error",
        message: `Unknown action: ${String(action)}`,
      });
  }
}

/**
 * Attach the WebSocket gateway to an existing HTTP server.
 * Returns a teardown function that closes the WS server and clears timers.
 */
export function attachWsGateway(server: http.Server): () => void {
  // Dynamically require ws so the module can be loaded without it installed.
  let WsServer: new (opts: Record<string, unknown>) => WsServerLike;
  try {
    const wsModule = require("ws") as {
      Server: new (opts: Record<string, unknown>) => WsServerLike;
    };
    WsServer = wsModule.Server;
  } catch {
    logger.warn(
      "wsGateway: `ws` package not found — WebSocket gateway is disabled. " +
        'Add "ws" to dependencies to enable it.',
    );
    return () => void 0;
  }

  wss = new WsServer({ server, path: "/ws" });

  // Ledger-close broadcaster: forward fresh status to all network_status subscribers.
  removeLedgerCloseListener = onLedgerClose(
    (network: Network, status: NetworkStatusResult) => {
      if (!wss) return;
      for (const client of wss.clients) {
        if (client.subscriptions?.has("network_status")) {
          sendJson(client, { type: "network_status", network, ...status });
        }
      }
    },
  );

  // Handle new connections.
  wss.on("connection", (ws: WsLike) => {
    ws.isAlive = true;
    ws.subscriptions = new Set();

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (data: unknown) => {
      handleMessage(ws, String(data));
    });

    ws.on("close", () => {
      ws.subscriptions!.clear();
    });

    ws.on("error", (err: unknown) => {
      logger.warn({ err }, "wsGateway: socket error");
    });
  });

  // Heartbeat: ping all clients every 30 s, terminate those that don't pong.
  heartbeatTimer = setInterval(() => {
    if (!wss) return;
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  logger.info("wsGateway: WebSocket server attached on path /ws");

  return () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (removeLedgerCloseListener) {
      removeLedgerCloseListener();
      removeLedgerCloseListener = null;
    }
    if (wss) {
      wss.close();
      wss = null;
    }
  };
}

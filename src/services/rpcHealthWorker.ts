import { getRpcServer, Network } from "../config/stellar";
import { setCircuitStatus } from "./rpcClient";
import { logger } from "../utils/logger";

export interface RpcHealthSample {
  network: Network;
  url: string;
  latencyMs: number;
  ok: boolean;
  timestamp: number;
}

const ROLLING_WINDOW = 60;
const PING_INTERVAL_MS = 15_000;
const CONSECUTIVE_FAILURE_THRESHOLD = 3;

const samples = new Map<Network, RpcHealthSample[]>();
const consecutiveFailures = new Map<Network, number>();
let timer: NodeJS.Timeout | null = null;

export function getHealthSamples(network: Network): RpcHealthSample[] {
  return samples.get(network) ?? [];
}

export async function pingEndpoint(network: Network): Promise<RpcHealthSample> {
  const server = getRpcServer(network);
  const start = Date.now();
  let ok = true;
  try {
    await server.getHealth();
  } catch {
    ok = false;
  }
  const sample: RpcHealthSample = {
    network,
    url: "",
    latencyMs: Date.now() - start,
    ok,
    timestamp: Date.now(),
  };
  const list = samples.get(network) ?? [];
  list.push(sample);
  if (list.length > ROLLING_WINDOW) list.shift();
  samples.set(network, list);

  if (ok) {
    consecutiveFailures.set(network, 0);
    setCircuitStatus(network, "CLOSED");
  } else {
    const n = (consecutiveFailures.get(network) ?? 0) + 1;
    consecutiveFailures.set(network, n);
    if (n >= CONSECUTIVE_FAILURE_THRESHOLD) {
      setCircuitStatus(network, "OPEN");
    }
  }
  return sample;
}

export function startRpcHealthWorker(networks: Network[] = ["testnet", "mainnet", "futurenet"]): void {
  if (timer) return;
  const tick = async () => {
    for (const n of networks) {
      try {
        await pingEndpoint(n);
      } catch (err) {
        logger.warn({ err, network: n }, "rpcHealthWorker ping failed");
      }
    }
  };
  timer = setInterval(() => {
    void tick();
  }, PING_INTERVAL_MS);
  void tick();
}

export function stopRpcHealthWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
const http = require("http");
const PORT = parseInt(process.env.MOCK_RPC_PORT || "8000", 10);

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let rpc;
    try { rpc = JSON.parse(body || "{}"); } catch { rpc = {}; }
    const id = rpc.id ?? null;
    const method = rpc.method;
    let result;
    switch (method) {
      case "getHealth":
        result = { status: "healthy" };
        break;
      case "getLatestLedger":
        result = { sequence: 1000, closeTime: Date.now() };
        break;
      case "simulateTransaction":
        result = { transactionData: "AAAA", minResourceFee: "100", latestLedger: 1000 };
        break;
      case "getLedgerEntries":
        result = { entries: [], latestLedger: 1000 };
        break;
      default:
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }));
        return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
  });
});

server.listen(PORT, () => console.log(`Mock RPC server listening on port ${PORT}`));
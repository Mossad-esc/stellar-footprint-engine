// dotenv must be configured before any other imports that read process.env
// eslint-disable-next-line import-x/order
import dotenv from "dotenv";
dotenv.config();

const _startupBegin = process.hrtime.bigint();

import path from "path";

import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";

import routes from "./api/routes";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import { bruteForceMiddleware } from "./middleware/bruteForce";
import { contentTypeMiddleware } from "./middleware/contentType";
import { errorHandler } from "./middleware/errorHandler";
import { httpCacheMiddleware } from "./middleware/httpCache";
import { ipFilterMiddleware } from "./middleware/ipFilter";
import { metricsMiddleware, metrics } from "./middleware/metrics";
import { requestIdMiddleware } from "./middleware/requestId";
import { requestLogger } from "./middleware/requestLogger";
import { responseTimeMiddleware } from "./middleware/responseTime";
import { timeoutMiddleware } from "./middleware/timeout";
import { logger } from "./utils/logger";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const COMPRESSION_THRESHOLD = parseInt(
  process.env.COMPRESSION_THRESHOLD || "1024",
  10,
);

function buildCorsOptions(): cors.CorsOptions {
  const origin = process.env.CORS_ORIGIN;
  if (!origin) {
    return process.env.NODE_ENV === "production"
      ? { origin: false }
      : { origin: "*" };
  }
  const allowed = origin.split(",").map((o) => o.trim());
  return { origin: allowed.length === 1 ? allowed[0] : allowed };
}

app.use(cors(buildCorsOptions()));
app.use(
  helmet({
    contentSecurityPolicy: {
      // OWASP API Security: APIs typically should not serve executable
      // content to browsers. Keep a very restrictive CSP suitable for
      // a JSON API while permitting same-origin connections for tooling
      // (e.g. Swagger UI in non-production). The chosen directives:
      // - default-src 'none' : deny everything by default
      // - base-uri 'none'    : prevent base tag attacks
      // - object-src 'none'  : disallow plugins
      // - frame-ancestors 'none' : prevent clickjacking / framing
      // - form-action 'none' : disallow form submissions
      // - script-src 'self'  : only allow scripts from same origin (needed for dev docs)
      // - style-src 'self'   : only allow styles from same origin
      // - img-src 'none'     : disallow images
      // - connect-src 'self' : allow fetch/XHR to same origin
      // These choices align with OWASP guidance to minimise browser-executable
      // surface for API responses while keeping developer tooling functional.
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
        // Allow same-origin scripts/styles/connects to support Swagger UI during
        // development. In production the UI is not enabled and these remain safe.
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'none'"],
        connectSrc: ["'self'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  }),
);
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "accelerometer=(),ambient-light-sensor=(),autoplay=(),battery=(),camera=(),cross-origin-isolated=(),display-capture=(),document-domain=(),encrypted-media=(),execution-while-not-rendered=(),execution-while-out-of-viewport=(),fullscreen=(),geolocation=(),gyroscope=(),keyboard-map=(),magnetometer=(),microphone=(),midi=(),navigation-override=(),payment=(),picture-in-picture=(),publickey-credentials-get=(),screen-wake-lock=(),sync-xhr=(),usb=(),web-share=(),xr-spatial-tracking=()",
  );
  next();
});
app.use(compression({ threshold: COMPRESSION_THRESHOLD }));
app.use(express.json({ limit: process.env.BODY_LIMIT || "100kb" }));
app.use(responseTimeMiddleware);
app.use(ipFilterMiddleware);
app.use(requestIdMiddleware);
app.use(requestLogger);
app.use(metricsMiddleware);
app.use(timeoutMiddleware);
app.use(bruteForceMiddleware);
app.use(contentTypeMiddleware);
app.use(httpCacheMiddleware);

// Swagger UI — development only
if (process.env.NODE_ENV !== "production") {
  const swaggerUi =
    require("swagger-ui-express") as typeof import("swagger-ui-express");

  const YAML = require("yaml") as { parse: (s: string) => unknown };

  const fs = require("fs") as typeof import("fs");
  const specPath = path.join(__dirname, "..", "openapi.yaml");
  if (fs.existsSync(specPath)) {
    const spec = YAML.parse(fs.readFileSync(specPath, "utf8")) as Record<
      string,
      unknown
    >;
    const swaggerSetup = swaggerUi.setup(spec, {
      customSiteTitle: "Stellar Footprint Service API",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app as any).use("/api/docs", swaggerUi.serve, swaggerSetup);
  }
}

app.get("/metrics", async (_req, res) => {
  try {
    res.set("Content-Type", "text/plain");
    res.end(await metrics.getMetrics());
  } catch (error: unknown) {
    res.status(500).end(error instanceof Error ? error.message : String(error));
  }
});

app.use("/api/v1", apiKeyAuth, routes);

app.use("/api/*path", (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _p = ((req.params as any)["0"] ?? (req.params as any)["path"]) || "";
  res.redirect(
    308,
    `/api/v1/${_p}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`,
  );
});

app.use(errorHandler);

if (require.main === module) {
  const KEEP_ALIVE_TIMEOUT_MS = parseInt(
    process.env.KEEP_ALIVE_TIMEOUT_MS || "65000",
    10,
  );
  const HEADERS_TIMEOUT_MS = parseInt(
    process.env.HEADERS_TIMEOUT_MS || "66000",
    10,
  );

  const server = app.listen(PORT, () => {
    const coldStartMs = Number(process.hrtime.bigint() - _startupBegin) / 1e6;
    logger.info(
      {
        port: PORT,
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || "development",
        coldStartMs: Math.round(coldStartMs),
      },
      "stellar-footprint-service started",
    );
  });

  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully`);
    server.close(() => {
      logger.info("Server closed, exiting");
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn("Forced exit after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled rejection");
  });
}

export default app;

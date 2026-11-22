import type { Express } from "express";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import request from "supertest";

/**
 * Builds a strict CORS origin validator mirroring the production config:
 * exact matches against the allowlist plus safe wildcard subdomain patterns
 * (e.g. `*.stellar.org`). Wildcard `*` is never permitted.
 */
function buildOriginValidator(allowedOrigins: string[]) {
  const exact = new Set<string>();
  const patterns: RegExp[] = [];

  for (const entry of allowedOrigins) {
    const trimmed = entry.trim();
    if (!trimmed || trimmed === "*") continue;

    if (trimmed.startsWith("*.")) {
      const domain = trimmed.slice(2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match the apex domain and any single-or-multi-level subdomain,
      // but never a lookalike such as `evil-stellar.org` or `stellar.org.evil.com`.
      patterns.push(new RegExp(`^https?://(?:[a-z0-9-]+\\.)*${domain}(?::\\d+)?$`, "i"));
    } else {
      exact.add(trimmed);
    }
  }

  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      // Non-browser clients (no Origin header) are allowed.
      return callback(null, true);
    }
    if (exact.has(origin) || patterns.some((re) => re.test(origin))) {
      return callback(null, true);
    }
    return callback(null, false);
  };
}

function buildCorsApp(allowedOrigins: string[]): Express {
  const app = express();
  app.use(
    cors({
      origin: buildOriginValidator(allowedOrigins),
      credentials: true,
      maxAge: 86400,
    }),
  );
  app.get("/test", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("security headers", () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        },
      }),
    );
    app.use((_req, res, next) => {
      res.setHeader(
        "Permissions-Policy",
        "accelerometer=(),ambient-light-sensor=(),autoplay=(),battery=(),camera=(),cross-origin-isolated=(),display-capture=(),document-domain=(),encrypted-media=(),execution-while-not-rendered=(),execution-while-out-of-viewport=(),fullscreen=(),geolocation=(),gyroscope=(),keyboard-map=(),magnetometer=(),microphone=(),midi=(),navigation-override=(),payment=(),picture-in-picture=(),publickey-credentials-get=(),screen-wake-lock=(),sync-xhr=(),usb=(),web-share=(),xr-spatial-tracking=()",
      );
      next();
    });

    app.get("/test", (_req, res) => res.json({ ok: true }));
  });

  it("sets all expected security headers", async () => {
    const res = await request(app).get("/test");

    expect(res.status).toBe(200);

    // ── Helmet-provided headers ──────────────────────────────────────
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(res.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["referrer-policy"]).toBeDefined();
    expect(res.headers["x-dns-prefetch-control"]).toMatch(/^on|off$/);
    expect(res.headers["x-download-options"]).toBe("noopen");
    expect(res.headers["x-xss-protection"]).toBe("0");
    expect(res.headers["x-permitted-cross-domain-policies"]).toBe("none");
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(res.headers["origin-agent-cluster"]).toBe("?1");

    // ── Custom-managed headers ──────────────────────────────────────
    // Added via inline middleware — every browser feature disabled
    expect(res.headers["permissions-policy"]).toBeDefined();
    expect(res.headers["permissions-policy"]).not.toBe("");
  });
});

describe("strict CORS configuration", () => {
  const allowedOrigins = ["https://app.example.com", "*.stellar.org"];
  let app: Express;

  beforeEach(() => {
    app = buildCorsApp(allowedOrigins);
  });

  it("allows an exact-match origin and sets Vary: Origin", async () => {
    const res = await request(app)
      .get("/test")
      .set("Origin", "https://app.example.com");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.example.com",
    );
    expect(res.headers["vary"]).toMatch(/Origin/i);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("allows wildcard subdomains safely", async () => {
    const res = await request(app)
      .get("/test")
      .set("Origin", "https://api.stellar.org");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://api.stellar.org",
    );
    expect(res.headers["vary"]).toMatch(/Origin/i);
  });

  it("rejects lookalike domains that only resemble the wildcard pattern", async () => {
    for (const origin of [
      "https://evil-stellar.org",
      "https://stellar.org.evil.com",
      "https://notstellar.org",
    ]) {
      const res = await request(app).get("/test").set("Origin", origin);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("rejects an unauthorized origin", async () => {
    const res = await request(app)
      .get("/test")
      .set("Origin", "https://malicious.example.net");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("responds to allowed preflight with max-age 86400 and Vary: Origin", async () => {
    const res = await request(app)
      .options("/test")
      .set("Origin", "https://app.example.com")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.example.com",
    );
    expect(res.headers["access-control-max-age"]).toBe("86400");
    expect(res.headers["vary"]).toMatch(/Origin/i);
  });

  it("does not grant access to disallowed preflight requests", async () => {
    const res = await request(app)
      .options("/test")
      .set("Origin", "https://malicious.example.net")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-max-age"]).toBeUndefined();
  });

  it("never returns a wildcard origin when credentials are enabled", async () => {
    const res = await request(app)
      .get("/test")
      .set("Origin", "https://app.example.com");

    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});

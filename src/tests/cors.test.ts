import express from "express";
import request from "supertest";

import { compileOriginPattern, corsMiddleware } from "../middleware/cors";

function makeApp(allowed: string) {
  const app = express();
  app.use(corsMiddleware(allowed));
  app.get("/t", (_req, res) => res.json({ ok: true }));
  return app;
}

const ALLOWED = "https://app.example.com, https://*.stellar.org";

describe("strict CORS origin validation", () => {
  it("allows an exact-match origin with Vary and credentials", async () => {
    const res = await request(makeApp(ALLOWED))
      .get("/t")
      .set("Origin", "https://app.example.com");
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.example.com",
    );
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["vary"]).toMatch(/Origin/);
  });

  it("allows wildcard subdomains", async () => {
    const res = await request(makeApp(ALLOWED))
      .get("/t")
      .set("Origin", "https://horizon.stellar.org");
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://horizon.stellar.org",
    );
  });

  it.each([
    "https://evil.com",
    "https://stellar.org.evil.com",
    "https://evilstellar.org",
    "https://evil.com/.stellar.org",
    "https://stellar.org",
    "http://horizon.stellar.org",
    "https://app.example.com.evil.com",
    "https://xapp.example.com",
    "null",
  ])("rejects %s", async (origin) => {
    const res = await request(makeApp(ALLOWED)).get("/t").set("Origin", origin);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["vary"]).toMatch(/Origin/);
  });

  it("answers allowed preflight with max-age 86400", async () => {
    const res = await request(makeApp(ALLOWED))
      .options("/t")
      .set("Origin", "https://app.example.com")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-max-age"]).toBe("86400");
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.example.com",
    );
  });

  it("gives no CORS headers on preflight from a rejected origin", async () => {
    const res = await request(makeApp(ALLOWED))
      .options("/t")
      .set("Origin", "https://evil.com")
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("denies everything when nothing is configured and never emits '*'", async () => {
    const res = await request(makeApp(""))
      .get("/t")
      .set("Origin", "https://app.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(compileOriginPattern("*")).toBeNull();
    const star = await request(makeApp("*"))
      .get("/t")
      .set("Origin", "https://app.example.com");
    expect(star.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

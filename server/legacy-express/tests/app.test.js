import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

import { createApp } from "../src/app.js";
import { errorHandler } from "../src/middleware/errorHandler.js";

const config = {
  PORT: 5000,
  CLIENT_URL: "http://localhost:5173",
  JWT_SECRET: "a-test-secret-with-at-least-32-characters",
};

const app = createApp({ config });

describe("GET /health", () => {
  it("returns the service health status", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

it("uses the configured client origin for CORS", async () => {
  const response = await request(app)
    .get("/health")
    .set("Origin", "http://localhost:5173");

  expect(response.headers["access-control-allow-origin"]).toBe(
    "http://localhost:5173",
  );
});

it("does not grant CORS access to other origins", async () => {
  const response = await request(app)
    .get("/health")
    .set("Origin", "https://untrusted.example");

  expect(response.headers["access-control-allow-origin"]).toBeUndefined();
});

it("returns contract-shaped errors for unknown routes", async () => {
  const response = await request(app).get("/missing");

  expect(response.status).toBe(404);
  expect(response.body).toEqual({
    error: { message: "Not found.", code: "NOT_FOUND" },
  });
});

it("does not return or log raw internal error details", async () => {
  const internalApp = express();
  internalApp.get("/failure", (_request, _response, next) => {
    const error = new Error("JWT_SECRET=do-not-leak");
    error.status = 500;
    error.code = "UNSAFE_INTERNAL_CODE";
    next(error);
  });
  internalApp.use(errorHandler);
  const logger = jest.spyOn(console, "error").mockImplementation(() => {});

  try {
    const response = await request(internalApp).get("/failure");
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("JWT_SECRET");
    expect(JSON.stringify(response.body)).not.toContain("stack");
    expect(logger).toHaveBeenCalledWith("Request failed.", { errorType: "Error" });
    expect(JSON.stringify(logger.mock.calls)).not.toContain("do-not-leak");
  } finally {
    logger.mockRestore();
  }
});

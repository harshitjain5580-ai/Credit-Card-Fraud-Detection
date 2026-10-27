import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";

import { createApp } from "../src/app.js";
import { MlUnavailableError } from "../src/services/mlClient.js";

const merchantId = "507f1f77bcf86cd799439011";
const config = {
  CLIENT_URL: "http://localhost:5173",
  JWT_SECRET: "a-test-secret-with-at-least-32-characters",
};
const token = jwt.sign({ role: "merchant" }, config.JWT_SECRET, {
  subject: merchantId,
});
const transaction = {
  _id: "507f1f77bcf86cd799439012",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  displayAmount: 10,
  currency: "usd",
  source: "simulated",
  fraudProbability: 0.8,
  riskLabel: "HIGH",
  isFlagged: true,
  scoringStatus: "scored",
  modelVersion: "xgb-v1",
  reviewDecision: null,
  stripePaymentIntentId: null,
  features: { Amount: 10 },
};

function createTransactionModel() {
  return {
    find: jest.fn(() => ({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([transaction]),
    })),
    countDocuments: jest.fn().mockResolvedValue(1),
    findOneAndUpdate: jest.fn().mockResolvedValue(transaction),
    aggregate: jest.fn().mockResolvedValue([]),
  };
}

function authenticated(appRequest) {
  return appRequest.set("Authorization", `Bearer ${token}`);
}

describe("transaction API", () => {
  it("requires authentication for the transaction list", async () => {
    const app = createApp({ config });
    const response = await request(app).get("/api/transactions");

    expect(response.status).toBe(401);
  });

  it("applies merchant scope, filters, pagination, and safe serialization", async () => {
    const TransactionModel = createTransactionModel();
    const app = createApp({ config, TransactionModel });
    const response = await authenticated(request(app).get(
      "/api/transactions?page=2&limit=5&riskLabel=HIGH&flagged=true",
    ));

    expect(response.status).toBe(200);
    expect(TransactionModel.find).toHaveBeenCalledWith({
      merchantId,
      riskLabel: "HIGH",
      isFlagged: true,
    });
    expect(response.body).toEqual({
      items: [
        {
          id: transaction._id,
          createdAt: transaction.createdAt.toISOString(),
          displayAmount: 10,
          currency: "usd",
          source: "simulated",
          fraudProbability: 0.8,
          riskLabel: "HIGH",
          isFlagged: true,
          scoringStatus: "scored",
          modelVersion: "xgb-v1",
          reviewDecision: null,
          stripePaymentIntentId: null,
        },
      ],
      page: 2,
      limit: 5,
      total: 1,
    });
    expect(response.body.items[0]).not.toHaveProperty("features");
  });

  it("generates fraud-mode simulations through the scoring save flow", async () => {
    const samples = [];
    const replaySamplePicker = jest.fn(() => ({
      Time: 10,
      Amount: 3,
      Class: 1,
    }));
    const app = createApp({
      config,
      replaySamplePicker,
      saveScoredTransaction: jest.fn(async (input) => {
        samples.push(input);
        return transaction;
      }),
    });
    const response = await authenticated(request(app).post("/api/transactions/simulate"))
      .send({ count: 2, mode: "fraud" });

    expect(response.status).toBe(201);
    expect(response.body.created).toBe(2);
    expect(replaySamplePicker).toHaveBeenCalledWith({ fraud: true });
    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({
      features: { Time: 10, Amount: 3 },
      displayAmount: 3,
      source: "simulated",
      merchantId,
      groundTruthLabel: 1,
    });
  });

  it("rate limits repeated simulation requests", async () => {
    const app = createApp({ config });
    const responses = [];
    for (let index = 0; index < 11; index += 1) {
      responses.push(
        await request(app)
          .post("/api/transactions/simulate")
          .send({ count: 1, mode: "random" }),
      );
    }

    expect(responses.slice(0, 10).every((response) => response.status === 401)).toBe(true);
    expect(responses[10].status).toBe(429);
    expect(responses[10].body.error.code).toBe("RATE_LIMITED");
  });

  it("validates review decisions and scopes updates to the authenticated merchant", async () => {
    const TransactionModel = createTransactionModel();
    const app = createApp({ config, TransactionModel });
    const response = await authenticated(request(app).patch(
      `/api/transactions/${transaction._id}/review`,
    )).send({ decision: "legit" });

    expect(response.status).toBe(200);
    expect(TransactionModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: transaction._id, merchantId },
      { $set: { reviewDecision: "legit" } },
      { new: true, runValidators: true },
    );
    expect(response.body).not.toHaveProperty("features");
  });

  it("rejects an invalid transaction id through Zod before querying", async () => {
    const TransactionModel = createTransactionModel();
    const app = createApp({ config, TransactionModel });
    const response = await authenticated(
      request(app).patch("/api/transactions/not-an-object-id/review"),
    ).send({ decision: "legit" });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(TransactionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("proxies protected model info", async () => {
    const modelInfo = { model_version: "xgb-v1", threshold: 0.5, metrics: {} };
    const app = createApp({
      config,
      modelInfoFetcher: jest.fn().mockResolvedValue(modelInfo),
    });
    const response = await authenticated(request(app).get("/api/model-info"));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(modelInfo);
  });

  it("returns aggregated risk counts and zero-filled time series", async () => {
    const TransactionModel = createTransactionModel();
    TransactionModel.aggregate
      .mockResolvedValueOnce([
        {
          total: 2,
          flagged: 1,
          avgProbability: 0.4,
          LOW: 1,
          MEDIUM: 0,
          HIGH: 1,
          UNSCORED: 0,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const app = createApp({ config, TransactionModel });
    const response = await authenticated(request(app).get("/api/transactions/stats"));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      total: 2,
      flagged: 1,
      fraudRate: 0.5,
      avgProbability: 0.4,
      byRisk: { LOW: 1, MEDIUM: 0, HIGH: 1, UNSCORED: 0 },
    });
    expect(response.body.series24h).toHaveLength(24);
    expect(response.body.series30d).toHaveLength(30);
    const expectedMerchant = new mongoose.Types.ObjectId(merchantId);
    expect(TransactionModel.aggregate.mock.calls.every(
      ([pipeline]) => pipeline[0].$match.merchantId.equals(expectedMerchant),
    )).toBe(true);
    expect(response.body.series24h.every((row) => row.total === 0 && row.flagged === 0)).toBe(
      true,
    );
  });

  it("returns ten scoped histogram bins", async () => {
    const TransactionModel = createTransactionModel();
    TransactionModel.aggregate.mockResolvedValue([{ _id: 0, count: 3 }, { _id: 9, count: 2 }]);
    const app = createApp({ config, TransactionModel });
    const response = await authenticated(
      request(app).get("/api/transactions/score-histogram"),
    );

    expect(response.status).toBe(200);
    expect(TransactionModel.aggregate.mock.calls[0][0][0].$match).toEqual({
      merchantId: new mongoose.Types.ObjectId(merchantId),
      fraudProbability: { $ne: null },
    });
    expect(response.body.bins).toHaveLength(10);
    expect(response.body.bins[0]).toEqual({ from: 0, to: 0.1, count: 3 });
    expect(response.body.bins[9]).toEqual({ from: 0.9, to: 1, count: 2 });
  });

  it("returns the protected unread flagged transaction count", async () => {
    const TransactionModel = createTransactionModel();
    TransactionModel.countDocuments.mockResolvedValue(7);
    const app = createApp({ config, TransactionModel });
    const response = await authenticated(request(app).get("/api/alerts/unread-count"));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: 7 });
    expect(TransactionModel.countDocuments).toHaveBeenCalledWith({
      merchantId,
      isFlagged: true,
      reviewDecision: null,
    });
  });

  it("returns a contract-shaped service-unavailable error for model-info downtime", async () => {
    const app = createApp({
      config,
      modelInfoFetcher: jest.fn().mockRejectedValue(new MlUnavailableError()),
    });
    const response = await authenticated(request(app).get("/api/model-info"));

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: {
        message: "The fraud scoring service is unavailable.",
        code: "ML_UNAVAILABLE",
      },
    });
  });
});

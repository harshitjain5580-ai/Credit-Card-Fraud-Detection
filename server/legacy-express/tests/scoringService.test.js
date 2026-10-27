import { jest } from "@jest/globals";

import { MlUnavailableError } from "../src/services/mlClient.js";
import { scoreAndSave } from "../src/services/scoringService.js";

describe("scoreAndSave", () => {
  const input = {
    features: { Time: 1, Amount: 4.5 },
    displayAmount: 4.5,
    currency: "usd",
    source: "simulated",
    merchantId: "merchant-1",
    groundTruthLabel: 1,
  };

  it("saves a scored transaction and flags only the prediction result", async () => {
    const TransactionModel = { create: jest.fn(async (data) => data) };
    const score = jest.fn().mockResolvedValue({
      fraudProbability: 0.9,
      riskLabel: "HIGH",
      isFraud: true,
      modelVersion: "xgb-v1",
    });

    const transaction = await scoreAndSave(input, { TransactionModel, score });

    expect(transaction).toMatchObject({
      fraudProbability: 0.9,
      riskLabel: "HIGH",
      isFlagged: true,
      scoringStatus: "scored",
      modelVersion: "xgb-v1",
      status: "simulated",
    });
    expect(TransactionModel.create).toHaveBeenCalledTimes(1);
  });

  it("fails safe to manual review when ML is unavailable", async () => {
    const TransactionModel = { create: jest.fn(async (data) => data) };
    const logger = { warn: jest.fn() };
    const score = jest.fn().mockRejectedValue(new MlUnavailableError());

    const transaction = await scoreAndSave(input, { TransactionModel, score, logger });

    expect(transaction).toMatchObject({
      fraudProbability: null,
      riskLabel: "UNSCORED",
      isFlagged: true,
      scoringStatus: "pending_review",
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("does not hide transaction persistence or unexpected scoring errors", async () => {
    const failure = new Error("database unavailable");

    await expect(
      scoreAndSave(input, {
        TransactionModel: { create: jest.fn().mockRejectedValue(failure) },
        score: jest.fn().mockResolvedValue({
          fraudProbability: 0.1,
          riskLabel: "LOW",
          isFraud: false,
          modelVersion: "xgb-v1",
        }),
      }),
    ).rejects.toBe(failure);
  });

  it("does not let alert queue failures break transaction persistence", async () => {
    const TransactionModel = { create: jest.fn(async (data) => data) };
    const logger = { error: jest.fn() };
    const transaction = await scoreAndSave(input, {
      TransactionModel,
      logger,
      score: jest.fn().mockResolvedValue({
        fraudProbability: 0.95,
        riskLabel: "HIGH",
        isFraud: true,
        modelVersion: "xgb-v1",
      }),
      notifyAlert: jest.fn().mockRejectedValue(new Error("alert queue failed")),
    });

    expect(transaction.riskLabel).toBe("HIGH");
    expect(TransactionModel.create).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

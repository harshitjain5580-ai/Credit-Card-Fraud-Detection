import { jest } from "@jest/globals";

import { MlUnavailableError, scoreTransaction } from "../src/services/mlClient.js";

describe("scoreTransaction", () => {
  const prediction = {
    fraud_probability: 0.82,
    risk_label: "HIGH",
    is_fraud: true,
    model_version: "xgb-v1",
  };
  const options = {
    baseUrl: "http://ml-service:8000/",
    apiKey: "test-key",
    timeoutMs: 2500,
  };

  it("maps the prediction response and sends the configured auth header and timeout", async () => {
    const httpClient = { post: jest.fn().mockResolvedValue({ data: prediction }) };

    await expect(scoreTransaction({ Amount: 12 }, { ...options, httpClient })).resolves.toEqual({
      fraudProbability: 0.82,
      riskLabel: "HIGH",
      isFraud: true,
      modelVersion: "xgb-v1",
    });
    expect(httpClient.post).toHaveBeenCalledWith(
      "http://ml-service:8000/predict",
      { Amount: 12 },
      { headers: { "X-API-Key": "test-key" }, timeout: 2500 },
    );
  });

  it("retries a network failure once and then throws the typed availability error", async () => {
    const networkError = new Error("connection refused");
    const httpClient = {
      post: jest.fn().mockRejectedValueOnce(networkError).mockRejectedValueOnce(networkError),
    };

    await expect(scoreTransaction({}, { ...options, httpClient })).rejects.toBeInstanceOf(
      MlUnavailableError,
    );
    expect(httpClient.post).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors", async () => {
    const httpClient = {
      post: jest.fn().mockRejectedValue({ response: { status: 422 } }),
    };

    await expect(scoreTransaction({}, { ...options, httpClient })).rejects.toBeInstanceOf(
      MlUnavailableError,
    );
    expect(httpClient.post).toHaveBeenCalledTimes(1);
  });
});

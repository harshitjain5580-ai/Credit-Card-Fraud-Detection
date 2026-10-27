import { jest } from "@jest/globals";

import { createAlertService } from "../src/services/alertService.js";

describe("merchant fraud alert service", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("debounces a burst into one summary per merchant window", async () => {
    jest.useFakeTimers();
    const sendMail = jest.fn().mockResolvedValue({});
    const findById = jest.fn(() => ({
      select: jest.fn().mockResolvedValue({ email: "merchant@example.com" }),
    }));
    const alertService = createAlertService({
      config: {
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: 587,
        SMTP_USER: "user",
        SMTP_PASS: "pass",
        SMTP_FROM: "alerts@example.com",
      },
      UserModel: { findById },
      transporter: { sendMail },
      logger: { warn: jest.fn(), error: jest.fn() },
      debounceMs: 300_000,
    });

    await alertService.notifyTransactionAlert({
      merchantId: "merchant-1",
      transaction: { riskLabel: "HIGH", scoringStatus: "scored" },
    });
    await alertService.notifyTransactionAlert({
      merchantId: "merchant-1",
      transaction: { riskLabel: "UNSCORED", scoringStatus: "pending_review" },
    });
    await alertService.notifyTransactionAlert({
      merchantId: "merchant-1",
      transaction: { riskLabel: "HIGH", scoringStatus: "pending_review" },
    });
    await jest.advanceTimersByTimeAsync(300_000);

    expect(findById).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "merchant@example.com",
        subject: "Fraud alert summary: 3 transaction(s)",
        text: expect.stringContaining("High-risk transactions: 2."),
      }),
    );
    expect(sendMail.mock.calls[0][0].text).toContain(
      "Transactions pending manual review: 2.",
    );
  });

  it("does not send a second email to the same merchant inside five minutes", async () => {
    jest.useFakeTimers();
    const sendMail = jest.fn().mockResolvedValue({});
    const alertService = createAlertService({
      config: {
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: 587,
        SMTP_USER: "user",
        SMTP_PASS: "pass",
        SMTP_FROM: "alerts@example.com",
      },
      UserModel: {
        findById: () => ({
          select: jest.fn().mockResolvedValue({ email: "merchant@example.com" }),
        }),
      },
      transporter: { sendMail },
      logger: { warn: jest.fn(), error: jest.fn() },
      debounceMs: 300_000,
    });
    const alert = {
      merchantId: "merchant-1",
      transaction: { riskLabel: "HIGH", scoringStatus: "scored" },
    };

    await alertService.notifyTransactionAlert(alert);
    await jest.advanceTimersByTimeAsync(300_000);
    expect(sendMail).toHaveBeenCalledTimes(1);

    await alertService.notifyTransactionAlert(alert);
    await jest.advanceTimersByTimeAsync(299_999);
    expect(sendMail).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("logs alerts without SMTP and ignores transactions that do not need an alert", async () => {
    const logger = { warn: jest.fn(), error: jest.fn() };
    const alertService = createAlertService({ logger });

    await alertService.notifyTransactionAlert({
      merchantId: "merchant-1",
      transaction: { riskLabel: "LOW", scoringStatus: "scored" },
    });
    await alertService.notifyTransactionAlert({
      merchantId: "merchant-1",
      transaction: { riskLabel: "UNSCORED", scoringStatus: "pending_review" },
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Merchant fraud alert (SMTP is not configured).",
      expect.objectContaining({ merchantId: "merchant-1", pendingReview: 1 }),
    );
  });

  it("contains email delivery failures without rejecting the alert call", async () => {
    jest.useFakeTimers();
    const logger = { warn: jest.fn(), error: jest.fn() };
    const alertService = createAlertService({
      config: {
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: 587,
        SMTP_USER: "user",
        SMTP_PASS: "pass",
        SMTP_FROM: "alerts@example.com",
      },
      UserModel: {
        findById: () => ({
          select: jest.fn().mockResolvedValue({ email: "merchant@example.com" }),
        }),
      },
      transporter: { sendMail: jest.fn().mockRejectedValue(new Error("SMTP offline")) },
      logger,
      debounceMs: 10,
    });

    await expect(
      alertService.notifyTransactionAlert({
        merchantId: "merchant-1",
        transaction: { riskLabel: "HIGH", scoringStatus: "scored" },
      }),
    ).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(10);

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to send merchant fraud alert email.",
      expect.objectContaining({ merchantId: "merchant-1", errorType: "Error" }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("SMTP offline");
  });
});

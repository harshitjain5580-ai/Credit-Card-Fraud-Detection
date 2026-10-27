import { jest } from "@jest/globals";
import request from "supertest";

import { createApp } from "../src/app.js";
import { createStripeWebhookRouter } from "../src/routes/stripeWebhook.js";

const config = {
  CLIENT_URL: "http://localhost:5173",
  JWT_SECRET: "a-test-secret-with-at-least-32-characters",
};
const paymentIntent = {
  id: "pi_test_123",
  amount: 2599,
  currency: "usd",
  metadata: {
    merchantId: "507f1f77bcf86cd799439011",
    demoMode: "fraud-demo",
  },
};
const event = {
  id: "evt_test_123",
  type: "payment_intent.succeeded",
  data: { object: paymentIntent },
};

function createTransactionModel({ existing = null, createError } = {}) {
  const select = jest.fn().mockResolvedValue(existing);
  return {
    findOne: jest.fn(() => ({ select })),
    create: jest.fn().mockRejectedValue(createError),
  };
}

function createAppWithWebhook({
  stripe,
  TransactionModel,
  replaySamplePicker,
  saveScoredTransaction,
}) {
  return createApp({
    config,
    webhookRouter: createStripeWebhookRouter({
      stripe,
      webhookSecret: "whsec_test",
      TransactionModel,
      replaySamplePicker,
      saveScoredTransaction,
    }),
  });
}

describe("Stripe webhook", () => {
  it("rejects invalid signatures with HTTP 400", async () => {
    const stripe = {
      webhooks: { constructEvent: jest.fn(() => { throw new Error("bad signature"); }) },
    };
    const app = createAppWithWebhook({
      stripe,
      TransactionModel: createTransactionModel(),
    });
    const response = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "invalid")
      .send(JSON.stringify(event));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_STRIPE_SIGNATURE");
    expect(stripe.webhooks.constructEvent.mock.calls[0][0]).toBeInstanceOf(Buffer);
  });

  it("acknowledges unrelated Stripe events without scoring", async () => {
    const stripe = {
      webhooks: {
        constructEvent: jest.fn(() => ({ ...event, type: "charge.updated" })),
      },
    };
    const saveScoredTransaction = jest.fn();
    const app = createAppWithWebhook({
      stripe,
      TransactionModel: createTransactionModel(),
      saveScoredTransaction,
    });
    const response = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "valid")
      .send(JSON.stringify(event));

    expect(response.status).toBe(200);
    expect(saveScoredTransaction).not.toHaveBeenCalled();
  });

  it("rejects malformed successful-payment payloads before database access", async () => {
    const stripe = {
      webhooks: {
        constructEvent: jest.fn(() => ({
          ...event,
          data: { object: { ...paymentIntent, metadata: { merchantId: "invalid" } } },
        })),
      },
    };
    const TransactionModel = createTransactionModel();
    const app = createAppWithWebhook({ stripe, TransactionModel });
    const response = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "valid")
      .send(JSON.stringify(event));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_PAYMENT_METADATA");
    expect(TransactionModel.findOne).not.toHaveBeenCalled();
  });

  it("scores and saves a successful payment with replay features and real Stripe IDs/amount", async () => {
    const stripe = { webhooks: { constructEvent: jest.fn(() => event) } };
    const TransactionModel = createTransactionModel();
    const replaySamplePicker = jest.fn(() => ({
      Time: 123,
      V1: -1,
      Amount: 5,
      Class: 1,
    }));
    const saveScoredTransaction = jest.fn().mockResolvedValue({});
    const app = createAppWithWebhook({
      stripe,
      TransactionModel,
      replaySamplePicker,
      saveScoredTransaction,
    });
    const response = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "valid")
      .send(JSON.stringify(event));

    expect(response.status).toBe(200);
    expect(TransactionModel.findOne).toHaveBeenCalledWith({
      $or: [
        { stripeEventId: event.id },
        { stripePaymentIntentId: paymentIntent.id },
      ],
    });
    expect(replaySamplePicker).toHaveBeenCalledWith({ fraud: true });
    expect(saveScoredTransaction).toHaveBeenCalledWith(
      {
        features: { Time: 123, V1: -1, Amount: 5 },
        displayAmount: 25.99,
        currency: "usd",
        source: "stripe",
        merchantId: paymentIntent.metadata.merchantId,
        stripeIds: {
          stripeEventId: event.id,
          stripePaymentIntentId: paymentIntent.id,
        },
        groundTruthLabel: 1,
      },
      expect.objectContaining({ TransactionModel }),
    );
  });

  it("returns immediately without replay or scoring when a payment already exists", async () => {
    const stripe = { webhooks: { constructEvent: jest.fn(() => event) } };
    const TransactionModel = createTransactionModel({ existing: { _id: "existing" } });
    const replaySamplePicker = jest.fn();
    const saveScoredTransaction = jest.fn();
    const app = createAppWithWebhook({
      stripe,
      TransactionModel,
      replaySamplePicker,
      saveScoredTransaction,
    });
    const response = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "valid")
      .send(JSON.stringify(event));

    expect(response.status).toBe(200);
    expect(replaySamplePicker).not.toHaveBeenCalled();
    expect(saveScoredTransaction).not.toHaveBeenCalled();
  });

  it("acknowledges a duplicate-key race once the duplicate transaction exists", async () => {
    const duplicateError = Object.assign(new Error("duplicate"), { code: 11000 });
    const stripe = { webhooks: { constructEvent: jest.fn(() => event) } };
    const select = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: "winner" });
    const TransactionModel = {
      findOne: jest.fn(() => ({ select })),
    };
    const app = createAppWithWebhook({
      stripe,
      TransactionModel,
      replaySamplePicker: jest.fn(() => ({ Time: 1, Amount: 1, Class: 0 })),
      saveScoredTransaction: jest.fn().mockRejectedValue(duplicateError),
    });
    const response = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "valid")
      .send(JSON.stringify(event));

    expect(response.status).toBe(200);
    expect(TransactionModel.findOne).toHaveBeenCalledTimes(2);
  });
});

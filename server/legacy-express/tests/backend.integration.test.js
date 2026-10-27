import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import mongoose from "mongoose";
import Stripe from "stripe";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";

import { createApp } from "../src/app.js";
import Transaction from "../src/models/Transaction.js";
import User from "../src/models/User.js";
import { MlUnavailableError } from "../src/services/mlClient.js";
import { createStripeWebhookRouter } from "../src/routes/stripeWebhook.js";

const JWT_SECRET = "integration-test-secret-with-more-than-32-characters";
const WEBHOOK_SECRET = "whsec_integration_test_secret";
const config = {
  CLIENT_URL: "http://localhost:5173",
  JWT_SECRET,
  ML_SERVICE_URL: "http://localhost:8000",
  ML_TIMEOUT_MS: 1000,
};
const merchantId = new mongoose.Types.ObjectId().toString();
const stripe = new Stripe("sk_test_integration");

let mongoServer;

function createSignedWebhookApp(score, logger) {
  const event = {
    id: "evt_integration_payment_succeeded",
    object: "event",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_integration_payment",
        object: "payment_intent",
        amount: 4299,
        currency: "usd",
        metadata: { merchantId, demoMode: "normal" },
      },
    },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  const webhookRouter = createStripeWebhookRouter({
    stripe,
    webhookSecret: WEBHOOK_SECRET,
    scoringOptions: { score, logger },
  });
  return {
    app: createApp({ config, webhookRouter }),
    payload,
    signature,
  };
}

async function postWebhook(app, payload, signature) {
  return request(app)
    .post("/api/webhooks/stripe")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", signature)
    .send(payload);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([User.init(), Transaction.init()]);
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Transaction.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe("MongoDB-backed auth and Stripe integration", () => {
  it("registers and logs in a merchant, and rejects a wrong password", async () => {
    const app = createApp({ config });
    const registration = await request(app).post("/api/auth/register").send({
      name: "Mongo Merchant",
      email: "merchant@example.com",
      password: "secure-password-123",
    });
    const login = await request(app).post("/api/auth/login").send({
      email: "MERCHANT@example.com",
      password: "secure-password-123",
    });
    const rejectedLogin = await request(app).post("/api/auth/login").send({
      email: "merchant@example.com",
      password: "wrong-password",
    });

    expect(registration.status).toBe(201);
    expect(login.status).toBe(200);
    expect(login.body.user).toEqual(registration.body.user);
    expect(rejectedLogin.status).toBe(401);
    expect(rejectedLogin.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(await User.countDocuments()).toBe(1);
  });

  it("rejects a protected transaction request without a JWT", async () => {
    const response = await request(createApp({ config })).get("/api/transactions");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a Stripe webhook with a bad signature", async () => {
    const { app, payload } = createSignedWebhookApp(jest.fn());
    const response = await postWebhook(app, payload, "bad-signature");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_STRIPE_SIGNATURE");
  });

  it("creates exactly one transaction when a signed success event is delivered twice", async () => {
    const mockMlClient = jest.fn().mockResolvedValue({
      fraudProbability: 0.91,
      riskLabel: "HIGH",
      isFraud: true,
      modelVersion: "test-model",
    });
    const { app, payload, signature } = createSignedWebhookApp(mockMlClient);

    const first = await postWebhook(app, payload, signature);
    const duplicate = await postWebhook(app, payload, signature);

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(await Transaction.countDocuments()).toBe(1);
    expect(mockMlClient).toHaveBeenCalledTimes(1);
    const saved = await Transaction.findOne().lean();
    expect(saved).toMatchObject({
      stripeEventId: "evt_integration_payment_succeeded",
      stripePaymentIntentId: "pi_integration_payment",
      merchantId: new mongoose.Types.ObjectId(merchantId),
      displayAmount: 42.99,
      currency: "usd",
      source: "stripe",
      scoringStatus: "scored",
    });
  });

  it("saves an unscored transaction for manual review and acknowledges ML downtime", async () => {
    const mockMlClient = jest.fn().mockRejectedValue(new MlUnavailableError());
    const logger = { warn: jest.fn() };
    const { app, payload, signature } = createSignedWebhookApp(mockMlClient, logger);

    const response = await postWebhook(app, payload, signature);
    const saved = await Transaction.findOne().lean();

    expect(response.status).toBe(200);
    expect(saved).toMatchObject({
      stripePaymentIntentId: "pi_integration_payment",
      scoringStatus: "pending_review",
      riskLabel: "UNSCORED",
      isFlagged: true,
      fraudProbability: null,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import request from "supertest";

import { createApp } from "../src/app.js";

const config = {
  CLIENT_URL: "http://localhost:5173",
  JWT_SECRET: "a-test-secret-with-at-least-32-characters",
};
const merchantId = "507f1f77bcf86cd799439011";
const token = jwt.sign({ role: "merchant" }, config.JWT_SECRET, {
  subject: merchantId,
});

describe("Stripe checkout route", () => {
  it("requires authentication", async () => {
    const app = createApp({ config, stripe: { checkout: { sessions: { create: jest.fn() } } } });
    const response = await request(app)
      .post("/api/payments/checkout-session")
      .send({ amount: 12, mode: "normal" });

    expect(response.status).toBe(401);
  });

  it("creates a test Checkout Session with metadata and returns its URL", async () => {
    const create = jest.fn().mockResolvedValue({ url: "https://checkout.stripe.test/session" });
    const stripe = { checkout: { sessions: { create } } };
    const app = createApp({ config, stripe });
    const response = await request(app)
      .post("/api/payments/checkout-session")
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 12.34, mode: "fraud-demo" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ url: "https://checkout.stripe.test/session" });
    expect(create).toHaveBeenCalledWith({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Test purchase" },
            unit_amount: 1234,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        metadata: { merchantId, demoMode: "fraud-demo" },
      },
      success_url:
        "http://localhost:5173/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "http://localhost:5173/?checkout=cancelled",
    });
  });

  it("validates amount, mode, and currency while applying the USD default", async () => {
    const create = jest.fn().mockResolvedValue({ url: "https://checkout.stripe.test/session" });
    const app = createApp({
      config,
      stripe: { checkout: { sessions: { create } } },
    });
    const headers = { Authorization: `Bearer ${token}` };
    const belowMinimum = await request(app)
      .post("/api/payments/checkout-session")
      .set(headers)
      .send({ amount: 0.99, mode: "normal" });
    const invalidMode = await request(app)
      .post("/api/payments/checkout-session")
      .set(headers)
      .send({ amount: 2, mode: "unknown" });
    const valid = await request(app)
      .post("/api/payments/checkout-session")
      .set(headers)
      .send({ amount: 1, mode: "normal" });

    expect(belowMinimum.status).toBe(422);
    expect(invalidMode.status).toBe(422);
    expect(valid.status).toBe(200);
    expect(create.mock.calls[0][0].line_items[0].price_data.currency).toBe("usd");
  });
});

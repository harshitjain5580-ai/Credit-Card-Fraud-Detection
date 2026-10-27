import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const checkoutSchema = z.object({
  amount: z.number().finite().min(1).max(999999.99).refine(
    (amount) => Number.isInteger(amount * 100),
    "Amount must have no more than two decimal places.",
  ),
  currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/).default("usd"),
  mode: z.enum(["normal", "fraud-demo"]),
}).strict();

/**
 * Creates the authenticated Stripe Checkout endpoint.
 */
export function createPaymentsRouter({ jwtSecret, clientUrl, stripe } = {}) {
  if (!jwtSecret || !clientUrl || !stripe?.checkout?.sessions) {
    throw new Error("JWT secret, client URL, and Stripe client are required for payments.");
  }

  const router = Router();
  router.use(requireAuth(jwtSecret));
  router.post(
    "/payments/checkout-session",
    validate(checkoutSchema),
    async (request, response, next) => {
      try {
        const { amount, currency, mode } = request.validated.body;
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency,
                product_data: { name: "Test purchase" },
                unit_amount: Math.round(amount * 100),
              },
              quantity: 1,
            },
          ],
          payment_intent_data: {
            metadata: {
              merchantId: request.auth.userId,
              demoMode: mode,
            },
          },
          success_url: `${clientUrl.replace(/\/+$/, "")}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${clientUrl.replace(/\/+$/, "")}/?checkout=cancelled`,
        });
        return response.json({ url: session.url });
      } catch (error) {
        return next(error);
      }
    },
  );
  return router;
}

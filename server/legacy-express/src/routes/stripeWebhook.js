import express, { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";

import Transaction from "../models/Transaction.js";
import { validate } from "../middleware/validate.js";
import { pickSample } from "../services/replaySamples.js";
import { scoreAndSave } from "../services/scoringService.js";

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

const succeededEventSchema = z.object({
  id: z.string().min(1),
  type: z.literal("payment_intent.succeeded"),
  data: z.object({
    object: z.object({
      id: z.string().min(1),
      amount: z.number().int().positive(),
      currency: z.string().regex(/^[a-z]{3}$/i),
      metadata: z.object({
        merchantId: z.string().refine(mongoose.isValidObjectId),
        demoMode: z.enum(["normal", "fraud-demo"]).default("normal"),
      }).passthrough(),
    }).passthrough(),
  }),
}).passthrough();
const eventEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
}).passthrough();

/**
 * Creates a raw-body Stripe webhook router with signature verification and idempotency.
 */
export function createStripeWebhookRouter({
  stripe,
  webhookSecret,
  TransactionModel = Transaction,
  replaySamplePicker = pickSample,
  saveScoredTransaction = scoreAndSave,
  scoringOptions = {},
} = {}) {
  if (!stripe?.webhooks || !webhookSecret) {
    throw new Error("Stripe client and webhook secret are required for webhook handling.");
  }

  const router = Router();
  router.post("/stripe", express.raw({ type: "application/json" }), async (request, response, next) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body,
        request.get("stripe-signature"),
        webhookSecret,
      );
    } catch {
      return response.status(400).json({
        error: {
          message: "Invalid Stripe webhook signature.",
          code: "INVALID_STRIPE_SIGNATURE",
        },
      });
    }

    const parsedEnvelope = eventEnvelopeSchema.safeParse(event);
    if (!parsedEnvelope.success) {
      return response.status(400).json({
        error: {
          message: "Stripe event is invalid.",
          code: "INVALID_STRIPE_SIGNATURE",
        },
      });
    }

    if (parsedEnvelope.data.type !== "payment_intent.succeeded") {
      return response.sendStatus(200);
    }

    const parsedEvent = succeededEventSchema.safeParse(parsedEnvelope.data);
    if (!parsedEvent.success) {
      return response.status(400).json({
        error: {
          message: "Stripe payment metadata is missing or invalid.",
          code: "INVALID_PAYMENT_METADATA",
        },
      });
    }

    const { data: { object: paymentIntent }, id: eventId } = parsedEvent.data;
    const merchantId = paymentIntent.metadata.merchantId;
    const paymentIntentId = paymentIntent.id;
    try {
      const identifiers = {
        stripeEventId: eventId,
        stripePaymentIntentId: paymentIntentId,
      };
      const existing = await TransactionModel.findOne({
        $or: [
          { stripeEventId: identifiers.stripeEventId },
          { stripePaymentIntentId: identifiers.stripePaymentIntentId },
        ],
      }).select("_id");
      if (existing) {
        return response.sendStatus(200);
      }

      const fraudDemo = paymentIntent.metadata.demoMode === "fraud-demo";
      const sample = replaySamplePicker({ fraud: fraudDemo ? true : undefined });
      // Stripe does not provide the 30 anonymised PCA features, so the model input comes from replayed dataset rows while the amount and IDs come from the real Stripe test payment.
      const features = Object.fromEntries(
        Object.entries(sample).filter(([name]) => name !== "Class"),
      );

      await saveScoredTransaction(
        {
          features,
          displayAmount: paymentIntent.amount / 100,
          currency: paymentIntent.currency,
          source: "stripe",
          merchantId,
          stripeIds: identifiers,
          groundTruthLabel: sample.Class,
        },
        { TransactionModel, ...scoringOptions },
      );
      return response.sendStatus(200);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        try {
          const duplicate = await TransactionModel.findOne({
            $or: [
              { stripeEventId: eventId },
              { stripePaymentIntentId: paymentIntentId },
            ],
          }).select("_id");
          if (duplicate) {
            return response.sendStatus(200);
          }
        } catch (lookupError) {
          return next(lookupError);
        }
      }
      return next(error);
    }
  });
  return router;
}

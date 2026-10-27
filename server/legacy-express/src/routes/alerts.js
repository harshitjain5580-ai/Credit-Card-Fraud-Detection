import { Router } from "express";

import { requireAuth } from "../middleware/auth.js";
import Transaction from "../models/Transaction.js";

/**
 * Creates protected merchant-scoped alert routes.
 */
export function createAlertsRouter({
  jwtSecret,
  TransactionModel = Transaction,
} = {}) {
  if (!jwtSecret) {
    throw new Error("A JWT secret is required to configure alert routes.");
  }

  const router = Router();
  router.use(requireAuth(jwtSecret));
  router.get("/alerts/unread-count", async (request, response, next) => {
    try {
      const count = await TransactionModel.countDocuments({
        merchantId: request.auth.userId,
        isFlagged: true,
        reviewDecision: null,
      });
      return response.json({ count });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

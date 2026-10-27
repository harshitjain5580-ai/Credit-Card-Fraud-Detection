import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";

import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createAuthRouter } from "./routes/auth.js";
import { createAlertsRouter } from "./routes/alerts.js";
import { createPaymentsRouter } from "./routes/payments.js";
import { createTransactionsRouter } from "./routes/transactions.js";
import { createAlertService } from "./services/alertService.js";

export function createApp({
  config,
  webhookRouter,
  stripe,
  UserModel,
  TransactionModel,
  score,
  batchScorer,
  saveScoredTransaction,
  replaySamplePicker,
  modelInfoFetcher,
  alertNotifier,
} = {}) {
  if (!config?.CLIENT_URL || !config?.JWT_SECRET) {
    throw new Error("CLIENT_URL and JWT_SECRET are required to configure the server.");
  }

  const app = express();
  const notifyAlert =
    alertNotifier ??
    createAlertService({ config }).notifyTransactionAlert;
  const overallLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) =>
      response.status(429).json({
        error: { message: "Too many requests.", code: "RATE_LIMITED" },
      }),
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) =>
      response.status(429).json({
        error: { message: "Too many authentication attempts.", code: "RATE_LIMITED" },
      }),
  });
  const simulateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) =>
      response.status(429).json({
        error: { message: "Too many simulation requests.", code: "RATE_LIMITED" },
      }),
  });

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => callback(null, origin === config.CLIENT_URL),
    }),
  );
  app.use(overallLimiter);

  // Mount the Stripe webhook router here, before express.json(), and use express.raw()
  // in that router so Stripe signature verification receives the original request body.
  if (webhookRouter) {
    app.use("/api/webhooks", webhookRouter);
  }

  app.use(express.json());
  app.use("/api/transactions/simulate", simulateLimiter);
  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.use(
    "/api/auth",
    authLimiter,
    createAuthRouter({ jwtSecret: config.JWT_SECRET, UserModel }),
  );
  if (stripe) {
    app.use(
      "/api",
      createPaymentsRouter({
        jwtSecret: config.JWT_SECRET,
        clientUrl: config.CLIENT_URL,
        stripe,
      }),
    );
  }
  app.use(
    "/api",
    createTransactionsRouter({
      jwtSecret: config.JWT_SECRET,
      config,
      TransactionModel,
      score,
      batchScorer,
      saveScoredTransaction,
      replaySamplePicker,
      modelInfoFetcher,
      notifyAlert,
    }),
  );
  app.use(
    "/api",
    createAlertsRouter({
      jwtSecret: config.JWT_SECRET,
      TransactionModel,
    }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

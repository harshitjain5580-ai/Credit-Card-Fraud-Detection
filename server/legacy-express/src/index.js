import Stripe from "stripe";

import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/db.js";
import { getEnv } from "./config/env.js";
import { createAlertService } from "./services/alertService.js";
import { createStripeWebhookRouter } from "./routes/stripeWebhook.js";

async function startServer() {
  const config = getEnv();
  await connectDatabase(config.MONGODB_URI);
  const stripe = new Stripe(config.STRIPE_SECRET_KEY);
  const alertService = createAlertService({ config });
  const webhookRouter = createStripeWebhookRouter({
    stripe,
    webhookSecret: config.STRIPE_WEBHOOK_SECRET,
    scoringOptions: { notifyAlert: alertService.notifyTransactionAlert },
  });
  const app = createApp({
    config,
    stripe,
    webhookRouter,
    alertNotifier: alertService.notifyTransactionAlert,
  });
  const server = app.listen(config.PORT, () => {
    console.info(`Server listening on port ${config.PORT}.`);
  });

  const shutdown = (signal) => {
    console.info(`${signal} received; shutting down server.`);
    server.close(async (error) => {
      if (error) {
        console.error("Failed to close HTTP server.", {
          errorType: error?.name || "Error",
        });
        process.exitCode = 1;
      }
      try {
        await disconnectDatabase();
      } catch (disconnectError) {
        console.error("Failed to disconnect from MongoDB.", {
          errorType: disconnectError?.name || "Error",
        });
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

startServer().catch((error) => {
  console.error("Server startup failed.", { errorType: error?.name || "Error" });
  process.exitCode = 1;
});

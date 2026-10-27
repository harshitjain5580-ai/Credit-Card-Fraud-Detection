import Transaction from "../models/Transaction.js";
import { MlUnavailableError, scoreTransaction } from "./mlClient.js";

/**
 * Scores and persists a transaction, falling back to manual review if ML is down.
 */
export async function scoreAndSave(
  {
    features,
    displayAmount,
    currency,
    source,
    merchantId,
    stripeIds = {},
    groundTruthLabel = null,
  },
  {
    TransactionModel = Transaction,
    score = scoreTransaction,
    notifyAlert,
    logger = console,
  } = {},
) {
  const transactionData = {
    ...stripeIds,
    features,
    displayAmount,
    currency,
    source,
    merchantId,
    groundTruthLabel,
    status: source === "stripe" ? "succeeded" : "simulated",
  };

  let prediction;
  try {
    prediction = await score(features);
  } catch (error) {
    if (!(error instanceof MlUnavailableError)) {
      throw error;
    }
    logger.warn("ML scoring unavailable; transaction queued for manual review.");
    const transaction = await TransactionModel.create({
      ...transactionData,
      fraudProbability: null,
      riskLabel: "UNSCORED",
      isFlagged: true,
      scoringStatus: "pending_review",
      modelVersion: "",
    });
    await notifySafely(notifyAlert, transaction, merchantId, logger);
    return transaction;
  }

  const transaction = await TransactionModel.create({
    ...transactionData,
    fraudProbability: prediction.fraudProbability,
    riskLabel: prediction.riskLabel,
    isFlagged: prediction.isFraud,
    scoringStatus: "scored",
    modelVersion: prediction.modelVersion,
  });
  await notifySafely(notifyAlert, transaction, merchantId, logger);
  return transaction;
}

async function notifySafely(notifyAlert, transaction, merchantId, logger) {
  try {
    await notifyAlert?.({ transaction, merchantId });
  } catch (error) {
    logger.error("Failed to enqueue merchant fraud alert.", {
      merchantId: String(merchantId),
      errorType: error?.name || "Error",
    });
  }
}

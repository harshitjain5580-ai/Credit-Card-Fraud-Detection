import mongoose from "mongoose";
import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import Transaction from "../models/Transaction.js";
import {
  explainTransaction,
  fetchModelInfo,
  scoreTransaction,
  scoreTransactions,
} from "../services/mlClient.js";
import { pickSample } from "../services/replaySamples.js";
import { scoreAndSave } from "../services/scoringService.js";

const riskLabels = ["LOW", "MEDIUM", "HIGH", "UNSCORED"];
const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  riskLabel: z.enum(riskLabels).optional(),
  flagged: z.enum(["true", "false"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict();
const simulateSchema = z.object({
  count: z.coerce.number().int().min(1).max(50),
  mode: z.enum(["random", "fraud"]),
}).strict();
const reviewSchema = z.object({
  decision: z.enum(["confirmed_fraud", "legit"]),
}).strict();
const transactionParamsSchema = z.object({
  id: z.string().refine(mongoose.isValidObjectId, "Transaction id is invalid."),
}).strict();
const featureNames = ["Time", ...Array.from({ length: 28 }, (_value, index) => `V${index + 1}`), "Amount"];
const batchFeaturesSchema = z.object(
  Object.fromEntries(
    featureNames.map((name) => [
      name,
      name === "Amount" ? z.number().finite().nonnegative() : z.number().finite(),
    ]),
  ),
).strict();
const batchPredictionSchema = z.object({
  transactions: z.array(batchFeaturesSchema).min(1).max(100),
}).strict();

/** Serializes a database transaction without exposing its model features. */
function serializeTransaction(transaction) {
  return {
    id: String(transaction._id ?? transaction.id),
    createdAt: new Date(transaction.createdAt).toISOString(),
    displayAmount: transaction.displayAmount,
    currency: transaction.currency,
    source: transaction.source,
    fraudProbability: transaction.fraudProbability ?? null,
    riskLabel: transaction.riskLabel,
    isFlagged: transaction.isFlagged,
    scoringStatus: transaction.scoringStatus,
    modelVersion: transaction.modelVersion,
    reviewDecision: transaction.reviewDecision ?? null,
    stripePaymentIntentId: transaction.stripePaymentIntentId ?? null,
  };
}

/** Creates an API error that is formatted by the shared error middleware. */
function requestError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/** Floors a date to the requested UTC bucket boundary. */
function rangeStart(date, unit) {
  const result = new Date(date);
  if (unit === "hour") {
    result.setUTCMinutes(0, 0, 0);
  } else {
    result.setUTCHours(0, 0, 0, 0);
  }
  return result;
}

/** Fills gaps in a Mongo time-series aggregation with zero-valued buckets. */
function buildSeries(rows, start, count, unit) {
  const lookup = new Map(
    rows.map((row) => [new Date(row._id).toISOString(), row]),
  );
  return Array.from({ length: count }, (_value, index) => {
    const timestamp = new Date(start);
    if (unit === "hour") {
      timestamp.setUTCHours(timestamp.getUTCHours() + index);
    } else {
      timestamp.setUTCDate(timestamp.getUTCDate() + index);
    }
    const t = timestamp.toISOString();
    const row = lookup.get(t);
    return { t, total: row?.total ?? 0, flagged: row?.flagged ?? 0 };
  });
}

/** Aggregates transaction and flagged counts into UTC time buckets. */
async function aggregateSeries(TransactionModel, merchantId, start, unit) {
  return TransactionModel.aggregate([
    { $match: { merchantId, createdAt: { $gte: start } } },
    {
      $group: {
        _id: { $dateTrunc: { date: "$createdAt", unit, timezone: "UTC" } },
        total: { $sum: 1 },
        flagged: { $sum: { $cond: ["$isFlagged", 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

/**
 * Creates authenticated, merchant-scoped transaction and model metadata routes.
 */
export function createTransactionsRouter({
  jwtSecret,
  config = {},
  TransactionModel = Transaction,
  score = scoreTransaction,
  batchScorer,
  saveScoredTransaction,
  replaySamplePicker = pickSample,
  modelInfoFetcher,
  explanationFetcher,
  notifyAlert,
} = {}) {
  if (!jwtSecret) {
    throw new Error("A JWT secret is required to configure transaction routes.");
  }

  const router = Router();
  router.use(requireAuth(jwtSecret));

  /** Runs an authenticated, non-persisting batch through the current fraud model. */
  router.post(
    "/predictions/batch",
    validate(batchPredictionSchema),
    async (request, response, next) => {
      try {
        const scoreBatch = batchScorer ?? ((transactions) =>
          scoreTransactions(transactions, {
            baseUrl: config.ML_SERVICE_URL,
            apiKey: config.ML_API_KEY,
            timeoutMs: config.ML_TIMEOUT_MS,
          }));
        const predictions = await scoreBatch(request.validated.body.transactions);
        return response.json({
          count: predictions.length,
          items: predictions.map((prediction, index) => ({ index, ...prediction })),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  /** Lists filtered transactions belonging only to the authenticated merchant. */
  router.get(
    "/transactions",
    validate(listQuerySchema, "query"),
    async (request, response, next) => {
      try {
        const { page, limit, riskLabel, flagged, from, to } = request.validated.query;
        const filter = { merchantId: request.auth.userId };
        if (riskLabel) filter.riskLabel = riskLabel;
        if (flagged) filter.isFlagged = flagged === "true";
        if (from || to) {
          filter.createdAt = {};
          if (from) filter.createdAt.$gte = new Date(from);
          if (to) filter.createdAt.$lte = new Date(to);
        }
        if (from && to && new Date(from) > new Date(to)) {
          throw requestError(
            422,
            "The from date must be before the to date.",
            "VALIDATION_ERROR",
          );
        }

        const [items, total] = await Promise.all([
          TransactionModel.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
          TransactionModel.countDocuments(filter),
        ]);
        return response.json({
          items: items.map(serializeTransaction),
          page,
          limit,
          total,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  /** Returns merchant-only score counts and UTC transaction time series. */
  router.get("/transactions/stats", async (request, response, next) => {
    try {
      const merchantId = new mongoose.Types.ObjectId(request.auth.userId);
      const match = { merchantId };
      const [summary] = await TransactionModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            flagged: { $sum: { $cond: ["$isFlagged", 1, 0] } },
            avgProbability: { $avg: "$fraudProbability" },
            LOW: { $sum: { $cond: [{ $eq: ["$riskLabel", "LOW"] }, 1, 0] } },
            MEDIUM: { $sum: { $cond: [{ $eq: ["$riskLabel", "MEDIUM"] }, 1, 0] } },
            HIGH: { $sum: { $cond: [{ $eq: ["$riskLabel", "HIGH"] }, 1, 0] } },
            UNSCORED: {
              $sum: { $cond: [{ $eq: ["$riskLabel", "UNSCORED"] }, 1, 0] },
            },
          },
        },
      ]);
      const riskCounts = Object.fromEntries(
        riskLabels.map((label) => [label, summary?.[label] ?? 0]),
      );

      const now = new Date();
      const hourlyStart = new Date(rangeStart(now, "hour"));
      hourlyStart.setUTCHours(hourlyStart.getUTCHours() - 23);
      const dailyStart = new Date(rangeStart(now, "day"));
      dailyStart.setUTCDate(dailyStart.getUTCDate() - 29);
      const [hourlyRows, dailyRows] = await Promise.all([
        aggregateSeries(TransactionModel, merchantId, hourlyStart, "hour"),
        aggregateSeries(TransactionModel, merchantId, dailyStart, "day"),
      ]);
      const total = summary?.total ?? 0;
      const flaggedCount = summary?.flagged ?? 0;
      return response.json({
        total,
        flagged: flaggedCount,
        fraudRate: total ? flaggedCount / total : 0,
        avgProbability: summary?.avgProbability ?? 0,
        byRisk: riskCounts,
        series24h: buildSeries(hourlyRows, hourlyStart, 24, "hour"),
        series30d: buildSeries(dailyRows, dailyStart, 30, "day"),
      });
    } catch (error) {
      return next(error);
    }
  });

  /** Returns ten merchant-scoped fraud probability histogram bins. */
  router.get("/transactions/score-histogram", async (request, response, next) => {
    try {
      const merchantId = new mongoose.Types.ObjectId(request.auth.userId);
      const rows = await TransactionModel.aggregate([
        { $match: { merchantId, fraudProbability: { $ne: null } } },
        {
          $group: {
            _id: {
              $min: [9, { $floor: { $multiply: ["$fraudProbability", 10] } }],
            },
            count: { $sum: 1 },
          },
        },
      ]);
      const counts = new Map(rows.map((row) => [row._id, row.count]));
      return response.json({
        bins: Array.from({ length: 10 }, (_value, index) => ({
          from: index / 10,
          to: (index + 1) / 10,
          count: counts.get(index) ?? 0,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  /** Creates replay transactions through the normal ML scoring and persistence path. */
  router.post(
    "/transactions/simulate",
    validate(simulateSchema),
    async (request, response, next) => {
      try {
        const { count, mode } = request.validated.body;
        const save = saveScoredTransaction ?? ((input) =>
          scoreAndSave(input, {
            TransactionModel,
            score: (features) =>
              score(features, {
                baseUrl: config.ML_SERVICE_URL,
                apiKey: config.ML_API_KEY,
                timeoutMs: config.ML_TIMEOUT_MS,
              }),
            notifyAlert,
          }));
        const items = await Promise.all(
          Array.from({ length: count }, async () => {
            const sample = replaySamplePicker({
              fraud: mode === "fraud" ? true : undefined,
            });
            const features = Object.fromEntries(
              Object.entries(sample).filter(([name]) => name !== "Class"),
            );
            return save({
              features,
              displayAmount: features.Amount,
              currency: "usd",
              source: "simulated",
              merchantId: request.auth.userId,
              groundTruthLabel: sample.Class,
            });
          }),
        );
        return response.status(201).json({
          created: items.length,
          items: items.map(serializeTransaction),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  /** Records a merchant's review decision on one of their transactions. */
  router.patch(
    "/transactions/:id/review",
    validate(transactionParamsSchema, "params"),
    validate(reviewSchema),
    async (request, response, next) => {
      try {
        const transaction = await TransactionModel.findOneAndUpdate(
          {
            _id: request.validated.params.id,
            merchantId: request.auth.userId,
          },
          { $set: { reviewDecision: request.validated.body.decision } },
          { new: true, runValidators: true },
        );
        if (!transaction) {
          throw requestError(404, "Transaction was not found.", "NOT_FOUND");
        }
        return response.json(serializeTransaction(transaction));
      } catch (error) {
        return next(error);
      }
    },
  );

  /** Returns per-transaction model impacts without exposing stored features. */
  router.get(
    "/transactions/:id/explanation",
    validate(transactionParamsSchema, "params"),
    async (request, response, next) => {
      try {
        const transaction = await TransactionModel.findOne({
          _id: request.validated.params.id,
          merchantId: request.auth.userId,
        }).lean();
        if (!transaction) {
          throw requestError(404, "Transaction was not found.", "NOT_FOUND");
        }
        if (transaction.scoringStatus !== "scored" || !transaction.features) {
          throw requestError(
            409,
            "This transaction has no model score to explain.",
            "NOT_SCORED",
          );
        }

        const fetchExplanation = explanationFetcher ?? ((features) =>
          explainTransaction(features, {
            baseUrl: config.ML_SERVICE_URL,
            apiKey: config.ML_API_KEY,
            timeoutMs: config.ML_TIMEOUT_MS,
          }));
        const explanation = await fetchExplanation(transaction.features);
        return response.json({
          transactionId: String(transaction._id ?? transaction.id),
          fraudProbability: explanation.fraudProbability,
          threshold: explanation.threshold,
          modelVersion: explanation.modelVersion,
          method: explanation.method,
          baselineLogOdds: explanation.baselineLogOdds,
          topFactors: explanation.topFactors,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  /** Proxies ML model metadata without changing its contract shape. */
  router.get("/model-info", async (_request, response, next) => {
    try {
      const fetchInfo = modelInfoFetcher ?? (() =>
        fetchModelInfo({
          baseUrl: config.ML_SERVICE_URL,
          apiKey: config.ML_API_KEY,
          timeoutMs: config.ML_TIMEOUT_MS,
        }));
      return response.json(await fetchInfo());
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

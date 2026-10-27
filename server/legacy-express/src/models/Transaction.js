import mongoose from "mongoose";

const transactionFeaturesSchema = new mongoose.Schema(
  {
    Time: { type: Number, required: true },
    V1: { type: Number, required: true },
    V2: { type: Number, required: true },
    V3: { type: Number, required: true },
    V4: { type: Number, required: true },
    V5: { type: Number, required: true },
    V6: { type: Number, required: true },
    V7: { type: Number, required: true },
    V8: { type: Number, required: true },
    V9: { type: Number, required: true },
    V10: { type: Number, required: true },
    V11: { type: Number, required: true },
    V12: { type: Number, required: true },
    V13: { type: Number, required: true },
    V14: { type: Number, required: true },
    V15: { type: Number, required: true },
    V16: { type: Number, required: true },
    V17: { type: Number, required: true },
    V18: { type: Number, required: true },
    V19: { type: Number, required: true },
    V20: { type: Number, required: true },
    V21: { type: Number, required: true },
    V22: { type: Number, required: true },
    V23: { type: Number, required: true },
    V24: { type: Number, required: true },
    V25: { type: Number, required: true },
    V26: { type: Number, required: true },
    V27: { type: Number, required: true },
    V28: { type: Number, required: true },
    Amount: { type: Number, required: true, min: 0 },
  },
  { _id: false, strict: "throw" },
);

const transactionSchema = new mongoose.Schema(
  {
    stripePaymentIntentId: { type: String, unique: true, sparse: true },
    stripeEventId: { type: String, unique: true, sparse: true },
    source: { type: String, required: true, enum: ["stripe", "simulated"] },
    merchantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    displayAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, lowercase: true, trim: true },
    status: { type: String, required: true, trim: true },
    features: { type: transactionFeaturesSchema, required: true },
    fraudProbability: { type: Number, min: 0, max: 1, default: null },
    riskLabel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "UNSCORED"],
      default: "UNSCORED",
    },
    isFlagged: { type: Boolean, default: false },
    scoringStatus: {
      type: String,
      enum: ["scored", "pending_review"],
      default: "pending_review",
    },
    modelVersion: { type: String, default: "" },
    groundTruthLabel: { type: Number, enum: [0, 1, null], default: null },
    reviewDecision: {
      type: String,
      enum: ["confirmed_fraud", "legit", null],
      default: null,
    },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false },
);

export default mongoose.models.Transaction ||
  mongoose.model("Transaction", transactionSchema);

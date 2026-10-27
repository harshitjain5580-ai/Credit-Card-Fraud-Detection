import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, default: "merchant", trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

export default mongoose.models.User || mongoose.model("User", userSchema);

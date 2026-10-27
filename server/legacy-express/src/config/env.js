import "dotenv/config";
import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);
const envSchema = z.object({
  PORT: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.number().int().positive().default(5000),
  ),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must contain at least 32 characters."),
  CLIENT_URL: z.string().url(),
  ML_SERVICE_URL: z.string().url(),
  ML_API_KEY: optionalString,
  ML_TIMEOUT_MS: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.number().int().positive().default(5000),
  ),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_FROM: optionalString,
});

const requiredEnvNames = [
  "MONGODB_URI",
  "JWT_SECRET",
  "CLIENT_URL",
  "ML_SERVICE_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

export function getEnv(source = process.env) {
  const missing = requiredEnvNames.filter(
    (name) => typeof source[name] !== "string" || source[name].trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required server environment variable(s): ${missing.join(", ")}.`,
    );
  }

  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment configuration: ${details}`);
  }
  return result.data;
}

export { envSchema };

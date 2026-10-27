import { getEnv } from "../src/config/env.js";

const validEnv = {
  MONGODB_URI: "mongodb://127.0.0.1:27017/fraud-test",
  JWT_SECRET: "a-test-secret-with-at-least-32-characters",
  CLIENT_URL: "http://localhost:5173",
  ML_SERVICE_URL: "http://localhost:8000",
  STRIPE_SECRET_KEY: "sk_test_value",
  STRIPE_WEBHOOK_SECRET: "whsec_test_value",
};

it("applies default ports and accepts omitted optional integration settings", () => {
  expect(getEnv(validEnv)).toMatchObject({
    PORT: 5000,
    ML_TIMEOUT_MS: 5000,
  });
  expect(getEnv(validEnv)).not.toHaveProperty("ML_API_KEY");
  expect(getEnv(validEnv)).not.toHaveProperty("SMTP_HOST");
});

it("treats blank values in the example env file as unset optional ports", () => {
  const config = getEnv({
    ...validEnv,
    PORT: "",
    ML_TIMEOUT_MS: "",
    SMTP_PORT: "",
  });
  expect(config).toMatchObject({ PORT: 5000, ML_TIMEOUT_MS: 5000 });
  expect(config.SMTP_PORT).toBeUndefined();
});

it("reports invalid required settings clearly", () => {
  expect(() => getEnv({ ...validEnv, CLIENT_URL: "not-a-url" })).toThrow(
    /CLIENT_URL: Invalid url/,
  );
});

it("fails fast with the names of missing required deployment variables", () => {
  expect(() =>
    getEnv({
      ...validEnv,
      MONGODB_URI: "",
      STRIPE_WEBHOOK_SECRET: "",
    }),
  ).toThrow(
    "Missing required server environment variable(s): MONGODB_URI, STRIPE_WEBHOOK_SECRET.",
  );
});

it("uses the PORT value supplied by the deployment environment", () => {
  expect(getEnv({ ...validEnv, PORT: "8080" }).PORT).toBe(8080);
});

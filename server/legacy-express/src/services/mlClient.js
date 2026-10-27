import axios from "axios";

export class MlUnavailableError extends Error {
  constructor(message = "The fraud scoring service is unavailable.", options = {}) {
    super(message, options);
    this.name = "MlUnavailableError";
    this.status = 503;
    this.code = "ML_UNAVAILABLE";
  }
}

/** Determines whether a failed ML request may succeed when retried. */
function isRetryable(error) {
  return !error?.response || error.response.status >= 500;
}

/** Builds the optional authentication headers expected by the ML service. */
function createHeaders(apiKey) {
  return apiKey ? { "X-API-Key": apiKey } : {};
}

/** Joins a configured ML service base URL and endpoint path. */
function serviceUrl(baseUrl, path) {
  if (!baseUrl) {
    throw new MlUnavailableError("ML_SERVICE_URL is not configured.");
  }
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

/**
 * Scores transaction features through the ML service, retrying transient failures once.
 */
export async function scoreTransaction(
  features,
  {
    baseUrl = process.env.ML_SERVICE_URL,
    apiKey = process.env.ML_API_KEY,
    timeoutMs = Number(process.env.ML_TIMEOUT_MS || 5000),
    httpClient = axios,
  } = {},
) {
  const url = serviceUrl(baseUrl, "/predict");
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await httpClient.post(url, features, {
        headers: createHeaders(apiKey),
        timeout: timeoutMs,
      });
      const result = response.data;
      if (
        typeof result?.fraud_probability !== "number" ||
        !Number.isFinite(result.fraud_probability) ||
        result.fraud_probability < 0 ||
        result.fraud_probability > 1 ||
        typeof result?.risk_label !== "string" ||
        !["LOW", "MEDIUM", "HIGH"].includes(result.risk_label) ||
        typeof result?.is_fraud !== "boolean" ||
        typeof result?.model_version !== "string"
      ) {
        throw new MlUnavailableError("The ML service returned an invalid prediction.");
      }
      return {
        fraudProbability: result.fraud_probability,
        riskLabel: result.risk_label,
        isFraud: result.is_fraud,
        modelVersion: result.model_version,
      };
    } catch (error) {
      if (error instanceof MlUnavailableError) {
        throw error;
      }
      lastError = error;
      if (attempt === 1 || !isRetryable(error)) {
        break;
      }
    }
  }

  throw new MlUnavailableError("The fraud scoring service is unavailable.", {
    cause: lastError,
  });
}

/** Scores a bounded batch with one request to the ML service. */
export async function scoreTransactions(
  transactions,
  {
    baseUrl = process.env.ML_SERVICE_URL,
    apiKey = process.env.ML_API_KEY,
    timeoutMs = Number(process.env.ML_TIMEOUT_MS || 10000),
    httpClient = axios,
  } = {},
) {
  try {
    const response = await httpClient.post(
      serviceUrl(baseUrl, "/predict/batch"),
      transactions,
      { headers: createHeaders(apiKey), timeout: timeoutMs },
    );
    const results = response.data;
    if (
      !Array.isArray(results) ||
      results.length !== transactions.length ||
      results.some((result) =>
        typeof result?.fraud_probability !== "number" ||
        !Number.isFinite(result.fraud_probability) ||
        result.fraud_probability < 0 ||
        result.fraud_probability > 1 ||
        typeof result?.threshold !== "number" ||
        !Number.isFinite(result.threshold) ||
        result.threshold < 0 ||
        result.threshold > 1 ||
        typeof result?.risk_label !== "string" ||
        !["LOW", "MEDIUM", "HIGH"].includes(result.risk_label) ||
        typeof result?.is_fraud !== "boolean" ||
        typeof result?.model_version !== "string"
      )
    ) {
      throw new MlUnavailableError("The ML service returned invalid batch predictions.");
    }

    return results.map((result) => ({
      fraudProbability: result.fraud_probability,
      riskLabel: result.risk_label,
      isFlagged: result.is_fraud,
      threshold: result.threshold,
      modelVersion: result.model_version,
    }));
  } catch (error) {
    if (error instanceof MlUnavailableError) throw error;
    throw new MlUnavailableError("The fraud scoring service is unavailable.", {
      cause: error,
    });
  }
}

/** Returns model-attributed feature impacts for an already-scored transaction. */
export async function explainTransaction(
  features,
  {
    baseUrl = process.env.ML_SERVICE_URL,
    apiKey = process.env.ML_API_KEY,
    timeoutMs = Number(process.env.ML_TIMEOUT_MS || 5000),
    httpClient = axios,
  } = {},
) {
  try {
    const response = await httpClient.post(
      serviceUrl(baseUrl, "/explain"),
      features,
      { headers: createHeaders(apiKey), timeout: timeoutMs },
    );
    const result = response.data;
    if (
      typeof result?.fraud_probability !== "number" ||
      typeof result?.threshold !== "number" ||
      typeof result?.model_version !== "string" ||
      !["tree_shap", "linear_coefficients"].includes(result?.method) ||
      typeof result?.baseline_log_odds !== "number" ||
      !Array.isArray(result?.top_factors)
    ) {
      throw new MlUnavailableError("The ML service returned an invalid explanation.");
    }

    return {
      fraudProbability: result.fraud_probability,
      threshold: result.threshold,
      modelVersion: result.model_version,
      method: result.method,
      baselineLogOdds: result.baseline_log_odds,
      topFactors: result.top_factors.map((factor) => ({
        feature: factor.feature,
        value: factor.value,
        impact: factor.impact,
        direction: factor.direction,
      })),
    };
  } catch (error) {
    if (error instanceof MlUnavailableError) throw error;
    throw new MlUnavailableError("The fraud explanation service is unavailable.", {
      cause: error,
    });
  }
}

/**
 * Fetches model metadata from the ML service for the protected dashboard endpoint.
 */
export async function fetchModelInfo(
  {
    baseUrl = process.env.ML_SERVICE_URL,
    apiKey = process.env.ML_API_KEY,
    timeoutMs = Number(process.env.ML_TIMEOUT_MS || 5000),
    httpClient = axios,
  } = {},
) {
  try {
    const response = await httpClient.get(serviceUrl(baseUrl, "/model-info"), {
      headers: createHeaders(apiKey),
      timeout: timeoutMs,
    });
    return response.data;
  } catch (error) {
    throw new MlUnavailableError("The fraud scoring service is unavailable.", {
      cause: error,
    });
  }
}

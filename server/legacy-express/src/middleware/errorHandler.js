import mongoose from "mongoose";
import { ZodError } from "zod";

const exposedErrors = new Set([
  "INVALID_CREDENTIALS",
  "UNAUTHORIZED",
  "INVALID_TOKEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "ML_UNAVAILABLE",
]);
const exposedMessages = {
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  UNAUTHORIZED: "Authentication is required.",
  INVALID_TOKEN: "Authentication token is invalid or expired.",
  NOT_FOUND: "Not found.",
  VALIDATION_ERROR: "Request validation failed.",
  RATE_LIMITED: "Too many requests.",
  ML_UNAVAILABLE: "The fraud scoring service is unavailable.",
};

export function notFoundHandler(request, _response, next) {
  const error = new Error("Route not found.");
  error.status = 404;
  error.code = "NOT_FOUND";
  next(error);
}

export function errorHandler(error, _request, response, _next) {
  if (response.headersSent) {
    return;
  }

  if (error instanceof ZodError) {
    return response.status(422).json({
      error: {
        message: "Request validation failed.",
        code: "VALIDATION_ERROR",
      },
    });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(422).json({
      error: {
        message: "Request body must contain valid JSON.",
        code: "VALIDATION_ERROR",
      },
    });
  }
  if (error instanceof mongoose.Error.ValidationError) {
    return response.status(422).json({
      error: {
        message: "Submitted data is invalid.",
        code: "VALIDATION_ERROR",
      },
    });
  }
  if (error?.code === 11000) {
    return response.status(409).json({
      error: {
        message: "A record with these details already exists.",
        code: "DUPLICATE_RECORD",
      },
    });
  }

  const isKnownError = exposedErrors.has(error?.code);
  const status =
    error?.code === "ML_UNAVAILABLE"
      ? 503
      : isKnownError && Number.isInteger(error.status)
        ? error.status
        : 500;
  const message =
    error?.code === "ML_UNAVAILABLE"
      ? exposedMessages.ML_UNAVAILABLE
      : status >= 500
        ? "An unexpected server error occurred."
        : exposedMessages[error.code];
  const code = isKnownError ? error.code : "INTERNAL_ERROR";
  if (status >= 500 && error?.code !== "ML_UNAVAILABLE") {
    console.error("Request failed.", { errorType: error?.name || "Error" });
  }
  return response.status(status).json({ error: { message, code } });
}

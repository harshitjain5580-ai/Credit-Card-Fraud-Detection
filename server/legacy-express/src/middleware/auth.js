import jwt from "jsonwebtoken";

export function requireAuth(jwtSecret) {
  return function authenticate(request, _response, next) {
    const authorization = request.get("authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      const error = new Error("Authentication is required.");
      error.status = 401;
      error.code = "UNAUTHORIZED";
      return next(error);
    }

    try {
      const payload = jwt.verify(match[1], jwtSecret);
      if (
        typeof payload !== "object" ||
        typeof payload.sub !== "string" ||
        typeof payload.role !== "string"
      ) {
        const error = new Error("Authentication token is invalid.");
        error.status = 401;
        error.code = "INVALID_TOKEN";
        return next(error);
      }
      request.auth = { userId: payload.sub, role: payload.role };
      return next();
    } catch {
      const error = new Error("Authentication token is invalid or expired.");
      error.status = 401;
      error.code = "INVALID_TOKEN";
      return next(error);
    }
  };
}

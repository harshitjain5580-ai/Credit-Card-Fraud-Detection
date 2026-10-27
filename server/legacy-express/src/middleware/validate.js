export function validate(schema, property = "body") {
  return function validateRequest(request, _response, next) {
    const result = schema.safeParse(request[property]);
    if (!result.success) {
      return next(result.error);
    }
    request.validated = request.validated || {};
    request.validated[property] = result.data;
    return next();
  };
}

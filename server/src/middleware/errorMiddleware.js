function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.status && error.status >= 400 && error.status < 500 && !error.type)
    return res.status(error.status).json({ message: error.message });
  if (error.code === "23505")
    return res.status(409).json({ message: "This record already exists." });
  if (error.code === "23503")
    return res
      .status(400)
      .json({
        message:
          "A referenced country, category, attribute, or record does not exist.",
      });
  if (["23514", "23502", "22003", "22P02"].includes(error.code))
    return res
      .status(400)
      .json({ message: "Values violate a required database constraint." });
  if (error.code === "P0001")
    return res.status(409).json({ message: error.message });
  if (error.type === "entity.parse.failed") {
    return res
      .status(400)
      .json({ message: "Request body must contain valid JSON." }); // 400 Bad Request: malformed JSON.
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large." }); // 413 Content Too Large: request exceeds the JSON body limit.
  }
  console.error("Unhandled request error:", error);
  return res
    .status(500)
    .json({ message: "An unexpected server error occurred." }); // 500 Internal Server Error: return JSON without exposing internal details.
}

module.exports = { errorHandler };

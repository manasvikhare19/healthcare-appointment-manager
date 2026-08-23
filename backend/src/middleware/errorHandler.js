const { ApiError } = require('../utils/asyncHandler');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }

  // Prisma unique-constraint violation — this is the expected shape of
  // a lost double-booking race; surface it as a clean 409, not a 500.
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'That slot was just taken. Please pick another.' });
  }

  console.error('[Unhandled error]', err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;

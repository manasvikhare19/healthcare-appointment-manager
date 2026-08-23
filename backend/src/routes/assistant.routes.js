const express = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const assistantService = require('../services/assistant.service');

const router = express.Router();
router.use(requireAuth);

// Chat can be spammed easily since it's just typing — keep it generous but bounded.
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
router.use(chatLimiter);

router.post(
  '/message',
  asyncHandler(async (req, res) => {
    const schema = z.object({ message: z.string().min(1).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'message is required (max 500 chars)');

    const result = await assistantService.handleMessage({ message: parsed.data.message, user: req.user });
    res.json(result);
  })
);

module.exports = router;
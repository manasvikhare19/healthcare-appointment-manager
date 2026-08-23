const { PrismaClient } = require('@prisma/client');

// Single shared instance — avoids exhausting DB connections in dev
// with nodemon reloads and keeps one consistent client across services.
const prisma = new PrismaClient();

module.exports = prisma;

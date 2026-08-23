const app = require('./app');
const { PORT } = require('./config/env');
const { startBackgroundJobs } = require('./jobs');

app.listen(PORT, () => {
  console.log(`✅ Healthcare Appointment Manager API listening on http://localhost:${PORT}`);
  startBackgroundJobs();
});

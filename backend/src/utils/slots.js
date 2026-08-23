const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * Generate the list of candidate slot start times for a doctor on a given
 * calendar date, honoring working days/hours and slot duration. Does NOT
 * check availability against bookings — pair with getBookedSlots().
 */
function generateDaySlots(doctor, dateStr) {
  const dayIdx = new Date(`${dateStr}T00:00:00`).getDay();
  const dayCode = DAY_CODES[dayIdx];
  const workingDays = doctor.workingDays.split(',').map((d) => d.trim());
  if (!workingDays.includes(dayCode)) return [];

  const slots = [];
  const duration = doctor.slotDurationMinutes;
  for (let minutes = doctor.workStartMinutes; minutes + duration <= doctor.workEndMinutes; minutes += duration) {
    const start = new Date(`${dateStr}T00:00:00`);
    start.setMinutes(start.getMinutes() + minutes);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + duration);
    slots.push({ start, end });
  }
  return slots;
}

function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = { generateDaySlots, toDateStr, DAY_CODES };

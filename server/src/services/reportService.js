const reportRepository = require("../repositories/reportRepository");

function createServiceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeDate(value, label) {
  if (value === undefined || value === "") return null;
  const parsedDate = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
  if (!parsedDate ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== value) {
    throw createServiceError(`${label} must be a valid YYYY-MM-DD date.`, 400);
  }
  return value;
}

async function getReports(query = {}) {
  const from = normalizeDate(query.from, "Start date");
  const to = normalizeDate(query.to, "End date");
  if (from && to && from > to) {
    throw createServiceError("Start date must be on or before end date.", 400);
  }

  return reportRepository.getReports({ from, to });
}

module.exports = { getReports };

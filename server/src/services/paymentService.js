const paymentRepository = require("../repositories/paymentRepository");

function createServiceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateId(id, label) {
  const idString = String(id);

  if (!/^[1-9]\d*$/.test(idString) || BigInt(idString) > 9223372036854775807n) {
    throw createServiceError(`${label} must be a positive integer.`, 400);
  }

  return idString;
}

function normalizeAmount(value) {
  const text = typeof value === "number" ? String(value) : value;

  if (typeof text !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw createServiceError(
      "Payment amount must be a positive number with at most 2 decimal places.",
      400
    );
  }

  const [whole, fraction = ""] = text.split(".");
  if (whole.length > 10) {
    throw createServiceError("Payment amount is too large.", 400);
  }
  if (/^0+$/.test(whole) && (!fraction || /^0+$/.test(fraction))) {
    throw createServiceError("Payment amount must be greater than zero.", 400);
  }

  return text;
}

function normalizePayment(input, authenticatedUserId) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createServiceError("Request body must be a JSON object.", 400);
  }

  if (Object.prototype.hasOwnProperty.call(input, "created_by")) {
    throw createServiceError("created_by is assigned by the server and must not be provided.", 400);
  }

  const amount = normalizeAmount(input.amount);
  const created_by = validateId(authenticatedUserId, "Authenticated user ID");

  if (typeof input.method !== "string") {
    throw createServiceError("Payment method is required.", 400);
  }
  const method = input.method.trim();
  const validMethods = ["cash", "card", "bank_transfer", "mobile_money", "other"];
  if (!validMethods.includes(method)) {
    throw createServiceError("Payment method is invalid.", 400);
  }

  const reference =
    input.reference === undefined || input.reference === null
      ? null
      : typeof input.reference === "string"
        ? input.reference.trim() || null
        : (() => {
            throw createServiceError("Payment reference must be text.", 400);
          })();
  if (reference && reference.length > 100) {
    throw createServiceError("Payment reference must be 100 characters or fewer.", 400);
  }

  if (typeof input.idempotency_key !== "string") {
    throw createServiceError("Idempotency key is required.", 400);
  }
  const idempotency_key = input.idempotency_key.trim();
  if (!idempotency_key || idempotency_key.length > 100) {
    throw createServiceError("Idempotency key must be 1 to 100 characters.", 400);
  }

  return { amount, method, reference, created_by, idempotency_key };
}

function handleRepositoryError(error) {
  switch (error.code) {
    case "PAYMENT_SALE_NOT_FOUND":
    case "PAYMENT_USER_NOT_FOUND":
      throw createServiceError(error.message, 404);
    case "PAYMENT_INVALID_SALE_TYPE":
    case "PAYMENT_SALE_NOT_COMPLETED":
    case "PAYMENT_NO_OUTSTANDING_BALANCE":
    case "PAYMENT_EXCEEDS_BALANCE":
    case "PAYMENT_IDEMPOTENCY_CONFLICT":
      throw createServiceError(error.message, 409);
    case "23503":
      throw createServiceError("A referenced sale or user does not exist.", 404);
    case "23505":
      if (error.constraint === "payments_idempotency_key_unique_idx") {
        throw createServiceError(
          "This idempotency key has already been used.",
          409
        );
      }
      throw createServiceError("Payment conflicts with an existing record.", 409);
    case "23514":
      throw createServiceError("Payment data violates a database constraint.", 400);
    default:
      throw error;
  }
}

async function createPayment(saleId, input, authenticatedUserId) {
  const validSaleId = validateId(saleId, "Sale ID");
  const payment = normalizePayment(input, authenticatedUserId);

  try {
    return await paymentRepository.createPayment(validSaleId, payment);
  } catch (error) {
    handleRepositoryError(error);
  }
}

async function getPaymentsBySaleId(saleId) {
  const validSaleId = validateId(saleId, "Sale ID");
  const exists = await paymentRepository.saleExists(validSaleId);

  if (!exists) {
    throw createServiceError("Sale not found.", 404);
  }

  return paymentRepository.getPaymentsBySaleId(validSaleId);
}

const PAYMENT_METHODS = new Set([
  "cash",
  "card",
  "bank_transfer",
  "mobile_money",
  "other",
]);

function normalizeHistoryFilters(filters = {}) {
  const normalized = {};
  if (filters.method !== undefined && filters.method !== "") {
    if (typeof filters.method !== "string" || !PAYMENT_METHODS.has(filters.method)) {
      throw createServiceError("Payment method filter is invalid.", 400);
    }
    normalized.method = filters.method;
  } else {
    normalized.method = null;
  }

  for (const field of ["from", "to"]) {
    const value = filters[field];
    if (value === undefined || value === "") {
      normalized[field] = null;
      continue;
    }
    const parsedDate = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00.000Z`)
      : null;
    if (!parsedDate ||
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== value) {
      throw createServiceError(`Payment ${field} date must be a valid YYYY-MM-DD date.`, 400);
    }
    normalized[field] = value;
  }

  if (normalized.from && normalized.to && normalized.from > normalized.to) {
    throw createServiceError("Start date must be on or before end date.", 400);
  }

  return normalized;
}

async function getAllPayments(filters) {
  return paymentRepository.getAllPayments(normalizeHistoryFilters(filters));
}

module.exports = {
  createPayment,
  getPaymentsBySaleId,
  getAllPayments,
  normalizePayment,
  handleRepositoryError,
};

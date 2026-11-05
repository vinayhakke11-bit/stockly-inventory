const stockAdjustmentRepository = require("../repositories/stockAdjustmentRepository");
const productRepository = require("../repositories/productRepository");

const REASONS = new Set([
  "physical_count",
  "damaged_goods",
  "expired_goods",
  "lost_missing",
  "found_stock",
  "manual_correction",
  "other",
]);

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

function validateQuantity(value) {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^\d+(?:\.\d{1,3})?$/.test(text)) {
    throw createServiceError(
      "Quantity must be a positive number with at most 3 decimal places.",
      400
    );
  }

  const [whole, fraction = ""] = text.split(".");
  if (whole.length > 9) {
    throw createServiceError("Quantity is too large.", 400);
  }

  if (/^0+$/.test(whole) && (!fraction || /^0+$/.test(fraction))) {
    throw createServiceError("Quantity must be greater than zero.", 400);
  }

  return text;
}

function normalizeAdjustment(input, authenticatedUserId) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createServiceError("Request body must be a JSON object.", 400);
  }

  const productId = validateId(input.product_id, "Product ID");
  const performedBy = validateId(authenticatedUserId, "Authenticated user ID");
  if (!["increase", "decrease"].includes(input.adjustment_type)) {
    throw createServiceError("Adjustment type must be increase or decrease.", 400);
  }

  const quantity = validateQuantity(input.quantity);
  if (typeof input.reason !== "string" || !REASONS.has(input.reason)) {
    throw createServiceError("Select a valid adjustment reason.", 400);
  }

  let note = null;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== "string") {
      throw createServiceError("Note must be text.", 400);
    }
    note = input.note.trim() || null;
    if (note && note.length > 1000) {
      throw createServiceError("Note must be 1000 characters or fewer.", 400);
    }
  }

  return {
    productId,
    quantityChange: input.adjustment_type === "increase" ? quantity : `-${quantity}`,
    reason: input.reason,
    note,
    performedBy,
  };
}

function handleRepositoryError(error) {
  if (error.code === "STOCK_ADJUSTMENT_PRODUCT_NOT_FOUND") {
    throw createServiceError("Product not found.", 404);
  }
  if (error.code === "STOCK_ADJUSTMENT_PRODUCT_INACTIVE") {
    throw createServiceError(error.message, 409);
  }
  if (error.code === "STOCK_ADJUSTMENT_INSUFFICIENT_STOCK" ||
      (error.code === "P0001" && error.message.includes("Insufficient stock"))) {
    throw createServiceError("Adjustment cannot decrease stock below zero.", 409);
  }
  if (error.code === "23503") {
    throw createServiceError("Product or authenticated user not found.", 404);
  }
  if (error.code === "23514") {
    throw createServiceError("Stock adjustment violates a database constraint.", 400);
  }

  throw error;
}

async function createStockAdjustment(input, authenticatedUserId) {
  const adjustment = normalizeAdjustment(input, authenticatedUserId);
  try {
    return await stockAdjustmentRepository.createStockAdjustment(adjustment);
  } catch (error) {
    handleRepositoryError(error);
  }
}

async function getStockAdjustmentHistory(productId) {
  const validProductId = productId === undefined
    ? null
    : validateId(productId, "Product ID");

  if (validProductId !== null) {
    const products = await productRepository.getProductById(validProductId);
    if (!products) {
      throw createServiceError("Product not found.", 404);
    }
  }

  return stockAdjustmentRepository.getStockAdjustmentHistory({
    productId: validProductId,
  });
}

module.exports = {
  createStockAdjustment,
  getStockAdjustmentHistory,
};

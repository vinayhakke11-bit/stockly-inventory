const returnRepository = require("../repositories/returnRepository");

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

function validateAmount(value) {
  const text = typeof value === "number" ? String(value) : value;

  if (typeof text !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw createServiceError(
      "Refund amount must be a positive number with at most 2 decimal places.",
      400
    );
  }

  const [whole, fraction = ""] = text.split(".");
  if (whole.length > 10) {
    throw createServiceError("Refund amount is too large.", 400);
  }
  if (/^0+$/.test(whole) && (!fraction || /^0+$/.test(fraction))) {
    throw createServiceError("Refund amount must be greater than zero.", 400);
  }

  return text;
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createServiceError("At least one return item is required.", 400);
  }

  const productIds = new Set();
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw createServiceError(`Return item ${index + 1} must be an object.`, 400);
    }

    const productId = validateId(item.product_id, `Product ID in item ${index + 1}`);
    if (productIds.has(productId)) {
      throw createServiceError(
        "A product can only appear once in a return; combine its quantity.",
        400
      );
    }
    productIds.add(productId);

    const quantity = typeof item.quantity === "number" ? String(item.quantity) : item.quantity;
    if (typeof quantity !== "string" || !/^\d+(?:\.\d{1,3})?$/.test(quantity)) {
      throw createServiceError(
        `Quantity in return item ${index + 1} must be positive with at most 3 decimal places.`,
        400
      );
    }

    const [whole, fraction = ""] = quantity.split(".");
    if (whole.length > 9 || (/^0+$/.test(whole) && (!fraction || /^0+$/.test(fraction)))) {
      throw createServiceError(
        `Quantity in return item ${index + 1} must be positive and within the supported range.`,
        400
      );
    }

    const paddedFraction = fraction.padEnd(3, "0");
    const quantity_thousandths =
      (BigInt(whole) * 1000n + BigInt(paddedFraction)).toString();

    return { product_id: productId, quantity, quantity_thousandths };
  });
}

function normalizeRefund(input, authenticatedUserId) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createServiceError("Request body must be a JSON object.", 400);
  }

  if (Object.prototype.hasOwnProperty.call(input, "created_by")) {
    throw createServiceError("created_by is assigned by the server and must not be provided.", 400);
  }

  const amount = validateAmount(input.amount);
  const created_by = validateId(authenticatedUserId, "Authenticated user ID");

  if (typeof input.method !== "string") {
    throw createServiceError("Refund method is required.", 400);
  }
  const method = input.method.trim();
  const allowedMethods = ["cash", "card", "bank_transfer", "mobile_money", "other"];
  if (!allowedMethods.includes(method)) {
    throw createServiceError("Refund method is invalid.", 400);
  }

  let reference = null;
  if (input.reference !== undefined && input.reference !== null) {
    if (typeof input.reference !== "string") {
      throw createServiceError("Refund reference must be text.", 400);
    }
    reference = input.reference.trim() || null;
    if (reference && reference.length > 100) {
      throw createServiceError("Refund reference must be 100 characters or fewer.", 400);
    }
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
    case "RETURN_ORIGINAL_NOT_FOUND":
    case "RETURN_NOT_FOUND":
    case "RETURN_USER_NOT_FOUND":
    case "REFUND_USER_NOT_FOUND":
      throw createServiceError(error.message, 404);
    case "RETURN_ORIGINAL_EMPTY":
    case "RETURN_EMPTY":
    case "RETURN_ZERO_TOTAL":
    case "RETURN_PRODUCT_NOT_SOLD":
    case "RETURN_QUANTITY_EXCEEDED":
      throw createServiceError(error.message, 400);
    case "RETURN_ORIGINAL_NOT_COMPLETED":
    case "RETURN_ALREADY_COMPLETED":
    case "RETURN_NOT_DRAFT":
    case "REFUND_RETURN_NOT_COMPLETED":
    case "REFUND_EXCEEDS_ELIGIBLE_AMOUNT":
    case "REFUND_IDEMPOTENCY_CONFLICT":
      throw createServiceError(error.message, 409);
    case "23505":
      throw createServiceError("Refund conflicts with an existing transaction.", 409);
    case "23503":
      throw createServiceError("A referenced return, sale, or user does not exist.", 404);
    case "23514":
      throw createServiceError("Return or refund data violates a database constraint.", 400);
    case "P0001":
      throw createServiceError(error.message, 409);
    default:
      throw error;
  }
}

async function createReturn(saleId, input, authenticatedUserId) {
  const validSaleId = validateId(saleId, "Sale ID");
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createServiceError("Request body must be a JSON object.", 400);
  }
  if (Object.prototype.hasOwnProperty.call(input, "created_by")) {
    throw createServiceError("created_by is assigned by the server and must not be provided.", 400);
  }
  const returnInput = {
    created_by: validateId(authenticatedUserId, "Authenticated user ID"),
    items: normalizeItems(input.items),
  };

  try {
    return await returnRepository.createReturn(validSaleId, returnInput);
  } catch (error) {
    handleRepositoryError(error);
  }
}

async function getReturnsBySaleId(saleId) {
  const validSaleId = validateId(saleId, "Sale ID");

  try {
    const returns = await returnRepository.getReturnsBySaleId(validSaleId);
    if (returns === null) {
      throw createServiceError("Original sale not found.", 404);
    }
    return returns;
  } catch (error) {
    handleRepositoryError(error);
  }
}

async function getAllReturns() {
  return returnRepository.getAllReturns();
}

async function getReturnById(returnId) {
  const validReturnId = validateId(returnId, "Return ID");
  const returnRecord = await returnRepository.getReturnById(validReturnId);
  if (!returnRecord) {
    throw createServiceError("Return not found.", 404);
  }
  return returnRecord;
}

async function completeReturn(returnId, authenticatedUserId) {
  const validReturnId = validateId(returnId, "Return ID");
  const performedBy = validateId(authenticatedUserId, "Authenticated user ID");

  try {
    const returnRecord = await returnRepository.completeReturn(validReturnId, performedBy);
    if (!returnRecord) {
      throw createServiceError("Return not found.", 404);
    }
    return returnRecord;
  } catch (error) {
    handleRepositoryError(error);
  }
}

async function createRefund(returnId, input, authenticatedUserId) {
  const validReturnId = validateId(returnId, "Return ID");
  const refund = normalizeRefund(input, authenticatedUserId);

  try {
    return await returnRepository.createRefund(validReturnId, refund);
  } catch (error) {
    handleRepositoryError(error);
  }
}

async function getRefundsByReturnId(returnId) {
  const validReturnId = validateId(returnId, "Return ID");
  await getReturnById(validReturnId);

  return returnRepository.getRefundsByReturnId(validReturnId);
}

module.exports = {
  createReturn,
  getReturnsBySaleId,
  getAllReturns,
  getReturnById,
  completeReturn,
  createRefund,
  getRefundsByReturnId,
};

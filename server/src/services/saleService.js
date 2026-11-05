const saleRepository = require("../repositories/saleRepository");
const paymentService = require("./paymentService");

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

function validateDecimal(value, field, { maxScale, maxIntegerDigits, allowZero }) {
  const text = typeof value === "number" ? String(value) : value;
  const expression = new RegExp(`^\\d+(?:\\.\\d{1,${maxScale}})?$`);

  if (typeof text !== "string" || !expression.test(text)) {
    throw createServiceError(
      `${field} must be a valid number with at most ${maxScale} decimal places.`,
      400
    );
  }

  const [whole, fraction = ""] = text.split(".");
  if (whole.length > maxIntegerDigits) {
    throw createServiceError(`${field} is too large.`, 400);
  }

  const isZero = /^0+$/.test(whole) && (!fraction || /^0+$/.test(fraction));
  if (!allowZero && isZero) {
    throw createServiceError(`${field} must be greater than zero.`, 400);
  }

  return text;
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createServiceError("At least one sale item is required.", 400);
  }

  const productIds = new Set();
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw createServiceError(`Sale item ${index + 1} must be an object.`, 400);
    }

    const productId = validateId(item.product_id, `Product ID in item ${index + 1}`);
    if (productIds.has(productId)) {
      throw createServiceError(
        "A product can only appear once in a sale; combine its quantity.",
        400
      );
    }
    productIds.add(productId);

    return {
      product_id: productId,
      quantity: validateDecimal(item.quantity, "Quantity", {
        maxScale: 3,
        maxIntegerDigits: 9,
        allowZero: false,
      }),
      unit_price: validateDecimal(item.unit_price, "Unit price", {
        maxScale: 2,
        maxIntegerDigits: 10,
        allowZero: true,
      }),
    };
  });
}

function normalizeCustomerId(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return validateId(value, "Customer ID");
}

function rejectClientCreatedBy(input) {
  if (Object.prototype.hasOwnProperty.call(input, "created_by")) {
    throw createServiceError("created_by is assigned by the server and must not be provided.", 400);
  }
}

function normalizeSale(input, { isUpdate = false, authenticatedUserId } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createServiceError("Request body must be a JSON object.", 400);
  }

  rejectClientCreatedBy(input);
  const customer_id = normalizeCustomerId(input.customer_id);
  const items = normalizeItems(input.items);

  if (isUpdate) {
    return { customer_id, items };
  }

  return {
    customer_id,
    created_by: validateId(authenticatedUserId, "Authenticated user ID"),
    items,
  };
}

function handleRepositoryError(error) {
  switch (error.code) {
    case "SALE_USER_NOT_FOUND":
    case "SALE_CUSTOMER_NOT_FOUND":
    case "SALE_PRODUCT_NOT_FOUND":
      throw createServiceError(error.message, 404);
    case "SALE_PRODUCT_INACTIVE":
      throw createServiceError(error.message, 409);
    case "SALE_INSUFFICIENT_STOCK":
    case "SALE_ALREADY_COMPLETED":
    case "SALE_NOT_DRAFT":
    case "SALE_CREDIT_ENTRY_EXISTS":
    case "RECEIPT_ALREADY_EXISTS":
      throw createServiceError(error.message, 409);
    case "SALE_HAS_NO_ITEMS":
    case "SALE_ZERO_TOTAL":
      throw createServiceError(error.message, 400);
    case "23503":
      throw createServiceError("A referenced customer, user, or product does not exist.", 404);
    case "23505":
      throw createServiceError("A product can only appear once in a sale.", 400);
    case "23514":
      throw createServiceError("Sale data violates a database constraint.", 400);
    case "P0001":
      if (error.message.includes("Insufficient stock")) {
        throw createServiceError("Insufficient stock to complete this sale.", 409);
      }
      throw error;
    default:
      throw error;
  }
}

async function createSale(input, authenticatedUserId) {
  const sale = normalizeSale(input, { authenticatedUserId });
  try {
    return await saleRepository.createSale(sale);
  } catch (error) {
    handleRepositoryError(error);
  }
}

async function getAllSales() {
  return saleRepository.getAllSales();
}

async function getSaleById(id) {
  const validId = validateId(id, "Sale ID");
  const sale = await saleRepository.getSaleById(validId);

  if (!sale) {
    throw createServiceError("Sale not found.", 404);
  }

  return sale;
}

async function updateSale(id, input) {
  const validId = validateId(id, "Sale ID");
  const sale = normalizeSale(input, { isUpdate: true });

  try {
    const updatedSale = await saleRepository.updateSale(validId, sale);
    if (!updatedSale) {
      throw createServiceError("Sale not found.", 404);
    }
    return updatedSale;
  } catch (error) {
    handleRepositoryError(error);
  }
}

async function deleteSale(id) {
  const validId = validateId(id, "Sale ID");

  try {
    const cancelledSale = await saleRepository.deleteSale(validId);
    if (!cancelledSale) {
      throw createServiceError("Sale not found.", 404);
    }
    return cancelledSale;
  } catch (error) {
    handleRepositoryError(error);
  }
}

async function completeSale(id, authenticatedUser, initialPaymentInput) {
  const validId = validateId(id, "Sale ID");
  if (!authenticatedUser || typeof authenticatedUser !== "object") {
    throw createServiceError("Authenticated user is required.", 401);
  }
  const performedBy = validateId(authenticatedUser.id, "Authenticated user ID");
  if (
    typeof authenticatedUser.username !== "string" ||
    !authenticatedUser.username.trim() ||
    authenticatedUser.username.trim().length > 50
  ) {
    throw createServiceError("Authenticated username is invalid.", 400);
  }
  const initialPayment = initialPaymentInput === undefined
    ? null
    : paymentService.normalizePayment(initialPaymentInput, performedBy);

  try {
    const completedSale = await saleRepository.completeSale(validId, {
      performedBy,
      cashierUsername: authenticatedUser.username.trim(),
      initialPayment,
    });
    if (!completedSale) {
      throw createServiceError("Sale not found.", 404);
    }
    return completedSale;
  } catch (error) {
    if (
      typeof error.code === "string" &&
      error.code.startsWith("PAYMENT_")
    ) {
      paymentService.handleRepositoryError(error);
    }
    if (error.constraint === "payments_idempotency_key_unique_idx") {
      paymentService.handleRepositoryError(error);
    }
    handleRepositoryError(error);
  }
}

module.exports = {
  createSale,
  getAllSales,
  getSaleById,
  updateSale,
  deleteSale,
  completeSale,
};

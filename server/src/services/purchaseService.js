const purchaseRepository = require("../repositories/purchaseRepository");

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
    throw createServiceError("At least one purchase item is required.", 400);
  }

  const productIds = new Set();
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw createServiceError(`Purchase item ${index + 1} must be an object.`, 400);
    }

    const productId = validateId(item.product_id, `Product ID in item ${index + 1}`);
    if (productIds.has(productId)) {
      throw createServiceError(
        "A product can only appear once in a purchase; combine its quantity.",
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
      unit_cost: validateDecimal(item.unit_cost, "Unit cost", {
        maxScale: 2,
        maxIntegerDigits: 10,
        allowZero: true,
      }),
    };
  });
}

function rejectClientCreatedBy(input) {
  if (Object.prototype.hasOwnProperty.call(input, "created_by")) {
    throw createServiceError("created_by is assigned by the server and must not be provided.", 400);
  }
}

function normalizePurchase(input, authenticatedUserId) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createServiceError("Request body must be a JSON object.", 400);
  }

  rejectClientCreatedBy(input);
  const supplierId = validateId(input.supplier_id, "Supplier ID");
  const createdBy = validateId(authenticatedUserId, "Authenticated user ID");

  return {
    supplier_id: supplierId,
    created_by: createdBy,
    items: normalizeItems(input.items),
  };
}

function normalizePurchaseUpdate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createServiceError("Request body must be a JSON object.", 400);
  }

  rejectClientCreatedBy(input);
  return {
    supplier_id: validateId(input.supplier_id, "Supplier ID"),
    items: normalizeItems(input.items),
  };
}

function handleRepositoryError(error) {
  switch (error.code) {
    case "PURCHASE_SUPPLIER_NOT_FOUND":
    case "PURCHASE_PRODUCT_NOT_FOUND":
    case "PURCHASE_USER_NOT_FOUND":
      throw createServiceError(error.message, 404);
    case "PURCHASE_ALREADY_RECEIVED":
    case "PURCHASE_NOT_DRAFT":
      throw createServiceError(error.message, 409);
    case "23503":
      throw createServiceError("A referenced supplier, user, or product does not exist.", 404);
    case "23505":
      throw createServiceError(
        "A product can only appear once in a purchase.",
        400
      );
    case "23514":
      throw createServiceError("Purchase data violates a database constraint.", 400);
    default:
      throw error;
  }
}

async function createPurchase(input, authenticatedUserId) {
  const purchase = normalizePurchase(input, authenticatedUserId);
  try {
    return await purchaseRepository.createPurchase(purchase);
  } catch (error) {
    handleRepositoryError(error);
  }
}

async function getAllPurchases() {
  return purchaseRepository.getAllPurchases();
}

async function getPurchaseById(id) {
  const validId = validateId(id, "Purchase ID");
  const purchase = await purchaseRepository.getPurchaseById(validId);

  if (!purchase) {
    throw createServiceError("Purchase not found.", 404);
  }

  return purchase;
}

async function updatePurchase(id, input) {
  const validId = validateId(id, "Purchase ID");
  const purchase = normalizePurchaseUpdate(input);

  try {
    const updatedPurchase = await purchaseRepository.updatePurchase(validId, purchase);
    if (!updatedPurchase) {
      throw createServiceError("Purchase not found.", 404);
    }
    return updatedPurchase;
  } catch (error) {
    handleRepositoryError(error);
  }
}

async function deletePurchase(id) {
  const validId = validateId(id, "Purchase ID");

  try {
    const cancelledPurchase = await purchaseRepository.deletePurchase(validId);
    if (!cancelledPurchase) {
      throw createServiceError("Purchase not found.", 404);
    }
    return cancelledPurchase;
  } catch (error) {
    handleRepositoryError(error);
  }
}

async function receivePurchase(id, authenticatedUserId) {
  const validId = validateId(id, "Purchase ID");
  const performedBy = validateId(authenticatedUserId, "Authenticated user ID");

  try {
    const receivedPurchase = await purchaseRepository.receivePurchase(validId, performedBy);
    if (!receivedPurchase) {
      throw createServiceError("Purchase not found.", 404);
    }
    return receivedPurchase;
  } catch (error) {
    handleRepositoryError(error);
  }
}

module.exports = {
  createPurchase,
  getAllPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
  receivePurchase,
};

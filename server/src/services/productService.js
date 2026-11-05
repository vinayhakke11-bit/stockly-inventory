const productRepository = require("../repositories/productRepository");

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

function normalizeText(value, field, { required = false, maxLength } = {}) {
  if (value === undefined || value === null) {
    if (required) {
      throw createServiceError(`${field} is required and must be text.`, 400);
    }
    return null;
  }

  if (typeof value !== "string") {
    throw createServiceError(`${field} must be text.`, 400);
  }

  const trimmedValue = value.trim();
  if (required && !trimmedValue) {
    throw createServiceError(`${field} cannot be empty.`, 400);
  }
  if (maxLength && trimmedValue.length > maxLength) {
    throw createServiceError(`${field} must be ${maxLength} characters or fewer.`, 400);
  }

  return trimmedValue || null;
}

function normalizeNonNegativeNumber(value, field, { required = false, max } = {}) {
  if (value === undefined || value === null) {
    if (required) {
      throw createServiceError(`${field} is required.`, 400);
    }
    return null;
  }

  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw createServiceError(`${field} must be a non-negative number.`, 400);
  }
  if (max !== undefined && numberValue > max) {
    throw createServiceError(`${field} exceeds the maximum supported value.`, 400);
  }

  return numberValue;
}

function normalizeProduct(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createServiceError("Request body must be a JSON object.", 400);
  }

  const categoryId = validateId(input.category_id, "Category ID");
  const name = normalizeText(input.name, "Product name", {
    required: true,
    maxLength: 150,
  });
  const sku = normalizeText(input.sku, "SKU", {
    required: true,
    maxLength: 60,
  });
  const barcode = normalizeText(input.barcode, "Barcode", { maxLength: 100 });
  const description = normalizeText(input.description, "Description");
  const sellingPrice = normalizeNonNegativeNumber(input.selling_price, "Selling price", {
    required: true,
    max: 9999999999.99,
  });
  const stockOnHand = normalizeNonNegativeNumber(input.stock_on_hand, "Stock on hand", {
    max: 999999999.999,
  });

  if (isUpdate && input.stock_on_hand !== undefined) {
    throw createServiceError(
      "Stock cannot be changed through product updates; use an inventory operation.",
      400
    );
  }

  if (!isUpdate && stockOnHand !== null && stockOnHand !== 0) {
    throw createServiceError(
      "New products must start with zero stock; use an inventory operation to add stock.",
      400
    );
  }

  return {
    category_id: categoryId,
    sku,
    barcode,
    name,
    description,
    selling_price: sellingPrice,
  };
}

function handleDatabaseError(error) {
  if (error.code === "23505") {
    if (error.constraint === "products_barcode_key") {
      throw createServiceError("A product with this barcode already exists.", 409);
    }
    throw createServiceError("A product with this SKU already exists.", 409);
  }

  if (error.code === "23503") {
    if (error.constraint === "products_category_id_fkey") {
      throw createServiceError("Category not found.", 404);
    }
    throw createServiceError("Product is referenced by transaction history.", 409);
  }

  if (error.code === "23514") {
    throw createServiceError("Product data violates a database constraint.", 400);
  }

  throw error;
}

async function ensureCategoryExists(categoryId) {
  if (!(await productRepository.checkCategoryExists(categoryId))) {
    throw createServiceError("Category not found.", 404);
  }
}

async function ensureSkuIsAvailable(sku, currentProductId) {
  const existingProduct = await productRepository.getProductBySku(sku);

  if (existingProduct && String(existingProduct.id) !== currentProductId) {
    throw createServiceError("A product with this SKU already exists.", 409);
  }
}

async function createProduct(input) {
  const product = normalizeProduct(input);
  await ensureCategoryExists(product.category_id);
  await ensureSkuIsAvailable(product.sku);

  try {
    return await productRepository.createProduct(product);
  } catch (error) {
    handleDatabaseError(error);
  }
}

async function getAllProducts() {
  return productRepository.getAllProducts();
}

async function getProductById(id) {
  const validId = validateId(id, "Product ID");
  const product = await productRepository.getProductById(validId);

  if (!product) {
    throw createServiceError("Product not found.", 404);
  }

  return product;
}

async function updateProduct(id, input) {
  const validId = validateId(id, "Product ID");
  const product = normalizeProduct(input, { isUpdate: true });

  await getProductById(validId);
  await ensureCategoryExists(product.category_id);
  await ensureSkuIsAvailable(product.sku, validId);

  try {
    const updatedProduct = await productRepository.updateProduct(validId, product);
    if (!updatedProduct) {
      throw createServiceError("Product not found.", 404);
    }

    return updatedProduct;
  } catch (error) {
    handleDatabaseError(error);
  }
}

async function deleteProduct(id) {
  const validId = validateId(id, "Product ID");
  await getProductById(validId);

  if (await productRepository.productHasTransactionHistory(validId)) {
    throw createServiceError(
      "Cannot delete a product referenced by purchase or sale history.",
      409
    );
  }

  try {
    const deletedProduct = await productRepository.deleteProduct(validId);
    if (!deletedProduct) {
      throw createServiceError("Product not found.", 404);
    }

    return deletedProduct;
  } catch (error) {
    handleDatabaseError(error);
  }
}

module.exports = {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
};

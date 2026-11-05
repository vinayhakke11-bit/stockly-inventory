const supplierRepository = require("../repositories/supplierRepository");

function createServiceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateSupplierId(id) {
  const idString = String(id);

  if (!/^[1-9]\d*$/.test(idString) || BigInt(idString) > 9223372036854775807n) {
    throw createServiceError("Supplier ID must be a positive integer.", 400);
  }

  return idString;
}

function normalizeOptionalText(value, field, maxLength) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw createServiceError(`${field} must be text.`, 400);
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length > maxLength) {
    throw createServiceError(`${field} must be ${maxLength} characters or fewer.`, 400);
  }

  return trimmedValue || null;
}

function normalizeSupplier(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createServiceError("Request body must be a JSON object.", 400);
  }

  if (typeof input.name !== "string") {
    throw createServiceError("Supplier name is required and must be text.", 400);
  }

  const name = input.name.trim();
  if (!name) {
    throw createServiceError("Supplier name cannot be empty.", 400);
  }
  if (name.length > 150) {
    throw createServiceError("Supplier name must be 150 characters or fewer.", 400);
  }

  const phone = normalizeOptionalText(input.phone, "Phone", 30);
  const email = normalizeOptionalText(input.email, "Email", 255);
  const address = normalizeOptionalText(input.address, "Address", Number.MAX_SAFE_INTEGER);

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createServiceError("Email must be a valid email address.", 400);
  }

  return { name, phone, email, address };
}

async function ensureNameIsAvailable(name, currentSupplierId) {
  const existingSupplier = await supplierRepository.getSupplierByName(name);

  if (
    existingSupplier &&
    String(existingSupplier.id) !== currentSupplierId
  ) {
    throw createServiceError("A supplier with this name already exists.", 409);
  }
}

function handleDatabaseError(error) {
  if (error.code === "23503") {
    throw createServiceError(
      "Cannot delete a supplier that is referenced by purchases.",
      409
    );
  }

  throw error;
}

async function createSupplier(input) {
  const supplier = normalizeSupplier(input);
  await ensureNameIsAvailable(supplier.name);

  return supplierRepository.createSupplier(supplier);
}

async function getAllSuppliers() {
  return supplierRepository.getAllSuppliers();
}

async function getSupplierById(id) {
  const validId = validateSupplierId(id);
  const supplier = await supplierRepository.getSupplierById(validId);

  if (!supplier) {
    throw createServiceError("Supplier not found.", 404);
  }

  return supplier;
}

async function updateSupplier(id, input) {
  const validId = validateSupplierId(id);
  const supplier = normalizeSupplier(input);

  await getSupplierById(validId);
  await ensureNameIsAvailable(supplier.name, validId);

  const updatedSupplier = await supplierRepository.updateSupplier(validId, supplier);
  if (!updatedSupplier) {
    throw createServiceError("Supplier not found.", 404);
  }

  return updatedSupplier;
}

async function deleteSupplier(id) {
  const validId = validateSupplierId(id);
  await getSupplierById(validId);

  if (await supplierRepository.supplierHasPurchases(validId)) {
    throw createServiceError(
      "Cannot delete a supplier that is referenced by purchases.",
      409
    );
  }

  try {
    const deletedSupplier = await supplierRepository.deleteSupplier(validId);
    if (!deletedSupplier) {
      throw createServiceError("Supplier not found.", 404);
    }

    return deletedSupplier;
  } catch (error) {
    handleDatabaseError(error);
  }
}

module.exports = {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
};

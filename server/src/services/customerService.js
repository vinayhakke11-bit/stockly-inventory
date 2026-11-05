const customerRepository = require("../repositories/customerRepository");

function createServiceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateCustomerId(id) {
  const idString = String(id);

  if (!/^[1-9]\d*$/.test(idString) || BigInt(idString) > 9223372036854775807n) {
    throw createServiceError("Customer ID must be a positive integer.", 400);
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

function normalizeCustomer(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createServiceError("Request body must be a JSON object.", 400);
  }

  if (typeof input.name !== "string") {
    throw createServiceError("Customer name is required and must be text.", 400);
  }

  const name = input.name.trim();
  if (!name) {
    throw createServiceError("Customer name cannot be empty.", 400);
  }
  if (name.length > 150) {
    throw createServiceError("Customer name must be 150 characters or fewer.", 400);
  }

  const phone = normalizeOptionalText(input.phone, "Phone", 30);
  const email = normalizeOptionalText(input.email, "Email", 255);
  const address = normalizeOptionalText(input.address, "Address", Number.MAX_SAFE_INTEGER);

  const phoneDigits = phone ? (phone.match(/\d/g) || []).length : 0;
  if (phone && (!/^[+]?[\d\s().-]+$/.test(phone) || phoneDigits < 7 || phoneDigits > 15)) {
    throw createServiceError("Phone must contain 7 to 15 digits and only valid phone characters.", 400);
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createServiceError("Email must be a valid email address.", 400);
  }

  return { name, phone, email, address };
}

async function ensureCustomerIsUnique(customer, excludeId) {
  const duplicate = await customerRepository.getDuplicateCustomer(customer, excludeId);

  if (duplicate) {
    throw createServiceError(
      "A customer with the same name and contact details already exists.",
      409
    );
  }
}

function handleDatabaseError(error) {
  if (error.code === "23503") {
    throw createServiceError(
      "Cannot delete a customer that is referenced by sales, credit transactions, or payments.",
      409
    );
  }

  if (error.code === "23505") {
    throw createServiceError("Customer conflicts with an existing record.", 409);
  }

  throw error;
}

async function createCustomer(input) {
  const customer = normalizeCustomer(input);
  await ensureCustomerIsUnique(customer);

  try {
    return await customerRepository.createCustomer(customer);
  } catch (error) {
    handleDatabaseError(error);
  }
}

async function getAllCustomers() {
  return customerRepository.getAllCustomers();
}

async function getCustomerById(id) {
  const validId = validateCustomerId(id);
  const customer = await customerRepository.getCustomerById(validId);

  if (!customer) {
    throw createServiceError("Customer not found.", 404);
  }

  return customer;
}

async function getCustomerCreditSummary(id) {
  const validId = validateCustomerId(id);
  const summary = await customerRepository.getCustomerCreditSummary(validId);

  if (!summary) {
    throw createServiceError("Customer not found.", 404);
  }

  return summary;
}

async function getCustomerCreditTransactions(id) {
  const validId = validateCustomerId(id);
  await getCustomerById(validId);

  return customerRepository.getCustomerCreditTransactions(validId);
}

async function updateCustomer(id, input) {
  const validId = validateCustomerId(id);
  const customer = normalizeCustomer(input);

  await getCustomerById(validId);
  await ensureCustomerIsUnique(customer, validId);

  try {
    const updatedCustomer = await customerRepository.updateCustomer(validId, customer);
    if (!updatedCustomer) {
      throw createServiceError("Customer not found.", 404);
    }

    return updatedCustomer;
  } catch (error) {
    handleDatabaseError(error);
  }
}

async function deleteCustomer(id) {
  const validId = validateCustomerId(id);
  await getCustomerById(validId);

  if (await customerRepository.customerHasHistory(validId)) {
    throw createServiceError(
      "Cannot delete a customer with sales, credit transactions, or payment history.",
      409
    );
  }

  try {
    const deletedCustomer = await customerRepository.deleteCustomer(validId);
    if (!deletedCustomer) {
      throw createServiceError("Customer not found.", 404);
    }

    return deletedCustomer;
  } catch (error) {
    handleDatabaseError(error);
  }
}

module.exports = {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  getCustomerCreditSummary,
  getCustomerCreditTransactions,
  updateCustomer,
  deleteCustomer,
};

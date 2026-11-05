const shopSettingsRepository = require("../repositories/shopSettingsRepository");

function createServiceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeText(value, field, { required = false, maxLength }) {
  if (value === undefined || value === null) {
    if (required) throw createServiceError(`${field} is required.`, 400);
    return "";
  }
  if (typeof value !== "string") {
    throw createServiceError(`${field} must be text.`, 400);
  }

  const text = value.trim();
  if (required && !text) throw createServiceError(`${field} is required.`, 400);
  if (text.length > maxLength) {
    throw createServiceError(`${field} must be ${maxLength} characters or fewer.`, 400);
  }
  return text;
}

function normalizeSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createServiceError("Request body must be a JSON object.", 400);
  }

  const supportedFields = new Set(["name", "address", "phone"]);
  if (Object.keys(input).some((key) => !supportedFields.has(key))) {
    throw createServiceError("Only shop name, address, and phone can be updated.", 400);
  }

  return {
    name: normalizeText(input.name, "Shop name", { required: true, maxLength: 150 }),
    address: normalizeText(input.address, "Shop address", { maxLength: 2000 }),
    phone: normalizeText(input.phone, "Phone number", { maxLength: 30 }),
  };
}

async function getShopSettings() {
  return shopSettingsRepository.getShopSettings();
}

async function updateShopSettings(input) {
  return shopSettingsRepository.updateShopSettings(normalizeSettings(input));
}

module.exports = { getShopSettings, updateShopSettings };

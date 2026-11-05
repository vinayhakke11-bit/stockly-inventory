const receiptRepository = require("../repositories/receiptRepository");

function createServiceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateSaleId(id) {
  const idString = String(id);
  if (!/^[1-9]\d*$/.test(idString) || BigInt(idString) > 9223372036854775807n) {
    throw createServiceError("Sale ID must be a positive integer.", 400);
  }
  return idString;
}

async function getReceiptBySaleId(id) {
  const saleId = validateSaleId(id);
  const receipt = await receiptRepository.getReceiptBySale(saleId);
  if (!receipt) {
    throw createServiceError("Receipt not found.", 404);
  }
  return receipt;
}

module.exports = { getReceiptBySaleId };

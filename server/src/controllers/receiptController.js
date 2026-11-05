const receiptService = require("../services/receiptService");

async function getBySale(req, res) {
  const receipt = await receiptService.getReceiptBySaleId(req.params.saleId);
  res.status(200).json({
    status: "success",
    data: receipt,
  });
}

module.exports = { getBySale };

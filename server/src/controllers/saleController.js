const saleService = require("../services/saleService");
const receiptService = require("../services/receiptService");

async function create(req, res) {
  const sale = await saleService.createSale(req.body, req.user.id);

  res.status(201).json({
    status: "success",
    message: "Sale created successfully.",
    data: sale,
  });
}

async function getAll(req, res) {
  const sales = await saleService.getAllSales();

  res.status(200).json({
    status: "success",
    data: sales,
  });
}

async function getById(req, res) {
  const sale = await saleService.getSaleById(req.params.id);

  res.status(200).json({
    status: "success",
    data: sale,
  });
}

async function update(req, res) {
  const sale = await saleService.updateSale(req.params.id, req.body);

  res.status(200).json({
    status: "success",
    message: "Sale updated successfully.",
    data: sale,
  });
}

async function deleteSale(req, res) {
  const sale = await saleService.deleteSale(req.params.id);

  res.status(200).json({
    status: "success",
    message: "Draft sale cancelled successfully.",
    data: sale,
  });
}

async function complete(req, res) {
  const sale = await saleService.completeSale(
    req.params.id,
    req.user,
    req.body?.initial_payment
  );

  res.status(200).json({
    status: "success",
    message: "Sale completed successfully.",
    data: sale,
  });
}

async function getReceipt(req, res) {
  const receipt = await receiptService.getReceiptBySaleId(req.params.saleId);

  res.status(200).json({
    status: "success",
    data: receipt,
  });
}

module.exports = {
  create,
  getAll,
  getById,
  update,
  delete: deleteSale,
  complete,
  getReceipt,
};

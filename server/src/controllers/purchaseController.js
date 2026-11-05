const purchaseService = require("../services/purchaseService");

async function create(req, res) {
  const purchase = await purchaseService.createPurchase(req.body, req.user.id);

  res.status(201).json({
    status: "success",
    message: "Purchase created successfully.",
    data: purchase,
  });
}

async function getAll(req, res) {
  const purchases = await purchaseService.getAllPurchases();

  res.status(200).json({
    status: "success",
    data: purchases,
  });
}

async function getById(req, res) {
  const purchase = await purchaseService.getPurchaseById(req.params.id);

  res.status(200).json({
    status: "success",
    data: purchase,
  });
}

async function update(req, res) {
  const purchase = await purchaseService.updatePurchase(req.params.id, req.body);

  res.status(200).json({
    status: "success",
    message: "Purchase updated successfully.",
    data: purchase,
  });
}

async function deletePurchase(req, res) {
  const purchase = await purchaseService.deletePurchase(req.params.id);

  res.status(200).json({
    status: "success",
    message: "Draft purchase cancelled successfully.",
    data: purchase,
  });
}

async function receive(req, res) {
  const purchase = await purchaseService.receivePurchase(req.params.id, req.user.id);

  res.status(200).json({
    status: "success",
    message: "Purchase received successfully.",
    data: purchase,
  });
}

module.exports = {
  create,
  getAll,
  getById,
  update,
  delete: deletePurchase,
  receive,
};

const returnService = require("../services/returnService");

async function create(req, res) {
  const returnRecord = await returnService.createReturn(
    req.params.saleId,
    req.body,
    req.user.id
  );

  res.status(201).json({
    status: "success",
    message: "Return created successfully.",
    data: returnRecord,
  });
}

async function getBySale(req, res) {
  const returns = await returnService.getReturnsBySaleId(req.params.saleId);

  res.status(200).json({
    status: "success",
    data: returns,
  });
}

async function getAll(req, res) {
  const returns = await returnService.getAllReturns();

  res.status(200).json({
    status: "success",
    data: returns,
  });
}

async function getById(req, res) {
  const returnRecord = await returnService.getReturnById(req.params.returnId);

  res.status(200).json({
    status: "success",
    data: returnRecord,
  });
}

async function complete(req, res) {
  const returnRecord = await returnService.completeReturn(req.params.returnId, req.user.id);

  res.status(200).json({
    status: "success",
    message: "Return completed successfully.",
    data: returnRecord,
  });
}

async function refund(req, res) {
  const result = await returnService.createRefund(
    req.params.returnId,
    req.body,
    req.user.id
  );

  res.status(result.replayed ? 200 : 201).json({
    status: "success",
    message: result.replayed
      ? "Refund request was already processed."
      : "Refund recorded successfully.",
    data: result.payment,
  });
}

async function getRefunds(req, res) {
  const refunds = await returnService.getRefundsByReturnId(req.params.returnId);

  res.status(200).json({
    status: "success",
    data: refunds,
  });
}

module.exports = { create, getBySale, getAll, getById, complete, refund, getRefunds };

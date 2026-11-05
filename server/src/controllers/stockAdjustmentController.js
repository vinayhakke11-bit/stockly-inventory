const stockAdjustmentService = require("../services/stockAdjustmentService");

async function create(req, res) {
  const adjustment = await stockAdjustmentService.createStockAdjustment(
    req.body,
    req.user.id
  );

  res.status(201).json({
    status: "success",
    message: "Stock adjustment recorded successfully.",
    data: adjustment,
  });
}

async function getHistory(req, res) {
  const history = await stockAdjustmentService.getStockAdjustmentHistory(
    req.query.product_id
  );

  res.status(200).json({
    status: "success",
    data: history,
  });
}

module.exports = { create, getHistory };

const paymentService = require("../services/paymentService");

async function create(req, res) {
  const result = await paymentService.createPayment(
    req.params.saleId,
    req.body,
    req.user.id
  );

  res.status(result.replayed ? 200 : 201).json({
    status: "success",
    message: result.replayed
      ? "Payment request was already processed."
      : "Payment recorded successfully.",
    data: result.payment,
  });
}

async function getBySale(req, res) {
  const payments = await paymentService.getPaymentsBySaleId(req.params.saleId);

  res.status(200).json({
    status: "success",
    data: payments,
  });
}

async function getAll(req, res) {
  const payments = await paymentService.getAllPayments(req.query);

  res.status(200).json({
    status: "success",
    data: payments,
  });
}

module.exports = { create, getBySale, getAll };

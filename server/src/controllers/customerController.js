const customerService = require("../services/customerService");

async function create(req, res) {
  const customer = await customerService.createCustomer(req.body);

  res.status(201).json({
    status: "success",
    message: "Customer created successfully.",
    data: customer,
  });
}

async function getAll(req, res) {
  const customers = await customerService.getAllCustomers();

  res.status(200).json({
    status: "success",
    data: customers,
  });
}

async function getById(req, res) {
  const customer = await customerService.getCustomerById(req.params.id);

  res.status(200).json({
    status: "success",
    data: customer,
  });
}

async function getCreditSummary(req, res) {
  const summary = await customerService.getCustomerCreditSummary(req.params.id);

  res.status(200).json({
    status: "success",
    data: summary,
  });
}

async function getCreditTransactions(req, res) {
  const transactions = await customerService.getCustomerCreditTransactions(req.params.id);

  res.status(200).json({
    status: "success",
    data: transactions,
  });
}

async function update(req, res) {
  const customer = await customerService.updateCustomer(req.params.id, req.body);

  res.status(200).json({
    status: "success",
    message: "Customer updated successfully.",
    data: customer,
  });
}

async function deleteCustomer(req, res) {
  const customer = await customerService.deleteCustomer(req.params.id);

  res.status(200).json({
    status: "success",
    message: "Customer deleted successfully.",
    data: customer,
  });
}

module.exports = {
  create,
  getAll,
  getById,
  getCreditSummary,
  getCreditTransactions,
  update,
  delete: deleteCustomer,
};

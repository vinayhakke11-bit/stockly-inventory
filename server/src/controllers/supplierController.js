const supplierService = require("../services/supplierService");

async function create(req, res) {
  const supplier = await supplierService.createSupplier(req.body);

  res.status(201).json({
    status: "success",
    message: "Supplier created successfully.",
    data: supplier,
  });
}

async function getAll(req, res) {
  const suppliers = await supplierService.getAllSuppliers();

  res.status(200).json({
    status: "success",
    data: suppliers,
  });
}

async function getById(req, res) {
  const supplier = await supplierService.getSupplierById(req.params.id);

  res.status(200).json({
    status: "success",
    data: supplier,
  });
}

async function update(req, res) {
  const supplier = await supplierService.updateSupplier(req.params.id, req.body);

  res.status(200).json({
    status: "success",
    message: "Supplier updated successfully.",
    data: supplier,
  });
}

async function deleteSupplier(req, res) {
  const supplier = await supplierService.deleteSupplier(req.params.id);

  res.status(200).json({
    status: "success",
    message: "Supplier deleted successfully.",
    data: supplier,
  });
}

module.exports = { create, getAll, getById, update, delete: deleteSupplier };

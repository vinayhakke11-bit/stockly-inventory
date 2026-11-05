const productService = require("../services/productService");

async function create(req, res) {
  const product = await productService.createProduct(req.body);

  res.status(201).json({
    status: "success",
    message: "Product created successfully.",
    data: product,
  });
}

async function getAll(req, res) {
  const products = await productService.getAllProducts();

  res.status(200).json({
    status: "success",
    data: products,
  });
}

async function getById(req, res) {
  const product = await productService.getProductById(req.params.id);

  res.status(200).json({
    status: "success",
    data: product,
  });
}

async function update(req, res) {
  const product = await productService.updateProduct(req.params.id, req.body);

  res.status(200).json({
    status: "success",
    message: "Product updated successfully.",
    data: product,
  });
}

async function deleteProduct(req, res) {
  const product = await productService.deleteProduct(req.params.id);

  res.status(200).json({
    status: "success",
    message: "Product deleted successfully.",
    data: product,
  });
}

module.exports = { create, getAll, getById, update, delete: deleteProduct };

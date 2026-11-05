const categoryService = require("../services/categoryService");

async function create(req, res) {
  const category = await categoryService.createCategory(req.body);

  res.status(201).json({
    status: "success",
    message: "Category created successfully.",
    data: category,
  });
}

async function getAll(req, res) {
  const categories = await categoryService.getAllCategories();

  res.status(200).json({
    status: "success",
    data: categories,
  });
}

async function getById(req, res) {
  const category = await categoryService.getCategoryById(req.params.id);

  res.status(200).json({
    status: "success",
    data: category,
  });
}

async function update(req, res) {
  const category = await categoryService.updateCategory(req.params.id, req.body);

  res.status(200).json({
    status: "success",
    message: "Category updated successfully.",
    data: category,
  });
}

async function deleteCategory(req, res) {
  const category = await categoryService.deleteCategory(req.params.id);

  res.status(200).json({
    status: "success",
    message: "Category deleted successfully.",
    data: category,
  });
}

module.exports = { create, getAll, getById, update, delete: deleteCategory };

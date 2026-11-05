const categoryRepository = require("../repositories/categoryRepository");

function createServiceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateCategoryId(id) {
  const idString = String(id);

  if (!/^[1-9]\d*$/.test(idString) || BigInt(idString) > 9223372036854775807n) {
    throw createServiceError("Category ID must be a positive integer.", 400);
  }

  return idString;
}

function normalizeCategory(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createServiceError("Request body must be a JSON object.", 400);
  }

  if (typeof input.name !== "string") {
    throw createServiceError("Category name is required and must be text.", 400);
  }

  const name = input.name.trim();
  if (!name) {
    throw createServiceError("Category name cannot be empty.", 400);
  }

  if (name.length > 100) {
    throw createServiceError("Category name must be 100 characters or fewer.", 400);
  }

  if (input.description !== undefined && input.description !== null
      && typeof input.description !== "string") {
    throw createServiceError("Category description must be text.", 400);
  }

  const description = input.description?.trim() || null;
  return { name, description };
}

function handleDatabaseConflict(error) {
  if (error.code === "23505") {
    throw createServiceError("A category with this name already exists.", 409);
  }

  if (error.code === "23503") {
    throw createServiceError("Category is still referenced by products.", 409);
  }

  throw error;
}

async function createCategory(input) {
  const category = normalizeCategory(input);
  const existingCategory = await categoryRepository.getCategoryByName(category.name);

  if (existingCategory) {
    throw createServiceError("A category with this name already exists.", 409);
  }

  try {
    return await categoryRepository.createCategory(category);
  } catch (error) {
    handleDatabaseConflict(error);
  }
}

async function getAllCategories() {
  return categoryRepository.getAllCategories();
}

async function getCategoryById(id) {
  const validId = validateCategoryId(id);
  const category = await categoryRepository.getCategoryById(validId);

  if (!category) {
    throw createServiceError("Category not found.", 404);
  }

  return category;
}

async function updateCategory(id, input) {
  const validId = validateCategoryId(id);
  const category = normalizeCategory(input);

  await getCategoryById(validId);
  const existingCategory = await categoryRepository.getCategoryByName(category.name);

  if (existingCategory && String(existingCategory.id) !== validId) {
    throw createServiceError("A category with this name already exists.", 409);
  }

  try {
    const updatedCategory = await categoryRepository.updateCategory(validId, category);
    if (!updatedCategory) {
      throw createServiceError("Category not found.", 404);
    }

    return updatedCategory;
  } catch (error) {
    handleDatabaseConflict(error);
  }
}

async function deleteCategory(id) {
  const validId = validateCategoryId(id);
  await getCategoryById(validId);

  if (await categoryRepository.categoryHasProducts(validId)) {
    throw createServiceError("Cannot delete a category that is used by products.", 409);
  }

  try {
    const deletedCategory = await categoryRepository.deleteCategory(validId);
    if (!deletedCategory) {
      throw createServiceError("Category not found.", 404);
    }

    return deletedCategory;
  } catch (error) {
    handleDatabaseConflict(error);
  }
}

module.exports = {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};

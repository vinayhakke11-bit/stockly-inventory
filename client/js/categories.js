"use strict";

const CATEGORIES_URL = "/api/categories";
const elements = {
  body: document.getElementById("categories-body"),
  status: document.getElementById("category-status"),
  search: document.getElementById("category-search"),
  resultCount: document.getElementById("category-result-count"),
  refreshButton: document.getElementById("refresh-categories"),
  addButton: document.getElementById("add-category-button"),
  dialog: document.getElementById("category-dialog"),
  form: document.getElementById("category-form"),
  dialogTitle: document.getElementById("category-dialog-title"),
  formMessage: document.getElementById("category-form-message"),
  saveButton: document.getElementById("save-category-button"),
  closeButton: document.getElementById("close-category-dialog"),
  cancelButton: document.getElementById("cancel-category-form"),
};

let categories = [];
let loading = false;
let saving = false;
let editingCategoryId = null;

function showStatus(message, isError = false, isSuccess = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
  elements.status.classList.toggle("is-success", isSuccess);
}

function categoryError(status, message = "") {
  const lowerMessage = message.toLocaleLowerCase();
  if (status === 400) return message || "Enter a valid category name and try again.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to manage categories.";
  if (status === 404) return "This category could not be found. Refresh the list and try again.";
  if (status === 409) {
    if (lowerMessage.includes("referenced") || lowerMessage.includes("used by products")) {
      return "This category is used by one or more products and cannot be deleted.";
    }
    return "A category with this name already exists.";
  }
  if (status >= 500) return "Stockly could not complete the request. Please try again.";
  return message || `The request could not be completed (${status}).`;
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await window.StocklyAuth.fetchWithCsrf(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("Network error. Check your connection and try again.");
  }

  if (response.status === 401) {
    window.location.replace("./login.html");
    throw new Error(categoryError(401));
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(categoryError(response.status));
  }
  if (!response.ok || payload.status === "error") {
    throw new Error(categoryError(response.status, payload.message));
  }
  return payload;
}

function addCell(row, value, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = value === null || value === undefined || value === ""
    ? "—"
    : String(value);
  row.append(cell);
  return cell;
}

function emptyRow(message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.className = "empty-cell";
  cell.colSpan = 3;
  cell.textContent = message;
  row.append(cell);
  elements.body.replaceChildren(row);
}

function renderCategories() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const visibleCategories = categories.filter((category) =>
    String(category.name || "").toLocaleLowerCase().includes(query)
  );
  elements.resultCount.textContent = loading
    ? "Loading…"
    : `${visibleCategories.length} ${visibleCategories.length === 1 ? "category" : "categories"}`;

  if (loading) {
    emptyRow("Loading categories…");
    return;
  }
  if (visibleCategories.length === 0) {
    emptyRow(query
      ? "No categories match your search."
      : "No categories yet. Add your first category to get started.");
    return;
  }

  const rows = visibleCategories.map((category) => {
    const row = document.createElement("tr");
    const nameCell = addCell(row, category.name);
    nameCell.className = "category-name-cell";
    addCell(row, Number.isFinite(Number(category.product_count))
      ? Number(category.product_count).toLocaleString("en-IN")
      : "—", "numeric");

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-heading";
    row.append(actionsCell);
    const actions = document.createElement("div");
    actions.className = "product-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "table-action";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", `Edit ${category.name}`);
    editButton.addEventListener("click", () => openEditForm(category));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "table-action table-action-danger";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${category.name}`);
    deleteButton.addEventListener("click", () => deleteCategory(category));

    actions.append(editButton, deleteButton);
    actionsCell.append(actions);
    return row;
  });
  elements.body.replaceChildren(...rows);
}

async function loadCategories({ quiet = false } = {}) {
  if (loading) return;
  loading = true;
  elements.refreshButton.disabled = true;
  if (!quiet) showStatus("Loading categories…");
  renderCategories();

  try {
    const payload = await requestJson(CATEGORIES_URL);
    if (!Array.isArray(payload.data)) {
      throw new Error("The categories response has an unexpected format.");
    }
    categories = payload.data;
    loading = false;
    renderCategories();
    if (!quiet) {
      showStatus(`Loaded ${categories.length} ${categories.length === 1 ? "category" : "categories"}.`);
    }
    return true;
  } catch (error) {
    categories = [];
    loading = false;
    renderCategories();
    showStatus(error.message || "Unable to load categories.", true);
    return false;
  } finally {
    elements.refreshButton.disabled = false;
  }
}

function showFormError(message) {
  elements.formMessage.textContent = message;
  elements.formMessage.hidden = false;
}

function clearFormError() {
  elements.formMessage.textContent = "";
  elements.formMessage.hidden = true;
}

function openCreateForm() {
  editingCategoryId = null;
  elements.form.reset();
  clearFormError();
  elements.dialogTitle.textContent = "Add category";
  elements.saveButton.textContent = "Save category";
  elements.dialog.showModal();
  elements.form.elements.name.focus();
}

async function openEditForm(category) {
  editingCategoryId = String(category.id);
  elements.form.reset();
  clearFormError();
  elements.dialogTitle.textContent = "Edit category";
  elements.saveButton.textContent = "Save changes";
  elements.saveButton.disabled = true;
  elements.form.elements.name.disabled = true;
  elements.form.elements.description.disabled = true;
  elements.dialog.showModal();

  try {
    const payload = await requestJson(`${CATEGORIES_URL}/${encodeURIComponent(editingCategoryId)}`);
    const detail = payload.data;
    if (!detail || String(detail.id) !== editingCategoryId) {
      throw new Error("Stockly returned an unexpected category response.");
    }
    elements.form.elements.name.value = detail.name || "";
    elements.form.elements.description.value = detail.description || "";
    elements.form.elements.name.focus();
  } catch (error) {
    showFormError(error.message || "Unable to load this category.");
  } finally {
    elements.form.elements.name.disabled = false;
    elements.form.elements.description.disabled = false;
    elements.saveButton.disabled = false;
  }
}

function categoryPayload() {
  const formData = new FormData(elements.form);
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  if (!name) throw new Error("Category name is required.");
  if (name.length > 100) throw new Error("Category name must be 100 characters or fewer.");
  const duplicate = categories.some((category) =>
    category.name === name && String(category.id) !== editingCategoryId
  );
  if (duplicate) throw new Error("A category with this name already exists.");
  return { name, description: description || null };
}

async function saveCategory(event) {
  event.preventDefault();
  if (saving || !elements.form.reportValidity()) return;
  clearFormError();

  let body;
  try {
    body = categoryPayload();
  } catch (error) {
    showFormError(error.message);
    return;
  }

  saving = true;
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = "Saving…";
  try {
    const isEditing = editingCategoryId !== null;
    const url = isEditing
      ? `${CATEGORIES_URL}/${encodeURIComponent(editingCategoryId)}`
      : CATEGORIES_URL;
    const payload = await requestJson(url, {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    elements.dialog.close();
    const refreshed = await loadCategories({ quiet: true });
    if (refreshed) showStatus(payload.message || (isEditing
      ? "Category updated successfully."
      : "Category created successfully."), false, true);
  } catch (error) {
    showFormError(error.message || "Unable to save category.");
  } finally {
    saving = false;
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = editingCategoryId === null
      ? "Save category"
      : "Save changes";
  }
}

async function deleteCategory(category) {
  if (!window.confirm(
    `Delete "${category.name}"? Categories assigned to products cannot be deleted.`
  )) return;

  try {
    const payload = await requestJson(
      `${CATEGORIES_URL}/${encodeURIComponent(category.id)}`,
      { method: "DELETE" }
    );
    const refreshed = await loadCategories({ quiet: true });
    if (refreshed) showStatus(payload.message || "Category deleted successfully.", false, true);
  } catch (error) {
    showStatus(error.message || "Unable to delete category.", true);
  }
}

function closeDialog() {
  elements.dialog.close();
}

elements.addButton.addEventListener("click", openCreateForm);
elements.refreshButton.addEventListener("click", loadCategories);
elements.search.addEventListener("input", renderCategories);
elements.form.addEventListener("submit", saveCategory);
elements.closeButton.addEventListener("click", closeDialog);
elements.cancelButton.addEventListener("click", closeDialog);
elements.dialog.addEventListener("close", () => {
  elements.form.elements.name.disabled = false;
  elements.form.elements.description.disabled = false;
  if (!saving) editingCategoryId = null;
});

window.StocklyAuth.ready.then((authenticated) => {
  if (authenticated) loadCategories();
});

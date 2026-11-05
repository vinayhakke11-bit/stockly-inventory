"use strict";

const PRODUCTS_URL = "/api/products";
const CATEGORIES_URL = "/api/categories";
const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const quantityFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const elements = {
  body: document.getElementById("products-body"),
  status: document.getElementById("product-status"),
  search: document.getElementById("product-search"),
  resultCount: document.getElementById("result-count"),
  addButton: document.getElementById("add-product-button"),
  dialog: document.getElementById("product-dialog"),
  form: document.getElementById("product-form"),
  dialogTitle: document.getElementById("product-dialog-title"),
  formMessage: document.getElementById("form-message"),
  saveButton: document.getElementById("save-product-button"),
  closeButton: document.getElementById("close-product-dialog"),
  cancelButton: document.getElementById("cancel-product-form"),
  categorySelect: document.querySelector("#product-form [name='category_id']"),
};

let products = [];
let categories = [];
let editingProductId = null;
let loading = false;

function showStatus(message, isError = false, isSuccess = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
  elements.status.classList.toggle("is-success", isSuccess);
}

async function requestJson(url, options = {}) {
  const response = await window.StocklyAuth.fetchWithCsrf(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(response.ok
      ? "The server returned an invalid response."
      : `Request failed (${response.status}).`);
  }

  if (!response.ok || payload.status === "error") {
    throw new Error(payload.message || `Request failed (${response.status}).`);
  }

  return payload;
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? currencyFormatter.format(amount) : "—";
}

function quantity(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? quantityFormatter.format(amount) : "—";
}

function displayDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
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
  cell.colSpan = 7;
  cell.textContent = message;
  row.append(cell);
  elements.body.replaceChildren(row);
}

function renderProducts() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const visibleProducts = products.filter((product) =>
    String(product.name || "").toLocaleLowerCase().includes(query) ||
    String(product.sku || "").toLocaleLowerCase().includes(query)
  );
  elements.resultCount.textContent =
    `${visibleProducts.length} ${visibleProducts.length === 1 ? "product" : "products"}`;

  if (loading) {
    emptyRow("Loading products…");
    return;
  }
  if (visibleProducts.length === 0) {
    emptyRow(query ? "No products match your search." : "No products yet. Add your first product to get started.");
    return;
  }

  const rows = visibleProducts.map((product) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.className = "product-name-cell";
    row.append(nameCell);
    nameCell.append(document.createTextNode(product.name || "—"));
    if (product.description) {
      const description = document.createElement("span");
      description.className = "product-description";
      description.textContent = product.description;
      nameCell.append(description);
    }

    addCell(row, product.sku);
    addCell(row, product.category_name);
    addCell(row, money(product.selling_price), "numeric");
    addCell(row, quantity(product.stock_on_hand), "numeric");

    const statusCell = document.createElement("td");
    row.append(statusCell);
    const status = product.is_active ? "Active" : "Inactive";
    const badge = document.createElement("span");
    badge.className = `status-badge ${product.is_active ? "status-badge-completed" : "status-badge-inactive"}`;
    badge.textContent = status;
    statusCell.append(badge);

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-heading";
    row.append(actionsCell);
    const actions = document.createElement("div");
    actions.className = "product-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "table-action";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", `Edit ${product.name}`);
    editButton.addEventListener("click", () => openEditForm(product));

    const adjustButton = document.createElement("a");
    adjustButton.className = "table-action";
    adjustButton.textContent = "Adjust stock";
    adjustButton.href = `./stock-adjustments.html?product_id=${encodeURIComponent(product.id)}`;
    adjustButton.setAttribute("aria-label", `Adjust stock for ${product.name}`);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "table-action table-action-danger";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${product.name}`);
    deleteButton.addEventListener("click", () => deleteProduct(product));

    actions.append(editButton);
    if (product.is_active) actions.append(adjustButton);
    actions.append(deleteButton);
    actionsCell.append(actions);
    return row;
  });

  elements.body.replaceChildren(...rows);
}

async function loadProducts({ quiet = false } = {}) {
  if (loading) return;
  loading = true;
  renderProducts();
  if (!quiet) showStatus("Loading products…");

  try {
    const payload = await requestJson(PRODUCTS_URL);
    if (!Array.isArray(payload.data)) {
      throw new Error("The products response has an unexpected format.");
    }
    products = payload.data;
    loading = false;
    renderProducts();
    if (!quiet) {
      showStatus(`Loaded ${products.length} ${products.length === 1 ? "product" : "products"}.`);
    }
  } catch (error) {
    products = [];
    loading = false;
    renderProducts();
    emptyRow(error.message || "Unable to load products.");
    showStatus(error.message || "Unable to load products.", true);
  }
}

async function loadCategories() {
  const payload = await requestJson(CATEGORIES_URL);
  if (!Array.isArray(payload.data)) {
    throw new Error("The categories response has an unexpected format.");
  }

  categories = payload.data;
  const options = [new Option("Select category", "")];
  for (const category of categories) {
    options.push(new Option(category.name, String(category.id)));
  }
  elements.categorySelect.replaceChildren(...options);
}

function displayFormError(message) {
  elements.formMessage.textContent = message;
  elements.formMessage.hidden = false;
}

function clearFormError() {
  elements.formMessage.textContent = "";
  elements.formMessage.hidden = true;
}

async function openCreateForm() {
  editingProductId = null;
  elements.form.reset();
  clearFormError();
  elements.dialogTitle.textContent = "Add product";
  elements.saveButton.textContent = "Save product";

  try {
    await loadCategories();
  } catch (error) {
    displayFormError(`Could not load categories: ${error.message}`);
    elements.categorySelect.disabled = true;
  }

  elements.dialog.showModal();
  elements.form.elements.name.focus();
}

function openEditForm(product) {
  editingProductId = String(product.id);
  elements.form.reset();
  clearFormError();
  elements.dialogTitle.textContent = "Edit product";
  elements.saveButton.textContent = "Save changes";
  elements.categorySelect.disabled = false;

  elements.form.elements.name.value = product.name || "";
  elements.form.elements.sku.value = product.sku || "";
  elements.form.elements.category_id.value = String(product.category_id || "");
  elements.form.elements.selling_price.value = product.selling_price ?? "";
  elements.form.elements.barcode.value = product.barcode || "";
  elements.form.elements.description.value = product.description || "";

  elements.dialog.showModal();
  elements.form.elements.name.focus();
}

function getProductPayload() {
  const formData = new FormData(elements.form);
  const name = String(formData.get("name") || "").trim();
  const sku = String(formData.get("sku") || "").trim();
  const categoryId = String(formData.get("category_id") || "").trim();
  const sellingPrice = String(formData.get("selling_price") || "").trim();
  const barcode = String(formData.get("barcode") || "").trim();
  const description = String(formData.get("description") || "").trim();

  if (!name || !sku || !categoryId || !sellingPrice) {
    throw new Error("Product name, SKU, category, and selling price are required.");
  }
  if (!Number.isFinite(Number(sellingPrice)) || Number(sellingPrice) < 0) {
    throw new Error("Selling price must be a non-negative number.");
  }
  if (Number(sellingPrice) > 9999999999.99) {
    throw new Error("Selling price is too large.");
  }

  return {
    name,
    sku,
    category_id: categoryId,
    selling_price: sellingPrice,
    barcode: barcode || null,
    description: description || null,
  };
}

async function saveProduct(event) {
  event.preventDefault();
  clearFormError();
  if (!elements.form.reportValidity()) return;

  let body;
  try {
    body = getProductPayload();
  } catch (error) {
    displayFormError(error.message);
    return;
  }

  elements.saveButton.disabled = true;
  try {
    const isEditing = editingProductId !== null;
    const url = isEditing
      ? `${PRODUCTS_URL}/${encodeURIComponent(editingProductId)}`
      : PRODUCTS_URL;
    const payload = await requestJson(url, {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(body),
    });

    elements.dialog.close();
    showStatus(payload.message || (isEditing ? "Product updated successfully." : "Product created successfully."), false, true);
    await loadProducts({ quiet: true });
  } catch (error) {
    displayFormError(error.message || "Unable to save product.");
  } finally {
    elements.saveButton.disabled = false;
  }
}

async function deleteProduct(product) {
  const confirmed = window.confirm(
    `Delete "${product.name}" (${product.sku})? This cannot be undone.`
  );
  if (!confirmed) return;

  try {
    const payload = await requestJson(
      `${PRODUCTS_URL}/${encodeURIComponent(product.id)}`,
      { method: "DELETE" }
    );
    showStatus(payload.message || "Product deleted successfully.", false, true);
    await loadProducts({ quiet: true });
  } catch (error) {
    showStatus(error.message || "Unable to delete product.", true);
  }
}

function closeDialog() {
  elements.dialog.close();
  elements.categorySelect.disabled = false;
}

elements.addButton.addEventListener("click", openCreateForm);
elements.search.addEventListener("input", renderProducts);
elements.form.addEventListener("submit", saveProduct);
elements.closeButton.addEventListener("click", closeDialog);
elements.cancelButton.addEventListener("click", closeDialog);
elements.dialog.addEventListener("close", () => {
  elements.categorySelect.disabled = false;
});
document.querySelectorAll(".nav-link[aria-disabled='true']").forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});

window.StocklyAuth.ready.then((authenticated) => {
  if (authenticated) loadProducts();
});

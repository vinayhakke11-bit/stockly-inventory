"use strict";

const PURCHASES_URL = "/api/purchases";
const SUPPLIERS_URL = "/api/suppliers";
const PRODUCTS_URL = "/api/products";
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
  body: document.getElementById("purchases-body"),
  status: document.getElementById("purchase-status"),
  newButton: document.getElementById("new-purchase-button"),
  dialog: document.getElementById("purchase-dialog"),
  form: document.getElementById("purchase-form"),
  formMessage: document.getElementById("purchase-form-message"),
  dialogTitle: document.getElementById("purchase-dialog-title"),
  formHint: document.getElementById("purchase-form-hint"),
  supplierSelect: document.querySelector("#purchase-form [name='supplier_id']"),
  itemRows: document.getElementById("purchase-item-rows"),
  addItemButton: document.getElementById("add-purchase-item"),
  purchaseTotal: document.getElementById("purchase-total"),
  saveButton: document.getElementById("save-purchase-button"),
  detailDialog: document.getElementById("purchase-detail-dialog"),
  detailMessage: document.getElementById("purchase-detail-message"),
  detailItems: document.getElementById("purchase-detail-items"),
};

let purchases = [];
let suppliers = [];
let products = [];
let loading = false;
let referenceError = "";
let editingPurchaseId = null;

function showStatus(message, isError = false, isSuccess = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
  elements.status.classList.toggle("is-success", isSuccess);
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
    const error = new Error("Your session has expired. Please sign in again.");
    error.statusCode = 401;
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error(response.ok
      ? "The server returned an invalid response."
      : `Request failed (${response.status}).`);
    error.statusCode = response.status;
    throw error;
  }

  if (!response.ok || payload.status === "error") {
    const error = new Error(payload.message || `Request failed (${response.status}).`);
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

function money(value) {
  if (value === null || value === undefined || value === "") return "—";
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

function purchaseTotal(items) {
  return (items || []).reduce(
    (total, item) => total + Number(item.quantity) * Number(item.unit_cost),
    0
  );
}

function emptyPurchaseRow(message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.className = "empty-cell";
  cell.colSpan = 6;
  cell.textContent = message;
  row.append(cell);
  elements.body.replaceChildren(row);
}

function renderPurchases() {
  if (loading) {
    emptyPurchaseRow("Loading purchases…");
    return;
  }
  if (purchases.length === 0) {
    emptyPurchaseRow("No purchases yet. Create a draft when you place a supplier order.");
    return;
  }

  const rows = purchases.map((purchase) => {
    const row = document.createElement("tr");
    const idCell = addCell(row, `#${purchase.id}`, "id-cell");
    idCell.setAttribute("aria-label", `Purchase ${purchase.id}`);
    addCell(row, purchase.supplier_name);

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge status-badge-${purchase.status}`;
    badge.textContent = purchase.status || "unknown";
    statusCell.append(badge);
    row.append(statusCell);

    addCell(
      row,
      purchase.items ? money(purchaseTotal(purchase.items)) : "Unavailable",
      "numeric"
    );
    addCell(row, displayDate(purchase.purchased_at));

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-heading";
    const actions = document.createElement("div");
    actions.className = "product-actions";
    actions.append(actionButton("Details", () => openPurchaseDetails(purchase.id)));
    if (purchase.status === "draft") {
      actions.append(
        actionButton("Edit", () => openEditForm(purchase.id)),
        actionButton("Receive", () => receivePurchase(purchase)),
        actionButton("Cancel", () => cancelPurchase(purchase), "table-action-danger")
      );
    }
    actionsCell.append(actions);
    row.append(actionsCell);
    return row;
  });

  elements.body.replaceChildren(...rows);
}

function actionButton(label, callback, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `table-action ${extraClass}`.trim();
  button.textContent = label;
  button.addEventListener("click", callback);
  return button;
}

async function loadPurchases({ quiet = false } = {}) {
  if (loading) return false;
  loading = true;
  renderPurchases();
  if (!quiet) showStatus("Loading purchases…");

  try {
    const payload = await requestJson(PURCHASES_URL);
    if (!Array.isArray(payload.data)) {
      throw new Error("The purchases response has an unexpected format.");
    }
    purchases = await Promise.all(payload.data.map(async (purchase) => {
      try {
        const detail = await requestJson(`${PURCHASES_URL}/${encodeURIComponent(purchase.id)}`);
        if (!detail.data || !Array.isArray(detail.data.items)) {
          throw new Error("The purchase details response has an unexpected format.");
        }
        return detail.data;
      } catch (error) {
        return { ...purchase, items: null, detailError: error.message };
      }
    }));

    loading = false;
    renderPurchases();
    const failedDetail = purchases.find((purchase) => purchase.detailError);
    if (failedDetail) {
      showStatus(`Some purchase totals could not be loaded: ${failedDetail.detailError}`, true);
      return false;
    }
    if (!quiet) {
      showStatus(`Loaded ${purchases.length} ${purchases.length === 1 ? "purchase" : "purchases"}.`);
    }
    return true;
  } catch (error) {
    purchases = [];
    loading = false;
    renderPurchases();
    emptyPurchaseRow(error.message || "Unable to load purchases.");
    showStatus(error.message || "Unable to load purchases.", true);
    return false;
  }
}

async function loadReferences() {
  referenceError = "";
  try {
    const [supplierPayload, productPayload] = await Promise.all([
      requestJson(SUPPLIERS_URL),
      requestJson(PRODUCTS_URL),
    ]);
    if (!Array.isArray(supplierPayload.data) || !Array.isArray(productPayload.data)) {
      throw new Error("The supplier or product response has an unexpected format.");
    }

    suppliers = supplierPayload.data;
    products = productPayload.data;
    elements.supplierSelect.replaceChildren(
      new Option("Select supplier", ""),
      ...suppliers.map((supplier) => new Option(supplier.name, String(supplier.id)))
    );
  } catch (error) {
    referenceError = error.message || "Unable to load suppliers and products.";
    throw error;
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

function addItemRow(item = null) {
  const row = document.createElement("tr");
  row.className = "purchase-entry-row";

  const productCell = document.createElement("td");
  const productSelect = document.createElement("select");
  productSelect.className = "purchase-product-select";
  productSelect.setAttribute("aria-label", "Product");
  productSelect.required = true;
  productSelect.append(new Option("Select product", ""));
  for (const product of products) {
    productSelect.append(new Option(`${product.name} (${product.sku})`, String(product.id)));
  }
  if (item) productSelect.value = String(item.product_id);
  productCell.append(productSelect);
  row.append(productCell);

  const quantityCell = document.createElement("td");
  quantityCell.className = "numeric";
  const quantityInput = document.createElement("input");
  quantityInput.type = "number";
  quantityInput.className = "purchase-quantity-input";
  quantityInput.setAttribute("aria-label", "Quantity");
  quantityInput.min = "0.001";
  quantityInput.max = "999999999.999";
  quantityInput.step = "0.001";
  quantityInput.required = true;
  if (item) quantityInput.value = String(item.quantity);
  quantityCell.append(quantityInput);
  row.append(quantityCell);

  const costCell = document.createElement("td");
  costCell.className = "numeric";
  const costInput = document.createElement("input");
  costInput.type = "number";
  costInput.className = "purchase-cost-input";
  costInput.setAttribute("aria-label", "Unit cost");
  costInput.min = "0";
  costInput.max = "9999999999.99";
  costInput.step = "0.01";
  costInput.required = true;
  if (item) costInput.value = String(item.unit_cost);
  costCell.append(costInput);
  row.append(costCell);

  const totalCell = document.createElement("td");
  totalCell.className = "numeric purchase-item-total";
  totalCell.textContent = "—";
  row.append(totalCell);

  const removeCell = document.createElement("td");
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "table-action table-action-danger purchase-remove-item";
  removeButton.textContent = "Remove";
  removeButton.setAttribute("aria-label", "Remove purchase item");
  removeCell.append(removeButton);
  row.append(removeCell);

  elements.itemRows.append(row);
  updateItemRows();
  return row;
}

function updateItemRows() {
  const rows = [...elements.itemRows.querySelectorAll(".purchase-entry-row")];
  const selectedIds = rows.map((row) => row.querySelector(".purchase-product-select").value);

  rows.forEach((row, index) => {
    const productSelect = row.querySelector(".purchase-product-select");
    for (const option of productSelect.options) {
      option.disabled = Boolean(
        option.value &&
        selectedIds.some((selectedId, selectedIndex) =>
          selectedIndex !== index && selectedId === option.value
        )
      );
    }

    const itemQuantity = Number(row.querySelector(".purchase-quantity-input").value);
    const unitCost = Number(row.querySelector(".purchase-cost-input").value);
    const itemTotal = row.querySelector(".purchase-item-total");
    itemTotal.textContent = Number.isFinite(itemQuantity * unitCost) &&
      row.querySelector(".purchase-quantity-input").value &&
      row.querySelector(".purchase-cost-input").value
      ? money(itemQuantity * unitCost)
      : "—";
  });

  const total = rows.reduce((sum, row) => {
    const itemQuantity = Number(row.querySelector(".purchase-quantity-input").value);
    const unitCost = Number(row.querySelector(".purchase-cost-input").value);
    return sum + (Number.isFinite(itemQuantity * unitCost) ? itemQuantity * unitCost : 0);
  }, 0);
  elements.purchaseTotal.textContent = money(total);
}

function getPurchasePayload() {
  const supplierId = elements.supplierSelect.value;
  if (!supplierId) throw new Error("Select a supplier.");

  const rows = [...elements.itemRows.querySelectorAll(".purchase-entry-row")];
  if (rows.length === 0) throw new Error("Add at least one purchase item.");

  const productIds = new Set();
  const items = rows.map((row, index) => {
    const productId = row.querySelector(".purchase-product-select").value;
    const itemQuantity = row.querySelector(".purchase-quantity-input").value.trim();
    const unitCost = row.querySelector(".purchase-cost-input").value.trim();
    if (!productId) throw new Error(`Select a product for item ${index + 1}.`);
    if (productIds.has(productId)) {
      throw new Error("A product can only appear once; combine its quantity.");
    }
    productIds.add(productId);
    if (!/^\d+(?:\.\d{1,3})?$/.test(itemQuantity) || Number(itemQuantity) <= 0 ||
        itemQuantity.split(".")[0].length > 9) {
      throw new Error(`Item ${index + 1} quantity must be greater than zero with up to 3 decimal places.`);
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(unitCost) ||
        unitCost.split(".")[0].length > 10) {
      throw new Error(`Item ${index + 1} unit cost must be non-negative with up to 2 decimal places.`);
    }
    return { product_id: productId, quantity: itemQuantity, unit_cost: unitCost };
  });

  if (suppliers.length === 0) throw new Error("No suppliers are available.");
  if (products.length === 0) throw new Error("No products are available.");
  return { supplier_id: supplierId, items };
}

async function openCreateForm() {
  editingPurchaseId = null;
  elements.form.reset();
  clearFormError();
  elements.itemRows.replaceChildren();
  elements.dialogTitle.textContent = "New purchase";
  elements.saveButton.textContent = "Save draft";
  elements.formHint.textContent = "New purchases are saved as drafts and do not change stock. Receive the purchase after goods arrive.";
  if (referenceError) {
    showFormError(`Could not load suppliers or products: ${referenceError}`);
  } else if (suppliers.length === 0 || products.length === 0) {
    showFormError("Add at least one supplier and one product before creating a purchase.");
  }
  addItemRow();
  elements.dialog.showModal();
  elements.supplierSelect.focus();
}

function resetPurchaseForm() {
  editingPurchaseId = null;
  elements.form.reset();
  elements.itemRows.replaceChildren();
  clearFormError();
  elements.dialogTitle.textContent = "New purchase";
  elements.saveButton.textContent = "Save draft";
  elements.formHint.textContent = "New purchases are saved as drafts and do not change stock. Receive the purchase after goods arrive.";
  elements.purchaseTotal.textContent = money(0);
}

async function openEditForm(purchaseId) {
  editingPurchaseId = String(purchaseId);
  elements.form.reset();
  elements.itemRows.replaceChildren();
  clearFormError();
  elements.dialogTitle.textContent = `Edit purchase #${purchaseId}`;
  elements.saveButton.textContent = "Save changes";
  elements.formHint.textContent = "Editing a draft does not change stock. Receive the purchase after goods arrive.";

  try {
    if (referenceError) {
      throw new Error(`Could not load suppliers or products: ${referenceError}`);
    }
    const payload = await requestJson(`${PURCHASES_URL}/${encodeURIComponent(purchaseId)}`);
    const purchase = payload.data;
    if (!purchase || !Array.isArray(purchase.items)) {
      throw new Error("The purchase details response has an unexpected format.");
    }
    if (purchase.status !== "draft") {
      throw new Error("Only draft purchases can be edited.");
    }

    elements.supplierSelect.value = String(purchase.supplier_id);
    for (const item of purchase.items) addItemRow(item);
    updateItemRows();
    elements.dialog.showModal();
  } catch (error) {
    resetPurchaseForm();
    if (error.statusCode === 401) return;
    showStatus(error.message || "Unable to load this purchase for editing.", true);
    if (error.statusCode === 404 || error.message === "Only draft purchases can be edited.") {
      await loadPurchases({ quiet: true });
    }
  }
}

async function savePurchase(event) {
  event.preventDefault();
  clearFormError();
  if (!elements.form.reportValidity()) return;

  let body;
  try {
    if (referenceError) throw new Error(`Could not load suppliers or products: ${referenceError}`);
    body = getPurchasePayload();
  } catch (error) {
    showFormError(error.message);
    return;
  }

  elements.saveButton.disabled = true;
  try {
    const isEditing = editingPurchaseId !== null;
    const url = isEditing
      ? `${PURCHASES_URL}/${encodeURIComponent(editingPurchaseId)}`
      : PURCHASES_URL;
    const payload = await requestJson(url, {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    elements.dialog.close();
    resetPurchaseForm();
    const refreshed = await loadPurchases({ quiet: true });
    if (isEditing && !refreshed) {
      showStatus("Purchase updated, but the list could not be refreshed. Reload the page to see the changes.", true);
    } else {
      showStatus(
        payload.message || (isEditing ? "Draft purchase updated successfully." : "Draft purchase created successfully."),
        false,
        true
      );
    }
  } catch (error) {
    const isEditing = editingPurchaseId !== null;
    if (isEditing && (error.statusCode === 404 || error.statusCode === 409)) {
      await loadPurchases({ quiet: true });
      const latestPurchase = purchases.find((purchase) => String(purchase.id) === editingPurchaseId);
      if (latestPurchase && latestPurchase.status !== "draft") {
        elements.dialog.close();
        resetPurchaseForm();
        showStatus(error.message || "This purchase is no longer a draft. The list has been refreshed.", true);
        return;
      }
    }
    showFormError(error.message || "Unable to create the purchase.");
  } finally {
    elements.saveButton.disabled = false;
  }
}

async function openPurchaseDetails(purchaseId) {
  elements.detailMessage.hidden = true;
  elements.detailItems.replaceChildren();
  elements.detailDialog.showModal();
  document.getElementById("purchase-detail-title").textContent = `Purchase #${purchaseId}`;
  document.getElementById("detail-supplier").textContent = "Loading…";
  document.getElementById("detail-status").textContent = "Loading…";
  document.getElementById("detail-date").textContent = "Loading…";
  document.getElementById("detail-total").textContent = "—";

  try {
    const payload = await requestJson(`${PURCHASES_URL}/${encodeURIComponent(purchaseId)}`);
    const purchase = payload.data;
    if (!purchase || !Array.isArray(purchase.items)) {
      throw new Error("The purchase details response has an unexpected format.");
    }
    document.getElementById("detail-supplier").textContent = purchase.supplier_name || "—";
    document.getElementById("detail-status").textContent = purchase.status || "—";
    document.getElementById("detail-date").textContent = displayDate(purchase.purchased_at);
    const rows = purchase.items.map((item) => {
      const row = document.createElement("tr");
      addCell(row, item.product_name);
      addCell(row, item.sku);
      addCell(row, quantity(item.quantity), "numeric");
      addCell(row, money(item.unit_cost), "numeric");
      addCell(row, money(Number(item.quantity) * Number(item.unit_cost)), "numeric");
      return row;
    });
    elements.detailItems.replaceChildren(...rows);
    document.getElementById("detail-total").textContent = money(purchaseTotal(purchase.items));
  } catch (error) {
    document.getElementById("detail-supplier").textContent = "—";
    document.getElementById("detail-status").textContent = "—";
    document.getElementById("detail-date").textContent = "—";
    elements.detailMessage.textContent = error.message || "Unable to load purchase details.";
    elements.detailMessage.hidden = false;
  }
}

async function receivePurchase(purchase) {
  if (purchase.status !== "draft") {
    showStatus("Only draft purchases can be received.", true);
    return;
  }
  if (!window.confirm(`Receive purchase #${purchase.id}? This will increase stock for its items.`)) return;

  try {
    const payload = await requestJson(
      `${PURCHASES_URL}/${encodeURIComponent(purchase.id)}/receive`,
      { method: "PUT" }
    );
    await loadPurchases({ quiet: true });
    try {
      await loadReferences();
      showStatus(payload.message || "Purchase received. Stock has been updated.", false, true);
    } catch (error) {
      showStatus(`Purchase received, but product data could not be refreshed: ${error.message}`, true);
    }
  } catch (error) {
    showStatus(error.message || "Unable to receive the purchase.", true);
  }
}

async function cancelPurchase(purchase) {
  if (purchase.status !== "draft") {
    showStatus("Only draft purchases can be cancelled.", true);
    return;
  }
  if (!window.confirm(`Cancel draft purchase #${purchase.id}? This cannot be undone.`)) return;

  try {
    const payload = await requestJson(
      `${PURCHASES_URL}/${encodeURIComponent(purchase.id)}`,
      { method: "DELETE" }
    );
    await loadPurchases({ quiet: true });
    showStatus(payload.message || "Draft purchase cancelled.", false, true);
  } catch (error) {
    showStatus(error.message || "Unable to cancel the purchase.", true);
  }
}

elements.newButton.addEventListener("click", openCreateForm);
elements.form.addEventListener("submit", savePurchase);
elements.addItemButton.addEventListener("click", addItemRow);
elements.itemRows.addEventListener("input", updateItemRows);
elements.itemRows.addEventListener("change", updateItemRows);
elements.itemRows.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".purchase-remove-item");
  if (!removeButton) return;
  const rows = elements.itemRows.querySelectorAll(".purchase-entry-row");
  if (rows.length <= 1) {
    showFormError("A purchase must contain at least one item.");
    return;
  }
  removeButton.closest(".purchase-entry-row").remove();
  clearFormError();
  updateItemRows();
});
document.getElementById("close-purchase-dialog").addEventListener("click", () => elements.dialog.close());
document.getElementById("cancel-purchase-form").addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("close", resetPurchaseForm);
document.getElementById("close-purchase-details").addEventListener("click", () => elements.detailDialog.close());
document.getElementById("close-purchase-details-button").addEventListener("click", () => elements.detailDialog.close());
document.querySelectorAll(".nav-link[aria-disabled='true']").forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});

async function initialize() {
  const results = await Promise.allSettled([loadPurchases(), loadReferences()]);
  const referenceResult = results[1];
  if (referenceResult.status === "rejected") {
    showStatus(`Could not load suppliers or products: ${referenceResult.reason.message}`, true);
  }
}

window.StocklyAuth.ready.then((authenticated) => {
  if (authenticated) initialize();
});

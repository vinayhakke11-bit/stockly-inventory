"use strict";

const PRODUCTS_URL = "/api/products";
const ADJUSTMENTS_URL = "/api/stock-adjustments";
const reasonLabels = {
  physical_count: "Physical stock count",
  damaged_goods: "Damaged goods",
  expired_goods: "Expired goods",
  lost_missing: "Lost or missing",
  found_stock: "Found stock",
  manual_correction: "Manual correction",
  other: "Other",
};
const quantityFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const elements = {
  status: document.getElementById("adjustment-status"),
  form: document.getElementById("adjustment-form"),
  product: document.getElementById("adjustment-product"),
  currentStock: document.getElementById("current-stock"),
  type: document.getElementById("adjustment-type"),
  quantity: document.getElementById("adjustment-quantity"),
  reason: document.getElementById("adjustment-reason"),
  note: document.getElementById("adjustment-note"),
  previewCurrent: document.getElementById("preview-current"),
  previewChange: document.getElementById("preview-change"),
  previewNew: document.getElementById("preview-new"),
  formMessage: document.getElementById("adjustment-form-message"),
  submit: document.getElementById("submit-adjustment"),
  historyBody: document.getElementById("history-body"),
  historyStatus: document.getElementById("history-status"),
  historySearch: document.getElementById("history-search"),
  historyFilter: document.getElementById("history-product-filter"),
  refresh: document.getElementById("refresh-history"),
};

let products = [];
let historyRows = [];
let productLoading = false;
let historyLoading = false;
let submitting = false;

function showStatus(element, message, isError = false, isSuccess = false) {
  element.textContent = message;
  element.classList.toggle("is-error", isError);
  element.classList.toggle("is-success", isSuccess);
}

function friendlyError(status, message) {
  if (status === 400) return message || "Check the adjustment details and try again.";
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403) return "You do not have permission to change stock.";
  if (status === 404) return "The selected product could not be found. Refresh the product list.";
  if (status === 409) return message || "This adjustment conflicts with the current stock.";
  if (status >= 500) return "Stockly could not complete the request. Please try again.";
  return message || "The request could not be completed.";
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
    throw new Error("Unable to connect to Stockly. Check your connection and try again.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(friendlyError(response.status));
  }

  if (!response.ok || payload.status === "error") {
    throw new Error(friendlyError(response.status, payload.message));
  }
  return payload;
}

function toThousandths(value) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

function formatThousandths(value) {
  return quantityFormatter.format(Number(value) / 1000);
}

function selectedProduct() {
  return products.find((product) => String(product.id) === elements.product.value) || null;
}

function setFormMessage(message) {
  elements.formMessage.textContent = message;
  elements.formMessage.hidden = !message;
}

function updatePreview() {
  const product = selectedProduct();
  const stock = product ? toThousandths(product.stock_on_hand) : null;
  const quantity = toThousandths(elements.quantity.value);

  elements.currentStock.value = stock === null ? "—" : formatThousandths(stock);
  elements.previewCurrent.textContent = stock === null ? "—" : formatThousandths(stock);
  elements.previewChange.textContent = "—";
  elements.previewNew.textContent = "—";
  if (stock === null || quantity === null || quantity === 0n) return;

  const increase = elements.type.value === "increase";
  const change = increase ? quantity : -quantity;
  const newStock = stock + change;
  elements.previewChange.textContent = `${increase ? "+" : "−"}${formatThousandths(quantity)}`;
  if (newStock < 0n) {
    elements.previewNew.textContent = "Insufficient stock";
    return;
  }
  elements.previewNew.textContent = formatThousandths(newStock);
}

function renderProductOptions() {
  const currentValue = elements.product.value;
  const productOptions = [
    new Option("Select a product", ""),
    ...products.map((product) => new Option(
      `${product.name} (${product.sku}) — ${quantityFormatter.format(Number(product.stock_on_hand))} in stock`,
      String(product.id)
    )),
  ];
  elements.product.replaceChildren(...productOptions);

  const filterValue = elements.historyFilter.value;
  elements.historyFilter.replaceChildren(
    new Option("All products", ""),
    ...products.map((product) => new Option(`${product.name} (${product.sku})`, String(product.id)))
  );
  if (products.some((product) => String(product.id) === filterValue)) {
    elements.historyFilter.value = filterValue;
  }

  const requestedProductId = new URLSearchParams(window.location.search).get("product_id");
  const nextValue = products.some((product) => String(product.id) === currentValue)
    ? currentValue
    : requestedProductId;
  if (nextValue && products.some((product) => String(product.id) === nextValue)) {
    elements.product.value = nextValue;
  }
  updatePreview();
}

async function loadProducts() {
  if (productLoading) return;
  productLoading = true;
  elements.product.disabled = true;
  showStatus(elements.status, "Loading products…");
  try {
    const payload = await requestJson(PRODUCTS_URL);
    if (!Array.isArray(payload.data)) {
      throw new Error("Stockly returned an unexpected product list.");
    }
    products = payload.data.filter((product) => product.is_active);
    renderProductOptions();
    showStatus(
      elements.status,
      products.length
        ? `Ready to adjust stock for ${products.length} active ${products.length === 1 ? "product" : "products"}.`
        : "No active products are available for stock adjustment."
    );
  } catch (error) {
    products = [];
    renderProductOptions();
    showStatus(elements.status, error.message || "Unable to load products.", true);
  } finally {
    productLoading = false;
    elements.product.disabled = false;
  }
}

function addCell(row, text, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text === null || text === undefined || text === "" ? "—" : String(text);
  row.append(cell);
  return cell;
}

function renderHistory() {
  const query = elements.historySearch.value.trim().toLocaleLowerCase();
  const productId = elements.historyFilter.value;
  const visibleRows = historyRows.filter((movement) => {
    if (productId && String(movement.product_id) !== productId) return false;
    const searchable = [
      movement.product_name,
      movement.sku,
      movement.reason,
      movement.note,
      movement.performed_by_username,
    ].join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  });

  if (historyLoading) {
    const row = document.createElement("tr");
    const cell = addCell(row, "Loading adjustment history…", "empty-cell");
    cell.colSpan = 7;
    elements.historyBody.replaceChildren(row);
    return;
  }
  if (!visibleRows.length) {
    const row = document.createElement("tr");
    const message = query || productId
      ? "No adjustments match these filters."
      : "No stock adjustments have been recorded yet.";
    const cell = addCell(row, message, "empty-cell");
    cell.colSpan = 7;
    elements.historyBody.replaceChildren(row);
    return;
  }

  const rows = visibleRows.map((movement) => {
    const row = document.createElement("tr");
    const date = new Date(movement.created_at);
    addCell(row, Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date));
    const productCell = addCell(row, movement.product_name || "—", "product-name-cell");
    if (movement.sku) {
      const sku = document.createElement("span");
      sku.className = "product-description";
      sku.textContent = movement.sku;
      productCell.append(sku);
    }
    const positive = Number(movement.quantity_change) > 0;
    const typeCell = addCell(row, positive ? "Increase" : "Decrease");
    typeCell.classList.add(positive ? "stock-adjustment-increase" : "stock-adjustment-decrease");
    const quantity = Number(movement.quantity_change);
    addCell(row, `${positive ? "+" : "−"}${quantityFormatter.format(Math.abs(quantity))}`, "numeric");
    addCell(row, reasonLabels[movement.reason] || movement.reason || "—");
    addCell(row, movement.note);
    addCell(row, movement.performed_by_username);
    return row;
  });
  elements.historyBody.replaceChildren(...rows);
}

async function loadHistory() {
  if (historyLoading) return;
  historyLoading = true;
  elements.refresh.disabled = true;
  renderHistory();
  showStatus(elements.historyStatus, "Loading adjustment history…");
  try {
    const filter = elements.historyFilter.value;
    const url = filter
      ? `${ADJUSTMENTS_URL}?product_id=${encodeURIComponent(filter)}`
      : ADJUSTMENTS_URL;
    const payload = await requestJson(url);
    if (!Array.isArray(payload.data)) {
      throw new Error("Stockly returned an unexpected adjustment history.");
    }
    historyRows = payload.data;
    showStatus(elements.historyStatus, `${historyRows.length} ${historyRows.length === 1 ? "adjustment" : "adjustments"} found.`);
  } catch (error) {
    historyRows = [];
    showStatus(elements.historyStatus, error.message || "Unable to load adjustment history.", true);
  } finally {
    historyLoading = false;
    elements.refresh.disabled = false;
    renderHistory();
  }
}

async function submitAdjustment(event) {
  if (submitting) return;
  event.preventDefault();
  setFormMessage("");
  if (!elements.form.reportValidity()) return;

  const product = selectedProduct();
  if (!product) {
    setFormMessage("Select an active product.");
    return;
  }
  const stock = toThousandths(product.stock_on_hand);
  const quantity = toThousandths(elements.quantity.value);
  if (stock === null || quantity === null || quantity <= 0n) {
    setFormMessage("Enter a quantity greater than zero with at most 3 decimal places.");
    return;
  }

  const increase = elements.type.value === "increase";
  const change = increase ? quantity : -quantity;
  const newStock = stock + change;
  if (newStock < 0n) {
    setFormMessage("The decrease cannot be greater than the current stock.");
    updatePreview();
    return;
  }

  const confirmation = `This will change ${product.name} stock from ${formatThousandths(stock)} to ${formatThousandths(newStock)}. Continue?`;
  if (!window.confirm(confirmation)) return;

  submitting = true;
  elements.submit.disabled = true;
  elements.product.disabled = true;
  elements.submit.textContent = "Saving…";
  try {
    const payload = await requestJson(ADJUSTMENTS_URL, {
      method: "POST",
      body: JSON.stringify({
        product_id: product.id,
        adjustment_type: elements.type.value,
        quantity: elements.quantity.value.trim(),
        reason: elements.reason.value,
        note: elements.note.value.trim() || null,
      }),
    });
    elements.quantity.value = "";
    elements.note.value = "";
    elements.reason.value = "";
    showStatus(elements.status, payload.message || "Stock adjustment recorded.", false, true);
    await loadProducts();
    await loadHistory();
  } catch (error) {
    setFormMessage(error.message || "Unable to save the stock adjustment.");
  } finally {
    submitting = false;
    elements.submit.disabled = false;
    elements.product.disabled = false;
    elements.submit.textContent = "Review adjustment";
    updatePreview();
  }
}

elements.form.addEventListener("submit", submitAdjustment);
elements.product.addEventListener("change", updatePreview);
elements.type.addEventListener("change", updatePreview);
elements.quantity.addEventListener("input", updatePreview);
elements.historySearch.addEventListener("input", renderHistory);
elements.historyFilter.addEventListener("change", loadHistory);
elements.refresh.addEventListener("click", async () => {
  await loadProducts();
  await loadHistory();
});

window.StocklyAuth.ready.then((authenticated) => {
  if (authenticated) {
    loadProducts();
    loadHistory();
  }
});

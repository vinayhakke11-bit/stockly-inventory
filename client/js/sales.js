"use strict";

const SALES_URL = "/api/sales";
const CUSTOMERS_URL = "/api/customers";
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
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const elements = {
  body: document.getElementById("sales-body"),
  status: document.getElementById("sale-status"),
  newButton: document.getElementById("new-sale-button"),
  dialog: document.getElementById("sale-dialog"),
  form: document.getElementById("sale-form"),
  formMessage: document.getElementById("sale-form-message"),
  customerSelect: document.querySelector("#sale-form [name='customer_id']"),
  itemRows: document.getElementById("sale-item-rows"),
  addItemButton: document.getElementById("add-sale-item"),
  total: document.getElementById("sale-total"),
  saveButton: document.getElementById("save-sale-button"),
  detailDialog: document.getElementById("sale-detail-dialog"),
  detailMessage: document.getElementById("sale-detail-message"),
  detailItems: document.getElementById("sale-detail-items"),
  detailActions: document.getElementById("sale-detail-actions"),
  actionStatus: document.getElementById("sale-action-status"),
  paymentSummary: document.getElementById("sale-payment-summary"),
  amountPaid: document.getElementById("detail-amount-paid"),
  outstanding: document.getElementById("detail-outstanding"),
  paymentStatus: document.getElementById("detail-payment-status"),
  paymentHistorySection: document.getElementById("payment-history-section"),
  paymentHistoryMessage: document.getElementById("payment-history-message"),
  paymentHistoryRows: document.getElementById("payment-history-rows"),
  initialPaymentSection: document.getElementById("initial-payment-section"),
  initialPaymentForm: document.getElementById("initial-payment-form"),
  initialPaymentAmount: document.getElementById("initial-payment-amount"),
  initialPaymentMethod: document.getElementById("initial-payment-method"),
  initialPaymentReference: document.getElementById("initial-payment-reference"),
  initialPaymentMessage: document.getElementById("initial-payment-message"),
  confirmSaleCompletion: document.getElementById("confirm-sale-completion"),
  laterPaymentSection: document.getElementById("later-payment-section"),
  laterPaymentForm: document.getElementById("later-payment-form"),
  laterPaymentAmount: document.getElementById("later-payment-amount"),
  laterPaymentMethod: document.getElementById("later-payment-method"),
  laterPaymentReference: document.getElementById("later-payment-reference"),
  laterPaymentMessage: document.getElementById("later-payment-message"),
  submitLaterPayment: document.getElementById("submit-later-payment"),
  receiptDialog: document.getElementById("receipt-dialog"),
  receiptMessage: document.getElementById("receipt-message"),
  receiptPaper: document.getElementById("receipt-paper"),
  receiptItems: document.getElementById("receipt-items"),
  receiptPayments: document.getElementById("receipt-payments"),
  receiptNoPayment: document.getElementById("receipt-no-payment"),
  printReceiptButton: document.getElementById("print-receipt"),
};

let sales = [];
let customers = [];
let products = [];
let loading = false;
let referenceError = "";
let editingSaleId = null;
let selectedSale = null;
let paymentRequestKeys = new Map();

function showStatus(message, isError = false, isSuccess = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
  elements.status.classList.toggle("is-success", isSuccess);
}

function paymentFormMessage(element, message) {
  element.textContent = message;
  element.hidden = !message;
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

  if (response.status === 401) {
    window.location.replace("./login.html");
    throw new Error("Your session has expired. Please sign in again.");
  }

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

function friendlyPaymentError(status, message = "") {
  const detail = message.toLowerCase();
  if (status === 400) {
    if (detail.includes("item") || detail.includes("sale")) {
      return "The sale could not be completed. Review the sale details and try again.";
    }
    return "Check the payment amount, method, and reference, then try again.";
  }
  if (status === 404) return "This sale could not be found. Refresh Sales and try again.";
  if (status === 409) {
    if (detail.includes("insufficient stock")) {
      return "There is not enough stock to complete this sale.";
    }
    if (detail.includes("exceed") || detail.includes("greater than the outstanding")) {
      return "That amount is greater than the remaining balance. Enter a lower amount.";
    }
    if (detail.includes("no outstanding balance")) {
      return "This sale has no outstanding balance. Refresh the sale details.";
    }
    if (detail.includes("idempotency")) {
      return "This payment request was already processed. Refresh the sale details.";
    }
    if (detail.includes("already been completed")) {
      return "This sale was already completed. Refresh the sale details.";
    }
    return "The payment could not be recorded. Refresh the sale details and try again.";
  }
  return "The request could not be completed. Please try again.";
}

async function requestPaymentJson(url, options = {}) {
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
    throw new Error("Your session has expired. Please sign in again.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(friendlyPaymentError(response.status));
  }
  if (!response.ok || payload.status === "error") {
    throw new Error(friendlyPaymentError(response.status, payload.message));
  }
  return payload;
}

function money(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? currencyFormatter.format(amount) : "—";
}

function cents(value) {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error("The server returned an invalid payment amount.");
  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = (match[3] || "").padEnd(2, "0");
  return sign * (BigInt(match[2]) * 100n + BigInt(fraction || "0"));
}

function moneyFromCents(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const formatted = `${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
  return `${negative ? "-" : ""}${money(formatted)}`;
}

function paymentRequestKey(scope, values) {
  const fingerprint = JSON.stringify(values);
  const existing = paymentRequestKeys.get(scope);
  if (existing?.fingerprint === fingerprint) return existing.key;
  if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
    throw new Error("Secure payment submission is not available in this browser.");
  }
  const key = window.crypto.randomUUID();
  paymentRequestKeys.set(scope, { fingerprint, key });
  return key;
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

function displayDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

function receiptMoney(value, currencyCode) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${String(value)} ${currencyCode}`;
  }
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

function lineTotal(itemQuantity, unitPrice) {
  const rawTotal = Number(itemQuantity) * Number(unitPrice);
  return Number.isFinite(rawTotal) ? Math.round((rawTotal + Number.EPSILON) * 100) / 100 : 0;
}

function saleTotal(items) {
  return items.reduce((total, item) =>
    total + lineTotal(item.quantity, item.unit_price), 0);
}

function showFormError(message) {
  elements.formMessage.textContent = message;
  elements.formMessage.hidden = false;
}

function clearFormError() {
  elements.formMessage.textContent = "";
  elements.formMessage.hidden = true;
}

function emptySaleRow(message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.className = "empty-cell";
  cell.colSpan = 6;
  cell.textContent = message;
  row.append(cell);
  elements.body.replaceChildren(row);
}

function actionButton(label, callback, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `table-action ${extraClass}`.trim();
  button.textContent = label;
  button.addEventListener("click", callback);
  return button;
}

function renderSales() {
  if (loading) {
    emptySaleRow("Loading sales…");
    return;
  }
  if (sales.length === 0) {
    emptySaleRow("No sales yet. Create a draft to record a customer purchase.");
    return;
  }

  const rows = sales.map((sale) => {
    const row = document.createElement("tr");
    const idCell = addCell(row, `#${sale.id}`, "id-cell");
    idCell.setAttribute("aria-label", `Sale ${sale.id}`);
    addCell(row, sale.customer_name || "Walk-in");

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge status-badge-${sale.status}`;
    badge.textContent = sale.status || "unknown";
    statusCell.append(badge);
    row.append(statusCell);

    addCell(row, money(sale.total), "numeric");
    addCell(row, displayDate(sale.created_at || sale.sold_at));

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-heading";
    const actions = document.createElement("div");
    actions.className = "product-actions";
    actions.append(actionButton("Details", () => openSaleDetails(sale.id)));
    actionsCell.append(actions);
    row.append(actionsCell);
    return row;
  });

  elements.body.replaceChildren(...rows);
}

async function loadSales({ quiet = false } = {}) {
  if (loading) return;
  loading = true;
  renderSales();
  if (!quiet) showStatus("Loading sales…");

  try {
    const payload = await requestJson(SALES_URL);
    if (!Array.isArray(payload.data)) {
      throw new Error("The sales response has an unexpected format.");
    }
    sales = payload.data;
    loading = false;
    renderSales();
    if (!quiet) {
      showStatus(`Loaded ${sales.length} ${sales.length === 1 ? "sale" : "sales"}.`);
    }
  } catch (error) {
    sales = [];
    loading = false;
    renderSales();
    emptySaleRow(error.message || "Unable to load sales.");
    showStatus(error.message || "Unable to load sales.", true);
  }
}

async function loadReferences() {
  referenceError = "";
  try {
    const [customerPayload, productPayload] = await Promise.all([
      requestJson(CUSTOMERS_URL),
      requestJson(PRODUCTS_URL),
    ]);
    if (!Array.isArray(customerPayload.data) || !Array.isArray(productPayload.data)) {
      throw new Error("The customer or product response has an unexpected format.");
    }
    customers = customerPayload.data;
    products = productPayload.data;
    elements.customerSelect.replaceChildren(
      new Option("Walk-in Customer", ""),
      ...customers.map((customer) => new Option(customer.name, String(customer.id)))
    );
  } catch (error) {
    referenceError = error.message || "Unable to load customers and products.";
    throw error;
  }
}

function addSaleItemRow(item = null) {
  const row = document.createElement("tr");
  row.className = "sale-entry-row";

  const productCell = document.createElement("td");
  const productSelect = document.createElement("select");
  productSelect.className = "sale-product-select";
  productSelect.setAttribute("aria-label", "Product");
  productSelect.required = true;
  productSelect.append(new Option("Select product", ""));
  for (const product of products) {
    if (!product.is_active && String(product.id) !== String(item?.product_id)) continue;
    const label = `${product.name} (${product.sku})`;
    productSelect.append(new Option(label, String(product.id)));
  }
  productSelect.value = item ? String(item.product_id) : "";
  productCell.append(productSelect);
  const stockHint = document.createElement("span");
  stockHint.className = "sale-stock-hint";
  stockHint.textContent = "Select a product to see stock.";
  productCell.append(stockHint);
  row.append(productCell);

  const quantityCell = document.createElement("td");
  quantityCell.className = "numeric";
  const quantityInput = document.createElement("input");
  quantityInput.type = "number";
  quantityInput.className = "sale-quantity-input";
  quantityInput.setAttribute("aria-label", "Quantity");
  quantityInput.min = "0.001";
  quantityInput.max = "999999999.999";
  quantityInput.step = "0.001";
  quantityInput.required = true;
  quantityInput.value = item?.quantity ?? "";
  quantityCell.append(quantityInput);
  row.append(quantityCell);

  const priceCell = document.createElement("td");
  priceCell.className = "numeric";
  const priceInput = document.createElement("input");
  priceInput.type = "number";
  priceInput.className = "sale-price-input";
  priceInput.setAttribute("aria-label", "Unit price");
  priceInput.min = "0";
  priceInput.max = "9999999999.99";
  priceInput.step = "0.01";
  priceInput.required = true;
  priceInput.value = item?.unit_price ?? "";
  priceCell.append(priceInput);
  row.append(priceCell);

  const totalCell = document.createElement("td");
  totalCell.className = "numeric sale-line-total";
  totalCell.textContent = "—";
  row.append(totalCell);

  const removeCell = document.createElement("td");
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "table-action table-action-danger sale-remove-item";
  removeButton.textContent = "Remove";
  removeButton.setAttribute("aria-label", "Remove sale item");
  removeCell.append(removeButton);
  row.append(removeCell);

  elements.itemRows.append(row);
  updateSaleItemRows();
  return row;
}

function updateSaleItemRows() {
  const rows = [...elements.itemRows.querySelectorAll(".sale-entry-row")];
  const selectedIds = rows.map((row) => row.querySelector(".sale-product-select").value);
  rows.forEach((row, index) => {
    const productSelect = row.querySelector(".sale-product-select");
    for (const option of productSelect.options) {
      option.disabled = Boolean(
        option.value &&
        selectedIds.some((selectedId, selectedIndex) =>
          selectedIndex !== index && selectedId === option.value
        )
      );
    }

    const product = products.find((entry) => String(entry.id) === productSelect.value);
    const stockHint = row.querySelector(".sale-stock-hint");
    if (product) {
      stockHint.textContent = `Available stock: ${quantity(product.stock_on_hand)}`;
      const priceInput = row.querySelector(".sale-price-input");
      if (productSelect.dataset.previousProduct !== productSelect.value && !priceInput.value) {
        priceInput.value = product.selling_price;
      }
      productSelect.dataset.previousProduct = productSelect.value;
    } else {
      stockHint.textContent = "Select a product to see stock.";
    }

    const itemQuantity = row.querySelector(".sale-quantity-input").value;
    const unitPrice = row.querySelector(".sale-price-input").value;
    row.querySelector(".sale-line-total").textContent =
      itemQuantity && unitPrice ? money(lineTotal(itemQuantity, unitPrice)) : "—";
  });

  const total = rows.reduce((sum, row) => {
    const itemQuantity = row.querySelector(".sale-quantity-input").value;
    const unitPrice = row.querySelector(".sale-price-input").value;
    return sum + (itemQuantity && unitPrice ? lineTotal(itemQuantity, unitPrice) : 0);
  }, 0);
  elements.total.textContent = money(total);
}

function buildSalePayload() {
  const customerId = elements.customerSelect.value;
  const rows = [...elements.itemRows.querySelectorAll(".sale-entry-row")];
  if (rows.length === 0) throw new Error("Add at least one sale item.");

  const productIds = new Set();
  const items = rows.map((row, index) => {
    const productId = row.querySelector(".sale-product-select").value;
    const itemQuantity = row.querySelector(".sale-quantity-input").value.trim();
    const unitPrice = row.querySelector(".sale-price-input").value.trim();
    if (!productId) throw new Error(`Select a product for item ${index + 1}.`);
    if (productIds.has(productId)) {
      throw new Error("A product can only appear once; combine its quantity.");
    }
    productIds.add(productId);
    if (!/^\d+(?:\.\d{1,3})?$/.test(itemQuantity) || Number(itemQuantity) <= 0 ||
        itemQuantity.split(".")[0].length > 9) {
      throw new Error(`Item ${index + 1} quantity must be greater than zero with up to 3 decimal places.`);
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(unitPrice) ||
        unitPrice.split(".")[0].length > 10) {
      throw new Error(`Item ${index + 1} unit price must be non-negative with up to 2 decimal places.`);
    }
    return { product_id: productId, quantity: itemQuantity, unit_price: unitPrice };
  });

  if (!products.some((product) => product.is_active)) {
    throw new Error("No active products are available for sale.");
  }
  if (customers.length === 0 && customerId) throw new Error("The selected customer is unavailable.");
  return { customer_id: customerId || null, items };
}

function resetSaleForm() {
  elements.form.reset();
  elements.itemRows.replaceChildren();
  clearFormError();
  addSaleItemRow();
}

async function openCreateForm() {
  editingSaleId = null;
  document.getElementById("sale-dialog-title").textContent = "New sale";
  elements.saveButton.textContent = "Save draft";
  resetSaleForm();
  if (referenceError) {
    showFormError(`Could not load customers or products: ${referenceError}`);
  } else if (!products.some((product) => product.is_active)) {
    showFormError("No active products are available for sale.");
  }
  elements.dialog.showModal();
  elements.customerSelect.focus();
}

async function openEditForm(sale) {
  editingSaleId = String(sale.id);
  document.getElementById("sale-dialog-title").textContent = `Edit sale #${sale.id}`;
  elements.saveButton.textContent = "Save changes";
  resetSaleForm();

  try {
    const payload = await requestJson(`${SALES_URL}/${encodeURIComponent(sale.id)}`);
    const details = payload.data;
    if (details.status !== "draft" || details.type !== "sale") {
      throw new Error("Only draft sales can be edited.");
    }
    elements.customerSelect.value = details.customer_id ? String(details.customer_id) : "";
    elements.itemRows.replaceChildren();
    for (const item of details.items) addSaleItemRow(item);
    updateSaleItemRows();
    elements.dialog.showModal();
  } catch (error) {
    editingSaleId = null;
    showStatus(error.message || "Unable to load this sale for editing.", true);
  }
}

async function saveSale(event) {
  event.preventDefault();
  clearFormError();
  if (!elements.form.reportValidity()) return;

  let body;
  try {
    if (referenceError) throw new Error(`Could not load customers or products: ${referenceError}`);
    body = buildSalePayload();
  } catch (error) {
    showFormError(error.message);
    return;
  }

  elements.saveButton.disabled = true;
  try {
    const isEditing = editingSaleId !== null;
    const url = isEditing
      ? `${SALES_URL}/${encodeURIComponent(editingSaleId)}`
      : SALES_URL;
    const payload = await requestJson(url, {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    const saleId = payload.data?.id || editingSaleId;
    elements.dialog.close();
    editingSaleId = null;
    await loadSales({ quiet: true });
    showStatus(payload.message || (isEditing ? "Sale updated successfully." : "Draft sale created successfully."), false, true);
    if (saleId) await openSaleDetails(saleId);
  } catch (error) {
    showFormError(error.message || "Unable to save the sale.");
  } finally {
    elements.saveButton.disabled = false;
  }
}

function setDetailActionStatus(message, isError = false, isSuccess = false) {
  elements.actionStatus.textContent = message;
  elements.actionStatus.classList.toggle("is-error", isError);
  elements.actionStatus.classList.toggle("is-success", isSuccess);
}

function renderPaymentHistory(payments, errorMessage = "") {
  elements.paymentHistoryRows.replaceChildren();
  elements.paymentHistoryMessage.textContent = errorMessage;
  if (errorMessage) return;

  if (payments.length === 0) {
    const row = document.createElement("tr");
    const cell = addCell(row, "No payments recorded.", "empty-cell");
    cell.colSpan = 4;
    elements.paymentHistoryRows.append(row);
    return;
  }

  const rows = payments.map((payment) => {
    const row = document.createElement("tr");
    const isRefund = payment.direction === "refunded";
    addCell(row, `${isRefund ? "Refund" : "Payment"}: ${money(payment.amount)}`, "numeric");
    addCell(row, paymentMethodLabel(payment.method));
    addCell(row, payment.reference || "—");
    addCell(row, displayDateTime(payment.paid_at));
    return row;
  });
  elements.paymentHistoryRows.replaceChildren(...rows);
}

function paymentMethodLabel(method) {
  const labels = {
    cash: "Cash",
    card: "Card",
    bank_transfer: "Bank transfer",
    mobile_money: "Mobile money",
    other: "Other",
  };
  return labels[method] || "—";
}

function getPaymentSummary(sale, payments, returns) {
  let netPaid = 0n;
  for (const payment of payments) {
    const amount = cents(payment.amount);
    if (payment.direction === "received") netPaid += amount;
    if (payment.direction === "refunded") netPaid -= amount;
  }
  const completedReturns = returns
    .filter((record) => record.status === "completed")
    .reduce((total, record) => total + cents(record.total), 0n);
  const outstanding = cents(sale.total) - completedReturns - netPaid;
  const status = outstanding <= 0n
    ? "Paid"
    : netPaid > 0n
      ? "Partially Paid"
      : "Unpaid";
  return { netPaid, outstanding, status };
}

function renderPaymentSummary(sale, paymentInfo) {
  const completedSale = sale.status === "completed" && sale.type === "sale";
  elements.paymentSummary.hidden = !completedSale;
  elements.paymentHistorySection.hidden = !completedSale;
  elements.laterPaymentSection.hidden = true;

  if (!completedSale) return null;
  if (!paymentInfo || paymentInfo.error) {
    elements.amountPaid.textContent = "Unavailable";
    elements.outstanding.textContent = "Unavailable";
    elements.paymentStatus.textContent = "Unavailable";
    elements.paymentStatus.className = "status-badge";
    renderPaymentHistory(
      paymentInfo?.payments || [],
      paymentInfo?.paymentError || (!paymentInfo?.payments
        ? "Payment details could not be loaded. Refresh and try again."
        : "")
    );
    return null;
  }

  renderPaymentHistory(paymentInfo.payments);
  const summary = getPaymentSummary(sale, paymentInfo.payments, paymentInfo.returns);
  elements.amountPaid.textContent = moneyFromCents(summary.netPaid);
  elements.outstanding.textContent = summary.outstanding < 0n
    ? `Customer credit: ${moneyFromCents(-summary.outstanding)}`
    : moneyFromCents(summary.outstanding);
  elements.paymentStatus.textContent = summary.status;
  elements.paymentStatus.className =
    `status-badge status-badge-payment-${summary.status.toLowerCase().replaceAll(" ", "-")}`;
  return summary;
}

function renderSaleDetails(sale, paymentInfo = null) {
  selectedSale = sale;
  document.getElementById("sale-detail-title").textContent = `Sale #${sale.id}`;
  document.getElementById("detail-customer").textContent = sale.customer_name || "Walk-in Customer";
  document.getElementById("detail-status").textContent = sale.status || "—";
  document.getElementById("detail-date").textContent = displayDate(sale.created_at || sale.sold_at);
  const rows = sale.items.map((item) => {
    const row = document.createElement("tr");
    addCell(row, item.product_name);
    addCell(row, item.sku);
    addCell(row, quantity(item.quantity), "numeric");
    addCell(row, money(item.unit_price), "numeric");
    addCell(row, money(item.line_total ?? lineTotal(item.quantity, item.unit_price)), "numeric");
    return row;
  });
  elements.detailItems.replaceChildren(...rows);
  document.getElementById("detail-total").textContent = money(sale.total);
  elements.initialPaymentSection.hidden = true;
  elements.initialPaymentMessage.textContent = "";
  elements.initialPaymentMessage.hidden = true;
  const paymentSummary = renderPaymentSummary(sale, paymentInfo);

  const actionButtons = [
    actionButton("Close", () => elements.detailDialog.close()),
  ];
  if (sale.status === "completed" && sale.type === "sale") {
    if (paymentSummary && paymentSummary.outstanding > 0n) {
      actionButtons.unshift(actionButton("Record Payment", showLaterPaymentForm));
    }
    actionButtons.unshift(
      actionButton("View Receipt", () => openReceipt(sale.id), "sale-receipt-button")
    );
  }
  if (sale.status === "draft") {
    actionButtons.unshift(
      actionButton("Cancel sale", () => cancelSale(sale), "table-action-danger"),
      actionButton("Edit", () => {
        elements.detailDialog.close();
        openEditForm(sale);
      }),
      actionButton("Complete sale", () => completeSale(sale), "sale-complete-button")
    );
  }
  elements.detailActions.replaceChildren(...actionButtons);
}

function showInitialPaymentForm() {
  elements.initialPaymentForm.reset();
  elements.initialPaymentMethod.value = "cash";
  elements.initialPaymentMessage.textContent = "";
  elements.initialPaymentMessage.hidden = true;
  elements.initialPaymentSection.hidden = false;
  elements.initialPaymentAmount.focus();
}

function showLaterPaymentForm() {
  elements.laterPaymentForm.reset();
  elements.laterPaymentMethod.value = "cash";
  elements.laterPaymentMessage.textContent = "";
  elements.laterPaymentMessage.hidden = true;
  elements.laterPaymentSection.hidden = false;
  elements.laterPaymentAmount.focus();
}

function normalizePaymentForm(form, amountInput, methodInput, referenceInput, optional, keyScope) {
  const amount = amountInput.value.trim();
  if (!amount && optional) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
    throw new Error("Enter a valid payment amount with up to 2 decimal places.");
  }
  if (cents(amount) === 0n && optional) return null;
  if (cents(amount) <= 0n) {
    throw new Error("Payment amount must be greater than zero.");
  }
  if (!methodInput.value) throw new Error("Choose a payment method.");
  if (!form.reportValidity()) throw new Error("Check the payment details and try again.");

  const reference = referenceInput.value.trim();
  const payment = {
    amount,
    method: methodInput.value,
    reference: reference || null,
  };
  return {
    ...payment,
    idempotency_key: paymentRequestKey(keyScope, payment),
  };
}

async function loadCompletedPaymentInfo(saleId) {
  const [paymentResult, returnResult] = await Promise.allSettled([
    requestPaymentJson(`${SALES_URL}/${encodeURIComponent(saleId)}/payments`),
    requestPaymentJson(`${SALES_URL}/${encodeURIComponent(saleId)}/returns`),
  ]);
  const payments = paymentResult.status === "fulfilled" &&
    Array.isArray(paymentResult.value.data)
    ? paymentResult.value.data
    : null;
  const returns = returnResult.status === "fulfilled" &&
    Array.isArray(returnResult.value.data)
    ? returnResult.value.data
    : null;

  if (!payments || !returns) {
    return {
      payments: payments || [],
      returns: returns || [],
      error: true,
      paymentError: payments
        ? ""
        : "Payment history could not be loaded. Refresh and try again.",
    };
  }
  return { payments, returns, error: false };
}

async function refreshSaleDetails(saleId) {
  const payload = await requestJson(`${SALES_URL}/${encodeURIComponent(saleId)}`);
  const sale = payload.data;
  if (!sale || !Array.isArray(sale.items)) {
    throw new Error("The sale details response has an unexpected format.");
  }
  const paymentInfo = sale.status === "completed" && sale.type === "sale"
    ? await loadCompletedPaymentInfo(sale.id)
    : null;
  renderSaleDetails(sale, paymentInfo);
  return sale;
}

function setReceiptMessage(message, isError = false) {
  elements.receiptMessage.textContent = message;
  elements.receiptMessage.hidden = !message;
  elements.receiptMessage.classList.toggle("is-error", isError);
}

function setReceiptText(id, value) {
  const element = document.getElementById(id);
  element.textContent = value === null || value === undefined ? "" : String(value);
  return element;
}

function renderReceipt(receipt) {
  const currencyCode = receipt.currency_code || "INR";
  const shopName = setReceiptText("receipt-shop-name", receipt.shop_name);
  shopName.hidden = !receipt.shop_name;
  const shopAddress = setReceiptText("receipt-shop-address", receipt.shop_address);
  shopAddress.hidden = !receipt.shop_address;
  const shopPhone = setReceiptText("receipt-shop-phone", receipt.shop_phone);
  shopPhone.hidden = !receipt.shop_phone;
  setReceiptText("receipt-number", `Receipt #${receipt.receipt_number}`);
  setReceiptText("receipt-date", displayDateTime(receipt.issued_at));
  setReceiptText("receipt-cashier", receipt.cashier_username || "—");

  const customerValues = [
    ["receipt-customer-name", receipt.customer_name],
    ["receipt-customer-phone", receipt.customer_phone],
    ["receipt-customer-email", receipt.customer_email],
    ["receipt-customer-address", receipt.customer_address],
  ];
  let hasCustomerDetails = false;
  for (const [id, value] of customerValues) {
    const element = setReceiptText(id, value);
    element.hidden = !value;
    if (value) hasCustomerDetails = true;
  }
  document.getElementById("receipt-customer-section").hidden = !hasCustomerDetails;

  const itemRows = receipt.items.map((item) => {
    const row = document.createElement("tr");
    const productCell = document.createElement("td");
    const productName = document.createElement("span");
    productName.className = "receipt-product-name";
    productName.textContent = item.product_name || "Item";
    productCell.append(productName);
    if (item.product_sku) {
      const sku = document.createElement("span");
      sku.className = "receipt-product-sku";
      sku.textContent = `SKU: ${item.product_sku}`;
      productCell.append(sku);
    }
    row.append(productCell);
    addCell(row, quantity(item.quantity), "numeric");
    addCell(row, receiptMoney(item.unit_price, currencyCode), "numeric");
    addCell(row, receiptMoney(item.line_total, currencyCode), "numeric");
    return row;
  });
  elements.receiptItems.replaceChildren(...itemRows);
  setReceiptText("receipt-subtotal", receiptMoney(receipt.subtotal, currencyCode));
  setReceiptText("receipt-total", receiptMoney(receipt.total, currencyCode));
  setReceiptText("receipt-amount-paid", receiptMoney(receipt.amount_paid, currencyCode));
  setReceiptText("receipt-outstanding", receiptMoney(receipt.outstanding_amount, currencyCode));

  const paymentRows = (Array.isArray(receipt.payments) ? receipt.payments : []).map((payment) => {
    const item = document.createElement("li");
    const details = [payment.method, payment.reference].filter(Boolean).join(" · ");
    const paymentDate = payment.paid_at ? ` — ${displayDateTime(payment.paid_at)}` : "";
    item.textContent = `${details || "Payment"}: ${receiptMoney(payment.amount, currencyCode)}${paymentDate}`;
    return item;
  });
  elements.receiptPayments.replaceChildren(...paymentRows);
  elements.receiptNoPayment.textContent = paymentRows.length ? "" : "No payment recorded at issue.";
  elements.receiptNoPayment.hidden = paymentRows.length > 0;
  elements.receiptPaper.hidden = false;
  elements.printReceiptButton.disabled = false;
}

async function openReceipt(saleId) {
  elements.receiptPaper.hidden = true;
  elements.receiptItems.replaceChildren();
  elements.receiptPayments.replaceChildren();
  elements.printReceiptButton.disabled = true;
  setReceiptMessage("Loading receipt…");
  elements.receiptDialog.showModal();

  try {
    const response = await window.StocklyAuth.fetchWithCsrf(
      `${SALES_URL}/${encodeURIComponent(saleId)}/receipt`,
      { headers: { Accept: "application/json" } }
    );
    if (response.status === 401) {
      window.location.replace("./login.html");
      return;
    }
    if (response.status === 404) {
      setReceiptMessage("No receipt is available for this sale.", true);
      return;
    }
    if (!response.ok) {
      setReceiptMessage("Unable to load this receipt. Please try again.", true);
      return;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      setReceiptMessage("Unable to load this receipt. Please try again.", true);
      return;
    }
    const receipt = payload?.data;
    if (
      payload.status !== "success" ||
      !receipt ||
      !Array.isArray(receipt.items) ||
      !Array.isArray(receipt.payments)
    ) {
      setReceiptMessage("Unable to load this receipt. Please try again.", true);
      return;
    }

    renderReceipt(receipt);
    setReceiptMessage("");
  } catch {
    setReceiptMessage("Network error while loading the receipt. Check your connection and try again.", true);
  }
}

async function openSaleDetails(saleId) {
  elements.detailMessage.hidden = true;
  elements.detailItems.replaceChildren();
  elements.paymentSummary.hidden = true;
  elements.paymentHistorySection.hidden = true;
  elements.initialPaymentSection.hidden = true;
  elements.laterPaymentSection.hidden = true;
  setDetailActionStatus("");
  elements.detailDialog.showModal();
  document.getElementById("sale-detail-title").textContent = `Sale #${saleId}`;
  document.getElementById("detail-customer").textContent = "Loading…";
  document.getElementById("detail-status").textContent = "Loading…";
  document.getElementById("detail-date").textContent = "Loading…";
  document.getElementById("detail-total").textContent = "—";
  elements.detailActions.replaceChildren(actionButton("Close", () => elements.detailDialog.close()));

  try {
    await refreshSaleDetails(saleId);
  } catch (error) {
    selectedSale = null;
    elements.detailMessage.textContent = error.message || "Unable to load sale details.";
    elements.detailMessage.hidden = false;
  }
}

async function completeSale(sale) {
  if (sale.status !== "draft") {
    setDetailActionStatus("Only draft sales can be completed.", true);
    return;
  }
  showInitialPaymentForm();
}

async function submitSaleCompletion(event) {
  event.preventDefault();
  const sale = selectedSale;
  if (!sale || sale.status !== "draft") {
    paymentFormMessage(elements.initialPaymentMessage, "This draft is no longer available. Refresh Sales and try again.");
    return;
  }

  elements.initialPaymentMessage.hidden = true;
  let initialPayment;
  try {
    initialPayment = normalizePaymentForm(
      elements.initialPaymentForm,
      elements.initialPaymentAmount,
      elements.initialPaymentMethod,
      elements.initialPaymentReference,
      true,
      `initial-payment-${sale.id}`
    );
  } catch (error) {
    paymentFormMessage(elements.initialPaymentMessage, error.message);
    return;
  }

  if (!window.confirm(`Complete sale #${sale.id}? This will reduce stock for its items.`)) return;
  elements.confirmSaleCompletion.disabled = true;
  const body = initialPayment ? { initial_payment: initialPayment } : {};
  try {
    const payload = await requestPaymentJson(
      `${SALES_URL}/${encodeURIComponent(sale.id)}/complete`,
      { method: "PUT", body: JSON.stringify(body) }
    );
    paymentRequestKeys.delete(`initial-payment-${sale.id}`);
    elements.initialPaymentForm.reset();
    elements.initialPaymentSection.hidden = true;
    await Promise.allSettled([
      loadSales({ quiet: true }),
      loadReferences(),
    ]);

    try {
      await refreshSaleDetails(sale.id);
      setDetailActionStatus(payload.message || "Sale completed successfully.", false, true);
    } catch {
      if (payload.data) renderSaleDetails(payload.data);
      setDetailActionStatus(
        "Sale completed, but payment details could not be refreshed. Reopen the sale to try again.",
        true
      );
    }
    showStatus(payload.message || "Sale completed successfully.", false, true);
  } catch (error) {
    paymentFormMessage(elements.initialPaymentMessage, error.message || "Unable to complete the sale.");
  } finally {
    elements.confirmSaleCompletion.disabled = false;
  }
}

async function submitLaterPayment(event) {
  event.preventDefault();
  if (!selectedSale || selectedSale.status !== "completed" || selectedSale.type !== "sale") {
    paymentFormMessage(elements.laterPaymentMessage, "This completed sale is unavailable. Refresh Sales and try again.");
    return;
  }

  elements.laterPaymentMessage.hidden = true;
  let payment;
  try {
    payment = normalizePaymentForm(
      elements.laterPaymentForm,
      elements.laterPaymentAmount,
      elements.laterPaymentMethod,
      elements.laterPaymentReference,
      false,
      `later-payment-${selectedSale.id}`
    );
  } catch (error) {
    paymentFormMessage(elements.laterPaymentMessage, error.message);
    return;
  }

  const saleId = String(selectedSale.id);
  elements.submitLaterPayment.disabled = true;
  try {
    const payload = await requestPaymentJson(
      `${SALES_URL}/${encodeURIComponent(saleId)}/payments`,
      { method: "POST", body: JSON.stringify(payment) }
    );
    paymentRequestKeys.delete(`later-payment-${saleId}`);
    elements.laterPaymentForm.reset();
    elements.laterPaymentMethod.value = "cash";
    elements.laterPaymentSection.hidden = true;
    try {
      await refreshSaleDetails(saleId);
      setDetailActionStatus(payload.message || "Payment recorded successfully.", false, true);
    } catch {
      setDetailActionStatus(
        "Payment recorded, but the updated balance could not be loaded. Reopen the sale to refresh it.",
        true
      );
    }
  } catch (error) {
    paymentFormMessage(elements.laterPaymentMessage, error.message || "Unable to record payment.");
  } finally {
    elements.submitLaterPayment.disabled = false;
  }
}

async function cancelSale(sale) {
  if (sale.status !== "draft") {
    setDetailActionStatus("Only draft sales can be cancelled.", true);
    return;
  }
  if (!window.confirm(`Cancel draft sale #${sale.id}? This cannot be undone.`)) return;

  try {
    const payload = await requestJson(
      `${SALES_URL}/${encodeURIComponent(sale.id)}`,
      { method: "DELETE" }
    );
    await loadSales({ quiet: true });
    showStatus(payload.message || "Draft sale cancelled.", false, true);
    elements.detailDialog.close();
  } catch (error) {
    setDetailActionStatus(error.message || "Unable to cancel the sale.", true);
  }
}

elements.newButton.addEventListener("click", openCreateForm);
elements.form.addEventListener("submit", saveSale);
elements.addItemButton.addEventListener("click", () => addSaleItemRow());
elements.itemRows.addEventListener("input", updateSaleItemRows);
elements.itemRows.addEventListener("change", (event) => {
  if (event.target.matches(".sale-product-select")) {
    const row = event.target.closest(".sale-entry-row");
    const product = products.find((entry) => String(entry.id) === event.target.value);
    row.querySelector(".sale-price-input").value = product?.selling_price ?? "";
  }
  updateSaleItemRows();
});
elements.itemRows.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".sale-remove-item");
  if (!removeButton) return;
  const rows = elements.itemRows.querySelectorAll(".sale-entry-row");
  if (rows.length <= 1) {
    showFormError("A sale must contain at least one item.");
    return;
  }
  removeButton.closest(".sale-entry-row").remove();
  clearFormError();
  updateSaleItemRows();
});
document.getElementById("close-sale-dialog").addEventListener("click", () => elements.dialog.close());
document.getElementById("cancel-sale-form").addEventListener("click", () => elements.dialog.close());
elements.initialPaymentForm.addEventListener("submit", submitSaleCompletion);
elements.laterPaymentForm.addEventListener("submit", submitLaterPayment);
document.getElementById("cancel-initial-payment").addEventListener("click", () => {
  elements.initialPaymentSection.hidden = true;
});
document.getElementById("cancel-later-payment").addEventListener("click", () => {
  elements.laterPaymentSection.hidden = true;
});
document.getElementById("close-sale-details").addEventListener("click", () => elements.detailDialog.close());
document.getElementById("close-sale-details-button").addEventListener("click", () => elements.detailDialog.close());
document.getElementById("close-receipt").addEventListener("click", () => elements.receiptDialog.close());
document.getElementById("close-receipt-button").addEventListener("click", () => elements.receiptDialog.close());
elements.printReceiptButton.addEventListener("click", () => window.print());
document.querySelectorAll(".nav-link[aria-disabled='true']").forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});

async function initialize() {
  const results = await Promise.allSettled([loadSales(), loadReferences()]);
  if (results[1].status === "rejected") {
    showStatus(`Could not load customers or products: ${results[1].reason.message}`, true);
  }

  const params = new URLSearchParams(window.location.search);
  const requestedSaleId = params.get("sale_id");
  if (!requestedSaleId) return;

  const sale = sales.find((item) => String(item.id) === requestedSaleId);
  if (!sale) {
    showStatus("The requested sale could not be found. Refresh Sales and try again.", true);
    return;
  }

  if (params.get("view") === "receipt") {
    if (sale.status !== "completed") {
      showStatus("A receipt is available after the sale is completed.", true);
      return;
    }
    await openReceipt(sale.id);
    return;
  }

  await openSaleDetails(sale.id);
}

window.StocklyAuth.ready.then((authenticated) => {
  if (authenticated) initialize();
});

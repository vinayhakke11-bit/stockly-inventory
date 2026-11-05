"use strict";

const SALES_URL = "/api/sales";
const RETURNS_URL = `${SALES_URL}/returns`;
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
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const elements = {
  body: document.getElementById("returns-body"),
  status: document.getElementById("returns-status"),
  refreshButton: document.getElementById("refresh-returns"),
  newButton: document.getElementById("new-return-button"),
  returnDialog: document.getElementById("return-dialog"),
  returnForm: document.getElementById("return-form"),
  saleSelect: document.getElementById("return-sale-select"),
  itemRows: document.getElementById("return-item-rows"),
  returnMessage: document.getElementById("return-form-message"),
  saveReturnButton: document.getElementById("save-return-button"),
  detailDialog: document.getElementById("return-detail-dialog"),
  detailTitle: document.getElementById("return-detail-title"),
  detailMessage: document.getElementById("return-detail-message"),
  originalSale: document.getElementById("detail-original-sale"),
  customer: document.getElementById("detail-return-customer"),
  returnStatus: document.getElementById("detail-return-status"),
  detailItems: document.getElementById("return-detail-items"),
  total: document.getElementById("detail-return-total"),
  completeButton: document.getElementById("complete-return-button"),
  refundsStatus: document.getElementById("refunds-status"),
  refundsBody: document.getElementById("refunds-body"),
  refundForm: document.getElementById("refund-form"),
  refundMessage: document.getElementById("refund-form-message"),
  submitRefundButton: document.getElementById("submit-refund-button"),
};

let returns = [];
let sales = [];
let loading = false;
let selectedReturnId = null;
let selectedSale = null;
let refundRequest = null;
let savingReturn = false;
let savingRefund = false;

function showStatus(message, isError = false, isSuccess = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
  elements.status.classList.toggle("is-success", isSuccess);
}

function showReturnMessage(message) {
  elements.returnMessage.textContent = message;
  elements.returnMessage.hidden = !message;
}

function showDetailMessage(message) {
  elements.detailMessage.textContent = message;
  elements.detailMessage.hidden = !message;
}

function showRefundMessage(message) {
  elements.refundMessage.textContent = message;
  elements.refundMessage.hidden = !message;
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
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

function safeError(status, message = "") {
  if (status === 400) {
    if (message.toLowerCase().includes("quantity")) {
      return "Check the return quantities. They must be valid and within the remaining amount sold.";
    }
    if (message.toLowerCase().includes("refund")) {
      return "Check the refund amount, method, and eligible balance.";
    }
    return message || "Check the return details and try again.";
  }
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to process returns or refunds.";
  if (status === 404) return "The sale or return could not be found. Refresh and try again.";
  if (status === 409) {
    if (message.toLowerCase().includes("refund")) {
      return "The refund exceeds the eligible amount, or this refund request conflicts with one already recorded.";
    }
    if (message.toLowerCase().includes("return")) {
      return "This return can no longer be changed. Refresh the returns list.";
    }
    return "This transaction changed and can no longer be processed. Refresh and try again.";
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
    throw new Error("Your session has expired. Please sign in again.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(safeError(response.status));
  }
  if (!response.ok || payload.status === "error") {
    throw new Error(safeError(response.status, payload.message));
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

function emptyReturns(message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.className = "empty-cell";
  cell.colSpan = 7;
  cell.textContent = message;
  row.append(cell);
  elements.body.replaceChildren(row);
}

function renderReturns() {
  if (loading) {
    emptyReturns("Loading returns…");
    return;
  }
  if (returns.length === 0) {
    emptyReturns("No returns yet. Create a return from a completed sale.");
    return;
  }

  const rows = returns.map((record) => {
    const row = document.createElement("tr");
    const idCell = addCell(row, `#${record.id}`);
    idCell.className = "id-cell";
    addCell(row, `#${record.original_sale_id}`);
    addCell(row, record.customer_name || "Walk-in Customer");

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge ${record.status === "completed" ? "status-badge-completed" : "status-badge-draft"}`;
    badge.textContent = record.status || "Unknown";
    statusCell.append(badge);
    row.append(statusCell);

    addCell(row, money(record.total), "numeric");
    addCell(row, displayDate(record.created_at || record.sold_at));
    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-heading";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "table-action";
    button.textContent = "Details";
    button.setAttribute("aria-label", `View return ${record.id}`);
    button.addEventListener("click", () => openReturnDetails(record.id));
    actionsCell.append(button);
    row.append(actionsCell);
    return row;
  });
  elements.body.replaceChildren(...rows);
}

async function loadReturns() {
  if (loading) return;
  loading = true;
  renderReturns();
  showStatus("Loading returns…");

  try {
    const salesPayload = await requestJson(SALES_URL);
    if (!Array.isArray(salesPayload.data)) {
      throw new Error("The sales response has an unexpected format.");
    }
    sales = salesPayload.data.filter(
      (sale) => sale.type === "sale" && sale.status === "completed"
    );
    const returnLists = await Promise.all(sales.map(async (sale) => {
      const payload = await requestJson(
        `${SALES_URL}/${encodeURIComponent(sale.id)}/returns`
      );
      if (!Array.isArray(payload.data)) {
        throw new Error("A sale returns response has an unexpected format.");
      }
      return payload.data.map((record) => ({
        ...record,
        customer_name: sale.customer_name,
      }));
    }));

    returns = returnLists.flat().sort((left, right) =>
      new Date(right.created_at || right.sold_at || 0) -
        new Date(left.created_at || left.sold_at || 0)
    );
    loading = false;
    renderReturns();
    showStatus(`Loaded ${returns.length} ${returns.length === 1 ? "return" : "returns"}.`);
  } catch (error) {
    returns = [];
    loading = false;
    renderReturns();
    showStatus(error.message || "Unable to load returns.", true);
  }
}

function clearReturnItems(message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.className = "empty-cell";
  cell.colSpan = 4;
  cell.textContent = message;
  row.append(cell);
  elements.itemRows.replaceChildren(row);
}

function renderSaleItems(items) {
  if (!items.length) {
    clearReturnItems("This sale has no items available to return.");
    return;
  }
  const rows = items.map((item) => {
    const row = document.createElement("tr");
    addCell(row, item.product_name);
    addCell(row, item.sku);
    addCell(row, quantity(item.quantity), "numeric");
    const inputCell = document.createElement("td");
    inputCell.className = "numeric";
    const input = document.createElement("input");
    input.className = "return-quantity-input";
    input.type = "number";
    input.min = "0";
    input.max = String(item.quantity);
    input.step = "0.001";
    input.inputMode = "decimal";
    input.value = "0";
    input.dataset.productId = String(item.product_id);
    input.setAttribute("aria-label", `Return quantity for ${item.product_name}`);
    inputCell.append(input);
    row.append(inputCell);
    return row;
  });
  elements.itemRows.replaceChildren(...rows);
}

async function openCreateReturn() {
  elements.returnForm.reset();
  showReturnMessage("");
  selectedSale = null;
  clearReturnItems("Select a completed sale to view its items.");
  elements.saleSelect.replaceChildren(new Option("Loading completed sales…", ""));
  elements.newButton.disabled = true;
  elements.returnDialog.showModal();

  try {
    const payload = await requestJson(SALES_URL);
    if (!Array.isArray(payload.data)) {
      throw new Error("The sales response has an unexpected format.");
    }
    sales = payload.data.filter(
      (sale) => sale.type === "sale" && sale.status === "completed"
    );
    elements.saleSelect.replaceChildren(
      new Option("Select a completed sale", ""),
      ...sales.map((sale) => new Option(
        `Sale #${sale.id} · ${sale.customer_name || "Walk-in"} · ${money(sale.total)}`,
        String(sale.id)
      ))
    );
    if (!sales.length) {
      showReturnMessage("There are no completed sales available for return.");
    }
  } catch (error) {
    elements.saleSelect.replaceChildren(new Option("Unable to load sales", ""));
    showReturnMessage(error.message || "Unable to load completed sales.");
  } finally {
    elements.newButton.disabled = false;
  }
}

async function loadSelectedSale() {
  const saleId = elements.saleSelect.value;
  selectedSale = null;
  showReturnMessage("");
  if (!saleId) {
    clearReturnItems("Select a completed sale to view its items.");
    return;
  }

  clearReturnItems("Loading sale items…");
  try {
    const payload = await requestJson(`${SALES_URL}/${encodeURIComponent(saleId)}`);
    const sale = payload.data;
    if (!sale || sale.type !== "sale" || sale.status !== "completed" || !Array.isArray(sale.items)) {
      throw new Error("Only completed sales with valid item details can be returned.");
    }
    selectedSale = sale;
    renderSaleItems(sale.items);
  } catch (error) {
    clearReturnItems(error.message || "Unable to load sale items.");
  }
}

async function createReturn(event) {
  event.preventDefault();
  if (savingReturn) return;
  showReturnMessage("");
  if (!selectedSale || !elements.saleSelect.value) {
    showReturnMessage("Select a completed sale first.");
    return;
  }

  const items = [];
  for (const input of elements.itemRows.querySelectorAll(".return-quantity-input")) {
    const value = input.value.trim();
    if (!value || Number(value) === 0) continue;
    if (!/^\d+(?:\.\d{1,3})?$/.test(value) || Number(value) <= 0) {
      showReturnMessage("Enter a positive return quantity with up to 3 decimal places.");
      input.focus();
      return;
    }
    items.push({ product_id: input.dataset.productId, quantity: value });
  }
  if (!items.length) {
    showReturnMessage("Enter a return quantity for at least one product.");
    return;
  }

  savingReturn = true;
  elements.saveReturnButton.disabled = true;
  elements.saveReturnButton.textContent = "Saving…";
  try {
    await requestJson(`${SALES_URL}/${encodeURIComponent(selectedSale.id)}/returns`, {
      method: "POST",
      body: JSON.stringify({ items }),
    });
    elements.returnDialog.close();
    await loadReturns();
    showStatus("Return draft created. Complete it after the returned goods are confirmed.", false, true);
  } catch (error) {
    showReturnMessage(error.message || "Unable to create the return.");
  } finally {
    savingReturn = false;
    elements.saveReturnButton.disabled = false;
    elements.saveReturnButton.textContent = "Save return draft";
  }
}

function renderReturnItems(items) {
  if (!items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "empty-cell";
    cell.textContent = "No return items.";
    row.append(cell);
    elements.detailItems.replaceChildren(row);
    return;
  }
  const rows = items.map((item) => {
    const row = document.createElement("tr");
    addCell(row, item.product_name);
    addCell(row, item.sku);
    addCell(row, quantity(item.quantity), "numeric");
    addCell(row, money(item.unit_price), "numeric");
    addCell(row, money(item.line_total), "numeric");
    return row;
  });
  elements.detailItems.replaceChildren(...rows);
}

function renderRefunds(refunds) {
  if (!refunds.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty-cell";
    cell.textContent = "No refunds recorded for this return.";
    row.append(cell);
    elements.refundsBody.replaceChildren(row);
    return;
  }

  const rows = refunds.map((refund) => {
    const row = document.createElement("tr");
    addCell(row, money(refund.amount));
    addCell(row, refund.method);
    addCell(row, refund.reference);
    addCell(row, displayDate(refund.paid_at || refund.created_at));
    return row;
  });
  elements.refundsBody.replaceChildren(...rows);
}

async function refreshReturnDetails(returnId) {
  const [detailPayload, refundsPayload] = await Promise.all([
    requestJson(`${RETURNS_URL}/${encodeURIComponent(returnId)}`),
    requestJson(`${RETURNS_URL}/${encodeURIComponent(returnId)}/refunds`),
  ]);
  const record = detailPayload.data;
  if (!record || String(record.id) !== String(returnId) || !Array.isArray(record.items) ||
      !Array.isArray(refundsPayload.data)) {
    throw new Error("The return details response has an unexpected format.");
  }

  elements.detailTitle.textContent = `Return #${record.id}`;
  elements.originalSale.textContent = `Sale #${record.original_sale_id}`;
  elements.customer.textContent = record.customer_name || "Walk-in Customer";
  elements.returnStatus.textContent = record.status || "Unknown";
  elements.total.textContent = money(record.total);
  renderReturnItems(record.items);
  renderRefunds(refundsPayload.data);
  elements.refundsStatus.textContent = `${refundsPayload.data.length} ${refundsPayload.data.length === 1 ? "refund" : "refunds"}.`;
  elements.completeButton.hidden = record.status !== "draft";
  elements.completeButton.disabled = false;
  elements.refundForm.hidden = record.status !== "completed";
  return record;
}

async function openReturnDetails(returnId) {
  selectedReturnId = String(returnId);
  refundRequest = null;
  showDetailMessage("");
  showRefundMessage("");
  elements.detailTitle.textContent = "Loading return…";
  elements.originalSale.textContent = "—";
  elements.customer.textContent = "—";
  elements.returnStatus.textContent = "—";
  elements.total.textContent = "—";
  elements.detailItems.replaceChildren();
  elements.refundsBody.replaceChildren();
  elements.refundsStatus.textContent = "Loading refunds…";
  elements.refundForm.reset();
  elements.refundForm.hidden = true;
  elements.completeButton.hidden = true;
  elements.detailDialog.showModal();

  try {
    await refreshReturnDetails(selectedReturnId);
  } catch (error) {
    showDetailMessage(error.message || "Unable to load return details.");
    elements.refundsStatus.textContent = "Unable to load refund history.";
  }
}

async function completeReturn() {
  if (!selectedReturnId || elements.completeButton.disabled) return;
  if (!window.confirm("Complete this return and restore the returned quantities to stock?")) return;

  elements.completeButton.disabled = true;
  showDetailMessage("");
  try {
    await requestJson(`${RETURNS_URL}/${encodeURIComponent(selectedReturnId)}/complete`, {
      method: "PUT",
    });
    await loadReturns();
    await refreshReturnDetails(selectedReturnId);
    showStatus("Return completed. Stock and customer credit were updated by Stockly.", false, true);
  } catch (error) {
    elements.completeButton.disabled = false;
    showDetailMessage(error.message || "Unable to complete the return.");
    await loadReturns();
  }
}

function makeRefundIdempotencyKey(fingerprint) {
  if (refundRequest && refundRequest.fingerprint === fingerprint) {
    return refundRequest.key;
  }
  if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
    throw new Error("This browser cannot securely prepare a refund request. Please use an up-to-date browser.");
  }
  refundRequest = {
    fingerprint,
    key: window.crypto.randomUUID(),
  };
  return refundRequest.key;
}

async function submitRefund(event) {
  event.preventDefault();
  if (savingRefund || !selectedReturnId) return;
  showRefundMessage("");
  const amount = elements.refundForm.elements.amount.value.trim();
  const method = elements.refundForm.elements.method.value;
  const reference = elements.refundForm.elements.reference.value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    showRefundMessage("Enter a refund amount greater than zero with up to 2 decimal places.");
    return;
  }
  if (reference.length > 100) {
    showRefundMessage("Reference must be 100 characters or fewer.");
    return;
  }

  const fingerprint = JSON.stringify({ amount, method, reference });
  let idempotencyKey;
  try {
    idempotencyKey = makeRefundIdempotencyKey(fingerprint);
  } catch (error) {
    showRefundMessage(error.message);
    return;
  }

  savingRefund = true;
  elements.submitRefundButton.disabled = true;
  elements.submitRefundButton.textContent = "Recording…";
  try {
    await requestJson(`${RETURNS_URL}/${encodeURIComponent(selectedReturnId)}/refunds`, {
      method: "POST",
      body: JSON.stringify({
        amount,
        method,
        reference: reference || null,
        idempotency_key: idempotencyKey,
      }),
    });
    refundRequest = null;
    elements.refundForm.reset();
    await refreshReturnDetails(selectedReturnId);
    showStatus("Refund recorded.", false, true);
  } catch (error) {
    showRefundMessage(error.message || "Unable to record the refund.");
  } finally {
    savingRefund = false;
    elements.submitRefundButton.disabled = false;
    elements.submitRefundButton.textContent = "Record refund";
  }
}

elements.refreshButton.addEventListener("click", loadReturns);
elements.newButton.addEventListener("click", openCreateReturn);
elements.saleSelect.addEventListener("change", loadSelectedSale);
elements.returnForm.addEventListener("submit", createReturn);
elements.refundForm.addEventListener("submit", submitRefund);
elements.completeButton.addEventListener("click", completeReturn);
document.getElementById("close-return-dialog").addEventListener("click", () => elements.returnDialog.close());
document.getElementById("cancel-return-form").addEventListener("click", () => elements.returnDialog.close());
document.getElementById("close-return-details").addEventListener("click", () => elements.detailDialog.close());
document.getElementById("close-return-details-button").addEventListener("click", () => elements.detailDialog.close());
document.querySelectorAll(".nav-link[aria-disabled='true']").forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});

window.StocklyAuth.ready.then((authenticated) => {
  if (authenticated) loadReturns();
});

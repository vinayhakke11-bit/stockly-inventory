"use strict";

const REPORTS_URL = "/api/reports";
const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const countFormatter = new Intl.NumberFormat("en-IN");
const quantityFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
const methodLabels = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  other: "Other",
};

const elements = {
  status: document.getElementById("report-status"),
  refresh: document.getElementById("refresh-reports"),
  periodButtons: [...document.querySelectorAll("[data-period]")],
  customRange: document.getElementById("custom-range"),
  from: document.getElementById("report-from"),
  to: document.getElementById("report-to"),
  applyRange: document.getElementById("apply-range"),
  dateNote: document.getElementById("report-date-note"),
  salesTotal: document.getElementById("report-sales-total"),
  salesNet: document.getElementById("report-sales-net"),
  salesCount: document.getElementById("report-sales-count"),
  salesCollected: document.getElementById("report-sales-collected"),
  salesCredit: document.getElementById("report-sales-credit"),
  purchaseCount: document.getElementById("report-purchase-count"),
  purchaseAllCount: document.getElementById("report-purchase-all-count"),
  purchaseTotal: document.getElementById("report-purchase-total"),
  paymentTotal: document.getElementById("report-payment-total"),
  paymentCount: document.getElementById("report-payment-count"),
  returnCount: document.getElementById("report-return-count"),
  returnQuantity: document.getElementById("report-return-quantity"),
  returnValue: document.getElementById("report-return-value"),
  refunds: document.getElementById("report-refunds"),
  productCount: document.getElementById("report-product-count"),
  stockQuantity: document.getElementById("report-stock-quantity"),
  lowStockCount: document.getElementById("report-low-stock"),
  outStockCount: document.getElementById("report-out-stock"),
  inventoryValue: document.getElementById("report-inventory-value"),
  paymentMethods: document.getElementById("report-payment-methods"),
  topProducts: document.getElementById("report-top-products"),
  lowStockProducts: document.getElementById("report-low-stock-products"),
};

let period = "today";
let requestVersion = 0;

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRange() {
  const today = new Date();
  const to = localDateString(today);
  if (period === "today") return { from: to, to, label: "today" };
  if (period === "last7") {
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 6);
    return { from: localDateString(fromDate), to, label: "the last 7 days" };
  }
  if (period === "month") {
    const fromDate = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: localDateString(fromDate), to, label: "this month" };
  }
  return {
    from: elements.from.value,
    to: elements.to.value,
    label: elements.from.value && elements.to.value
      ? `${elements.from.value} to ${elements.to.value}`
      : "the selected date range",
  };
}

function showStatus(message, isError = false, isSuccess = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
  elements.status.classList.toggle("is-success", isSuccess);
}

function friendlyError(status, message = "") {
  if (status === 400) return message || "Check the selected report dates and try again.";
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403) return "You do not have permission to view reports.";
  if (status === 404) return "The reports service is unavailable.";
  if (status >= 500) return "Stockly could not load reports. Please try again.";
  return message || "Unable to load reports.";
}

async function requestJson(url) {
  let response;
  try {
    response = await window.StocklyAuth.fetchWithCsrf(url, {
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("Unable to connect to Stockly. Check your connection and try again.");
  }

  if (response.status === 401) {
    window.location.replace("./login.html");
    throw new Error("Your session has expired. Sign in again to continue.");
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

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? currencyFormatter.format(amount) : "—";
}

function count(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? countFormatter.format(amount) : "—";
}

function quantity(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? quantityFormatter.format(amount) : "—";
}

function setLoading() {
  for (const element of [
    elements.salesTotal,
    elements.salesNet,
    elements.salesCount,
    elements.salesCollected,
    elements.salesCredit,
    elements.purchaseCount,
    elements.purchaseAllCount,
    elements.purchaseTotal,
    elements.paymentTotal,
    elements.paymentCount,
    elements.returnCount,
    elements.returnQuantity,
    elements.returnValue,
    elements.refunds,
    elements.productCount,
    elements.stockQuantity,
    elements.lowStockCount,
    elements.outStockCount,
    elements.inventoryValue,
  ]) {
    element.textContent = "…";
  }
  renderEmpty(elements.paymentMethods, 3, "Loading payment methods…");
  renderEmpty(elements.topProducts, 2, "Loading top-selling products…");
  renderEmpty(elements.lowStockProducts, 3, "Loading low-stock products…");
}

function renderEmpty(tbody, columns, message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.className = "empty-cell";
  cell.colSpan = columns;
  cell.textContent = message;
  row.append(cell);
  tbody.replaceChildren(row);
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

function renderTable(tbody, rows, columns, emptyMessage, renderRow) {
  if (!Array.isArray(rows) || rows.length === 0) {
    renderEmpty(tbody, columns, emptyMessage);
    return;
  }
  tbody.replaceChildren(...rows.map(renderRow));
}

function renderReports(data) {
  const sales = data.sales || {};
  const purchases = data.purchases || {};
  const payments = data.payments || {};
  const returns = data.returns || {};
  const inventory = data.inventory || {};

  elements.salesTotal.textContent = money(sales.total_sales);
  elements.salesNet.textContent = money(sales.net_sales);
  elements.salesCount.textContent = count(sales.completed_sale_count);
  elements.salesCollected.textContent = money(sales.payments_received);
  elements.salesCredit.textContent = money(sales.outstanding_customer_credit);
  elements.purchaseCount.textContent = count(purchases.received_purchase_count);
  elements.purchaseAllCount.textContent = count(purchases.total_purchase_count);
  elements.purchaseTotal.textContent = money(purchases.total_purchase_value);
  elements.paymentTotal.textContent = money(payments.payments_received);
  elements.paymentCount.textContent = count(payments.payment_count);
  elements.returnCount.textContent = count(returns.return_count);
  elements.returnQuantity.textContent = quantity(returns.returned_quantity);
  elements.returnValue.textContent = money(returns.returned_value);
  elements.refunds.textContent = money(returns.total_refunds);
  elements.productCount.textContent = count(inventory.product_count);
  elements.stockQuantity.textContent = quantity(inventory.total_stock_quantity);
  elements.lowStockCount.textContent = count(inventory.low_stock_count);
  elements.outStockCount.textContent = count(inventory.out_of_stock_count);
  elements.inventoryValue.textContent = money(inventory.retail_inventory_value);

  renderTable(
    elements.paymentMethods,
    payments.payment_methods,
    3,
    "No received payments in this period.",
    (method) => {
      const row = document.createElement("tr");
      addCell(row, methodLabels[method.method] || method.method);
      addCell(row, count(method.payment_count), "numeric");
      addCell(row, money(method.amount), "numeric");
      return row;
    }
  );
  renderTable(
    elements.topProducts,
    data.top_selling_products,
    2,
    "No completed product sales in this period.",
    (product) => {
      const row = document.createElement("tr");
      addCell(row, product.product_name);
      addCell(row, quantity(product.net_quantity_sold), "numeric");
      return row;
    }
  );
  renderTable(
    elements.lowStockProducts,
    inventory.low_stock_products,
    3,
    "No active products are currently low on stock.",
    (product) => {
      const row = document.createElement("tr");
      addCell(row, product.product_name);
      addCell(row, product.sku);
      addCell(row, quantity(product.stock_on_hand), "numeric");
      return row;
    }
  );
}

async function loadReports() {
  const requestId = ++requestVersion;
  const range = getRange();
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  const query = params.toString();
  const url = query ? `${REPORTS_URL}?${query}` : REPORTS_URL;

  elements.refresh.disabled = true;
  elements.applyRange.disabled = true;
  setLoading();
  showStatus("Loading reports…");
  elements.dateNote.textContent =
    `Financial activity for ${range.label}. Inventory figures are current and are not date-filtered.`;

  try {
    const payload = await requestJson(url);
    if (requestId !== requestVersion) return;
    if (!payload.data || typeof payload.data !== "object") {
      throw new Error("Stockly returned an unexpected reports response.");
    }
    renderReports(payload.data);
    showStatus("Reports are up to date.");
  } catch (error) {
    if (requestId !== requestVersion) return;
    renderEmpty(elements.paymentMethods, 3, "Report data could not be loaded.");
    renderEmpty(elements.topProducts, 2, "Report data could not be loaded.");
    renderEmpty(elements.lowStockProducts, 3, "Report data could not be loaded.");
    showStatus(error.message || "Unable to load reports.", true);
  } finally {
    if (requestId === requestVersion) {
      elements.refresh.disabled = false;
      elements.applyRange.disabled = false;
    }
  }
}

function selectPeriod(nextPeriod) {
  period = nextPeriod;
  for (const button of elements.periodButtons) {
    const selected = button.dataset.period === period;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  elements.customRange.hidden = period !== "custom";
  if (period !== "custom") loadReports();
}

elements.periodButtons.forEach((button) => {
  button.addEventListener("click", () => selectPeriod(button.dataset.period));
});
elements.applyRange.addEventListener("click", () => {
  if (!elements.from.value || !elements.to.value) {
    showStatus("Choose both a start date and an end date.", true);
    return;
  }
  if (elements.from.value > elements.to.value) {
    showStatus("Start date must be on or before end date.", true);
    return;
  }
  loadReports();
});
elements.refresh.addEventListener("click", loadReports);

document.querySelectorAll(".nav-link[aria-disabled='true']").forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});

window.StocklyAuth.ready.then((authenticated) => {
  if (authenticated) loadReports();
});

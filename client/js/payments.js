"use strict";

const PAYMENTS_URL = "/api/payments";
const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const methodLabels = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  other: "Other",
};

const elements = {
  status: document.getElementById("payment-status"),
  body: document.getElementById("payments-body"),
  search: document.getElementById("payment-search"),
  method: document.getElementById("payment-method"),
  from: document.getElementById("payment-date-from"),
  to: document.getElementById("payment-date-to"),
  count: document.getElementById("payment-result-count"),
  refresh: document.getElementById("refresh-payments"),
};

let payments = [];
let loading = false;
let requestVersion = 0;
let loadError = false;

function showStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
  elements.status.classList.remove("is-success");
}

function friendlyError(status, message = "") {
  if (status === 400) return message || "Check the payment filters and try again.";
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403) return "You do not have permission to view payment history.";
  if (status === 404) return "Payment history is unavailable.";
  if (status >= 500) return "Stockly could not load payment history. Please try again.";
  return message || "Unable to load payment history.";
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

function money(value, direction) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const formatted = currencyFormatter.format(amount);
  return direction === "refunded" ? `−${formatted}` : formatted;
}

function displayDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

function addCell(row, text, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text === null || text === undefined || text === ""
    ? "—"
    : String(text);
  row.append(cell);
  return cell;
}

function emptyRow(message) {
  const row = document.createElement("tr");
  const cell = addCell(row, message, "empty-cell");
  cell.colSpan = 9;
  elements.body.replaceChildren(row);
}

function filteredPayments() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  return payments.filter((payment) => {
    const searchable = [
      payment.id,
      payment.reference,
      payment.sale_id,
      payment.amount,
      payment.customer_name,
      payment.recorded_by,
      methodLabels[payment.method],
      payment.direction,
      payment.paid_at,
    ].join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  });
}

function renderPayments() {
  const visiblePayments = filteredPayments();
  elements.count.textContent =
    `${visiblePayments.length} ${visiblePayments.length === 1 ? "payment" : "payments"}`;

  if (loading) {
    emptyRow("Loading payment history…");
    return;
  }
  if (loadError) {
    emptyRow("Payment history could not be loaded. Use Refresh to try again.");
    return;
  }
  if (visiblePayments.length === 0) {
    emptyRow(payments.length
      ? "No payments match your search."
      : "No payments or refunds have been recorded yet.");
    return;
  }

  const rows = visiblePayments.map((payment) => {
    const row = document.createElement("tr");
    const paymentCell = addCell(row, "");
    const paymentId = document.createElement("strong");
    paymentId.textContent = `#${payment.id}`;
    paymentCell.append(paymentId);
    if (payment.reference) {
      const reference = document.createElement("span");
      reference.className = "payment-reference";
      reference.textContent = payment.reference;
      paymentCell.append(reference);
    }

    const saleCell = addCell(row, "");
    const saleLink = document.createElement("a");
    saleLink.className = "payment-related-link";
    saleLink.href = `./sales.html?sale_id=${encodeURIComponent(payment.sale_id)}`;
    saleLink.textContent = `Sale #${payment.sale_id}`;
    saleCell.append(saleLink);

    addCell(row, payment.customer_name || "Walk-in Customer");
    addCell(row, money(payment.amount, payment.direction), "numeric");
    addCell(row, methodLabels[payment.method] || payment.method || "—");

    const typeCell = addCell(row, "");
    const isRefund = payment.direction === "refunded";
    const typeBadge = document.createElement("span");
    typeBadge.className = `status-badge ${isRefund ? "status-badge-cancelled" : "status-badge-completed"}`;
    typeBadge.textContent = isRefund ? "Refund" : "Payment";
    typeCell.append(typeBadge);

    addCell(row, displayDateTime(payment.paid_at || payment.created_at));
    addCell(row, payment.recorded_by || `User #${payment.created_by}`);

    const relatedCell = addCell(row, "");
    relatedCell.className = "actions-heading";
    const receiptLink = document.createElement("a");
    receiptLink.className = "table-action payment-receipt-link";
    receiptLink.href = `./sales.html?sale_id=${encodeURIComponent(payment.sale_id)}&view=receipt`;
    receiptLink.textContent = "Receipt";
    receiptLink.setAttribute("aria-label", `View receipt for sale ${payment.sale_id}`);
    relatedCell.append(receiptLink);
    return row;
  });
  elements.body.replaceChildren(...rows);
}

function buildPaymentsUrl() {
  const params = new URLSearchParams();
  if (elements.method.value) params.set("method", elements.method.value);
  if (elements.from.value) params.set("from", elements.from.value);
  if (elements.to.value) params.set("to", elements.to.value);
  const query = params.toString();
  return query ? `${PAYMENTS_URL}?${query}` : PAYMENTS_URL;
}

async function loadPayments() {
  const currentRequest = ++requestVersion;
  loading = true;
  loadError = false;
  elements.refresh.disabled = true;
  renderPayments();
  showStatus("Loading payment history…");

  try {
    const payload = await requestJson(buildPaymentsUrl());
    if (currentRequest !== requestVersion) return;
    if (!Array.isArray(payload.data)) {
      throw new Error("Stockly returned an unexpected payment history.");
    }
    payments = payload.data;
    showStatus(`Loaded ${payments.length} ${payments.length === 1 ? "payment record" : "payment records"}.`);
  } catch (error) {
    if (currentRequest !== requestVersion) return;
    payments = [];
    loadError = true;
    showStatus(error.message || "Unable to load payment history.", true);
  } finally {
    if (currentRequest === requestVersion) {
      loading = false;
      elements.refresh.disabled = false;
      renderPayments();
    }
  }
}

elements.search.addEventListener("input", renderPayments);
elements.method.addEventListener("change", loadPayments);
elements.from.addEventListener("change", loadPayments);
elements.to.addEventListener("change", loadPayments);
elements.refresh.addEventListener("click", loadPayments);

document.querySelectorAll(".nav-link[aria-disabled='true']").forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});

window.StocklyAuth.ready.then((authenticated) => {
  if (authenticated) loadPayments();
});

"use strict";

const CUSTOMERS_URL = "/api/customers";
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

const elements = {
  body: document.getElementById("customers-body"),
  status: document.getElementById("customer-status"),
  search: document.getElementById("customer-search"),
  resultCount: document.getElementById("customer-result-count"),
  refreshButton: document.getElementById("refresh-customers"),
  addButton: document.getElementById("add-customer-button"),
  dialog: document.getElementById("customer-dialog"),
  form: document.getElementById("customer-form"),
  dialogTitle: document.getElementById("customer-dialog-title"),
  formMessage: document.getElementById("customer-form-message"),
  saveButton: document.getElementById("save-customer-button"),
  detailDialog: document.getElementById("customer-detail-dialog"),
  detailTitle: document.getElementById("customer-detail-title"),
  detailStatus: document.getElementById("customer-detail-status"),
  detailPhone: document.getElementById("detail-customer-phone"),
  detailEmail: document.getElementById("detail-customer-email"),
  detailAddress: document.getElementById("detail-customer-address"),
  outstanding: document.getElementById("detail-outstanding-credit"),
  totalDebit: document.getElementById("detail-total-debit"),
  totalCredit: document.getElementById("detail-total-credit"),
  historyBody: document.getElementById("customer-history-body"),
};

let customers = [];
let creditSummaries = new Map();
let loading = false;
let editingCustomerId = null;
let saving = false;

function showStatus(message, isError = false, isSuccess = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
  elements.status.classList.toggle("is-success", isSuccess);
}

function showDetailStatus(message, isError = false) {
  elements.detailStatus.textContent = message;
  elements.detailStatus.classList.toggle("is-error", isError);
}

function money(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? currencyFormatter.format(amount) : "—";
}

function displayDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
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
  cell.colSpan = 5;
  cell.textContent = message;
  row.append(cell);
  elements.body.replaceChildren(row);
}

function customerError(status, message = "") {
  if (status === 400) return message || "Check the customer details and try again.";
  if (status === 403) return "You do not have permission to manage customers.";
  if (status === 404) return "This customer could not be found. Refresh the list and try again.";
  if (status === 409) {
    if (message.toLowerCase().includes("delete")) {
      return "This customer has sales, payments, or credit history and cannot be deleted.";
    }
    return "A customer with these details already exists.";
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
    throw new Error(customerError(response.status));
  }

  if (!response.ok || payload.status === "error") {
    throw new Error(customerError(response.status, payload.message));
  }
  return payload;
}

function renderCustomers() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const visibleCustomers = customers.filter((customer) =>
    [customer.name, customer.phone, customer.email]
      .some((value) => String(value || "").toLocaleLowerCase().includes(query))
  );
  elements.resultCount.textContent =
    `${visibleCustomers.length} ${visibleCustomers.length === 1 ? "customer" : "customers"}`;

  if (loading) {
    emptyRow("Loading customers…");
    return;
  }
  if (visibleCustomers.length === 0) {
    emptyRow(query
      ? "No customers match your search."
      : "No customers yet. Add your first customer to get started.");
    return;
  }

  const rows = visibleCustomers.map((customer) => {
    const row = document.createElement("tr");
    const nameCell = addCell(row, customer.name);
    nameCell.className = "customer-name-cell";
    addCell(row, customer.phone);
    addCell(row, customer.email);
    const summary = creditSummaries.get(String(customer.id));
    addCell(
      row,
      summary ? money(summary.outstanding_balance) : "Unavailable",
      "numeric"
    );

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-heading";
    const actions = document.createElement("div");
    actions.className = "customer-actions";
    const detailsButton = document.createElement("button");
    detailsButton.type = "button";
    detailsButton.className = "table-action";
    detailsButton.textContent = "View credit";
    detailsButton.setAttribute("aria-label", `View credit for ${customer.name}`);
    detailsButton.addEventListener("click", () => openCustomerDetails(customer.id));

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "table-action";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", `Edit ${customer.name}`);
    editButton.addEventListener("click", () => openEditForm(customer.id));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "table-action table-action-danger";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${customer.name}`);
    deleteButton.addEventListener("click", () => deleteCustomer(customer));

    actions.append(detailsButton, editButton, deleteButton);
    actionsCell.append(actions);
    row.append(actionsCell);
    return row;
  });
  elements.body.replaceChildren(...rows);
}

async function loadCustomers({ quiet = false } = {}) {
  if (loading) return;
  loading = true;
  renderCustomers();
  if (!quiet) showStatus("Loading customers…");

  try {
    const payload = await requestJson(CUSTOMERS_URL);
    if (!Array.isArray(payload.data)) {
      throw new Error("The customer list response has an unexpected format.");
    }

    customers = payload.data;
    const summaries = await Promise.allSettled(customers.map(async (customer) => {
      const summaryPayload = await requestJson(
        `${CUSTOMERS_URL}/${encodeURIComponent(customer.id)}/credit`
      );
      if (!summaryPayload.data || String(summaryPayload.data.id) !== String(customer.id)) {
        throw new Error("A customer credit response has an unexpected format.");
      }
      return [String(customer.id), summaryPayload.data];
    }));

    creditSummaries = new Map();
    let failedSummaries = false;
    for (const result of summaries) {
      if (result.status === "fulfilled") {
        creditSummaries.set(...result.value);
      } else {
        failedSummaries = true;
      }
    }

    loading = false;
    renderCustomers();
    if (!quiet) {
      showStatus(failedSummaries
        ? "Customer list loaded, but some credit balances are unavailable. Refresh to try again."
        : `Loaded ${customers.length} ${customers.length === 1 ? "customer" : "customers"}.`,
      failedSummaries);
    }
    return true;
  } catch (error) {
    customers = [];
    creditSummaries.clear();
    loading = false;
    renderCustomers();
    showStatus(error.message || "Unable to load customers.", true);
    return false;
  }
}

function clearFormMessage() {
  elements.formMessage.textContent = "";
  elements.formMessage.hidden = true;
}

function showFormMessage(message) {
  elements.formMessage.textContent = message;
  elements.formMessage.hidden = false;
}

function resetForm() {
  editingCustomerId = null;
  saving = false;
  elements.form.reset();
  clearFormMessage();
  elements.saveButton.disabled = false;
  elements.saveButton.textContent = "Save customer";
}

function openCreateForm() {
  resetForm();
  elements.dialogTitle.textContent = "Add customer";
  elements.dialog.showModal();
  elements.form.elements.name.focus();
}

async function openEditForm(customerId) {
  resetForm();
  elements.dialogTitle.textContent = "Loading customer…";
  elements.saveButton.disabled = true;
  elements.dialog.showModal();

  try {
    const payload = await requestJson(`${CUSTOMERS_URL}/${encodeURIComponent(customerId)}`);
    const customer = payload.data;
    if (!customer || String(customer.id) !== String(customerId)) {
      throw new Error("The customer response has an unexpected format.");
    }

    editingCustomerId = String(customer.id);
    elements.form.elements.name.value = customer.name || "";
    elements.form.elements.phone.value = customer.phone || "";
    elements.form.elements.email.value = customer.email || "";
    elements.form.elements.address.value = customer.address || "";
    elements.dialogTitle.textContent = "Edit customer";
    elements.saveButton.textContent = "Save changes";
    elements.saveButton.disabled = false;
  } catch (error) {
    elements.dialog.close();
    showStatus(error.message || "Unable to load this customer.", true);
  }
}

function validateForm() {
  const name = elements.form.elements.name.value.trim();
  const phone = elements.form.elements.phone.value.trim();
  const email = elements.form.elements.email.value.trim();

  if (!name) return "Customer name is required.";
  if (name.length > 150) return "Customer name must be 150 characters or fewer.";
  if (phone) {
    const digits = phone.match(/\d/g) || [];
    if (!/^[+]?[\d\s().-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
      return "Enter a phone number with 7 to 15 digits.";
    }
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address.";
  }
  if (email.length > 255) return "Email must be 255 characters or fewer.";
  if (phone.length > 30) return "Phone must be 30 characters or fewer.";
  return "";
}

async function saveCustomer(event) {
  event.preventDefault();
  if (saving) return;
  clearFormMessage();
  const validationMessage = validateForm();
  if (validationMessage) {
    showFormMessage(validationMessage);
    return;
  }

  const customer = {
    name: elements.form.elements.name.value.trim(),
    phone: elements.form.elements.phone.value.trim() || null,
    email: elements.form.elements.email.value.trim() || null,
    address: elements.form.elements.address.value.trim() || null,
  };
  const isEditing = Boolean(editingCustomerId);
  const url = isEditing
    ? `${CUSTOMERS_URL}/${encodeURIComponent(editingCustomerId)}`
    : CUSTOMERS_URL;

  saving = true;
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = isEditing ? "Saving…" : "Adding…";
  try {
    await requestJson(url, {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(customer),
    });
    elements.dialog.close();
    resetForm();
    const refreshed = await loadCustomers({ quiet: true });
    if (refreshed) {
      showStatus(isEditing ? "Customer details updated." : "Customer added.", false, true);
    }
  } catch (error) {
    showFormMessage(error.message || "Unable to save the customer.");
    saving = false;
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = isEditing ? "Save changes" : "Save customer";
  }
}

async function deleteCustomer(customer) {
  if (!window.confirm(
    `Delete ${customer.name}? Customers with sales, payments, or credit history cannot be deleted.`
  )) {
    return;
  }

  try {
    await requestJson(`${CUSTOMERS_URL}/${encodeURIComponent(customer.id)}`, {
      method: "DELETE",
    });
    const refreshed = await loadCustomers({ quiet: true });
    if (refreshed) showStatus("Customer deleted.", false, true);
  } catch (error) {
    showStatus(error.message || "Unable to delete this customer.", true);
  }
}

function transactionLabel(transaction) {
  const labels = {
    sale_charge: "Sale charge",
    payment_received: "Customer payment",
    return_credit: "Return credit",
    refund: "Refund debit",
    adjustment: "Balance adjustment",
    opening_balance: "Opening balance",
  };
  const label = labels[transaction.entry_type] || "Credit transaction";
  return transaction.entry_type === "adjustment" || transaction.entry_type === "opening_balance"
    ? `${label} (${transaction.direction || "—"})`
    : label;
}

function renderTransactions(transactions) {
  if (!transactions.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-cell";
    cell.colSpan = 6;
    cell.textContent = "No credit transactions yet.";
    row.append(cell);
    elements.historyBody.replaceChildren(row);
    return;
  }

  const rows = transactions.map((transaction) => {
    const row = document.createElement("tr");
    addCell(row, displayDate(transaction.transaction_date));
    const typeCell = addCell(row, transactionLabel(transaction));
    typeCell.className = `customer-transaction-${transaction.direction === "debit" ? "debit" : "credit"}`;
    addCell(
      row,
      `${transaction.direction === "debit" ? "Debit" : "Credit"} · ${money(transaction.amount)}`
    );
    addCell(row, transaction.sale_id ? `Sale #${transaction.sale_id}` : "");
    const paymentDetail = [
      transaction.payment_reference,
      transaction.payment_method,
    ].filter(Boolean).join(" · ");
    addCell(row, paymentDetail);
    addCell(row, transaction.notes);
    return row;
  });
  elements.historyBody.replaceChildren(...rows);
}

async function openCustomerDetails(customerId) {
  elements.detailTitle.textContent = "Customer details";
  elements.detailPhone.textContent = "—";
  elements.detailEmail.textContent = "—";
  elements.detailAddress.textContent = "—";
  elements.outstanding.textContent = "—";
  elements.totalDebit.textContent = "—";
  elements.totalCredit.textContent = "—";
  elements.historyBody.replaceChildren();
  showDetailStatus("Loading account and credit history…");
  elements.detailDialog.showModal();

  try {
    const [summaryPayload, historyPayload] = await Promise.all([
      requestJson(`${CUSTOMERS_URL}/${encodeURIComponent(customerId)}/credit`),
      requestJson(`${CUSTOMERS_URL}/${encodeURIComponent(customerId)}/credit-transactions`),
    ]);
    const summary = summaryPayload.data;
    const transactions = historyPayload.data;
    if (!summary || String(summary.id) !== String(customerId) || !Array.isArray(transactions)) {
      throw new Error("The customer credit response has an unexpected format.");
    }

    elements.detailTitle.textContent = summary.name || "Customer details";
    elements.detailPhone.textContent = summary.phone || "Not provided";
    elements.detailEmail.textContent = summary.email || "Not provided";
    elements.detailAddress.textContent = summary.address || "Not provided";
    elements.outstanding.textContent = money(summary.outstanding_balance);
    elements.totalDebit.textContent = money(summary.total_debit);
    elements.totalCredit.textContent = money(summary.total_credit);
    renderTransactions(transactions);
    showDetailStatus(`${transactions.length} ${transactions.length === 1 ? "transaction" : "transactions"}.`);
  } catch (error) {
    elements.historyBody.replaceChildren();
    showDetailStatus(error.message || "Unable to load customer credit history.", true);
  }
}

elements.search.addEventListener("input", renderCustomers);
elements.refreshButton.addEventListener("click", () => loadCustomers());
elements.addButton.addEventListener("click", openCreateForm);
elements.form.addEventListener("submit", saveCustomer);
document.getElementById("close-customer-dialog").addEventListener("click", () => elements.dialog.close());
document.getElementById("cancel-customer-form").addEventListener("click", () => elements.dialog.close());
document.getElementById("close-customer-details").addEventListener("click", () => elements.detailDialog.close());
document.getElementById("close-customer-details-button").addEventListener("click", () => elements.detailDialog.close());

elements.dialog.addEventListener("close", resetForm);
document.querySelectorAll(".nav-link[aria-disabled='true']").forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});

window.StocklyAuth.ready.then((authenticated) => {
  if (authenticated) loadCustomers();
});

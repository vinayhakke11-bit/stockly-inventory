"use strict";

const SUPPLIERS_URL = "/api/suppliers";
const elements = {
  body: document.getElementById("suppliers-body"),
  status: document.getElementById("supplier-status"),
  search: document.getElementById("supplier-search"),
  resultCount: document.getElementById("supplier-result-count"),
  refreshButton: document.getElementById("refresh-suppliers"),
  addButton: document.getElementById("add-supplier-button"),
  dialog: document.getElementById("supplier-dialog"),
  form: document.getElementById("supplier-form"),
  dialogTitle: document.getElementById("supplier-dialog-title"),
  formMessage: document.getElementById("supplier-form-message"),
  saveButton: document.getElementById("save-supplier-button"),
  detailDialog: document.getElementById("supplier-detail-dialog"),
  detailTitle: document.getElementById("supplier-detail-title"),
  detailStatus: document.getElementById("supplier-detail-status"),
  detailPhone: document.getElementById("detail-supplier-phone"),
  detailEmail: document.getElementById("detail-supplier-email"),
  detailAddress: document.getElementById("detail-supplier-address"),
  detailActive: document.getElementById("detail-supplier-status"),
};

let suppliers = [];
let loading = false;
let editingSupplierId = null;
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

function supplierError(status, message = "") {
  if (status === 400) return message || "Check the supplier details and try again.";
  if (status === 403) return "You do not have permission to manage suppliers.";
  if (status === 404) return "This supplier could not be found. Refresh the list and try again.";
  if (status === 409) {
    if (message.toLowerCase().includes("delete") || message.toLowerCase().includes("purchases")) {
      return "This supplier has purchase history and cannot be deleted.";
    }
    return "A supplier with this name already exists.";
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
    throw new Error(supplierError(response.status));
  }

  if (!response.ok || payload.status === "error") {
    throw new Error(supplierError(response.status, payload.message));
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
  cell.colSpan = 6;
  cell.textContent = message;
  row.append(cell);
  elements.body.replaceChildren(row);
}

function renderSuppliers() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const visibleSuppliers = suppliers.filter((supplier) =>
    [supplier.name, supplier.phone, supplier.email, supplier.address]
      .some((value) => String(value || "").toLocaleLowerCase().includes(query))
  );
  elements.resultCount.textContent =
    `${visibleSuppliers.length} ${visibleSuppliers.length === 1 ? "supplier" : "suppliers"}`;

  if (loading) {
    emptyRow("Loading suppliers…");
    return;
  }
  if (visibleSuppliers.length === 0) {
    emptyRow(query
      ? "No suppliers match your search."
      : "No suppliers yet. Add your first supplier to get started.");
    return;
  }

  const rows = visibleSuppliers.map((supplier) => {
    const row = document.createElement("tr");
    const nameCell = addCell(row, supplier.name);
    nameCell.className = "customer-name-cell";
    addCell(row, supplier.phone);
    addCell(row, supplier.email);
    addCell(row, supplier.address);

    const statusCell = document.createElement("td");
    const isActive = supplier.is_active !== false;
    const badge = document.createElement("span");
    badge.className = `status-badge ${isActive ? "status-badge-completed" : "status-badge-inactive"}`;
    badge.textContent = isActive ? "Active" : "Inactive";
    statusCell.append(badge);
    row.append(statusCell);

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-heading";
    const actions = document.createElement("div");
    actions.className = "customer-actions";
    const detailsButton = document.createElement("button");
    detailsButton.type = "button";
    detailsButton.className = "table-action";
    detailsButton.textContent = "Details";
    detailsButton.setAttribute("aria-label", `View ${supplier.name}`);
    detailsButton.addEventListener("click", () => openSupplierDetails(supplier.id));

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "table-action";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", `Edit ${supplier.name}`);
    editButton.addEventListener("click", () => openEditForm(supplier.id));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "table-action table-action-danger";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${supplier.name}`);
    deleteButton.addEventListener("click", () => deleteSupplier(supplier));

    actions.append(detailsButton, editButton, deleteButton);
    actionsCell.append(actions);
    row.append(actionsCell);
    return row;
  });
  elements.body.replaceChildren(...rows);
}

async function loadSuppliers({ quiet = false } = {}) {
  if (loading) return false;
  loading = true;
  renderSuppliers();
  if (!quiet) showStatus("Loading suppliers…");

  try {
    const payload = await requestJson(SUPPLIERS_URL);
    if (!Array.isArray(payload.data)) {
      throw new Error("The supplier list response has an unexpected format.");
    }
    suppliers = payload.data;
    loading = false;
    renderSuppliers();
    if (!quiet) {
      showStatus(`Loaded ${suppliers.length} ${suppliers.length === 1 ? "supplier" : "suppliers"}.`);
    }
    return true;
  } catch (error) {
    suppliers = [];
    loading = false;
    renderSuppliers();
    showStatus(error.message || "Unable to load suppliers.", true);
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
  editingSupplierId = null;
  saving = false;
  elements.form.reset();
  clearFormMessage();
  elements.saveButton.disabled = false;
  elements.saveButton.textContent = "Save supplier";
}

function openCreateForm() {
  resetForm();
  elements.dialogTitle.textContent = "Add supplier";
  elements.dialog.showModal();
  elements.form.elements.name.focus();
}

async function openEditForm(supplierId) {
  resetForm();
  elements.dialogTitle.textContent = "Loading supplier…";
  elements.saveButton.disabled = true;
  elements.dialog.showModal();

  try {
    const payload = await requestJson(`${SUPPLIERS_URL}/${encodeURIComponent(supplierId)}`);
    const supplier = payload.data;
    if (!supplier || String(supplier.id) !== String(supplierId)) {
      throw new Error("The supplier response has an unexpected format.");
    }

    editingSupplierId = String(supplier.id);
    elements.form.elements.name.value = supplier.name || "";
    elements.form.elements.phone.value = supplier.phone || "";
    elements.form.elements.email.value = supplier.email || "";
    elements.form.elements.address.value = supplier.address || "";
    elements.dialogTitle.textContent = "Edit supplier";
    elements.saveButton.textContent = "Save changes";
    elements.saveButton.disabled = false;
  } catch (error) {
    elements.dialog.close();
    showStatus(error.message || "Unable to load this supplier.", true);
  }
}

function validateForm() {
  const name = elements.form.elements.name.value.trim();
  const phone = elements.form.elements.phone.value.trim();
  const email = elements.form.elements.email.value.trim();

  if (!name) return "Supplier name is required.";
  if (name.length > 150) return "Supplier name must be 150 characters or fewer.";
  if (phone) {
    const digits = phone.match(/\d/g) || [];
    if (!/^[+]?[\d\s().-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
      return "Enter a phone number with 7 to 15 digits.";
    }
  }
  if (phone.length > 30) return "Phone must be 30 characters or fewer.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address.";
  }
  if (email.length > 255) return "Email must be 255 characters or fewer.";
  return "";
}

async function saveSupplier(event) {
  event.preventDefault();
  if (saving) return;
  clearFormMessage();
  const validationMessage = validateForm();
  if (validationMessage) {
    showFormMessage(validationMessage);
    return;
  }

  const supplier = {
    name: elements.form.elements.name.value.trim(),
    phone: elements.form.elements.phone.value.trim() || null,
    email: elements.form.elements.email.value.trim() || null,
    address: elements.form.elements.address.value.trim() || null,
  };
  const isEditing = Boolean(editingSupplierId);
  const url = isEditing
    ? `${SUPPLIERS_URL}/${encodeURIComponent(editingSupplierId)}`
    : SUPPLIERS_URL;

  saving = true;
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = isEditing ? "Saving…" : "Adding…";
  try {
    await requestJson(url, {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(supplier),
    });
    elements.dialog.close();
    resetForm();
    const refreshed = await loadSuppliers({ quiet: true });
    if (refreshed) {
      showStatus(isEditing ? "Supplier details updated." : "Supplier added.", false, true);
    }
  } catch (error) {
    showFormMessage(error.message || "Unable to save the supplier.");
    saving = false;
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = isEditing ? "Save changes" : "Save supplier";
  }
}

async function deleteSupplier(supplier) {
  if (!window.confirm(
    `Delete ${supplier.name}? Suppliers referenced by purchase records cannot be deleted.`
  )) {
    return;
  }

  try {
    await requestJson(`${SUPPLIERS_URL}/${encodeURIComponent(supplier.id)}`, {
      method: "DELETE",
    });
    const refreshed = await loadSuppliers({ quiet: true });
    if (refreshed) showStatus("Supplier deleted.", false, true);
  } catch (error) {
    showStatus(error.message || "Unable to delete this supplier.", true);
  }
}

async function openSupplierDetails(supplierId) {
  elements.detailTitle.textContent = "Supplier details";
  elements.detailPhone.textContent = "—";
  elements.detailEmail.textContent = "—";
  elements.detailAddress.textContent = "—";
  elements.detailActive.textContent = "—";
  showDetailStatus("Loading supplier details…");
  elements.detailDialog.showModal();

  try {
    const payload = await requestJson(`${SUPPLIERS_URL}/${encodeURIComponent(supplierId)}`);
    const supplier = payload.data;
    if (!supplier || String(supplier.id) !== String(supplierId)) {
      throw new Error("The supplier response has an unexpected format.");
    }

    elements.detailTitle.textContent = supplier.name || "Supplier details";
    elements.detailPhone.textContent = supplier.phone || "Not provided";
    elements.detailEmail.textContent = supplier.email || "Not provided";
    elements.detailAddress.textContent = supplier.address || "Not provided";
    elements.detailActive.textContent = supplier.is_active === false ? "Inactive" : "Active";
    showDetailStatus("Supplier contact information.");
  } catch (error) {
    showDetailStatus(error.message || "Unable to load supplier details.", true);
  }
}

elements.search.addEventListener("input", renderSuppliers);
elements.refreshButton.addEventListener("click", () => loadSuppliers());
elements.addButton.addEventListener("click", openCreateForm);
elements.form.addEventListener("submit", saveSupplier);
document.getElementById("close-supplier-dialog").addEventListener("click", () => elements.dialog.close());
document.getElementById("cancel-supplier-form").addEventListener("click", () => elements.dialog.close());
document.getElementById("close-supplier-details").addEventListener("click", () => elements.detailDialog.close());
document.getElementById("close-supplier-details-button").addEventListener("click", () => elements.detailDialog.close());

elements.dialog.addEventListener("close", resetForm);
document.querySelectorAll(".nav-link[aria-disabled='true']").forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});

window.StocklyAuth.ready.then((authenticated) => {
  if (authenticated) loadSuppliers();
});

"use strict";

const SETTINGS_URL = "/api/settings/shop";
const elements = {
  status: document.getElementById("settings-status"),
  form: document.getElementById("settings-form"),
  message: document.getElementById("settings-form-message"),
  save: document.getElementById("save-settings"),
  reset: document.getElementById("reset-settings"),
};

let savedSettings = null;
let loading = false;
let saving = false;

function showStatus(message, isError = false, isSuccess = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
  elements.status.classList.toggle("is-success", isSuccess);
}

function showFormMessage(message) {
  elements.message.textContent = message;
  elements.message.hidden = !message;
}

function friendlyError(status, message = "") {
  if (status === 400) return message || "Check the shop information and try again.";
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403) return "Only the shop owner can update shop information.";
  if (status === 404) return "Shop settings are unavailable.";
  if (status >= 500) return "Stockly could not save shop information. Please try again.";
  return message || "The request could not be completed.";
}

async function requestJson(options = {}) {
  let response;
  try {
    response = await window.StocklyAuth.fetchWithCsrf(SETTINGS_URL, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Unable to connect to Stockly. Check your connection and try again.");
    }
    throw error;
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

function applySettings(settings) {
  elements.form.elements.name.value = settings.name || "";
  elements.form.elements.address.value = settings.address || "";
  elements.form.elements.phone.value = settings.phone || "";
}

function readSettingsResponse(payload) {
  const settings = payload && payload.data;
  if (!settings ||
      typeof settings.name !== "string" ||
      typeof settings.address !== "string" ||
      typeof settings.phone !== "string") {
    throw new Error("Stockly returned an unexpected shop settings response.");
  }
  return {
    name: settings.name,
    address: settings.address,
    phone: settings.phone,
  };
}

async function loadSettings() {
  if (loading) return;
  loading = true;
  elements.save.disabled = true;
  elements.reset.disabled = true;
  showStatus("Loading shop information…");

  try {
    const payload = await requestJson();
    savedSettings = readSettingsResponse(payload);
    applySettings(savedSettings);
    showStatus("Shop information loaded.");
  } catch (error) {
    showStatus(error.message || "Unable to load shop information.", true);
  } finally {
    loading = false;
    elements.save.disabled = false;
    elements.reset.disabled = false;
  }
}

function readForm() {
  const settings = {
    name: elements.form.elements.name.value.trim(),
    address: elements.form.elements.address.value.trim(),
    phone: elements.form.elements.phone.value.trim(),
  };
  if (!settings.name) throw new Error("Shop name is required.");
  if (settings.name.length > 150) throw new Error("Shop name must be 150 characters or fewer.");
  if (settings.address.length > 2000) throw new Error("Shop address must be 2000 characters or fewer.");
  if (settings.phone.length > 30) throw new Error("Phone number must be 30 characters or fewer.");
  return settings;
}

async function saveSettings(event) {
  event.preventDefault();
  if (saving || loading) return;
  showFormMessage("");

  let settings;
  try {
    if (!elements.form.reportValidity()) return;
    settings = readForm();
  } catch (error) {
    showFormMessage(error.message);
    return;
  }

  saving = true;
  elements.save.disabled = true;
  elements.reset.disabled = true;
  elements.save.textContent = "Saving…";
  try {
    const payload = await requestJson({
      method: "PUT",
      body: JSON.stringify(settings),
    });
    savedSettings = readSettingsResponse(payload);
    applySettings(savedSettings);
    showStatus(payload.message || "Shop information saved successfully.", false, true);
  } catch (error) {
    showFormMessage(error.message || "Unable to save shop information.");
    showStatus("Shop information was not saved.", true);
  } finally {
    saving = false;
    elements.save.disabled = false;
    elements.reset.disabled = false;
    elements.save.textContent = "Save changes";
  }
}

elements.form.addEventListener("submit", saveSettings);
elements.reset.addEventListener("click", () => {
  if (savedSettings) {
    applySettings(savedSettings);
    showFormMessage("");
    showStatus("Unsaved changes were reset.");
  } else {
    elements.form.reset();
  }
});

document.querySelectorAll(".nav-link[aria-disabled='true']").forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});

window.StocklyAuth.ready.then((authenticated) => {
  if (authenticated) loadSettings();
});

"use strict";

const AUTH_URL = "/api/auth";
const form = document.getElementById("login-form");
const identifierInput = document.getElementById("login-identifier");
const passwordInput = document.getElementById("login-password");
const passwordToggle = document.getElementById("toggle-password");
const submitButton = document.getElementById("login-button");
const message = document.getElementById("login-message");

function showMessage(text, isError = true) {
  message.textContent = text;
  message.hidden = !text;
  message.classList.toggle("is-error", isError);
  message.classList.toggle("is-success", !isError);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("Stockly returned an unexpected response.");
  }
}

async function checkExistingSession() {
  submitButton.disabled = true;
  submitButton.textContent = "Checking sign-in…";
  showMessage("Checking your sign-in…", false);

  try {
    const user = await window.StocklyAuth.getCurrentUser();
    if (user) {
      window.location.replace("./index.html");
      return;
    }
    showMessage("");
  } catch {
    showMessage("Unable to connect to Stockly. Check your connection and try again.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Sign in";
  }
}

async function submitLogin(event) {
  event.preventDefault();
  showMessage("");

  const identifier = identifierInput.value.trim();
  const password = passwordInput.value;
  if (!identifier || !password) {
    showMessage("Enter your username or email and password.");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Signing in…";

  try {
    const csrfToken = await window.StocklyAuth.getCsrfToken();
    const response = await fetch(`${AUTH_URL}/login`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ username: identifier, password }),
    });

    const payload = await readJson(response);
    if (response.status === 401) {
      showMessage("The username/email or password is incorrect.");
      return;
    }
    if (response.status === 403) {
      showMessage("Your sign-in request could not be verified. Please try again.");
      return;
    }
    if (!response.ok) {
      showMessage(
        response.status < 500 && payload.message
          ? payload.message
          : "Stockly could not sign you in. Please try again later."
      );
      return;
    }

    window.location.replace("./index.html");
  } catch {
    showMessage("Unable to reach Stockly. Check your connection and try again.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Sign in";
  }
}

passwordToggle.addEventListener("click", () => {
  const shouldShow = passwordInput.type === "password";
  passwordInput.type = shouldShow ? "text" : "password";
  passwordToggle.textContent = shouldShow ? "Hide" : "Show";
  passwordToggle.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
});

form.addEventListener("submit", submitLogin);
checkExistingSession();

"use strict";

const StocklyAuth = (() => {
  const AUTH_URL = "/api/auth";

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      throw new Error("Stockly returned an unexpected response.");
    }
  }

  async function getCurrentUser() {
    const response = await fetch(`${AUTH_URL}/me`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    if (response.status === 401) {
      return null;
    }
    if (!response.ok) {
      throw new Error("Unable to verify your sign-in. Please try again.");
    }

    const payload = await readJson(response);
    if (!payload.data?.user) {
      throw new Error("Stockly returned an unexpected sign-in response.");
    }
    return payload.data.user;
  }

  async function getCsrfToken() {
    const response = await fetch(`${AUTH_URL}/csrf-token`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const payload = await readJson(response);

    if (!response.ok || typeof payload.data?.csrfToken !== "string") {
      throw new Error("Unable to prepare a secure request. Please try again.");
    }
    return payload.data.csrfToken;
  }

  async function fetchWithCsrf(url, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const headers = { ...options.headers };

    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      headers["X-CSRF-Token"] = await getCsrfToken();
    }

    return fetch(url, {
      ...options,
      credentials: "same-origin",
      headers,
    });
  }

  async function logout() {
    const csrfToken = await getCsrfToken();
    const response = await fetch(`${AUTH_URL}/logout`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
      },
    });

    if (response.status === 401) {
      return;
    }
    if (!response.ok) {
      throw new Error("Could not log out. Please try again.");
    }
  }

  function showGuardError(message) {
    const status = document.querySelector(".page-status");
    if (status) {
      status.textContent = message;
      status.classList.add("is-error");
    }
  }

  function displayAccount(user) {
    const profile = document.querySelector("[data-auth-account]");
    if (!profile) return;

    const username = profile.querySelector("[data-auth-username]");
    const role = profile.querySelector("[data-auth-role]");
    const avatar = profile.querySelector("[data-auth-avatar]");
    if (username) username.textContent = user.username;
    if (role) {
      role.textContent = typeof user.role === "string"
        ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
        : "";
    }
    if (avatar) {
      const name = typeof user.username === "string" ? user.username.trim() : "";
      const parts = name.split(/[\s._-]+/).filter(Boolean);
      avatar.textContent = parts.length > 1
        ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
        : name.slice(0, 2).toUpperCase();
    }
    profile.setAttribute("aria-label", `${user.username}, ${role ? role.textContent : ""}`);
  }

  async function protectPage() {
    let revealPage = true;
    try {
      const user = await getCurrentUser();
      if (!user) {
        revealPage = false;
        window.location.replace("./login.html");
        return false;
      }

      displayAccount(user);
      document.querySelectorAll("[data-auth-logout]").forEach((button) => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await logout();
            window.location.replace("./login.html");
          } catch (error) {
            window.alert(error.message);
            button.disabled = false;
          }
        });
      });

      return true;
    } catch (error) {
      showGuardError(error.message);
      return false;
    } finally {
      if (revealPage) document.body.classList.remove("auth-pending");
    }
  }

  const ready = document.body.dataset.authGuard === "true"
    ? protectPage()
    : Promise.resolve(true);

  return { ready, getCurrentUser, getCsrfToken, fetchWithCsrf };
})();

window.StocklyAuth = StocklyAuth;

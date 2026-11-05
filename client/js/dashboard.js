"use strict";

const API_URL = "/api/dashboard";
const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const decimalFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const quantityFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 3,
});
const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const elements = {
  status: document.getElementById("page-status"),
  refreshButton: document.getElementById("refresh-button"),
  productCount: document.getElementById("product-count"),
  activeProductCount: document.getElementById("active-product-count"),
  totalStock: document.getElementById("total-stock-quantity"),
  lowStockCount: document.getElementById("low-stock-count"),
  inventoryValue: document.getElementById("retail-inventory-value"),
  netSales: document.getElementById("net-sales"),
  salesBreakdown: document.getElementById("sales-breakdown"),
  purchases: document.getElementById("today-purchases"),
  outstandingBalance: document.getElementById("outstanding-balance"),
  lowStockPanel: document.getElementById("low-stock-panel"),
  lowStockMessage: document.getElementById("low-stock-message"),
  recentSales: document.getElementById("recent-sales-body"),
  stockMovements: document.getElementById("stock-movements-body"),
  topProducts: document.getElementById("top-products-body"),
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "—";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return "—";

  const isNegative = match[1] === "-";
  const formattedWhole = currencyFormatter.formatToParts(BigInt(match[2]));
  const fraction = (match[3] || "").padEnd(2, "0").slice(0, 2);
  const decimal = decimalFormatter.formatToParts(1.1)
    .find((part) => part.type === "decimal")?.value || ".";
  const currencyText = formattedWhole.map((part) => part.value).join("");
  const signedCurrencyText = isNegative ? `-${currencyText}` : currencyText;
  return `${signedCurrencyText}${decimal}${fraction}`;
}

function formatQuantity(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? quantityFormatter.format(amount) : "—";
}

function formatCount(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-IN").format(amount) : "—";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
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

function addEmptyRow(tbody, columnCount, message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.className = "empty-cell";
  cell.colSpan = columnCount;
  cell.textContent = message;
  row.append(cell);
  tbody.replaceChildren(row);
}

function renderRecentSales(sales) {
  if (!Array.isArray(sales) || sales.length === 0) {
    addEmptyRow(elements.recentSales, 6, "No recent sales to show.");
    return;
  }

  const rows = sales.map((sale) => {
    const row = document.createElement("tr");
    addCell(row, `#${sale.id ?? "—"}`, "id-cell");
    addCell(row, sale.customer_name || "Walk-in");
    addCell(row, sale.type || "—");

    const statusCell = addCell(row, "");
    const badge = document.createElement("span");
    const status = sale.status || "unknown";
    badge.className = `status-badge status-badge-${status}`;
    badge.textContent = status;
    statusCell.append(badge);

    addCell(row, formatCurrency(sale.total_amount), "numeric");
    addCell(row, formatDate(sale.created_at));
    return row;
  });
  elements.recentSales.replaceChildren(...rows);
}

function renderStockMovements(movements) {
  if (!Array.isArray(movements) || movements.length === 0) {
    addEmptyRow(elements.stockMovements, 4, "No stock movements to show.");
    return;
  }

  const rows = movements.map((movement) => {
    const row = document.createElement("tr");
    addCell(row, movement.product_name || "—");
    const movementCell = addCell(row, "");
    const badge = document.createElement("span");
    badge.className = "movement-badge";
    badge.textContent = movement.movement_type || "—";
    movementCell.append(badge);

    const quantity = Number(movement.quantity_change);
    const quantityClass = Number.isFinite(quantity) && quantity > 0
      ? "numeric movement-positive"
      : Number.isFinite(quantity) && quantity < 0
        ? "numeric movement-negative"
        : "numeric";
    addCell(row, formatQuantity(movement.quantity_change), quantityClass);
    addCell(row, formatDate(movement.created_at));
    return row;
  });
  elements.stockMovements.replaceChildren(...rows);
}

function renderTopProducts(products) {
  if (!Array.isArray(products) || products.length === 0) {
    addEmptyRow(elements.topProducts, 2, "No completed product sales to show.");
    return;
  }

  const rows = products.map((product) => {
    const row = document.createElement("tr");
    addCell(row, product.product_name || "—");
    addCell(row, formatQuantity(product.net_quantity_sold), "numeric");
    return row;
  });
  elements.topProducts.replaceChildren(...rows);
}

function renderDashboard(dashboard) {
  const inventory = dashboard?.inventory || {};
  const today = dashboard?.today || {};
  const customerCredit = dashboard?.customer_credit || {};

  elements.productCount.textContent = formatCount(inventory.product_count);
  elements.activeProductCount.textContent = formatCount(inventory.active_product_count);
  elements.totalStock.textContent = formatQuantity(inventory.total_stock_quantity);
  elements.lowStockCount.textContent = formatCount(inventory.low_stock_count);
  elements.inventoryValue.textContent = formatCurrency(inventory.retail_inventory_value);
  elements.netSales.textContent = formatCurrency(today.net_sales);
  elements.salesBreakdown.textContent =
    `Gross ${formatCurrency(today.gross_sales)} · returns ${formatCurrency(today.returns)}`;
  elements.purchases.textContent = formatCurrency(today.purchases);
  elements.outstandingBalance.textContent = formatCurrency(customerCredit.outstanding_balance);

  const lowStock = Number(inventory.low_stock_count);
  const outOfStock = Number(inventory.out_of_stock_count);
  const hasAttention = Number.isFinite(lowStock) && lowStock > 0;
  elements.lowStockPanel.hidden = !hasAttention;
  if (hasAttention) {
    const outOfStockText = Number.isFinite(outOfStock)
      ? ` ${formatCount(outOfStock)} are out of stock.`
      : "";
    elements.lowStockMessage.textContent =
      `${formatCount(lowStock)} active products are low on stock.${outOfStockText} ` +
      "The dashboard API currently provides counts only, not product names.";
  }

  renderRecentSales(dashboard?.recent_sales);
  renderStockMovements(dashboard?.recent_stock_movements);
  renderTopProducts(dashboard?.top_selling_products);
}

async function loadDashboard() {
  elements.refreshButton.disabled = true;
  setStatus("Loading dashboard…");

  try {
    const response = await fetch(API_URL, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Dashboard request failed (${response.status}).`);
    }

    const payload = await response.json();
    if (!payload || payload.status !== "success" || !payload.data) {
      throw new Error("The dashboard response was not in the expected format.");
    }

    renderDashboard(payload.data);
    setStatus(`Dashboard updated at ${dateFormatter.format(new Date())}.`);
  } catch (error) {
    setStatus(
      `${error.message || "Unable to load the dashboard."} Check that the API is available and this page is served from the application origin.`,
      true
    );
    elements.productCount.textContent = "—";
    elements.activeProductCount.textContent = "—";
    elements.totalStock.textContent = "—";
    elements.lowStockCount.textContent = "—";
    elements.inventoryValue.textContent = "—";
    elements.netSales.textContent = "—";
    elements.salesBreakdown.textContent = "Sales summary unavailable";
    elements.purchases.textContent = "—";
    elements.outstandingBalance.textContent = "—";
    elements.lowStockPanel.hidden = true;
    addEmptyRow(elements.recentSales, 6, "Sales could not be loaded.");
    addEmptyRow(elements.stockMovements, 4, "Stock movements could not be loaded.");
    addEmptyRow(elements.topProducts, 2, "Products could not be loaded.");
  } finally {
    elements.refreshButton.disabled = false;
  }
}

elements.refreshButton.addEventListener("click", loadDashboard);
document.querySelectorAll(".nav-link[aria-disabled='true']").forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});
window.StocklyAuth.ready.then((authenticated) => {
  if (authenticated) loadDashboard();
});

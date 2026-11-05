const express = require("express");
const path = require("node:path");
const healthRoutes = require("./routes/health.routes");
const createAuthRouter = require("./routes/authRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const productRoutes = require("./routes/productRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const purchaseRoutes = require("./routes/purchaseRoutes");
const saleRoutes = require("./routes/saleRoutes");
const customerRoutes = require("./routes/customerRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const stockAdjustmentRoutes = require("./routes/stockAdjustmentRoutes");
const paymentHistoryRoutes = require("./routes/paymentHistoryRoutes");
const reportRoutes = require("./routes/reportRoutes");
const shopSettingsRoutes = require("./routes/shopSettingsRoutes");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");
const requireAuth = require("./middleware/requireAuth");
const requireRole = require("./middleware/requireRole");
const { sessionMiddleware } = require("./config/session");
const { csrfProtection } = require("./middleware/csrfProtection");
const createSecurityHeaders = require("./middleware/securityHeaders");

const app = express();

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(createSecurityHeaders());
app.use(express.json());
app.use(sessionMiddleware);
app.use(csrfProtection);
app.use("/api/health", healthRoutes);
app.use("/api/auth", createAuthRouter());
app.use("/api", requireAuth, requireRole("owner"));
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/stock-adjustments", stockAdjustmentRoutes);
app.use("/api/payments", paymentHistoryRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/settings/shop", shopSettingsRoutes);
app.use(express.static(path.resolve(__dirname, "../../client")));
app.use(notFound);
app.use(errorHandler);

module.exports = app;

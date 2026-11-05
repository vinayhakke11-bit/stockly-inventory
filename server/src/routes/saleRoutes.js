const express = require("express");
const saleController = require("../controllers/saleController");
const paymentRoutes = require("./paymentRoutes");
const returnRoutes = require("./returnRoutes");

const router = express.Router();

router.post("/", saleController.create);
router.get("/", saleController.getAll);
router.get("/:saleId/receipt", saleController.getReceipt);
router.get("/:id", saleController.getById);
router.put("/:id/complete", saleController.complete);
router.use("/:saleId/payments", paymentRoutes);
router.use(returnRoutes);
router.put("/:id", saleController.update);
router.delete("/:id", saleController.delete);

module.exports = router;

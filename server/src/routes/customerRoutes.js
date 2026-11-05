const express = require("express");
const customerController = require("../controllers/customerController");

const router = express.Router();

router.post("/", customerController.create);
router.get("/", customerController.getAll);
router.get("/:id/credit", customerController.getCreditSummary);
router.get("/:id/credit-transactions", customerController.getCreditTransactions);
router.get("/:id", customerController.getById);
router.put("/:id", customerController.update);
router.delete("/:id", customerController.delete);

module.exports = router;

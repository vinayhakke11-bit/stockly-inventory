const express = require("express");
const returnController = require("../controllers/returnController");

const router = express.Router();

router.post("/:saleId/returns", returnController.create);
router.get("/:saleId/returns", returnController.getBySale);
router.get("/returns", returnController.getAll);
router.get("/returns/:returnId", returnController.getById);
router.put("/returns/:returnId/complete", returnController.complete);
router.post("/returns/:returnId/refunds", returnController.refund);
router.get("/returns/:returnId/refunds", returnController.getRefunds);

module.exports = router;

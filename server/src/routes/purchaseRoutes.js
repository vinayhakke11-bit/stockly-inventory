const express = require("express");
const purchaseController = require("../controllers/purchaseController");

const router = express.Router();

router.post("/", purchaseController.create);
router.get("/", purchaseController.getAll);
router.get("/:id", purchaseController.getById);
router.put("/:id/receive", purchaseController.receive);
router.put("/:id", purchaseController.update);
router.delete("/:id", purchaseController.delete);

module.exports = router;

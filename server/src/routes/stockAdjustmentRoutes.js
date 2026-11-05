const express = require("express");
const stockAdjustmentController = require("../controllers/stockAdjustmentController");

const router = express.Router();

router.get("/", stockAdjustmentController.getHistory);
router.post("/", stockAdjustmentController.create);

module.exports = router;

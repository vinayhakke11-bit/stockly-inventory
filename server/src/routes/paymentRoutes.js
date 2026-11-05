const express = require("express");
const paymentController = require("../controllers/paymentController");

const router = express.Router({ mergeParams: true });

router.post("/", paymentController.create);
router.get("/", paymentController.getBySale);

module.exports = router;

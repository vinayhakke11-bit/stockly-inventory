const express = require("express");
const paymentController = require("../controllers/paymentController");

const router = express.Router();

router.get("/", paymentController.getAll);

module.exports = router;

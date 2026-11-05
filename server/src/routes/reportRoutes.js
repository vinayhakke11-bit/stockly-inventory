const express = require("express");
const reportController = require("../controllers/reportController");

const router = express.Router();

router.get("/", reportController.getReports);

module.exports = router;

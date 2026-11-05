const express = require("express");
const shopSettingsController = require("../controllers/shopSettingsController");

const router = express.Router();

router.get("/", shopSettingsController.get);
router.put("/", shopSettingsController.update);

module.exports = router;

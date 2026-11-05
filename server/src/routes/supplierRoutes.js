const express = require("express");
const supplierController = require("../controllers/supplierController");

const router = express.Router();

router.post("/", supplierController.create);
router.get("/", supplierController.getAll);
router.get("/:id", supplierController.getById);
router.put("/:id", supplierController.update);
router.delete("/:id", supplierController.delete);

module.exports = router;

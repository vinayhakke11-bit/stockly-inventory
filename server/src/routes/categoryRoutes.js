const express = require("express");
const categoryController = require("../controllers/categoryController");

const router = express.Router();

router.post("/", categoryController.create);
router.get("/", categoryController.getAll);
router.get("/:id", categoryController.getById);
router.put("/:id", categoryController.update);
router.delete("/:id", categoryController.delete);

module.exports = router;

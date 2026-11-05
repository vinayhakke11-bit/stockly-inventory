const shopSettingsService = require("../services/shopSettingsService");

async function get(req, res) {
  const settings = await shopSettingsService.getShopSettings();
  res.status(200).json({
    status: "success",
    data: settings,
  });
}

async function update(req, res) {
  const settings = await shopSettingsService.updateShopSettings(req.body);
  res.status(200).json({
    status: "success",
    message: "Shop information saved successfully.",
    data: settings,
  });
}

module.exports = { get, update };

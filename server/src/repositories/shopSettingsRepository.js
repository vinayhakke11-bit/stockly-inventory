const pool = require("../config/database");

function normalizeShopSettings(value) {
  const settings = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

  return {
    name: typeof settings.name === "string" ? settings.name : "",
    address: typeof settings.address === "string" ? settings.address : "",
    phone: typeof settings.phone === "string" ? settings.phone : "",
  };
}

async function getShopSettings() {
  const result = await pool.query(
    "SELECT value FROM shop_settings WHERE key = 'shop'"
  );
  return normalizeShopSettings(result.rows[0]?.value);
}

async function updateShopSettings(settings) {
  const result = await pool.query(
    `INSERT INTO shop_settings (key, value, updated_at)
     VALUES ('shop', $1::JSONB, now())
     ON CONFLICT (key) DO UPDATE
       SET value = shop_settings.value || EXCLUDED.value,
           updated_at = now()
     RETURNING value`,
    [JSON.stringify(settings)]
  );
  return normalizeShopSettings(result.rows[0].value);
}

module.exports = { getShopSettings, updateShopSettings };

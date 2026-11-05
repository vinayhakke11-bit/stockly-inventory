require("dotenv").config();

const authService = require("../services/authService");

async function bootstrapOwner() {
  if (process.env.ALLOW_OWNER_BOOTSTRAP !== "true") {
    throw new Error(
      "Owner bootstrap is disabled. Set ALLOW_OWNER_BOOTSTRAP=true for this one-time command."
    );
  }

  const user = await authService.createInitialOwner({
    username: process.env.BOOTSTRAP_OWNER_USERNAME,
    email: process.env.BOOTSTRAP_OWNER_EMAIL,
    password: process.env.BOOTSTRAP_OWNER_PASSWORD,
  });

  console.log(`Created initial owner account "${user.username}" (ID ${user.id}).`);
}

bootstrapOwner()
  .catch((error) => {
    if (
      ["OWNER_ROLE_NOT_FOUND", "OWNER_ALREADY_EXISTS"].includes(error.code) ||
      error.statusCode === 400 ||
      error.statusCode === 409
    ) {
      console.error(error.message);
    } else {
      console.error("Owner bootstrap failed. Check database connectivity and configured variables.");
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    const pool = require("../config/database");
    await pool.end();
  });

const pool = require("../config/database");

async function findByIdentifier(identifier) {
  const result = await pool.query(
    `SELECT u.id, u.username, u.email, u.password_hash, u.is_active, r.name AS role
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.username = $1 OR lower(u.email) = lower($1)
     ORDER BY (u.username = $1) DESC
     LIMIT 2`,
    [identifier]
  );

  return result.rows;
}

async function findActiveById(id) {
  const result = await pool.query(
    `SELECT u.id, u.username, u.email, r.name AS role
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.is_active = true`,
    [id]
  );

  return result.rows[0] || null;
}

async function createInitialOwner({ username, email, passwordHash }) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock($1)", [826347922]);

    const roleResult = await client.query(
      "SELECT id FROM roles WHERE name = 'owner' FOR UPDATE"
    );
    if (roleResult.rowCount === 0) {
      const error = new Error("The owner role is missing. Run the authentication migration first.");
      error.code = "OWNER_ROLE_NOT_FOUND";
      throw error;
    }

    const existingOwner = await client.query(
      "SELECT id FROM users WHERE role_id = $1 LIMIT 1",
      [roleResult.rows[0].id]
    );
    if (existingOwner.rowCount > 0) {
      const error = new Error("An owner account already exists.");
      error.code = "OWNER_ALREADY_EXISTS";
      throw error;
    }

    const result = await client.query(
      `INSERT INTO users (role_id, username, email, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email`,
      [roleResult.rows[0].id, username, email, passwordHash]
    );

    await client.query("COMMIT");
    transactionStarted = false;
    return result.rows[0];
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { findByIdentifier, findActiveById, createInitialOwner };

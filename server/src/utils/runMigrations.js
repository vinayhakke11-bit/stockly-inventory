require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

const migrationsDirectory = path.resolve(__dirname, "../../../database/migrations");
const migrationFilePattern = /^\d+_[a-z0-9_]+\.sql$/i;
const advisoryLockId = 826347921;

async function runMigrations() {
  let pool;
  let client;
  let lockAcquired = false;

  try {
    pool = require("../config/database");
    client = await pool.connect();

    await client.query("SELECT pg_advisory_lock($1)", [advisoryLockId]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const migrationFiles = fs
      .readdirSync(migrationsDirectory)
      .filter((fileName) => migrationFilePattern.test(fileName))
      .sort((left, right) => {
        const leftNumber = Number.parseInt(left, 10);
        const rightNumber = Number.parseInt(right, 10);
        return leftNumber - rightNumber || left.localeCompare(right);
      });

    for (let index = 1; index < migrationFiles.length; index += 1) {
      if (
        Number.parseInt(migrationFiles[index - 1], 10) ===
        Number.parseInt(migrationFiles[index], 10)
      ) {
        throw new Error(`Duplicate migration number in ${migrationFiles[index - 1]} and ${migrationFiles[index]}`);
      }
    }

    const appliedResult = await client.query(
      "SELECT migration_name FROM schema_migrations"
    );
    const appliedMigrations = new Set(
      appliedResult.rows.map((row) => row.migration_name)
    );

    for (const migrationFile of migrationFiles) {
      if (appliedMigrations.has(migrationFile)) {
        console.log(`Skipping already applied migration: ${migrationFile}`);
        continue;
      }

      const migrationSql = fs.readFileSync(
        path.join(migrationsDirectory, migrationFile),
        "utf8"
      );

      try {
        await client.query("BEGIN");
        await client.query(migrationSql);
        await client.query(
          "INSERT INTO schema_migrations (migration_name) VALUES ($1)",
          [migrationFile]
        );
        await client.query("COMMIT");
        console.log(`Applied migration: ${migrationFile}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migrationFile} failed: ${error.message}`, {
          cause: error,
        });
      }
    }

    console.log("Database migrations are up to date.");
  } catch (error) {
    console.error(`Migration error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (client && lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [advisoryLockId]);
      } catch (error) {
        console.error(`Could not release migration lock: ${error.message}`);
        process.exitCode = 1;
      }
    }

    if (client) {
      client.release();
    }
    if (pool) {
      await pool.end();
    }
  }
}

runMigrations();

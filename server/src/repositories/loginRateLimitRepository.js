class LoginRateLimitRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async consume(key, windowMs, maxAttempts) {
    await this.pool.query(
      `DELETE FROM login_rate_limits
       WHERE window_started_at <= now() - ($1 * interval '1 millisecond')`,
      [windowMs]
    );

    const result = await this.pool.query(
      `INSERT INTO login_rate_limits (key_hash, window_started_at, attempt_count)
       VALUES ($1, now(), 1)
       ON CONFLICT (key_hash) DO UPDATE
       SET window_started_at = CASE
             WHEN login_rate_limits.window_started_at <= now() - ($2 * interval '1 millisecond')
               THEN now()
             ELSE login_rate_limits.window_started_at
           END,
           attempt_count = CASE
             WHEN login_rate_limits.window_started_at <= now() - ($2 * interval '1 millisecond')
               THEN 1
             ELSE LEAST(login_rate_limits.attempt_count + 1, $3 + 1)
           END
       RETURNING attempt_count`,
      [key, windowMs, maxAttempts]
    );

    return result.rows[0].attempt_count <= maxAttempts;
  }
}

module.exports = LoginRateLimitRepository;

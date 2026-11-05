async function setPerformedBy(client, userId) {
  await client.query(
    "SELECT set_config('stockly.performed_by', $1, true)",
    [userId]
  );
}

module.exports = { setPerformedBy };

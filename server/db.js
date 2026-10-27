import pg from "pg";

export function createDatabase(connectionString) {
  if (!connectionString) {
    throw new Error("La variable DATABASE_URL est obligatoire.");
  }

  const pool = new pg.Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });

  pool.on("error", (error) => {
    console.error("Erreur inattendue du pool PostgreSQL :", error.message);
  });

  return {
    query: (text, values) => pool.query(text, values),
    async transaction(callback) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

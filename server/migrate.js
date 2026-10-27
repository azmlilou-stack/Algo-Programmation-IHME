import { readFile } from "node:fs/promises";
import { createDatabase } from "./db.js";

export async function migrate(db) {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await db.transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(7261042)");
    for (const statement of schema.split(";").filter((part) => part.trim())) {
      await client.query(statement);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    await migrate(db);
    console.log("Schéma PostgreSQL prêt.");
  } finally {
    await db.close();
  }
}

import { createApp } from "./app.js";
import { createDatabase } from "./db.js";
import { migrate } from "./migrate.js";

const db = createDatabase(process.env.DATABASE_URL);
const port = Number(process.env.PORT || 3000);
const cookiePath = process.env.COOKIE_PATH || "/";

try {
  await migrate(db);
  const app = createApp(db, { cookiePath });
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Application prête sur le port ${port}.`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      server.close(async () => {
        await db.close();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    });
  }
} catch (error) {
  console.error("Impossible de démarrer l’application :", error.message);
  await db.close();
  process.exitCode = 1;
}

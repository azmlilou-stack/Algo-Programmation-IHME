import bcrypt from "bcryptjs";
import { createDatabase } from "./db.js";

const { OPERATOR_NAME, OPERATOR_EMAIL, OPERATOR_PASSWORD } = process.env;

if (!OPERATOR_NAME || !OPERATOR_EMAIL || !OPERATOR_PASSWORD) {
  throw new Error(
    "Définissez temporairement OPERATOR_NAME, OPERATOR_EMAIL et OPERATOR_PASSWORD dans votre environnement.",
  );
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(OPERATOR_EMAIL.trim())) {
  throw new Error("L’adresse e-mail opérateur est invalide.");
}
if (OPERATOR_NAME.trim().length < 2 || OPERATOR_NAME.trim().length > 100) {
  throw new Error("Le nom opérateur doit contenir entre 2 et 100 caractères.");
}
if (OPERATOR_PASSWORD.length < 12 || Buffer.byteLength(OPERATOR_PASSWORD, "utf8") > 72) {
  throw new Error("Le mot de passe opérateur doit contenir entre 12 et 72 octets.");
}

const db = createDatabase(process.env.DATABASE_URL);
try {
  const result = await db.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'operator')
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [
      OPERATOR_NAME.trim(),
      OPERATOR_EMAIL.trim().toLowerCase(),
      await bcrypt.hash(OPERATOR_PASSWORD, 12),
    ],
  );
  if (!result.rowCount) {
    throw new Error("Cette adresse existe déjà ; aucun compte n’a été modifié.");
  }
  console.log("Compte opérateur créé.");
} finally {
  await db.close();
}

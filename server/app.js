import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SESSION_COOKIE = "ihme_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;
const TEST_FAMILIES = new Set(["Impact", "Thermique", "Mécanique"]);
const PRODUCT_CATEGORIES = new Set([
  "Body protection",
  "maintien articulaire",
  "casque",
]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const VERDICTS = new Set(["conforming", "non_conforming"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const publicUserFields = "id, name, email, role, must_change_password";
const requestSelect = `
  SELECT r.id, r.requester_id, r.product_reference, r.quantity, r.test_family,
    r.product_category, r.due_date, r.priority, r.status, r.assigned_operator_id, r.scheduled_date,
    r.created_at, requester.name AS requester_name, operator.name AS assigned_operator_name,
    result.verdict AS result_verdict, result.comment AS result_comment,
    result.submitted_at, result.validated_at
  FROM test_requests r
  JOIN users requester ON requester.id = r.requester_id
  LEFT JOIN users operator ON operator.id = r.assigned_operator_id
  LEFT JOIN test_results result ON result.request_id = r.id`;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value)
      .map(([name, ...value]) => [name, value.join("=")]),
  );
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function validateRegistration(input = {}) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = body.role === undefined ? "engineer" : body.role;

  if (name.length < 2 || name.length > 100) {
    throw httpError(400, "Le nom doit contenir entre 2 et 100 caractères.");
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw httpError(400, "Veuillez saisir une adresse e-mail valide.");
  }
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    throw httpError(400, "Le mot de passe doit contenir entre 12 et 72 octets.");
  }
  if (!["engineer", "operator"].includes(role)) {
    throw httpError(400, "Le profil du compte n’est pas reconnu.");
  }
  return { name, email, password, role };
}

export function validateRequest(input = {}) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const assignedOperatorId =
    body.assignedOperatorId === undefined || body.assignedOperatorId === ""
      ? null
      : body.assignedOperatorId;
  const productReference =
    typeof body.productReference === "string" ? body.productReference.trim() : "";
  const quantity = Number(body.quantity);
  const dueDate = typeof body.dueDate === "string" ? body.dueDate : "";
  const dateIsValid =
    /^\d{4}-\d{2}-\d{2}$/.test(dueDate) &&
    !Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`)) &&
    new Date(`${dueDate}T00:00:00Z`).toISOString().slice(0, 10) === dueDate;

  if (!productReference || productReference.length > 120) {
    throw httpError(400, "La référence produit est obligatoire (120 caractères maximum).");
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    throw httpError(400, "La quantité doit être comprise entre 1 et 10 000.");
  }
  if (!TEST_FAMILIES.has(body.testFamily)) {
    throw httpError(400, "La famille de test n’est pas reconnue.");
  }
  if (!PRODUCT_CATEGORIES.has(body.productCategory)) {
    throw httpError(400, "La catégorie du produit n’est pas reconnue.");
  }
  if (!dateIsValid) {
    throw httpError(400, "La date limite doit être une date valide au format AAAA-MM-JJ.");
  }
  if (!PRIORITIES.has(body.priority)) {
    throw httpError(400, "Le niveau de priorité n’est pas reconnu.");
  }
  if (assignedOperatorId !== null && (
    typeof assignedOperatorId !== "string" ||
    !UUID_PATTERN.test(assignedOperatorId)
  )) {
    throw httpError(400, "L’opérateur sélectionné est invalide.");
  }

  return {
    productReference,
    quantity,
    testFamily: body.testFamily,
    productCategory: body.productCategory,
    dueDate,
    priority: body.priority,
    assignedOperatorId,
  };
}

export function validateResult(input = {}) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (!VERDICTS.has(body.verdict)) {
    throw httpError(400, "Le verdict doit être Conforme ou Non conforme.");
  }
  if (!comment || comment.length > 2000) {
    throw httpError(400, "Le commentaire est obligatoire (2 000 caractères maximum).");
  }
  return { verdict: body.verdict, comment };
}

export function createApp(db, options = {}) {
  const app = express();
  const secureCookie = options.secureCookie ?? process.env.NODE_ENV === "production";
  const cookiePath = options.cookiePath || "/";
  const staticDirectory = options.staticDirectory || path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist",
  );

  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "16kb" }));

  app.use(async (req, res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) {
        const result = await db.query(
          `SELECT u.id, u.name, u.email, u.role, u.must_change_password
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1 AND s.expires_at > now()`,
          [hashToken(token)],
        );
        req.user = result.rows[0] || null;
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Trop de tentatives. Réessayez dans quelques minutes." },
  });

  app.get("/api/health", async (_req, res, next) => {
    try {
      await db.query("SELECT 1");
      res.json({ status: "ok" });
    } catch (error) {
      console.error("Contrôle de santé PostgreSQL en échec :", error.message);
      res.status(503).json({ status: "unavailable" });
    }
  });

  app.post("/api/auth/register", authRateLimit, async (req, res, next) => {
    try {
      const { name, email, password, role } = validateRegistration(req.body);
      const passwordHash = await bcrypt.hash(password, 12);
      const created = await db.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING ${publicUserFields}`,
        [name, email, passwordHash, role],
      );
      await createSession(db, created.rows[0].id, res, secureCookie, cookiePath);
      res.status(201).json({ user: created.rows[0] });
    } catch (error) {
      if (error.code === "23505") return next(httpError(409, "Cette adresse e-mail est déjà utilisée."));
      next(error);
    }
  });

  app.post("/api/auth/login", authRateLimit, async (req, res, next) => {
    try {
      const body = req.body || {};
      const expectedRole =
        typeof body.expectedRole === "string" ? body.expectedRole : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (expectedRole && !["engineer", "operator"].includes(expectedRole)) {
        throw httpError(400, "Le profil de connexion n’est pas reconnu.");
      }
      if (!EMAIL_PATTERN.test(email) || password.length > 72) {
        throw httpError(400, "Adresse e-mail ou mot de passe invalide.");
      }
      const found = await db.query(
        `SELECT id, name, email, password_hash, role, must_change_password
         FROM users WHERE email = $1`,
        [email],
      );
      const user = found.rows[0];
      if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
        throw httpError(401, "Adresse e-mail ou mot de passe incorrect.");
      }
      if (expectedRole && user.role !== expectedRole) {
        throw httpError(
          403,
          expectedRole === "engineer"
            ? "Ce compte est enregistré comme ingénieur essais. Choisissez ce profil pour vous connecter."
            : "Ce compte est enregistré comme ingénieur produit. Choisissez ce profil pour vous connecter.",
        );
      }
      await createSession(db, user.id, res, secureCookie, cookiePath);
      res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          must_change_password: user.must_change_password,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Connexion requise." });
    res.json({ user: req.user });
  });

  app.post("/api/auth/logout", async (req, res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) {
        await db.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
      }
      res.clearCookie(SESSION_COOKIE, cookieOptions(secureCookie, cookiePath));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/change-password", requireUser, async (req, res, next) => {
    try {
      const currentPassword =
        typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
      const newPassword =
        typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
      if (newPassword.length < 12 || Buffer.byteLength(newPassword, "utf8") > 72) {
        throw httpError(400, "Le nouveau mot de passe doit contenir entre 12 et 72 octets.");
      }

      const found = await db.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [req.user.id],
      );
      if (
        !found.rows[0]?.password_hash ||
        !(await bcrypt.compare(currentPassword, found.rows[0].password_hash))
      ) {
        throw httpError(401, "Le mot de passe temporaire est incorrect.");
      }
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await db.query(
        `UPDATE users SET password_hash = $1, must_change_password = false
         WHERE id = $2`,
        [passwordHash, req.user.id],
      );
      res.json({ changed: true });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", (req, _res, next) => {
    if (
      req.user?.must_change_password &&
      !["/auth/me", "/auth/logout", "/auth/change-password"].includes(req.path)
    ) {
      return next(
        httpError(403, "Changez votre mot de passe temporaire pour continuer."),
      );
    }
    next();
  });

  app.get("/api/operators", requireRole("engineer"), async (_req, res, next) => {
    try {
      const result = await db.query(
        `SELECT id, name, (password_hash IS NOT NULL) AS activated
         FROM users WHERE role = 'operator' ORDER BY name`,
      );
      res.json({ operators: result.rows });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/operators/:id/activate", requireRole("engineer"), async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id);
      const temporaryPassword = randomBytes(12).toString("base64url");
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);
      const activated = await db.query(
        `UPDATE users SET password_hash = $1, must_change_password = true
         WHERE id = $2 AND role = 'operator' AND password_hash IS NULL
         RETURNING id, name, email`,
        [passwordHash, id],
      );
      if (!activated.rowCount) {
        throw httpError(409, "Ce compte opérateur est déjà activé ou introuvable.");
      }
      res.status(201).json({
        operator: activated.rows[0],
        temporaryPassword,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/requests", requireUser, async (req, res, next) => {
    try {
      const result =
        req.user.role === "operator"
          ? await db.query(`${requestSelect} ORDER BY
              CASE r.status WHEN 'requested' THEN 0 WHEN 'scheduled' THEN 1
                WHEN 'in_progress' THEN 2 WHEN 'pending_validation' THEN 3 ELSE 4 END,
              r.due_date ASC, r.created_at DESC`)
          : await db.query(
              `${requestSelect} WHERE r.requester_id = $1 ORDER BY r.created_at DESC`,
              [req.user.id],
            );
      res.json({ requests: result.rows });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/requests", requireRole("engineer"), async (req, res, next) => {
    try {
      const request = validateRequest(req.body);
      if (request.assignedOperatorId) {
        const operator = await db.query(
          `SELECT id FROM users
           WHERE id = $1 AND role = 'operator' AND password_hash IS NOT NULL`,
          [request.assignedOperatorId],
        );
        if (!operator.rowCount) {
          throw httpError(400, "L’opérateur sélectionné n’existe pas ou son compte n’est pas activé.");
        }
      }
      const result = await db.query(
        `INSERT INTO test_requests
          (requester_id, product_reference, quantity, test_family, product_category,
           due_date, priority, assigned_operator_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, requester_id, product_reference, quantity, test_family,
           product_category, due_date, priority, status, assigned_operator_id, created_at`,
        [
          req.user.id,
          request.productReference,
          request.quantity,
          request.testFamily,
          request.productCategory,
          request.dueDate,
          request.priority,
          request.assignedOperatorId,
        ],
      );
      res.status(201).json({ request: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/requests/:id/schedule", requireRole("operator"), async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id);
      const scheduledDate = req.body?.scheduledDate;
      if (
        typeof scheduledDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) ||
        Number.isNaN(Date.parse(`${scheduledDate}T00:00:00Z`)) ||
        new Date(`${scheduledDate}T00:00:00Z`).toISOString().slice(0, 10) !== scheduledDate
      ) {
        throw httpError(400, "Veuillez saisir une date de planification valide.");
      }
      const result = await db.query(
        `UPDATE test_requests SET status = 'scheduled', scheduled_date = $1,
          assigned_operator_id = COALESCE(assigned_operator_id, $2), updated_at = now()
         WHERE id = $3 AND status = 'requested'
           AND (assigned_operator_id IS NULL OR assigned_operator_id = $2)
         RETURNING id`,
        [scheduledDate, req.user.id, id],
      );
      if (!result.rowCount) throw httpError(409, "Cette demande n’est plus disponible à la planification.");
      res.json({ status: "scheduled" });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/requests/:id/start", requireRole("operator"), async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id);
      const result = await db.query(
        `UPDATE test_requests SET status = 'in_progress', updated_at = now()
         WHERE id = $1 AND assigned_operator_id = $2 AND status = 'scheduled'
         RETURNING id`,
        [id, req.user.id],
      );
      if (!result.rowCount) throw httpError(409, "Cette demande n’est pas planifiée pour vous.");
      res.json({ status: "in_progress" });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/requests/:id/result", requireRole("operator"), async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id);
      const resultInput = validateResult(req.body);
      const saved = await db.transaction(async (client) => {
        const updated = await client.query(
          `UPDATE test_requests SET status = 'pending_validation', updated_at = now()
           WHERE id = $1 AND assigned_operator_id = $2 AND status = 'in_progress'
           RETURNING id`,
          [id, req.user.id],
        );
        if (!updated.rowCount) throw httpError(409, "Cette demande n’est pas en cours pour vous.");
        await client.query(
          `INSERT INTO test_results (request_id, verdict, comment)
           VALUES ($1, $2, $3)`,
          [id, resultInput.verdict, resultInput.comment],
        );
        return true;
      });
      res.status(201).json({ submitted: saved });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/requests/:id/validate", requireRole("engineer"), async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id);
      await db.transaction(async (client) => {
        const updated = await client.query(
          `UPDATE test_requests SET status = 'done', updated_at = now()
           WHERE id = $1 AND requester_id = $2 AND status = 'pending_validation'
           RETURNING id`,
          [id, req.user.id],
        );
        if (!updated.rowCount) {
          throw httpError(409, "Cette demande ne vous appartient pas ou n’attend pas votre validation.");
        }
        await client.query(
          `UPDATE test_results SET validated_at = now() WHERE request_id = $1`,
          [id],
        );
      });
      res.json({ status: "done" });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "Route API introuvable." }));
  app.use(express.static(staticDirectory, { index: false, maxAge: "1h" }));
  app.get("/{*path}", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(staticDirectory, "index.html"), (error) => {
      if (error) next(error);
    });
  });

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Le corps de la requête doit être un JSON valide." });
    }
    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "La requête est trop volumineuse." });
    }
    console.error("Erreur API :", error.message);
    res.status(500).json({ error: "Une erreur serveur est survenue." });
  });

  return app;
}

function requireUser(req, _res, next) {
  if (!req.user) return next(httpError(401, "Connexion requise."));
  next();
}

function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user) return next(httpError(401, "Connexion requise."));
    if (req.user.role !== role) return next(httpError(403, "Action non autorisée pour ce profil."));
    next();
  };
}

function requireUuid(value) {
  if (!UUID_PATTERN.test(value)) throw httpError(400, "Identifiant de demande invalide.");
  return value;
}

function cookieOptions(secure, path) {
  return {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path,
    maxAge: SESSION_DURATION_MS,
  };
}

async function createSession(db, userId, res, secure, path) {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + interval '7 days')`,
    [hashToken(token), userId],
  );
  res.cookie(SESSION_COOKIE, token, cookieOptions(secure, path));
}

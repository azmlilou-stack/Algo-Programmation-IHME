import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { describe, it } from "node:test";
import request from "supertest";
import { createApp, validateRegistration, validateRequest, validateResult } from "../server/app.js";

describe("validation des entrées", () => {
  it("normalise les coordonnées d’inscription", () => {
    assert.deepEqual(
      validateRegistration({
        name: "  Alex Martin ",
        email: "  ALEX@example.com ",
        password: "mot-de-passe-solide",
        role: "operator",
      }),
      {
        name: "Alex Martin",
        email: "alex@example.com",
        password: "mot-de-passe-solide",
      },
    );
  });

  it("refuse les mots de passe trop courts", () => {
    assert.throws(() =>
      validateRegistration({
        name: "Alex Martin",
        email: "alex@example.com",
        password: "court",
      }),
    );
  });

  it("valide et nettoie une demande laboratoire", () => {
    assert.deepEqual(
      validateRequest({
        productReference: "  PRD-14 ",
        quantity: 3,
        testFamily: "Thermique",
        productCategory: "casque",
        dueDate: "2027-01-15",
        priority: "high",
      }),
      {
        productReference: "PRD-14",
        quantity: 3,
        testFamily: "Thermique",
        productCategory: "casque",
        dueDate: "2027-01-15",
        priority: "high",
        assignedOperatorId: null,
      },
    );
  });

  it("refuse une date impossible, une quantité décimale ou une famille inconnue", () => {
    const validRequest = {
      productReference: "PRD-14",
      quantity: 1,
      testFamily: "Impact",
      productCategory: "Body protection",
      dueDate: "2027-02-28",
      priority: "normal",
    };
    assert.throws(() => validateRequest({ ...validRequest, dueDate: "2027-02-30" }));
    assert.throws(() => validateRequest({ ...validRequest, quantity: 1.5 }));
    assert.throws(() => validateRequest({ ...validRequest, testFamily: "Chimique" }));
    assert.throws(() => validateRequest({ ...validRequest, productCategory: "Autre" }));
    assert.throws(() => validateRequest({ ...validRequest, productCategory: "" }));
    assert.throws(() => validateRequest(null));
  });

  it("valide une affectation opérateur facultative", () => {
    const validRequest = {
      productReference: "PRD-14",
      quantity: 1,
      testFamily: "Impact",
      productCategory: "maintien articulaire",
      dueDate: "2027-02-28",
      priority: "normal",
    };
    const operatorId = "ea8fc84b-ecc8-4ea6-9c88-ef62c0e72011";
    assert.equal(
      validateRequest({ ...validRequest, assignedOperatorId: operatorId }).assignedOperatorId,
      operatorId,
    );
    assert.throws(() =>
      validateRequest({ ...validRequest, assignedOperatorId: "not-an-id" }),
    );
  });

  it("n’accepte que les verdicts prévus et un commentaire non vide", () => {
    assert.deepEqual(
      validateResult({ verdict: "non_conforming", comment: "  Fissure observée  " }),
      { verdict: "non_conforming", comment: "Fissure observée" },
    );
    assert.throws(() => validateResult({ verdict: "pass", comment: "" }));
    assert.throws(() => validateResult(null));
  });
});

describe("API", () => {
  const db = {
    async query(sql) {
      if (sql.includes("FROM sessions s JOIN users u")) {
        return {
          rows: [{
            id: "ea8fc84b-ecc8-4ea6-9c88-ef62c0e72011",
            name: "Opérateur Test",
            email: "operator@example.com",
            role: "operator",
            must_change_password: false,
          }],
        };
      }
      if (sql === "SELECT 1") return { rows: [{ "?column?": 1 }] };
      if (sql.includes("UPDATE test_requests SET status = 'scheduled'")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Requête non simulée dans ce test : ${sql}`);
    },
  };
  const app = createApp(db, { secureCookie: false, staticDirectory: "/tmp/ihme-test-static" });

  it("expose une route de santé sans informations sensibles", async () => {
    const response = await request(app).get("/api/health").expect(200);
    assert.deepEqual(response.body, { status: "ok" });
    assert.equal(response.headers["x-powered-by"], undefined);
  });

  it("renvoie un état indisponible si PostgreSQL ne répond pas", async () => {
    const unavailableApp = createApp(
      { query: async () => { throw new Error("database details"); } },
      { secureCookie: false, staticDirectory: "/tmp/ihme-test-static" },
    );
    const response = await request(unavailableApp).get("/api/health").expect(503);
    assert.deepEqual(response.body, { status: "unavailable" });
    assert.equal(JSON.stringify(response.body).includes("database details"), false);
  });

  it("protège les demandes contre les utilisateurs non connectés", async () => {
    await request(app).get("/api/requests").expect(401);
  });

  it("réserve la liste des opérateurs aux ingénieurs connectés", async () => {
    await request(app).get("/api/operators").expect(401);
    await request(app)
      .get("/api/operators")
      .set("Cookie", "ihme_session=operator-session")
      .expect(403);
  });

  it("réserve la création de demande aux ingénieurs", async () => {
    await request(app)
      .post("/api/requests")
      .set("Cookie", "ihme_session=test-session")
      .send({})
      .expect(403);
  });

  it("permet à un ingénieur de lister les opérateurs et d’assigner une demande", async () => {
    const engineer = {
      id: "ea8fc84b-ecc8-4ea6-9c88-ef62c0e72012",
      name: "Alex Martin",
      email: "alex@example.com",
      role: "engineer",
    };
    const operator = {
      id: "ea8fc84b-ecc8-4ea6-9c88-ef62c0e72011",
      name: "Opérateur Test",
    };
    const createdRequests = [];
    let operatorActive = true;
    const engineerDb = {
      async query(sql, values = []) {
        if (sql.includes("FROM sessions s JOIN users u")) {
          return { rows: [engineer] };
        }
        if (sql.includes("SELECT id, name, (password_hash IS NOT NULL)")) {
          return { rows: [{ ...operator, activated: true }] };
        }
        if (sql.includes("AND password_hash IS NOT NULL")) {
          const rows =
            operatorActive && values[0] === operator.id ? [{ id: operator.id }] : [];
          return { rows, rowCount: rows.length };
        }
        if (sql.includes("INSERT INTO test_requests")) {
          createdRequests.push(values);
          return {
            rows: [{
              id: `request-${createdRequests.length}`,
              requester_id: engineer.id,
              product_category: values[4],
              assigned_operator_id: values[7],
              status: "requested",
            }],
          };
        }
        throw new Error(`Requête non simulée dans ce test : ${sql}`);
      },
    };
    const engineerApp = createApp(engineerDb, {
      secureCookie: false,
      staticDirectory: "/tmp/ihme-test-static",
    });
    const cookie = "ihme_session=engineer-session";

    const operatorList = await request(engineerApp)
      .get("/api/operators")
      .set("Cookie", cookie)
      .expect(200);
    assert.deepEqual(operatorList.body.operators, [{ ...operator, activated: true }]);

    const requestBody = {
      productReference: "PRD-15",
      quantity: 2,
      testFamily: "Impact",
      productCategory: "casque",
      dueDate: "2027-02-28",
      priority: "normal",
      assignedOperatorId: operator.id,
    };
    const assigned = await request(engineerApp)
      .post("/api/requests")
      .set("Cookie", cookie)
      .send(requestBody)
      .expect(201);
    assert.equal(assigned.body.request.product_category, "casque");
    assert.equal(assigned.body.request.assigned_operator_id, operator.id);
    assert.equal(createdRequests[0][4], "casque");
    assert.equal(createdRequests[0][7], operator.id);

    const unassigned = await request(engineerApp)
      .post("/api/requests")
      .set("Cookie", cookie)
      .send({ ...requestBody, assignedOperatorId: "" })
      .expect(201);
    assert.equal(unassigned.body.request.assigned_operator_id, null);
    assert.equal(createdRequests[1][7], null);

    await request(engineerApp)
      .post("/api/requests")
      .set("Cookie", cookie)
      .send({ ...requestBody, assignedOperatorId: "ea8fc84b-ecc8-4ea6-9c88-ef62c0e72013" })
      .expect(400);

    operatorActive = false;
    await request(engineerApp)
      .post("/api/requests")
      .set("Cookie", cookie)
      .send(requestBody)
      .expect(400);
  });

  it("permet à un ingénieur d’activer un compte opérateur avec un mot de passe temporaire", async () => {
    const engineer = {
      id: "ea8fc84b-ecc8-4ea6-9c88-ef62c0e72012",
      name: "Alex Martin",
      email: "alex@example.com",
      role: "engineer",
      must_change_password: false,
    };
    const operator = {
      id: "ea8fc84b-ecc8-4ea6-9c88-ef62c0e72011",
      name: "Thibaut",
      email: "test+thibaut@decathlon.com",
    };
    let operatorPasswordHash = null;
    let mustChangePassword = false;
    const activationDb = {
      async query(sql, values = []) {
        if (sql.includes("FROM sessions s JOIN users u")) {
          return { rows: [{ ...engineer, must_change_password: false }] };
        }
        if (sql.includes("SELECT id, name, (password_hash IS NOT NULL)")) {
          return {
            rows: [{ ...operator, activated: operatorPasswordHash !== null }],
          };
        }
        if (sql.includes("UPDATE users SET password_hash = $1, must_change_password = true")) {
          if (values[1] !== operator.id || operatorPasswordHash !== null) {
            return { rows: [], rowCount: 0 };
          }
          operatorPasswordHash = values[0];
          mustChangePassword = true;
          return { rows: [operator], rowCount: 1 };
        }
        throw new Error(`Requête non simulée dans ce test : ${sql}`);
      },
    };
    const engineerApp = createApp(activationDb, {
      secureCookie: false,
      staticDirectory: "/tmp/ihme-test-static",
    });

    const activation = await request(engineerApp)
      .post(`/api/operators/${operator.id}/activate`)
      .set("Cookie", "ihme_session=engineer-session")
      .expect(201);
    assert.equal(activation.body.operator.name, "Thibaut");
    assert.equal(activation.body.temporaryPassword.length, 16);
    assert.equal(mustChangePassword, true);
    assert.equal(
      await bcrypt.compare(activation.body.temporaryPassword, operatorPasswordHash),
      true,
    );

    await request(engineerApp)
      .post(`/api/operators/${operator.id}/activate`)
      .set("Cookie", "ihme_session=engineer-session")
      .expect(409);
  });

  it("force le changement du mot de passe temporaire avant l’accès aux demandes", async () => {
    const operator = {
      id: "ea8fc84b-ecc8-4ea6-9c88-ef62c0e72011",
      name: "Thibaut",
      email: "test+thibaut@decathlon.com",
      role: "operator",
      must_change_password: true,
    };
    const temporaryPassword = "mot-de-passe-temporaire";
    let passwordHash = await bcrypt.hash(temporaryPassword, 4);
    let mustChangePassword = true;
    const passwordDb = {
      async query(sql, values = []) {
        if (sql.includes("FROM sessions s JOIN users u")) {
          return {
            rows: [{ ...operator, must_change_password: mustChangePassword }],
          };
        }
        if (sql === "SELECT password_hash FROM users WHERE id = $1") {
          return { rows: [{ password_hash: passwordHash }] };
        }
        if (sql.includes("UPDATE users SET password_hash = $1, must_change_password = false")) {
          passwordHash = values[0];
          mustChangePassword = false;
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("FROM test_requests r")) return { rows: [], rowCount: 0 };
        throw new Error(`Requête non simulée dans ce test : ${sql}`);
      },
    };
    const operatorApp = createApp(passwordDb, {
      secureCookie: false,
      staticDirectory: "/tmp/ihme-test-static",
    });
    const cookie = "ihme_session=operator-session";

    await request(operatorApp).get("/api/auth/me").set("Cookie", cookie).expect(200);
    await request(operatorApp).get("/api/requests").set("Cookie", cookie).expect(403);
    await request(operatorApp)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({
        currentPassword: temporaryPassword,
        newPassword: "mot-de-passe-opérateur-final",
      })
      .expect(200);
    await request(operatorApp).get("/api/requests").set("Cookie", cookie).expect(200);
  });

  it("empêche un autre opérateur de planifier une demande déjà assignée", async () => {
    const response = await request(app)
      .patch("/api/requests/ea8fc84b-ecc8-4ea6-9c88-ef62c0e72013/schedule")
      .set("Cookie", "ihme_session=operator-session")
      .send({ scheduledDate: "2027-02-20" })
      .expect(409);
    assert.match(response.body.error, /disponible à la planification/);
  });

  it("vérifie le profil sélectionné avant d’ouvrir une session de connexion", async () => {
    const password = "mot-de-passe-essais-solide";
    const passwordHash = await bcrypt.hash(password, 4);
    let sessionCreated = false;
    const loginDb = {
      async query(sql) {
        if (sql.includes("FROM users WHERE email = $1")) {
          return {
            rows: [{
              id: "ea8fc84b-ecc8-4ea6-9c88-ef62c0e72011",
              name: "Thibaut",
              email: "test+thibaut@decathlon.com",
              password_hash: passwordHash,
              role: "operator",
              must_change_password: false,
            }],
          };
        }
        if (sql.includes("INSERT INTO sessions")) {
          sessionCreated = true;
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Requête non simulée dans ce test : ${sql}`);
      },
    };
    const loginApp = createApp(loginDb, {
      secureCookie: false,
      staticDirectory: "/tmp/ihme-test-static",
    });

    await request(loginApp)
      .post("/api/auth/login")
      .send({ email: "test+thibaut@decathlon.com", password, expectedRole: "engineer" })
      .expect(403);
    assert.equal(sessionCreated, false);

    const response = await request(loginApp)
      .post("/api/auth/login")
      .send({ email: "test+thibaut@decathlon.com", password, expectedRole: "operator" })
      .expect(200);
    assert.equal(response.body.user.role, "operator");
    assert.equal(sessionCreated, true);
  });

  it("crée uniquement un compte ingénieur et gère une session jusqu’à la déconnexion", async () => {
    const storedSessions = new Set();
    const user = {
      id: "ea8fc84b-ecc8-4ea6-9c88-ef62c0e72011",
      name: "Alex Martin",
      email: "alex@example.com",
      role: "engineer",
    };
    const authDb = {
      async query(sql, values = []) {
        if (sql.includes("INSERT INTO users")) return { rows: [user], rowCount: 1 };
        if (sql.includes("INSERT INTO sessions")) {
          storedSessions.add(values[0]);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("FROM sessions s JOIN users u")) {
          return {
            rows: storedSessions.has(values[0]) ? [user] : [],
          };
        }
        if (sql.includes("DELETE FROM sessions")) {
          storedSessions.delete(values[0]);
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Requête non simulée dans ce test : ${sql}`);
      },
    };
    const agent = request.agent(
      createApp(authDb, { secureCookie: false, staticDirectory: "/tmp/ihme-test-static" }),
    );

    const registered = await agent
      .post("/api/auth/register")
      .send({
        name: "Alex Martin",
        email: "Alex@example.com",
        password: "mot-de-passe-solide",
        role: "operator",
      })
      .expect(201);
    assert.equal(registered.body.user.role, "engineer");
    await agent.get("/api/auth/me").expect(200);
    await agent.post("/api/auth/logout").expect(204);
    await agent.get("/api/auth/me").expect(401);
  });
});

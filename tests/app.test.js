import assert from "node:assert/strict";
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
        dueDate: "2027-01-15",
        priority: "high",
      }),
      {
        productReference: "PRD-14",
        quantity: 3,
        testFamily: "Thermique",
        dueDate: "2027-01-15",
        priority: "high",
      },
    );
  });

  it("refuse une date impossible, une quantité décimale ou une famille inconnue", () => {
    const validRequest = {
      productReference: "PRD-14",
      quantity: 1,
      testFamily: "Impact",
      dueDate: "2027-02-28",
      priority: "normal",
    };
    assert.throws(() => validateRequest({ ...validRequest, dueDate: "2027-02-30" }));
    assert.throws(() => validateRequest({ ...validRequest, quantity: 1.5 }));
    assert.throws(() => validateRequest({ ...validRequest, testFamily: "Chimique" }));
    assert.throws(() => validateRequest(null));
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
          }],
        };
      }
      if (sql === "SELECT 1") return { rows: [{ "?column?": 1 }] };
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

  it("réserve la création de demande aux ingénieurs", async () => {
    await request(app)
      .post("/api/requests")
      .set("Cookie", "ihme_session=test-session")
      .send({})
      .expect(403);
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

import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = `${import.meta.env.BASE_URL}api`;
const TEST_FAMILIES = ["Impact", "Thermique", "Mécanique"];
const STATUS_LABELS = {
  requested: "Demandée",
  scheduled: "Planifiée",
  in_progress: "En cours",
  pending_validation: "À valider",
  done: "Terminée",
};
const PRIORITY_LABELS = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
  urgent: "Urgente",
};

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    ...options,
  });
  let payload = {};
  if (response.status !== 204) {
    try {
      payload = await response.json();
    } catch {
      throw new Error("Le serveur a renvoyé une réponse illisible.");
    }
  }
  if (!response.ok) {
    throw Object.assign(new Error(payload.error || "Une erreur est survenue."), {
      status: response.status,
    });
  }
  return payload;
}

function App() {
  const [user, setUser] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("all");
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    const [session, requestList] = await Promise.all([
      api("/auth/me"),
      api("/requests"),
    ]);
    setUser(session.user);
    setRequests(requestList.requests);
  }, []);

  useEffect(() => {
    refresh()
      .catch((caught) => {
        setUser(null);
        if (caught.status !== 401) setError(caught.message);
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const visibleRequests = useMemo(() => {
    if (view === "all") return requests;
    if (view === "open") return requests.filter((item) => item.status !== "done");
    return requests.filter((item) => item.status === view);
  }, [requests, view]);

  async function perform(action) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(caught.message);
    }
  }

  if (loading) {
    return <main className="loading-screen">Chargement de votre espace…</main>;
  }
  if (!user) {
    return (
      <AuthScreen
        serverError={error}
        onAuthenticated={(authenticatedUser) => {
          setUser(authenticatedUser);
          refresh().catch((caught) => setError(caught.message));
        }}
      />
    );
  }

  const isOperator = user.role === "operator";
  const openCount = requests.filter((item) => item.status !== "done").length;
  const validationCount = requests.filter(
    (item) => item.status === "pending_validation",
  ).length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Accueil">
          <span className="brand-mark">L</span>
          <span>
            <strong>LABORATOIRE</strong>
            <small>Suivi des tests produit</small>
          </span>
        </a>
        <div className="account">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="account-copy">
            <strong>{user.name}</strong>
            <small>{isOperator ? "Opérateur laboratoire" : "Ingénieur produit"}</small>
          </span>
          <button
            className="button button-quiet"
            onClick={async () => {
              setError("");
              try {
                await api("/auth/logout", { method: "POST" });
                setUser(null);
              } catch (caught) {
                setError(caught.message);
              }
            }}
          >
            Déconnexion
          </button>
        </div>
      </header>

      <section className="welcome">
        <div>
          <p className="eyebrow">ESPACE {isOperator ? "LABORATOIRE" : "PRODUIT"}</p>
          <h1>Bonjour, {user.name.split(" ")[0]}.</h1>
          <p className="muted">
            {isOperator
              ? "Retrouvez les demandes et consignez les résultats de vos essais."
              : "Suivez vos demandes de test, de la planification à la validation."}
          </p>
        </div>
        {!isOperator && (
          <button className="button button-primary" onClick={() => setShowForm(true)}>
            <span aria-hidden="true">＋</span> Nouvelle demande
          </button>
        )}
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="summary-grid" aria-label="Résumé des demandes">
        <SummaryCard label="Demandes visibles" value={requests.length} icon="▤" />
        <SummaryCard label="En cours" value={openCount} icon="◷" />
        <SummaryCard
          label={isOperator ? "À traiter" : "À valider"}
          value={validationCount}
          icon="✓"
          accent
        />
      </section>

      <section className="list-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">VOTRE ACTIVITÉ</p>
            <h2>{isOperator ? "Demandes du laboratoire" : "Mes demandes"}</h2>
          </div>
          <label className="filter-control">
            <span className="sr-only">Filtrer les demandes</span>
            <select value={view} onChange={(event) => setView(event.target.value)}>
              <option value="all">Toutes les demandes</option>
              <option value="open">Demandes ouvertes</option>
              <option value="pending_validation">À valider</option>
              <option value="done">Terminées</option>
            </select>
          </label>
        </div>
        {visibleRequests.length ? (
          <div className="request-list">
            {visibleRequests.map((item) => (
              <RequestCard
                key={item.id}
                item={item}
                user={user}
                onAction={perform}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">⌕</span>
            <h3>Aucune demande pour le moment</h3>
            <p>
              {isOperator
                ? "Les demandes disponibles apparaîtront ici."
                : "Créez une demande pour lancer un essai au laboratoire."}
            </p>
          </div>
        )}
      </section>

      {showForm && (
        <RequestModal
          onClose={() => setShowForm(false)}
          onSubmit={async (body) => {
            await api("/requests", { method: "POST", body: JSON.stringify(body) });
            await refresh();
            setShowForm(false);
          }}
        />
      )}
      <footer className="page-footer">Suivi des tests produit · Espace laboratoire</footer>
    </main>
  );
}

function SummaryCard({ label, value, icon, accent }) {
  return (
    <article className={`summary-card${accent ? " summary-card-accent" : ""}`}>
      <span className="summary-icon">{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function RequestCard({ item, user, onAction }) {
  const isOperator = user.role === "operator";
  const [scheduledDate, setScheduledDate] = useState(item.scheduled_date || "");
  const [verdict, setVerdict] = useState("conforming");
  const [comment, setComment] = useState("");
  const canOperate =
    isOperator &&
    item.status !== "done" &&
    item.status !== "pending_validation" &&
    (!item.assigned_operator_id || item.assigned_operator_id === user.id);
  const canValidate =
    !isOperator && item.status === "pending_validation" && item.requester_id === user.id;

  return (
    <article className="request-card">
      <div className="request-main">
        <div className="request-title-row">
          <h3>{item.product_reference}</h3>
          <span className={`status status-${item.status}`}>
            <span className="status-dot" />
            {STATUS_LABELS[item.status]}
          </span>
        </div>
        <p className="request-subtitle">
          {item.test_family} <span>·</span> {item.quantity} échantillon
          {item.quantity > 1 ? "s" : ""}
        </p>
        <div className="request-meta">
          <span>
            <span aria-hidden="true">◷</span> Échéance{" "}
            {new Date(`${item.due_date}T00:00:00`).toLocaleDateString("fr-FR")}
          </span>
          <span className={`priority priority-${item.priority}`}>
            Priorité {PRIORITY_LABELS[item.priority]}
          </span>
          {item.assigned_operator_name && (
            <span>Opérateur : {item.assigned_operator_name}</span>
          )}
        </div>
        {item.result_verdict && (
          <div className={`result-note ${item.result_verdict === "conforming" ? "result-ok" : "result-fail"}`}>
            <strong>
              {item.result_verdict === "conforming" ? "Conforme" : "Non conforme"}
            </strong>
            {item.result_comment && <span> — {item.result_comment}</span>}
          </div>
        )}
      </div>
      {(canOperate || canValidate) && (
        <div className="request-actions">
          {canOperate && item.status === "requested" && (
            <form
              className="inline-action"
              onSubmit={(event) => {
                event.preventDefault();
                onAction(() =>
                  api(`/requests/${item.id}/schedule`, {
                    method: "PATCH",
                    body: JSON.stringify({ scheduledDate }),
                  }),
                );
              }}
            >
              <label>
                Date de planification
                <input
                  type="date"
                  required
                  value={scheduledDate}
                  onChange={(event) => setScheduledDate(event.target.value)}
                />
              </label>
              <button className="button button-secondary">Planifier</button>
            </form>
          )}
          {canOperate && item.status === "scheduled" && (
            <button
              className="button button-secondary"
              onClick={() =>
                onAction(() =>
                  api(`/requests/${item.id}/start`, { method: "PATCH" }),
                )
              }
            >
              Démarrer l’essai
            </button>
          )}
          {canOperate && item.status === "in_progress" && (
            <form
              className="inline-action result-form"
              onSubmit={(event) => {
                event.preventDefault();
                onAction(() =>
                  api(`/requests/${item.id}/result`, {
                    method: "PUT",
                    body: JSON.stringify({ verdict, comment }),
                  }),
                );
              }}
            >
              <label>
                Verdict
                <select value={verdict} onChange={(event) => setVerdict(event.target.value)}>
                  <option value="conforming">Conforme</option>
                  <option value="non_conforming">Non conforme</option>
                </select>
              </label>
              <label className="comment-field">
                Commentaire
                <input
                  required
                  maxLength="2000"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Observations utiles au demandeur"
                />
              </label>
              <button className="button button-secondary">Envoyer en validation</button>
            </form>
          )}
          {canValidate && (
            <button
              className="button button-primary"
              onClick={() =>
                onAction(() =>
                  api(`/requests/${item.id}/validate`, { method: "PATCH" }),
                )
              }
            >
              Valider et clôturer
            </button>
          )}
        </div>
      )}
      <div className="request-owner">
        Demandeur : {item.requester_name}
      </div>
    </article>
  );
}

function RequestModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({
    productReference: "",
    quantity: "1",
    testFamily: TEST_FAMILIES[0],
    dueDate: "",
    priority: "normal",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSubmit({ ...form, quantity: Number(form.quantity) });
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">NOUVEAU TEST</p>
            <h2 id="modal-title">Créer une demande</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <form className="request-form" onSubmit={submit}>
          <label>
            Référence produit
            <input
              required
              maxLength="120"
              value={form.productReference}
              onChange={(event) => setForm({ ...form, productReference: event.target.value })}
              placeholder="Ex. PRD-2026-014"
            />
          </label>
          <div className="form-grid">
            <label>
              Quantité d’échantillons
              <input
                type="number"
                min="1"
                max="10000"
                required
                value={form.quantity}
                onChange={(event) => setForm({ ...form, quantity: event.target.value })}
              />
            </label>
            <label>
              Famille de test
              <select
                value={form.testFamily}
                onChange={(event) => setForm({ ...form, testFamily: event.target.value })}
              >
                {TEST_FAMILIES.map((family) => <option key={family}>{family}</option>)}
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label>
              Date limite
              <input
                type="date"
                required
                min={new Date().toISOString().slice(0, 10)}
                value={form.dueDate}
                onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
              />
            </label>
            <label>
              Priorité
              <select
                value={form.priority}
                onChange={(event) => setForm({ ...form, priority: event.target.value })}
              >
                <option value="low">Basse</option>
                <option value="normal">Normale</option>
                <option value="high">Haute</option>
                <option value="urgent">Urgente</option>
              </select>
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="button button-quiet" onClick={onClose}>Annuler</button>
            <button className="button button-primary" disabled={saving}>
              {saving ? "Création…" : "Créer la demande"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AuthScreen({ onAuthenticated, serverError }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const payload = await api(path, {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      onAuthenticated(payload.user);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-intro">
        <a className="brand brand-light" href={import.meta.env.BASE_URL}>
          <span className="brand-mark">L</span>
          <span><strong>LABORATOIRE</strong><small>Suivi des tests produit</small></span>
        </a>
        <div className="auth-message">
          <p className="eyebrow">DEMANDE · ESSAI · VALIDATION</p>
          <h1>Les bons tests,<br />au bon moment.</h1>
          <p>Un espace partagé pour suivre chaque essai laboratoire, du besoin produit au résultat validé.</p>
        </div>
        <p className="auth-caption">Impact · Thermique · Mécanique</p>
      </div>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">ESPACE SÉCURISÉ</p>
          <h2>{mode === "login" ? "Ravi de vous revoir." : "Créer un compte ingénieur."}</h2>
          <p className="muted">
            {mode === "login"
              ? "Connectez-vous pour retrouver votre activité."
              : "L’inscription est réservée aux ingénieurs produits."}
          </p>
          {(error || serverError) && (
            <div className="alert alert-error">{error || serverError}</div>
          )}
          <form className="auth-form" onSubmit={submit}>
            {mode === "register" && (
              <label>
                Nom complet
                <input required minLength="2" maxLength="100" value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            )}
            <label>
              Adresse e-mail
              <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              Mot de passe
              <input
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength="12"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {mode === "register" && <small className="field-hint">12 caractères minimum.</small>}
            </label>
            <button className="button button-primary auth-submit" disabled={loading}>
              {loading ? "Veuillez patienter…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
            </button>
          </form>
          <p className="auth-switch">
            {mode === "login" ? "Pas encore de compte ?" : "Vous avez déjà un compte ?"}{" "}
            <button
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
            >
              {mode === "login" ? "Créer un compte" : "Se connecter"}
            </button>
          </p>
        </div>
        <p className="auth-legal">Accès réservé aux utilisateurs autorisés.</p>
      </section>
    </main>
  );
}

export default App;

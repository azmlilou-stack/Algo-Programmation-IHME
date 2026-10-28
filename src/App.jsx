import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import helmetIllustration from "./assets/bike-helmet-realistic.png";

const API_BASE = `${import.meta.env.BASE_URL}api`;
const TEST_FAMILIES = ["Impact", "Thermique", "Mécanique"];
const PRODUCT_CATEGORIES = ["Body protection", "maintien articulaire", "casque"];
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
const REQUEST_FILTERS = [
  { value: "all", label: "Toutes" },
  { value: "open", label: "En cours" },
  { value: "pending_validation", label: "À valider" },
  { value: "done", label: "Terminées" },
];
const TRIAL_TABLE_FILTERS = [
  { value: "all", label: "Toutes" },
  { value: "todo", label: "À faire" },
  { value: "active", label: "En cours" },
  { value: "pending_validation", label: "À valider" },
  { value: "past", label: "Passées" },
  { value: "done", label: "Validées" },
];
const URGENT_WITHIN_DAYS = 7;

function getDateUrgency(request) {
  if (["pending_validation", "done"].includes(request.status)) return null;
  const due = new Date(`${request.due_date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilDue = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
  return daysUntilDue < 0
    ? { daysUntilDue, label: `En retard de ${Math.abs(daysUntilDue)} j`, overdue: true }
    : daysUntilDue <= URGENT_WITHIN_DAYS
      ? { daysUntilDue, label: `Échéance dans ${daysUntilDue} j`, overdue: false }
      : null;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR");
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getInitialTheme() {
  try {
    const savedTheme = window.localStorage.getItem("ihme-theme");
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  } catch {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

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
  const [theme, setTheme] = useState(getInitialTheme);
  const [user, setUser] = useState(null);
  const [requests, setRequests] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("all");
  const [tableFilter, setTableFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedTab, setSelectedTab] = useState("requests");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [facets, setFacets] = useState({
    category: "all",
    priority: "all",
    operator: "all",
  });
  const [showForm, setShowForm] = useState(false);
  const [activatingOperatorId, setActivatingOperatorId] = useState("");
  const [temporaryCredentials, setTemporaryCredentials] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem("ihme-theme", theme);
    } catch {
      // The selected theme remains active for the current page view.
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === "light" ? "dark" : "light"));
  }

  const refresh = useCallback(async () => {
    const session = await api("/auth/me");
    setUser(session.user);
    if (session.user.must_change_password) {
      setRequests([]);
      setOperators([]);
      return;
    }
    const requestList = await api("/requests");
    setRequests(requestList.requests);
    if (session.user.role === "engineer") {
      const operatorList = await api("/operators");
      setOperators(operatorList.operators);
    } else {
      setOperators([]);
    }
  }, []);

  useEffect(() => {
    refresh()
      .catch((caught) => {
        setUser(null);
        if (caught.status !== 401) setError(caught.message);
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const facetFilteredRequests = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("fr");
    return requests.filter((item) => {
      const matchesCategory =
        facets.category === "all" || item.product_category === facets.category;
      const matchesPriority =
        facets.priority === "all" || item.priority === facets.priority;
      const matchesOperator =
        facets.operator === "all" ||
        (facets.operator === "unassigned"
          ? !item.assigned_operator_id
          : item.assigned_operator_id === facets.operator);
      const matchesSearch =
        !query ||
        [
          item.product_reference,
          item.test_family,
          item.product_category,
          item.requester_name,
          item.assigned_operator_name,
        ]
          .filter(Boolean)
          .some((value) => value.toLocaleLowerCase("fr").includes(query));
      return matchesCategory && matchesPriority && matchesOperator && matchesSearch;
    });
  }, [facets, requests, search]);

  const visibleRequests = useMemo(
    () =>
      facetFilteredRequests.filter((item) =>
        view === "all" ||
        (view === "open" && item.status !== "done") ||
        item.status === view,
      ),
    [facetFilteredRequests, view],
  );
  const assignedOperators = useMemo(() => {
    const byId = new Map(
      operators.map((operator) => [operator.id, operator.name]),
    );
    requests.forEach((item) => {
      if (item.assigned_operator_id && item.assigned_operator_name) {
        byId.set(item.assigned_operator_id, item.assigned_operator_name);
      }
    });
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [operators, requests]);

  async function perform(action) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(caught.message);
    }
  }

  async function activateOperator(operator) {
    setError("");
    setActivatingOperatorId(operator.id);
    try {
      const result = await api(`/operators/${operator.id}/activate`, {
        method: "POST",
      });
      setTemporaryCredentials({
        name: result.operator.name,
        email: result.operator.email,
        password: result.temporaryPassword,
      });
      await refresh();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setActivatingOperatorId("");
    }
  }

  if (loading) {
    return <main className="loading-screen">Chargement de votre espace…</main>;
  }
  if (!user) {
    return (
      <AuthScreen
        serverError={error}
        theme={theme}
        onToggleTheme={toggleTheme}
        onAuthenticated={(authenticatedUser) => {
          setUser(authenticatedUser);
          refresh().catch((caught) => setError(caught.message));
        }}
      />
    );
  }
  if (user.must_change_password) {
    return (
      <PasswordChangeScreen
        user={user}
        theme={theme}
        onToggleTheme={toggleTheme}
        onChanged={() => refresh().catch((caught) => setError(caught.message))}
      />
    );
  }

  const isOperator = user.role === "operator";
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
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="account-copy">
            <strong>{user.name}</strong>
            <small>{isOperator ? "Ingénieur essais" : "Ingénieur produit"}</small>
          </span>
          <button
            className="button button-quiet"
            onClick={async () => {
              setError("");
              try {
                await api("/auth/logout", { method: "POST" });
                setTemporaryCredentials(null);
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

      <section className={`welcome welcome-compact${isOperator ? " welcome-trials" : ""}`}>
        <div className="welcome-copy">
          <p className="eyebrow">ESPACE {isOperator ? "INGÉNIEUR ESSAIS" : "PRODUIT"}</p>
          <h1>
            Bonjour, {user.name.split(" ")[0]}
            <span className="welcome-period">.</span>
          </h1>
          <p className="welcome-description">
            {isOperator
              ? "Pilotez les essais, leurs échéances et les résultats du laboratoire."
              : "De la demande au résultat validé, gardez un œil sur chaque essai."}
          </p>
        </div>
        {!isOperator && (
          <button className="button button-primary new-request-button" onClick={() => setShowForm(true)}>
            <span aria-hidden="true">＋</span> Nouvelle demande
          </button>
        )}
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      <nav className="workspace-tabs" aria-label="Sections du laboratoire">
        <button
          className={`workspace-tab${selectedTab === "requests" ? " is-active" : ""}`}
          aria-current={selectedTab === "requests" ? "page" : undefined}
          onClick={() => setSelectedTab("requests")}
        >
          Demandes <span>{requests.length}</span>
        </button>
        <button
          className={`workspace-tab${selectedTab === "calendar" ? " is-active" : ""}`}
          aria-current={selectedTab === "calendar" ? "page" : undefined}
          onClick={() => setSelectedTab("calendar")}
        >
          Calendrier
        </button>
        {!isOperator && (
          <button
            className={`workspace-tab${selectedTab === "team" ? " is-active" : ""}`}
            aria-current={selectedTab === "team" ? "page" : undefined}
            onClick={() => setSelectedTab("team")}
          >
            Équipe
          </button>
        )}
      </nav>

      {selectedTab === "team" && !isOperator ? (
        <OperatorManagement
          operators={operators}
          activatingOperatorId={activatingOperatorId}
          temporaryCredentials={temporaryCredentials}
          onActivate={activateOperator}
          onDismissCredentials={() => setTemporaryCredentials(null)}
        />
      ) : selectedTab === "calendar" ? (
        <CalendarView
          requests={facetFilteredRequests}
          month={calendarMonth}
          onMonthChange={setCalendarMonth}
          search={search}
          onSearch={setSearch}
          operators={assignedOperators}
          facets={facets}
          onFacetsChange={setFacets}
        />
      ) : isOperator ? (
        <TrialDashboard
          requests={requests}
          operators={assignedOperators}
          facets={facets}
          onFacetsChange={setFacets}
          search={search}
          onSearch={setSearch}
          filter={tableFilter}
          onFilter={setTableFilter}
          user={user}
          onAction={perform}
        />
      ) : (
        <section className="list-section request-workspace">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SUIVI DU LABORATOIRE</p>
              <h2>Mes demandes</h2>
              <p className="section-description">
                Retrouvez le statut, les échéances et les résultats de vos tests.
              </p>
            </div>
          </div>
          <div className="list-toolbar">
            <div className="filter-tabs" role="group" aria-label="Filtrer les demandes">
              {REQUEST_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  className={`filter-tab${view === filter.value ? " filter-tab-active" : ""}`}
                  aria-pressed={view === filter.value}
                  onClick={() => setView(filter.value)}
                >
                  {filter.label}
                  <span>
                    {filter.value === "all"
                      ? requests.length
                      : filter.value === "open"
                        ? requests.filter((item) => item.status !== "done").length
                        : requests.filter((item) => item.status === filter.value).length}
                  </span>
                </button>
              ))}
            </div>
            <label className="search-control">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Rechercher une demande</span>
              <input
                type="search"
                placeholder="Référence, essai…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          <FacetFilters
            operators={assignedOperators}
            facets={facets}
            onChange={setFacets}
          />
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
              <span className="empty-icon">{search ? "⌕" : "✳"}</span>
              <h3>
                {search
                  ? "Aucune demande ne correspond"
                  : requests.length
                    ? "Rien dans cette sélection"
                    : "Aucune demande pour le moment"}
              </h3>
              <p>
                {search
                  ? "Essayez une autre référence ou un autre terme de recherche."
                  : requests.length
                    ? "Choisissez un autre filtre pour consulter les demandes."
                    : "Créez une demande pour lancer un essai au laboratoire."}
              </p>
            </div>
          )}
        </section>
      )}

      {showForm && (
        <RequestModal
          operators={operators}
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

function FacetFilters({ operators, facets, onChange }) {
  function update(field, value) {
    onChange((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="facet-filters" aria-label="Filtres détaillés">
      <label>
        Catégorie
        <select
          value={facets.category}
          onChange={(event) => update("category", event.target.value)}
        >
          <option value="all">Toutes les catégories</option>
          {PRODUCT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
        </select>
      </label>
      <label>
        Priorité
        <select
          value={facets.priority}
          onChange={(event) => update("priority", event.target.value)}
        >
          <option value="all">Toutes les priorités</option>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        Ingénieur essais
        <select
          value={facets.operator}
          onChange={(event) => update("operator", event.target.value)}
        >
          <option value="all">Tous les responsables</option>
          <option value="unassigned">Non assignées</option>
          {operators.map((operator) => (
            <option key={operator.id} value={operator.id}>{operator.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function CalendarView({
  requests,
  month,
  onMonthChange,
  search,
  onSearch,
  operators,
  facets,
  onFacetsChange,
}) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - ((firstDay.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
  const eventsByDate = new Map();
  function addEvent(date, event) {
    if (!date) return;
    const events = eventsByDate.get(date) || [];
    events.push(event);
    eventsByDate.set(date, events);
  }
  requests.forEach((item) => {
    if (item.scheduled_date) {
      addEvent(String(item.scheduled_date).slice(0, 10), {
        type: "scheduled",
        item,
      });
    }
    if (item.due_date) {
      addEvent(String(item.due_date).slice(0, 10), {
        type: "deadline",
        item,
      });
    }
  });
  const todayKey = dateKey(new Date());
  const title = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
  }).format(month);

  return (
    <section className="calendar-view" aria-labelledby="calendar-title">
      <div className="calendar-heading">
        <div>
          <p className="eyebrow">VUE PLANNING</p>
          <h2 id="calendar-title">Calendrier des essais</h2>
          <p className="section-description">
            Retrouvez les dates planifiées et les échéances maximales de chaque demande.
          </p>
        </div>
        <div className="calendar-tools">
          <label className="search-control calendar-search">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">Rechercher un essai du calendrier</span>
            <input
              type="search"
              placeholder="Référence, responsable…"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </label>
          <div className="calendar-navigation" aria-label="Navigation du calendrier">
            <button
              className="button button-secondary calendar-arrow"
              aria-label="Mois précédent"
              onClick={() => onMonthChange((current) => addMonths(current, -1))}
            >
              ‹
            </button>
            <strong aria-live="polite">{title}</strong>
            <button
              className="button button-secondary calendar-arrow"
              aria-label="Mois suivant"
              onClick={() => onMonthChange((current) => addMonths(current, 1))}
            >
              ›
            </button>
            <button
              className="button button-quiet calendar-today"
              onClick={() => onMonthChange(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
            >
              Aujourd’hui
            </button>
          </div>
        </div>
      </div>
      <div className="calendar-legend" aria-label="Légende">
        <span><i className="calendar-dot calendar-dot-scheduled" /> Test planifié</span>
        <span><i className="calendar-dot calendar-dot-deadline" /> Échéance maximale</span>
      </div>
      <FacetFilters operators={operators} facets={facets} onChange={onFacetsChange} />
      <div className="calendar-grid" role="grid" aria-labelledby="calendar-title">
        {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((weekday) => (
          <div className="calendar-weekday" role="columnheader" key={weekday}>{weekday}</div>
        ))}
        {days.map((date) => {
          const key = dateKey(date);
          const events = eventsByDate.get(key) || [];
          return (
            <div
              className={[
                "calendar-day",
                date.getMonth() !== month.getMonth() ? "is-outside-month" : "",
                key === todayKey ? "is-today" : "",
              ].filter(Boolean).join(" ")}
              role="gridcell"
              aria-label={`${date.toLocaleDateString("fr-FR", { dateStyle: "full" })}, ${events.length} jalon${events.length > 1 ? "s" : ""}`}
              key={key}
            >
              <span className="calendar-day-number">{date.getDate()}</span>
              <div className="calendar-day-events">
                {events.slice(0, 3).map(({ item, type }, index) => (
                  <div
                    className={`calendar-event calendar-event-${type}`}
                    title={`${item.product_reference} — ${type === "scheduled" ? "test planifié" : "échéance maximale"} · ${item.assigned_operator_name || "Non assignée"}`}
                    key={`${item.id}-${type}-${index}`}
                  >
                    <strong>{item.product_reference}</strong>
                    <span>{type === "scheduled" ? "Test" : "Échéance max."}</span>
                  </div>
                ))}
                {events.length > 3 && (
                  <small className="calendar-more">+{events.length - 3} autres</small>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TrialDashboard({
  requests,
  operators,
  facets,
  onFacetsChange,
  search,
  onSearch,
  filter,
  onFilter,
  user,
  onAction,
}) {
  const [expandedRequestId, setExpandedRequestId] = useState("");
  const query = search.trim().toLocaleLowerCase("fr");
  const filteredRequests = requests
    .filter((item) => {
      if (facets.category !== "all" && item.product_category !== facets.category) {
        return false;
      }
      if (facets.priority !== "all" && item.priority !== facets.priority) {
        return false;
      }
      if (
        facets.operator !== "all" &&
        (facets.operator === "unassigned"
          ? Boolean(item.assigned_operator_id)
          : item.assigned_operator_id !== facets.operator)
      ) {
        return false;
      }
      if (filter === "todo" && item.status !== "requested") return false;
      if (filter === "active" && !["scheduled", "in_progress"].includes(item.status)) {
        return false;
      }
      if (filter === "pending_validation" && item.status !== "pending_validation") {
        return false;
      }
      if (filter === "past" && !["pending_validation", "done"].includes(item.status)) {
        return false;
      }
      if (filter === "done" && item.status !== "done") return false;
      if (!query) return true;
      return [
        item.product_reference,
        item.product_category,
        item.test_family,
        item.requester_name,
        item.assigned_operator_name,
      ]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase("fr").includes(query));
    })
    .sort((left, right) => {
      const urgencyDifference =
        (getDateUrgency(left)?.daysUntilDue ?? Number.POSITIVE_INFINITY) -
        (getDateUrgency(right)?.daysUntilDue ?? Number.POSITIVE_INFINITY);
      return urgencyDifference || new Date(left.due_date) - new Date(right.due_date);
    });
  const urgencyRequests = filteredRequests
    .map((item) => ({ item, urgency: getDateUrgency(item) }))
    .filter(({ urgency }) => urgency)
    .sort((left, right) => left.urgency.daysUntilDue - right.urgency.daysUntilDue);
  const countFor = (statuses) =>
    requests.filter((item) => statuses.includes(item.status)).length;
  const counts = {
    all: requests.length,
    todo: countFor(["requested"]),
    active: countFor(["scheduled", "in_progress"]),
    pending_validation: countFor(["pending_validation"]),
    past: countFor(["pending_validation", "done"]),
    done: countFor(["done"]),
  };

  return (
    <section className="trial-dashboard" aria-labelledby="trials-title">
      <div className="trial-dashboard-heading">
        <div>
          <p className="eyebrow">PILOTAGE DES ESSAIS</p>
          <h2 id="trials-title">Tableau des demandes</h2>
          <p className="section-description">
            Les échéances proches et en retard sont signalées en priorité.
          </p>
        </div>
        <span className="trial-total">{requests.length} demande{requests.length > 1 ? "s" : ""}</span>
      </div>

      {urgencyRequests.length > 0 && (
        <aside className="deadline-alert" aria-live="polite">
          <span className="deadline-alert-icon" aria-hidden="true">!</span>
          <div>
            <strong>
              {urgencyRequests.length} demande{urgencyRequests.length > 1 ? "s" : ""} à traiter rapidement
            </strong>
            <ul>
              {urgencyRequests.slice(0, 4).map(({ item, urgency }) => (
                <li key={item.id}>
                  <span>{item.product_reference}</span>
                  <strong className={urgency.overdue ? "is-overdue" : ""}>
                    {urgency.label}
                  </strong>
                </li>
              ))}
            </ul>
            {urgencyRequests.length > 4 && (
              <small>Et {urgencyRequests.length - 4} autre{urgencyRequests.length - 4 > 1 ? "s" : ""} demande{urgencyRequests.length - 4 > 1 ? "s" : ""} à échéance proche.</small>
            )}
          </div>
        </aside>
      )}

      <div className="trial-table-toolbar">
        <div className="trial-filters" role="group" aria-label="Filtrer les demandes">
          {TRIAL_TABLE_FILTERS.map((item) => (
            <button
              key={item.value}
              className={`trial-filter${filter === item.value ? " is-active" : ""}`}
              aria-pressed={filter === item.value}
              onClick={() => onFilter(item.value)}
            >
              {item.label}<span>{counts[item.value]}</span>
            </button>
          ))}
        </div>
        <FacetFilters operators={operators} facets={facets} onChange={onFacetsChange} />
        <label className="search-control">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Rechercher un essai</span>
          <input
            type="search"
            placeholder="Référence, catégorie, demandeur…"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
      </div>

      {filteredRequests.length ? (
        <div className="trial-table-scroll">
          <table className="trial-table">
            <thead>
              <tr>
                <th scope="col">Demande / essai</th>
                <th scope="col">Demandeur</th>
                <th scope="col">Créée le</th>
                <th scope="col">Planifiée le</th>
                <th scope="col">Échéance</th>
                <th scope="col">Résultat envoyé</th>
                <th scope="col">Validée le</th>
                <th scope="col">État</th>
                <th scope="col">Priorité</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map((item) => {
                const urgency = getDateUrgency(item);
                const expanded = expandedRequestId === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr className={urgency?.overdue ? "trial-row-overdue" : ""}>
                      <td>
                        <strong className="trial-reference">{item.product_reference}</strong>
                        <span className="trial-description">
                          {item.product_category || "Catégorie non renseignée"} · {item.test_family}
                        </span>
                      </td>
                      <td>{item.requester_name}</td>
                      <td>{formatDate(item.created_at)}</td>
                      <td>{formatDate(item.scheduled_date)}</td>
                      <td>
                        <span>{formatDate(item.due_date)}</span>
                        {urgency && (
                          <small className={`trial-deadline${urgency.overdue ? " is-overdue" : ""}`}>
                            {urgency.label}
                          </small>
                        )}
                      </td>
                      <td>{formatDate(item.submitted_at)}</td>
                      <td>{formatDate(item.validated_at)}</td>
                      <td>
                        <span className={`status status-${item.status}`}>
                          <span className="status-dot" />{STATUS_LABELS[item.status]}
                        </span>
                      </td>
                      <td><span className={`priority priority-${item.priority}`}>{PRIORITY_LABELS[item.priority]}</span></td>
                      <td>
                        <button
                          className="button button-secondary trial-actions-button"
                          aria-expanded={expanded}
                          onClick={() => setExpandedRequestId(expanded ? "" : item.id)}
                        >
                          {expanded ? "Fermer" : "Détails / actions"}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="trial-expanded-row">
                        <td colSpan="10">
                          <RequestCard item={item} user={user} onAction={onAction} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state trial-empty-state">
          <span className="empty-icon">{search ? "⌕" : "✳"}</span>
          <h3>{search ? "Aucune demande ne correspond" : "Aucune demande dans cette sélection"}</h3>
          <p>
            {search
              ? "Essayez une autre référence, catégorie ou nom de demandeur."
              : "Les demandes correspondant à ce statut apparaîtront ici."}
          </p>
        </div>
      )}
    </section>
  );
}

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === "dark";
  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={isDark ? "Activer le mode jour" : "Activer le mode nuit"}
      aria-pressed={isDark}
      title={isDark ? "Mode nuit activé" : "Mode jour activé"}
      onClick={onToggle}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {isDark ? "☀" : "☾"}
      </span>
      <span className="theme-toggle-label">{isDark ? "Mode jour" : "Mode nuit"}</span>
    </button>
  );
}

function OperatorManagement({
  operators,
  activatingOperatorId,
  temporaryCredentials,
  onActivate,
  onDismissCredentials,
}) {
  const [copyStatus, setCopyStatus] = useState("");

  async function copyCredentials() {
    try {
      await navigator.clipboard.writeText(temporaryCredentials.password);
      setCopyStatus("Mot de passe copié.");
    } catch {
      setCopyStatus("Copie indisponible : sélectionnez le mot de passe ci-dessus.");
    }
  }

  return (
    <section className="operator-management" aria-labelledby="operators-title">
      <div className="operator-management-heading">
        <div>
          <p className="eyebrow">ACCÈS AU LABORATOIRE</p>
          <h2 id="operators-title">Équipe opératrice</h2>
          <p className="section-description">
            Activez les comptes avant d’assigner les essais aux opérateurs.
          </p>
        </div>
        <span className="operator-count">
          {operators.filter((operator) => operator.activated).length}/{operators.length} actifs
        </span>
      </div>

      {temporaryCredentials && (
        <div className="credential-notice" role="status">
          <div>
            <strong>Compte activé : {temporaryCredentials.name}</strong>
            <p>
              Transmets ces identifiants à l’opérateur par un canal privé. Le mot
              de passe temporaire ne sera plus affiché après fermeture de cette
              page, et devra être changé à la première connexion.
            </p>
            <span className="credential-email">{temporaryCredentials.email}</span>
            <code className="temporary-password">{temporaryCredentials.password}</code>
            {copyStatus && <span className="copy-status">{copyStatus}</span>}
          </div>
          <div className="credential-actions">
            <button className="button button-secondary" onClick={copyCredentials}>
              Copier le mot de passe
            </button>
            <button className="button button-quiet" onClick={onDismissCredentials}>
              Fermer
            </button>
          </div>
        </div>
      )}

      <ul className="operator-list">
        {operators.map((operator) => (
          <li className="operator-row" key={operator.id}>
            <span className="operator-avatar" aria-hidden="true">
              {operator.name.slice(0, 1)}
            </span>
            <span className="operator-name">{operator.name}</span>
            <span className={`operator-state${operator.activated ? " is-active" : ""}`}>
              <span className="status-dot" />
              {operator.activated ? "Compte actif" : "À activer"}
            </span>
            {!operator.activated && (
              <button
                className="button button-secondary"
                disabled={Boolean(activatingOperatorId)}
                onClick={() => onActivate(operator)}
              >
                {activatingOperatorId === operator.id ? "Activation…" : "Activer"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PasswordChangeScreen({ user, theme, onToggleTheme, onChanged }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }

    setSaving(true);
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onChanged();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="password-page">
      <header className="topbar password-topbar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Accueil">
          <span className="brand-mark">L</span>
          <span><strong>LABORATOIRE</strong><small>Suivi des tests produit</small></span>
        </a>
        <div className="account">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <span className="account-copy"><strong>{user.name}</strong><small>Ingénieur essais</small></span>
        </div>
      </header>
      <section className="password-card">
        <p className="eyebrow">PREMIÈRE CONNEXION</p>
        <h1>Choisis ton mot de passe.</h1>
        <p className="password-description">
          Pour sécuriser ton compte, remplace le mot de passe temporaire avant
          d’accéder aux demandes de test.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        <form className="auth-form" onSubmit={submit}>
          <label>
            Mot de passe temporaire
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            Nouveau mot de passe
            <input
              type="password"
              autoComplete="new-password"
              minLength="12"
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label>
            Confirmer le nouveau mot de passe
            <input
              type="password"
              autoComplete="new-password"
              minLength="12"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          <small className="field-hint">12 caractères minimum.</small>
          <button className="button button-primary auth-submit" disabled={saving}>
            {saving ? "Mise à jour…" : "Enregistrer et continuer"}
          </button>
        </form>
      </section>
    </main>
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
          {item.product_category || "Catégorie non renseignée"} <span>·</span>{" "}
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
          <div
            className={`result-note ${item.result_verdict === "conforming" ? "result-ok" : "result-fail"}`}
            aria-label="Résultat de l’essai"
          >
            <strong>Résultat de l’essai</strong>
            <span className="result-verdict">
              {item.result_verdict === "conforming" ? "Conforme" : "Non conforme"}
            </span>
            {item.result_comment && <span>Commentaire : {item.result_comment}</span>}
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

function RequestModal({ operators, onClose, onSubmit }) {
  const [form, setForm] = useState({
    productReference: "",
    quantity: "1",
    testFamily: TEST_FAMILIES[0],
    productCategory: "",
    dueDate: "",
    priority: "normal",
    assignedOperatorId: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activeOperators = operators.filter((operator) => operator.activated);
  const selectedOperator = activeOperators.find(
    (operator) => operator.id === form.assignedOperatorId,
  );

  function updateField(field, value) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
    setError("");
  }

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
        {error && (
          <div className="alert alert-error request-form-error" role="alert">
            <strong>La demande n’a pas pu être créée.</strong>
            <span>{error}</span>
          </div>
        )}
        <form className="request-form" onSubmit={submit}>
          <label>
            Référence produit
            <input
              required
              maxLength="120"
              value={form.productReference}
              onChange={(event) => updateField("productReference", event.target.value)}
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
                onChange={(event) => updateField("quantity", event.target.value)}
              />
              <small className="field-hint">Nombre d’échantillons, de 1 à 10 000.</small>
            </label>
            <label>
              Catégorie du produit
              <select
                required
                value={form.productCategory}
                onChange={(event) => updateField("productCategory", event.target.value)}
              >
                <option value="">Choisir une catégorie</option>
                {PRODUCT_CATEGORIES.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Famille de test
            <select
              value={form.testFamily}
              onChange={(event) => updateField("testFamily", event.target.value)}
            >
              {TEST_FAMILIES.map((family) => <option key={family}>{family}</option>)}
            </select>
          </label>
          <div className="form-grid">
            <label>
              Date limite
              <input
                type="date"
                required
                min={new Date().toISOString().slice(0, 10)}
                value={form.dueDate}
                onChange={(event) => updateField("dueDate", event.target.value)}
              />
            </label>
            <label>
              Priorité
              <select
                value={form.priority}
                onChange={(event) => updateField("priority", event.target.value)}
              >
                <option value="low">Basse</option>
                <option value="normal">Normale</option>
                <option value="high">Haute</option>
                <option value="urgent">Urgente</option>
              </select>
            </label>
          </div>
          <label>
            Opérateur assigné <span className="optional-label">Optionnel</span>
            <select
              value={form.assignedOperatorId}
              disabled={activeOperators.length === 0}
              onChange={(event) => updateField("assignedOperatorId", event.target.value)}
            >
              <option value="">Laisser la demande ouverte à l’équipe</option>
              {activeOperators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.name}
                </option>
              ))}
            </select>
            {activeOperators.length === 0 && (
              <small className="field-hint">
                Active d’abord un compte dans la section « Équipe opératrice » pour
                pouvoir assigner une demande.
              </small>
            )}
          </label>
          <aside className="request-preview" aria-live="polite" aria-label="Résumé de la demande">
            <p className="eyebrow">RÉSUMÉ DE LA DEMANDE</p>
            <dl>
              <div><dt>Produit</dt><dd>{form.productReference.trim() || "À renseigner"}</dd></div>
              <div>
                <dt>Quantité</dt>
                <dd>
                  {form.quantity
                    ? `${form.quantity} échantillon${Number(form.quantity) > 1 ? "s" : ""}`
                    : "À renseigner"}
                </dd>
              </div>
              <div><dt>Catégorie</dt><dd>{form.productCategory || "À choisir"}</dd></div>
              <div><dt>Essai</dt><dd>{form.testFamily}</dd></div>
              <div><dt>Échéance</dt><dd>{formatDate(form.dueDate)}</dd></div>
              <div><dt>Priorité</dt><dd>{PRIORITY_LABELS[form.priority]}</dd></div>
              <div><dt>Responsable</dt><dd>{selectedOperator?.name || "Équipe laboratoire"}</dd></div>
            </dl>
          </aside>
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

function AuthScreen({ onAuthenticated, serverError, theme, onToggleTheme }) {
  const [mode, setMode] = useState("login");
  const [selectedRole, setSelectedRole] = useState("engineer");
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
        body: JSON.stringify({
          name,
          email,
          password,
          ...(mode === "login"
            ? { expectedRole: selectedRole }
            : { role: selectedRole }),
        }),
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
          <div className="auth-message-copy">
            <p className="eyebrow">DEMANDE · ESSAI · VALIDATION</p>
            <h1>Les bons tests,<br />au bon moment.</h1>
            <p>Un espace partagé pour suivre chaque essai laboratoire, du besoin produit au résultat validé.</p>
          </div>
          <div className="auth-helmet" aria-hidden="true">
            <img src={helmetIllustration} alt="" />
          </div>
        </div>
        <p className="auth-caption">Impact · Thermique · Mécanique</p>
      </div>
      <section className="auth-panel">
        <div className="auth-tools">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
        <div className="auth-form-wrap">
          <p className="eyebrow">ESPACE SÉCURISÉ</p>
          <h2>{mode === "login" ? "Ravi de vous revoir." : "Créer votre compte."}</h2>
          <p className="muted">
            {mode === "login"
              ? "Connectez-vous pour retrouver votre activité."
              : `Votre compte ${selectedRole === "operator" ? "ingénieur essais" : "ingénieur produit"} sera actif dès sa création.`}
          </p>
          <fieldset className="role-picker">
            <legend>
              {mode === "login" ? "Vous vous connectez en tant que" : "Créer un compte en tant que"}
            </legend>
            <div className="role-options">
              <button
                type="button"
                className={`role-option${selectedRole === "engineer" ? " is-selected" : ""}`}
                aria-pressed={selectedRole === "engineer"}
                onClick={() => setSelectedRole("engineer")}
              >
                <span className="role-option-icon" aria-hidden="true">⌁</span>
                <span><strong>Ingénieur produit</strong><small>Créer et valider des demandes</small></span>
              </button>
              <button
                type="button"
                className={`role-option${selectedRole === "operator" ? " is-selected" : ""}`}
                aria-pressed={selectedRole === "operator"}
                onClick={() => setSelectedRole("operator")}
              >
                <span className="role-option-icon" aria-hidden="true">⚗</span>
                <span><strong>Ingénieur essais</strong><small>Planifier et suivre les tests</small></span>
              </button>
            </div>
          </fieldset>
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

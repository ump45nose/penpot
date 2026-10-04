// Users list: id/email lookup with a deleted filter and pagination.
// Lookup is by exact id or exact email (both indexed); substring
// search has no usable index at PRO scale. Every value is painted
// as text; status badges use a fixed class map, never the raw
// value. JSON responses use camelCase (`nextSince`, …).

import { rpc } from "../api.js";
import { deletedParams, deletedSelect } from "../components/filters.js";
import { renderHeader } from "../components/header.js";
import { renderTable } from "../components/table.js";
import { showToast } from "../components/toast.js";
import { readQuery, writeQuery, detailUrl, withFrom } from "../url.js";

const PAGE_SIZE = 25;

const STATUS_BADGES = {
  deleted: "admin-badge-status-deleted",
  blocked: "admin-badge-status-blocked",
  inactive: "admin-badge-status-inactive",
  demo: "admin-badge-status-demo",
  active: "admin-badge-status-active",
};

const COLUMNS = [
  { key: "fullname", label: "Name", class: "admin-cell-name" },
  { key: "email", label: "Email", class: "admin-cell-email" },
  { key: "createdAt", label: "Created", class: "admin-cell-date" },
  { key: "deletedAt", label: "Deleted", class: "admin-cell-date" },
  { key: "status", label: "Status", class: "admin-cell-status" },
];

function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso ?? "") : date.toLocaleString();
}

export function statusOf(item) {
  if (item.deletedAt) {
    return "deleted";
  }
  if (item.isBlocked) {
    return "blocked";
  }
  if (item.isDemo) {
    return "demo";
  }
  if (!item.isActive) {
    return "inactive";
  }
  return "active";
}

export function statusCell(status) {
  const badge = document.createElement("span");
  badge.className = "admin-badge " + (STATUS_BADGES[status] || STATUS_BADGES.active);
  badge.textContent = status;
  return badge;
}

export function usersPage(root, { onNavigate }) {
  const fromUrl = readQuery(["lookup", "deleted"]);
  const state = {
    lookup: fromUrl.lookup ?? "",
    deleted: fromUrl.deleted ?? "",
    items: [],
    nextSince: null,
    nextId: null,
    loading: false,
    loadedOnce: false,
  };

  root.appendChild(renderHeader("Users"));

  const controls = document.createElement("div");
  controls.className = "admin-controls";

  const lookupInput = document.createElement("input");
  lookupInput.className = "admin-input";
  lookupInput.type = "search";
  lookupInput.placeholder = "Look up by id or exact email…";
  lookupInput.setAttribute("aria-label", "Look up by id or exact email");
  lookupInput.value = state.lookup;
  lookupInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      searchButton.click();
    }
  });
  controls.appendChild(lookupInput);

  const deleted = deletedSelect("users", state.deleted);
  controls.appendChild(deleted);

  const searchButton = document.createElement("button");
  searchButton.className = "admin-button";
  searchButton.textContent = "Search";
  searchButton.addEventListener("click", () => {
    state.lookup = lookupInput.value.trim();
    state.deleted = deleted.value;
    state.nextSince = null;
    state.nextId = null;
    load();
  });
  controls.appendChild(searchButton);

  const clearButton = document.createElement("button");
  clearButton.className = "admin-button admin-button-ghost";
  clearButton.textContent = "Clear";
  clearButton.addEventListener("click", () => {
    lookupInput.value = "";
    deleted.value = "";
    state.lookup = "";
    state.deleted = "";
    state.nextSince = null;
    state.nextId = null;
    load();
  });
  controls.appendChild(clearButton);

  const bulkButton = document.createElement("button");
  bulkButton.className = "admin-button admin-button-ghost";
  bulkButton.textContent = "Delete by email…";
  bulkButton.addEventListener("click", () => onNavigate(withFrom("?screen=users-delete")));
  controls.appendChild(bulkButton);
  root.appendChild(controls);

  const countLine = document.createElement("p");
  countLine.className = "admin-count admin-count-spaced";
  root.appendChild(countLine);

  const tableWrap = document.createElement("div");
  root.appendChild(tableWrap);

  const pager = document.createElement("div");
  pager.className = "admin-pager";
  const nextButton = document.createElement("button");
  nextButton.className = "admin-button";
  nextButton.textContent = "Next page";
  nextButton.addEventListener("click", () => load({ append: true }));
  pager.appendChild(nextButton);
  root.appendChild(pager);

  function paint() {
    tableWrap.replaceChildren();
    if (state.loading && !state.loadedOnce) {
      countLine.textContent = "Loading…";
    } else if (state.items.length === 0) {
      countLine.textContent = "No users match the current filters.";
    } else {
      countLine.textContent =
        `Showing ${state.items.length} user` + (state.items.length === 1 ? "" : "s") +
        (state.nextSince === null ? " (all)" : " — more available");
    }

    const rows = state.items.map((item) => ({
      ...item,
      createdAt: formatDate(item.createdAt),
      deletedAt: item.deletedAt ? formatDate(item.deletedAt) : "—",
      status: statusOf(item),
    }));
    const table = renderTable(COLUMNS, rows);
    const bodyRows = table.querySelector("tbody").rows;
    for (let i = 0; i < bodyRows.length; i++) {
      const row = bodyRows[i];
      row.cells[4].replaceChildren(statusCell(rows[i].status));
      row.addEventListener("click", () =>
        onNavigate(detailUrl("user", state.items[i].id)));
    }
    tableWrap.appendChild(table);
    nextButton.disabled = state.loading || state.nextSince === null;
    searchButton.disabled = state.loading;
    clearButton.disabled = state.loading;
    pager.style.display =
      state.items.length === 0 || state.nextSince === null ? "none" : "";
  }

  async function load({ append = false } = {}) {
    state.loading = true;
    paint();
    writeQuery({ lookup: state.lookup, deleted: state.deleted });
    const params = { limit: PAGE_SIZE, ...deletedParams(state.deleted) };
    if (state.lookup) {
      // Exact email (unique index) when it looks like one,
      // otherwise an exact id (primary key).
      if (state.lookup.includes("@")) {
        params.email = state.lookup;
      } else {
        params.id = state.lookup;
      }
    }
    if (append && state.nextSince) {
      params.since = state.nextSince;
      params.sinceId = state.nextId;
    }
    try {
      const data = await rpc("get-profiles", params);
      state.items = append ? state.items.concat(data.items) : data.items;
      state.nextSince = data.nextSince ?? null;
      state.nextId = data.nextId ?? null;
      state.loadedOnce = true;
    } catch {
      showToast("Could not load users.", "error");
    } finally {
      state.loading = false;
      paint();
    }
  }

  paint();
  load();
}

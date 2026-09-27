import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/http";
import { useAuth } from "../auth/useAuth";
import { useResource, useTask } from "../hooks/useResource";
import { ContactFields, Feedback } from "../components/FormFields";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 20;
// Pending shops are a work queue rather than a browsable list, so it is worth
// fetching a deeper page of them before reaching for pagination.
const PENDING_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

const TABS = [
  ["users", "Users"],
  ["shops", "Shops"],
  ["pending", "Pending requests"],
  ["payments", "Payments"],
  ["refunds", "Refunds"],
];

const ACCOUNT_ROLES = ["customer", "vendor", "delivery", "admin"];

// The closed sets the server accepts for the money filters. Spelled out here so
// the select offers exactly what the API will not reject.
const PAYMENT_STATUSES = ["pending", "completed", "failed"];
const PAYMENT_METHODS = [
  ["cash_on_delivery", "Cash on delivery"],
  ["prepaid", "Prepaid"],
];
const REFUND_REASONS = [
  ["admin_removal", "Admin removal"],
  ["shop_closed", "Shop closed"],
];

function StatusPill({ status }) {
  return <span className={`status-pill status-${status}`}>{status}</span>;
}

// The search box writes to the URL only once the administrator pauses, so
// typing does not fire a request per keystroke. The URL stays the source of
// truth: clearing the term elsewhere must empty the box too, and that is
// adjusted during render rather than in an effect, which would paint the stale
// value first.
function SearchBox({ value, placeholder, onChange }) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // onChange is recreated per render; the debounce must not restart with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, value]);

  return (
    <label className="console-search">
      Search
      <input
        type="search"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
      />
    </label>
  );
}

function UsersPanel({ data, isLoading, error, filters, onFilter, onPage, task, onStatus, self }) {
  return (
    <>
      <div className="console-filters">
        <SearchBox
          value={filters.q}
          placeholder="Name or email"
          onChange={(term) => onFilter({ q: term })}
        />
        <label>
          Role
          <select
            value={filters.role}
            onChange={(event) => onFilter({ role: event.target.value })}
          >
            <option value="">Any role</option>
            {ACCOUNT_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) => onFilter({ status: event.target.value })}
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!isLoading && !error && data?.items.length === 0 && (
        <p className="empty-state">No accounts match these filters.</p>
      )}

      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((account) => (
                <tr key={account.user_id}>
                  <td>{account.name}</td>
                  <td>{account.email}</td>
                  <td>{account.role_name}</td>
                  <td>
                    <StatusPill status={account.active_status} />
                  </td>
                  <td>
                    {account.user_id === self ? (
                      // Banning yourself is refused by the server; offering the
                      // button would only produce an error to read.
                      <span className="muted">This is you</span>
                    ) : (
                      <button
                        disabled={task.busy}
                        onClick={() =>
                          onStatus(account, {
                            active_status:
                              account.active_status === "active"
                                ? "disabled"
                                : "active",
                          })
                        }
                      >
                        {account.active_status === "active"
                          ? "Disable"
                          : "Enable"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={filters.page}
        totalPages={data?.total_pages ?? 0}
        onPage={onPage}
      />
    </>
  );
}

// A shop's listings, opened from the row below it.
//
// The removal write is the page's, not this component's, so its result reports
// in the console's own feedback area. That is not a style preference: reloading
// the shop list clears `data` for a moment, which unmounts this whole expansion,
// and a message rendered in here would be thrown away before it could be read.
function ShopListings({ shopId, task, onRemove }) {
  const listings = useResource(`/admin/shops/${shopId}/listings`);
  const [confirming, setConfirming] = useState(null);

  async function remove(listing) {
    if (await onRemove(listing.prod_id)) {
      listings.reload();
      setConfirming(null);
    }
  }

  if (listings.isLoading) return <p className="muted">Loading listings…</p>;
  if (listings.error)
    return (
      <p className="error" role="alert">
        {listings.error}
      </p>
    );
  if (!listings.data?.length)
    return <p className="empty-state">This shop has no listings.</p>;

  return (
    <div className="console-listings">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Listing</th>
              <th>Price</th>
              <th>In stock</th>
              <th>Refund if removed</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {listings.data.map((listing) => {
              const refund = listing.refund;
              return (
                <tr key={listing.prod_id}>
                  <td>{listing.name}</td>
                  <td>${listing.unit_price}</td>
                  <td>{listing.in_stock}</td>
                  <td>
                    {refund && refund.units > 0 ? (
                      <>
                        ${refund.amount} for {refund.units} unit
                        {refund.units === 1 ? "" : "s"}
                      </>
                    ) : (
                      <span className="muted">Nothing to refund</span>
                    )}
                  </td>
                  <td>
                    {listing.discontinued ? (
                      // Removing it again is a 409, so the button would only
                      // produce an error to read. Any stock still on the shelf is
                      // paid for when its master product is removed.
                      <span className="muted">Retired</span>
                    ) : confirming === listing.prod_id ? (
                      <>
                        <button
                          className="danger"
                          disabled={task.busy}
                          onClick={() => remove(listing)}
                        >
                          Confirm: remove and refund ${refund?.amount ?? "0.00"}
                        </button>{" "}
                        <button
                          disabled={task.busy}
                          onClick={() => setConfirming(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={task.busy}
                        onClick={() => setConfirming(listing.prod_id)}
                      >
                        Remove and refund
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Removing a listing discontinues it and pays the vendor for the stock they
        still hold, at the prices they actually paid. It cannot be undone.
      </p>
    </div>
  );
}

function ShopsPanel({
  data,
  isLoading,
  error,
  filters,
  onFilter,
  onPage,
  task,
  onStatus,
  confirming,
  setConfirming,
  onRemove,
}) {
  const [expanded, setExpanded] = useState(null);
  return (
    <>
      <div className="console-filters">
        <SearchBox
          value={filters.q}
          placeholder="Shop, owner or email"
          onChange={(term) => onFilter({ q: term })}
        />
        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) => onFilter({ status: event.target.value })}
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!isLoading && !error && data?.items.length === 0 && (
        <p className="empty-state">No shops match these filters.</p>
      )}

      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Shop</th>
                <th>Owner</th>
                <th>City</th>
                <th>Listings</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((shop) => (
                <Fragment key={shop.shop_id}>
                  <tr>
                    <td>{shop.name}</td>
                    <td>
                      {shop.owner_name}
                      {shop.owner_status !== "active" && (
                        <span className="muted"> (banned)</span>
                      )}
                    </td>
                    <td>{shop.city || "—"}</td>
                    <td>
                      {/* The count is also the handle for the listing list, so
                          there is one obvious place to look for a shop's stock
                          rather than a separate "view" button saying the same. */}
                      <button
                        className="link-button"
                        aria-expanded={expanded === shop.shop_id}
                        onClick={() =>
                          setExpanded(
                            expanded === shop.shop_id ? null : shop.shop_id,
                          )
                        }
                      >
                        {shop.active_listing_count} of {shop.listing_count} live
                      </button>
                    </td>
                    <td>
                      <StatusPill status={shop.active_status} />
                    </td>
                    <td>
                      {shop.active_status !== "active" ? (
                        <button
                          disabled={task.busy}
                          onClick={() => onStatus(shop, { active_status: "active" })}
                        >
                          {shop.active_status === "pending" ? "Approve" : "Enable"}
                        </button>
                      ) : confirming === shop.shop_id ? (
                        // Disabling is one-way for the listings, so make it a
                        // deliberate second click rather than a single slip.
                        <>
                          <button
                            className="danger"
                            disabled={task.busy}
                            onClick={() =>
                              onStatus(shop, { active_status: "disabled" })
                            }
                          >
                            Confirm: discontinue {shop.active_listing_count} listing
                            {shop.active_listing_count === 1 ? "" : "s"}
                          </button>{" "}
                          <button
                            disabled={task.busy}
                            onClick={() => setConfirming(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          disabled={task.busy}
                          onClick={() => setConfirming(shop.shop_id)}
                        >
                          Disable
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === shop.shop_id && (
                    <tr>
                      <td colSpan="6">
                        <ShopListings
                          shopId={shop.shop_id}
                          task={task}
                          onRemove={onRemove}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={filters.page}
        totalPages={data?.total_pages ?? 0}
        onPage={onPage}
      />
    </>
  );
}

function RequestsPanel({ data, isLoading, error, page, onPage, task, onStatus }) {
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!isLoading && !error && data?.items.length === 0 && (
        <p className="empty-state">
          No shop is waiting for approval. New shops appear here as soon as a
          vendor submits one.
        </p>
      )}

      {data && data.items.length > 0 && (
        <div className="workspace-grid">
          <section>
            {data.items.map((shop) => (
              <article className="panel" key={shop.shop_id}>
                <h2>{shop.name}</h2>
                <p className="muted">
                  {shop.owner_name} · {shop.owner_email} · {shop.city || "no city"}
                </p>
                <p>
                  Requested{" "}
                  {new Date(shop.created_at).toLocaleDateString()} ·{" "}
                  {shop.listing_count} listing
                  {shop.listing_count === 1 ? "" : "s"} prepared
                </p>
                <button
                  className="primary"
                  disabled={task.busy}
                  onClick={() => onStatus(shop, { active_status: "active" })}
                >
                  Approve
                </button>{" "}
                <button
                  disabled={task.busy}
                  onClick={() => onStatus(shop, { active_status: "disabled" })}
                >
                  Reject
                </button>
              </article>
            ))}
          </section>
        </div>
      )}

      <Pagination
        page={page}
        totalPages={data?.total_pages ?? 0}
        onPage={onPage}
      />
    </>
  );
}

// Every payment in the system, with the order it settles and the customer behind
// it. The platform's cut sits beside the gross so the two are never confused —
// they are different numbers and the screen would be misleading if it showed
// only one.
function PaymentsPanel({ data, isLoading, error, filters, onFilter, onPage }) {
  return (
    <>
      <div className="console-filters">
        <SearchBox
          value={filters.q}
          placeholder="Customer, email or order number"
          onChange={(term) => onFilter({ q: term })}
        />
        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) => onFilter({ status: event.target.value })}
          >
            <option value="">Any status</option>
            {PAYMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Method
          <select
            value={filters.method}
            onChange={(event) => onFilter({ method: event.target.value })}
          >
            <option value="">Any method</option>
            {PAYMENT_METHODS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!isLoading && !error && data?.items.length === 0 && (
        <p className="empty-state">No payments match these filters.</p>
      )}

      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Payment</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((payment) => (
                <tr key={payment.transaction_id}>
                  <td>
                    #{payment.order_id}{" "}
                    <StatusPill status={payment.order_status} />
                  </td>
                  <td>
                    {payment.customer_name}
                    <br />
                    <span className="muted">{payment.customer_email}</span>
                  </td>
                  <td>
                    ${payment.amount}
                    <br />
                    <span className="muted">
                      ${payment.total_amount} + ${payment.delivery_cost} delivery
                    </span>
                  </td>
                  <td>
                    {payment.payment_method === "cash_on_delivery"
                      ? "Cash on delivery"
                      : "Prepaid"}
                  </td>
                  <td>
                    <StatusPill status={payment.payment_status} />
                  </td>
                  <td>
                    {payment.paid_at
                      ? new Date(payment.paid_at).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={filters.page}
        totalPages={data?.total_pages ?? 0}
        onPage={onPage}
      />
    </>
  );
}

// What the platform has paid vendors back, and who decided to. A refund row is
// the only place the money, the shop, the listing and the administrator appear
// together, so all four are on it.
function RefundsPanel({ data, isLoading, error, filters, onFilter, onPage }) {
  return (
    <>
      <div className="console-filters">
        <SearchBox
          value={filters.q}
          placeholder="Shop or listing"
          onChange={(term) => onFilter({ q: term })}
        />
        <label>
          Reason
          <select
            value={filters.reason}
            onChange={(event) => onFilter({ reason: event.target.value })}
          >
            <option value="">Any reason</option>
            {REFUND_REASONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!isLoading && !error && data?.items.length === 0 && (
        <p className="empty-state">
          No vendor has been refunded. Removing a listing or a master product
          pays the vendors holding its stock, and every payment lands here.
        </p>
      )}

      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Refund</th>
                <th>Shop</th>
                <th>Listing</th>
                <th>Units</th>
                <th>Unit amount</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Removed by</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((refund) => (
                <tr key={refund.refund_id}>
                  <td>
                    #{refund.refund_id}
                    <br />
                    <span className="muted">
                      {new Date(refund.created_at).toLocaleDateString()}
                    </span>
                  </td>
                  <td>{refund.shop_name}</td>
                  <td>
                    {refund.listing_name}
                    <br />
                    <span className="muted">{refund.master_name}</span>
                  </td>
                  <td>{refund.units}</td>
                  <td>{refund.unit_amount ? `$${refund.unit_amount}` : "—"}</td>
                  <td>${refund.amount}</td>
                  <td>
                    {refund.reason === "admin_removal"
                      ? "Admin removal"
                      : "Shop closed"}
                  </td>
                  <td>
                    {refund.admin_name}
                    <br />
                    <span className="muted">{refund.admin_email}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={filters.page}
        totalPages={data?.total_pages ?? 0}
        onPage={onPage}
      />
    </>
  );
}

export default function AdminConsolePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const task = useTask();
  const [confirming, setConfirming] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createRole, setCreateRole] = useState("customer");

  const requested = searchParams.get("tab");
  const tab = TABS.some(([key]) => key === requested) ? requested : "users";
  const filters = {
    q: searchParams.get("q") ?? "",
    role: searchParams.get("role") ?? "",
    status: searchParams.get("status") ?? "",
    method: searchParams.get("method") ?? "",
    reason: searchParams.get("reason") ?? "",
    page: Number(searchParams.get("page") ?? 1) || 1,
  };

  // Only the visible panel loads, so the URL carries one page number rather
  // than three that would each have to be kept apart.
  const usersQuery = new URLSearchParams({
    limit: PAGE_SIZE,
    page: filters.page,
  });
  if (filters.q) usersQuery.set("q", filters.q);
  if (filters.role) usersQuery.set("role", filters.role);
  if (filters.status) usersQuery.set("status", filters.status);

  const shopsQuery = new URLSearchParams({
    limit: PAGE_SIZE,
    page: filters.page,
  });
  if (filters.q) shopsQuery.set("q", filters.q);
  if (filters.status) shopsQuery.set("status", filters.status);

  const pendingQuery = new URLSearchParams({
    limit: PENDING_PAGE_SIZE,
    page: filters.page,
    status: "pending",
  });
  if (filters.q) pendingQuery.set("q", filters.q);

  // Each list carries only the filters it understands. `status` means different
  // things on different panels, which is why the tab switch drops it.
  const paymentsQuery = new URLSearchParams({
    limit: PAGE_SIZE,
    page: filters.page,
  });
  if (filters.q) paymentsQuery.set("q", filters.q);
  if (filters.status) paymentsQuery.set("status", filters.status);
  if (filters.method) paymentsQuery.set("method", filters.method);

  const refundsQuery = new URLSearchParams({
    limit: PAGE_SIZE,
    page: filters.page,
  });
  if (filters.q) refundsQuery.set("q", filters.q);
  if (filters.reason) refundsQuery.set("reason", filters.reason);

  const users = useResource(tab === "users" ? `/admin/users?${usersQuery}` : null);
  const shops = useResource(tab === "shops" ? `/admin/shops?${shopsQuery}` : null);
  const pending = useResource(
    tab === "pending" ? `/admin/shops?${pendingQuery}` : null,
  );
  const payments = useResource(
    tab === "payments" ? `/admin/payments?${paymentsQuery}` : null,
  );
  const refunds = useResource(
    tab === "refunds" ? `/admin/refunds?${refundsQuery}` : null,
  );
  const panel = { users, shops, pending, payments, refunds }[tab];

  function updateParams(changes) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (value !== "" && value != null) next.set(key, value);
    }
    // Any filter change resets paging; a page change keeps the rest.
    if (!("page" in changes)) next.delete("page");
    setSearchParams(next);
  }

  function changeTab(next) {
    // Filters do not follow the tab: "pending" is a shop status but not a user
    // one, and a page number from a longer list would land on an empty page.
    // The search term is kept because it means the same thing in both.
    const params = new URLSearchParams({ tab: next });
    if (filters.q) params.set("q", filters.q);
    setSearchParams(params);
    setConfirming(null);
  }

  async function write(path, method, body) {
    const ok = await task.run(() =>
      api(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    if (ok) {
      panel.reload();
      setConfirming(null);
    }
    return ok;
  }

  const setUserStatus = (account, body) =>
    write(`/admin/users/${account.user_id}/status`, "PUT", body);
  const setShopStatus = (shop, body) =>
    write(`/admin/shops/${shop.shop_id}/status`, "PUT", body);
  // Goes through the page's write so the refund message lands in the console's
  // feedback area and the shop list reloads with its new counts and balance.
  const removeListing = (prodId) =>
    write(`/admin/listings/${prodId}/discontinue`, "PUT");

  return (
    <main className="content">
      <h1>Administration</h1>
      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            className={key === tab ? "active" : undefined}
            aria-current={key === tab ? "page" : undefined}
            onClick={() => changeTab(key)}
          >
            {label}
          </button>
        ))}
        <Link className="tabs-end" to="/admin/catalog">
          Master catalog
        </Link>
      </nav>

      {/* Task feedback only, for writes. Each panel reports the failure of its
          own list, next to the list, so a message is never shown twice. */}
      <Feedback error={task.error} message={task.message} />

      {tab === "users" && (
        <>
          <div className="console-actions">
            <button onClick={() => setShowCreate((open) => !open)}>
              {showCreate ? "Close" : "Create an account"}
            </button>
          </div>
          {showCreate && (
            <form
              className="panel form console-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const body = Object.fromEntries(new FormData(form));
                if (await write("/admin/users", "POST", body)) form.reset();
              }}
            >
              <h2>Create an account</h2>
              <p>
                Only administrators can create admin accounts. Your current
                session stays signed in.
              </p>
              <fieldset disabled={task.busy}>
                <label>
                  Account type
                  <select
                    name="role"
                    value={createRole}
                    onChange={(event) => setCreateRole(event.target.value)}
                  >
                    {ACCOUNT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Name <span className="required-tag" aria-hidden="true">*</span></span>
                  <input name="name" minLength="2" maxLength="100" required />
                </label>
                <label>
                  <span>Email <span className="required-tag" aria-hidden="true">*</span></span>
                  <input name="email" type="email" maxLength="60" required />
                </label>
                <label>
                  <span>Password <span className="required-tag" aria-hidden="true">*</span></span>
                  <input
                    name="password"
                    type="password"
                    minLength="8"
                    maxLength="72"
                    required
                  />
                </label>
                <label>
                  <span>Confirm password <span className="required-tag" aria-hidden="true">*</span></span>
                  <input
                    name="confirm_password"
                    type="password"
                    minLength="8"
                    maxLength="72"
                    required
                  />
                </label>
                <ContactFields delivery={createRole === "delivery"} />
                <button className="primary">Create account</button>
              </fieldset>
              <p className="required-note">*required</p>
            </form>
          )}
          <UsersPanel
            data={users.data}
            isLoading={users.isLoading}
            error={users.error}
            filters={filters}
            onFilter={updateParams}
            onPage={(page) => updateParams({ page: String(page) })}
            task={task}
            onStatus={setUserStatus}
            self={user.user_id}
          />
        </>
      )}

      {tab === "shops" && (
        <ShopsPanel
          data={shops.data}
          isLoading={shops.isLoading}
          error={shops.error}
          filters={filters}
          onFilter={updateParams}
          onPage={(page) => updateParams({ page: String(page) })}
          task={task}
          onStatus={setShopStatus}
          confirming={confirming}
          setConfirming={setConfirming}
          onRemove={removeListing}
        />
      )}

      {tab === "pending" && (
        <RequestsPanel
          data={pending.data}
          isLoading={pending.isLoading}
          error={pending.error}
          page={filters.page}
          onPage={(page) => updateParams({ page: String(page) })}
          task={task}
          onStatus={setShopStatus}
        />
      )}

      {tab === "payments" && (
        <PaymentsPanel
          data={payments.data}
          isLoading={payments.isLoading}
          error={payments.error}
          filters={filters}
          onFilter={updateParams}
          onPage={(page) => updateParams({ page: String(page) })}
        />
      )}

      {tab === "refunds" && (
        <RefundsPanel
          data={refunds.data}
          isLoading={refunds.isLoading}
          error={refunds.error}
          filters={filters}
          onFilter={updateParams}
          onPage={(page) => updateParams({ page: String(page) })}
        />
      )}
    </main>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../hooks/useResource";
import { Feedback } from "../components/FormFields";

// What the shop earns, and when it earns it.
//
// The chart is an SVG bar series drawn from the design tokens rather than from
// colour literals: revenue in the brand colour and refunds in the danger colour,
// which are the same two colours those meanings carry everywhere else in the
// app. Both themes work because both tokens are defined in both palettes.
//
// Every figure on this page comes from one response, so the chart, the
// leaderboard and the reconciliation row cannot disagree with each other. What
// they deliberately do not match is the "Sales" figure on the payments page:
// that one counts every order that was placed, and this one counts only orders
// that were delivered. The difference is real — an order in transit is money the
// shop has not been paid — so it is spelled out under the heading rather than
// left for a vendor to discover by subtraction.

const money = (value) => `$${Number(value).toFixed(2)}`;

// A year of days is 365 bars, which is a smear rather than a chart, so the most
// recent slice is drawn and the page says how many were left off. Weeks and
// months never reach this.
const MAX_BARS = 60;

function RevenueChart({ series }) {
  if (series.length === 0)
    return (
      <p className="empty-state">
        Nothing has been delivered yet, so there is no income to chart. An order
        appears here once a courier has handed it over.
      </p>
    );

  const shown = series.slice(-MAX_BARS);
  const hidden = series.length - shown.length;
  const peak = Math.max(
    ...shown.map((row) => Math.max(Number(row.revenue), Number(row.refunds))),
    0,
  );
  // A chart with no sales and no refunds still has to draw something, and
  // dividing by a zero peak would put every bar at NaN.
  const scale = peak > 0 ? peak : 1;

  const width = 760,
    height = 260,
    left = 64,
    right = 16,
    top = 16,
    baseline = height - 34;
  const plot = width - left - right;
  const slot = plot / shown.length;
  const barWidth = Math.max(3, Math.min(26, slot * 0.62));
  // Only every nth label is drawn, so a long series does not overlap itself into
  // an unreadable band.
  const every = Math.ceil(shown.length / 8);
  const y = (value) => baseline - (value / scale) * (baseline - top);

  return (
    <>
      <div className="chart-wrap">
        <svg
          className="bar-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Revenue and refunds per period, highest ${money(peak)}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Two gridlines and the baseline: enough to read a bar against, few
              enough not to compete with the bars themselves. */}
          {[1, 0.5].map((fraction) => (
            <g key={fraction}>
              <line
                className="chart-grid"
                x1={left}
                x2={width - right}
                y1={y(peak * fraction)}
                y2={y(peak * fraction)}
              />
              <text
                className="chart-axis-label"
                x={left - 8}
                y={y(peak * fraction) + 4}
                textAnchor="end"
              >
                {money(peak * fraction)}
              </text>
            </g>
          ))}
          <line
            className="chart-axis"
            x1={left}
            x2={width - right}
            y1={baseline}
            y2={baseline}
          />

          {shown.map((row, index) => {
            const centre = left + slot * index + slot / 2;
            const revenue = Number(row.revenue);
            const refunds = Number(row.refunds);
            return (
              <g key={row.period}>
                {/* Revenue and refunds share a slot and sit side by side rather
                    than overlapping, so neither can hide the other. */}
                <rect
                  className="chart-bar-revenue"
                  x={centre - barWidth / 2}
                  y={y(revenue)}
                  width={barWidth}
                  height={Math.max(baseline - y(revenue), 0)}
                >
                  <title>
                    {row.period}: {money(revenue)} from {row.units} units
                  </title>
                </rect>
                {refunds > 0 && (
                  <rect
                    className="chart-bar-refund"
                    x={centre + barWidth / 2 + 1}
                    y={y(refunds)}
                    width={barWidth}
                    height={Math.max(baseline - y(refunds), 0)}
                  >
                    <title>
                      {row.period}: {money(refunds)} refunded to customers
                    </title>
                  </rect>
                )}
                {index % every === 0 && (
                  <text
                    className="chart-axis-label"
                    x={centre}
                    y={baseline + 18}
                    textAnchor="middle"
                  >
                    {row.period}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="chart-legend">
        <span className="chart-key chart-key-revenue" /> Delivered revenue
        <span className="chart-key chart-key-refund" /> Refunded to customers
      </p>
      {hidden > 0 && (
        <p className="muted">
          Showing the most recent {MAX_BARS} periods; {hidden} earlier ones are in
          the table below the leaderboard.
        </p>
      )}
    </>
  );
}

export default function VendorStatisticsPage() {
  const [groupBy, setGroupBy] = useState("month");
  const stats = useResource(`/vendor/statistics?group_by=${groupBy}`);

  const totals = stats.data?.totals;
  const series = stats.data?.series ?? [];
  const listings = stats.data?.top_listings ?? [];
  // Net of returns, which is the number a vendor actually keeps — the chart
  // shows both so the two are never confused.
  const net = totals
    ? Number(totals.delivered_revenue) - Number(totals.refunded_to_customers)
    : 0;

  return (
    <main className="content" aria-busy={stats.isLoading}>
      <h1>Income</h1>
      <nav className="tabs">
        <Link to="/vendor/shops">My shops</Link>
        <Link to="/vendor/inventory">Inventory and purchases</Link>
        <Link to="/vendor/balance">Balance</Link>
        <Link to="/vendor/statistics">Income</Link>
        <Link to="/vendor/payments">Payments</Link>
      </nav>

      <Feedback error={stats.error} />

      {stats.isLoading ? (
        <p role="status">Working out your income…</p>
      ) : (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h2>Taken over time</h2>
              <label>
                Group by
                <select
                  value={groupBy}
                  onChange={(event) => setGroupBy(event.target.value)}
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </label>
            </div>
            <p className="muted">
              Only delivered orders count as income, because that is when the
              money reaches your balance. The Sales figure on the payments page
              also counts orders still on their way, so the two will differ by
              whatever is in transit.
            </p>
            <RevenueChart series={series} />
          </section>

          {totals && (
            <section className="panel">
              <h2>The whole picture</h2>
              <dl className="order-facts">
                <div>
                  <dt>Delivered revenue</dt>
                  <dd>
                    {money(totals.delivered_revenue)}
                    <br />
                    <span className="muted">
                      {totals.units_sold} units across {totals.delivered_orders}{" "}
                      delivered orders.
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Refunded to customers</dt>
                  <dd>
                    {money(totals.refunded_to_customers)}
                    <br />
                    <span className="muted">Accepted returns, paid on approval.</span>
                  </dd>
                </div>
                <div>
                  <dt>Net from customers</dt>
                  <dd>
                    {money(net)}
                    <br />
                    <span className="muted">Delivered revenue less returns.</span>
                  </dd>
                </div>
                <div>
                  <dt>Recharged</dt>
                  <dd>
                    {money(totals.recharged)}
                    <br />
                    <span className="muted">
                      Money you put in. <Link to="/vendor/balance">Recharge</Link>.
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Wholesale spend</dt>
                  <dd>{money(totals.wholesale_spend)}</dd>
                </div>
                <div>
                  <dt>Refunds received</dt>
                  <dd>
                    {money(totals.refunds_received)}
                    <br />
                    <span className="muted">
                      For stock the platform removed from sale.
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Balance now</dt>
                  <dd>
                    {money(totals.balance_total)}
                    <br />
                    <span className="muted">
                      Recharges + delivered revenue − purchases − returns +
                      refunds. That is exactly what the balance page shows.
                    </span>
                  </dd>
                </div>
              </dl>
            </section>
          )}

          <h2>Best listings</h2>
          {listings.length === 0 ? (
            <p className="empty-state">
              Nothing has been delivered yet, so no listing has earned anything.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Listing</th>
                    <th scope="col">Shop</th>
                    <th scope="col">Units</th>
                    <th scope="col">Revenue</th>
                    <th scope="col">Share of revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((listing) => {
                    const share = totals?.delivered_revenue
                      ? (Number(listing.revenue) /
                          Number(totals.delivered_revenue)) *
                        100
                      : 0;
                    return (
                      <tr key={listing.prod_id}>
                        <td>
                          <Link to={`/products/${listing.prod_id}`}>
                            {listing.listing_name}
                          </Link>
                        </td>
                        <td>{listing.shop_name}</td>
                        <td>{listing.units}</td>
                        <td>{money(listing.revenue)}</td>
                        <td>{share.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <h2>Every period</h2>
          {series.length === 0 ? (
            <p className="empty-state">Nothing recorded yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Period starts</th>
                    <th scope="col">Orders</th>
                    <th scope="col">Units</th>
                    <th scope="col">Revenue</th>
                    <th scope="col">Refunded</th>
                    <th scope="col">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {[...series].reverse().map((row) => (
                    <tr key={row.period}>
                      <td>{row.period}</td>
                      <td>{row.orders}</td>
                      <td>{row.units}</td>
                      <td>{money(row.revenue)}</td>
                      <td>{money(row.refunds)}</td>
                      <td>{money(Number(row.revenue) - Number(row.refunds))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}

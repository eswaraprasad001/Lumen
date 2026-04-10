import { format } from "date-fns";

import { requireAdminPage, getAdminDashboardData, DayStat } from "@/lib/admin";

export const dynamic = "force-dynamic";

function BarChart({ data, color = "var(--accent)" }: { data: DayStat[]; color?: string }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="admin-bar-chart">
      {data.map((d) => (
        <div key={d.date} className="admin-bar-col" title={`${d.date}: ${d.count}`}>
          <div
            className="admin-bar"
            style={{ height: `${Math.max((d.count / max) * 100, d.count > 0 ? 4 : 0)}%`, background: color }}
          />
        </div>
      ))}
    </div>
  );
}

function BarChartXLabels({ data }: { data: DayStat[] }) {
  // Show label every 7 days
  return (
    <div className="admin-bar-xlabels">
      {data.map((d, i) => (
        <span key={d.date} className="admin-bar-xlabel">
          {i % 7 === 0 ? format(new Date(d.date), "MMM d") : ""}
        </span>
      ))}
    </div>
  );
}

export default async function AdminPage() {
  await requireAdminPage();
  const data = await getAdminDashboardData();

  const totalReadingStates =
    data.readingStates.new +
    data.readingStates.opened +
    data.readingStates.in_progress +
    data.readingStates.finished +
    data.readingStates.saved +
    data.readingStates.archived || 1;

  const readingStateRows = [
    { label: "Unread",      value: data.readingStates.new,         color: "var(--text-faint)" },
    { label: "Opened",      value: data.readingStates.opened,      color: "var(--accent-soft)" },
    { label: "In progress", value: data.readingStates.in_progress, color: "var(--accent)" },
    { label: "Finished",    value: data.readingStates.finished,    color: "var(--success)" },
    { label: "Saved",       value: data.readingStates.saved,       color: "#b07d3a" },
    { label: "Archived",    value: data.readingStates.archived,    color: "var(--border)" },
  ];

  return (
    <>
      <section className="page-header">
        <div>
          <span className="eyebrow">Admin</span>
          <h1>Analytics</h1>
          <p>Platform-wide metrics, usage trends, and user activity.</p>
        </div>
      </section>

      {/* ── Metric cards ────────────────────────────────── */}
      <div className="admin-metrics">
        <div className="admin-metric-card">
          <span className="admin-metric-value">{data.totalUsers}</span>
          <span className="admin-metric-label">Total users</span>
        </div>
        <div className="admin-metric-card">
          <span className="admin-metric-value">{data.activeUsers7d}</span>
          <span className="admin-metric-label">Active last 7 days</span>
        </div>
        <div className="admin-metric-card">
          <span className="admin-metric-value">{data.gmailConnectedCount}</span>
          <span className="admin-metric-label">Gmail connected</span>
        </div>
        <div className="admin-metric-card">
          <span className="admin-metric-value">{data.totalMessages.toLocaleString()}</span>
          <span className="admin-metric-label">Total issues synced</span>
        </div>
        <div className="admin-metric-card">
          <span className="admin-metric-value">{data.totalRules}</span>
          <span className="admin-metric-label">Total sender rules</span>
        </div>
        <div className="admin-metric-card">
          <span className="admin-metric-value">{data.avgMessagesPerUser}</span>
          <span className="admin-metric-label">Avg issues / user</span>
        </div>
      </div>

      {/* ── Trend charts ────────────────────────────────── */}
      <div className="admin-charts-row">
        <section className="section-card admin-chart-card">
          <header>
            <div>
              <h2>New signups</h2>
              <p>Last 30 days</p>
            </div>
            <span className="admin-chart-total">
              {data.signupsLast30d.reduce((s, d) => s + d.count, 0)} total
            </span>
          </header>
          <BarChart data={data.signupsLast30d} />
          <BarChartXLabels data={data.signupsLast30d} />
        </section>

        <section className="section-card admin-chart-card">
          <header>
            <div>
              <h2>Issues synced</h2>
              <p>Last 30 days</p>
            </div>
            <span className="admin-chart-total">
              {data.messagesLast30d.reduce((s, d) => s + d.count, 0).toLocaleString()} total
            </span>
          </header>
          <BarChart data={data.messagesLast30d} color="var(--success)" />
          <BarChartXLabels data={data.messagesLast30d} />
        </section>
      </div>

      {/* ── Reading states + Top sources ────────────────── */}
      <div className="admin-charts-row">
        <section className="section-card admin-chart-card">
          <header>
            <div>
              <h2>Reading states</h2>
              <p>Distribution across all issues</p>
            </div>
          </header>
          <div className="admin-state-list">
            {readingStateRows.map((row) => (
              <div key={row.label} className="admin-state-row">
                <span className="admin-state-label">{row.label}</span>
                <div className="admin-state-bar-wrap">
                  <div
                    className="admin-state-bar"
                    style={{
                      width: `${(row.value / totalReadingStates) * 100}%`,
                      background: row.color,
                    }}
                  />
                </div>
                <span className="admin-state-count">{row.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="section-card admin-chart-card">
          <header>
            <div>
              <h2>Top sources</h2>
              <p>By number of users tracking</p>
            </div>
          </header>
          {data.topSources.length > 0 ? (
            <div className="admin-state-list">
              {data.topSources.map((src) => (
                <div key={src.domain} className="admin-state-row">
                  <span className="admin-state-label" style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {src.domain}
                  </span>
                  <div className="admin-state-bar-wrap">
                    <div
                      className="admin-state-bar"
                      style={{
                        width: `${(src.userCount / (data.topSources[0]?.userCount || 1)) * 100}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                  <span className="admin-state-count">{src.userCount} user{src.userCount === 1 ? "" : "s"}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-note" style={{ padding: "16px 0" }}>No sources tracked yet.</p>
          )}
        </section>
      </div>

      {/* ── Users table ─────────────────────────────────── */}
      <section className="section-card admin-table-card">
        <header>
          <div>
            <h2>All users</h2>
            <p>{data.totalUsers} registered account{data.totalUsers === 1 ? "" : "s"}</p>
          </div>
        </header>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Joined</th>
                <th>Last sign in</th>
                <th>Gmail</th>
                <th>Last sync</th>
                <th>Issues</th>
                <th>Rules</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr key={user.id}>
                  <td className="admin-td-email">{user.email}</td>
                  <td className="admin-td-muted">{format(new Date(user.createdAt), "MMM d, yyyy")}</td>
                  <td className="admin-td-muted">
                    {user.lastSignInAt ? format(new Date(user.lastSignInAt), "MMM d, yyyy") : "—"}
                  </td>
                  <td>
                    {user.gmailConnected
                      ? <span className="admin-badge admin-badge-on">Connected</span>
                      : <span className="admin-badge admin-badge-off">Not connected</span>}
                  </td>
                  <td className="admin-td-muted">
                    {user.lastSyncAt ? format(new Date(user.lastSyncAt), "MMM d · h:mm a") : "—"}
                  </td>
                  <td className="admin-td-num">{user.messageCount.toLocaleString()}</td>
                  <td className="admin-td-num">{user.ruleCount}</td>
                </tr>
              ))}
              {data.users.length === 0 && (
                <tr>
                  <td colSpan={7} className="admin-td-empty">No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

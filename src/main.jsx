import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});
const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await apiRequest('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      onLogin();
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark" aria-hidden="true">HB</div>
        <p className="eyebrow">HOME BAKERS · PRIVATE CRM</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to review orders and customer activity.</p>
        <label htmlFor="password">Admin password</label>
        <input
          autoComplete="current-password"
          id="password"
          onChange={event => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button full-width" disabled={busy} type="submit">
          {busy ? 'Signing in…' : 'Sign in securely'}
        </button>
        <p className="privacy-note">Customer information is visible only after signing in.</p>
      </form>
    </main>
  );
}

function SummaryCard({ label, value, detail }) {
  return (
    <article className="summary-card">
      <p>{label}</p>
      <strong>{value}</strong>
      {detail && <span>{detail}</span>}
    </article>
  );
}

function Dashboard({ onLogout }) {
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState(null);

  const loadDashboard = useCallback(async (query = '', fromDate = '', toDate = '') => {
    setLoading(true);
    setError('');
    try {
      const filters = new URLSearchParams();
      if (fromDate) filters.set('startDate', fromDate);
      if (toDate) filters.set('endDate', toDate);
      const dateQuery = filters.toString();
      const orderQuery = new URLSearchParams({ limit: '100', search: query });
      if (fromDate) orderQuery.set('startDate', fromDate);
      if (toDate) orderQuery.set('endDate', toDate);
      const [nextSummary, nextOrders] = await Promise.all([
        apiRequest(`/api/admin/summary${dateQuery ? `?${dateQuery}` : ''}`),
        apiRequest(`/api/admin/orders?${orderQuery}`)
      ]);
      setSummary(nextSummary);
      setOrders(nextOrders.orders);
    } catch (loadError) {
      if (loadError.message.includes('sign in')) {
        onLogout();
        return;
      }
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadDashboard(search, startDate, endDate), 250);
    return () => window.clearTimeout(timer);
  }, [search, startDate, endDate, loadDashboard]);

  async function updateOrderFulfillment(orderId, orderFulfillment) {
    setBusyOrderId(orderId);
    setError('');
    try {
      await apiRequest(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ order_fulfillment: orderFulfillment })
      });
      await loadDashboard(search, startDate, endDate);
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusyOrderId(null);
    }
  }

  async function deleteOrder(order) {
    if (!window.confirm(`Delete the order for ${order.customer_name}? This cannot be undone.`)) return;
    setBusyOrderId(order.id);
    setError('');
    try {
      await apiRequest(`/api/admin/orders/${order.id}`, { method: 'DELETE' });
      await loadDashboard(search, startDate, endDate);
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusyOrderId(null);
    }
  }

  async function logout() {
    try {
      await apiRequest('/api/admin/logout', { method: 'POST' });
    } finally {
      onLogout();
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Home Bakers CRM home">
          <span className="brand-mark small">HB</span>
          <span>Home Bakers <small>Orders CRM</small></span>
        </a>
        <div className="topbar-actions">
          <button className="quiet-button" onClick={() => loadDashboard(search, startDate, endDate)} type="button">Refresh</button>
          <button className="quiet-button" onClick={logout} type="button">Sign out</button>
        </div>
      </header>

      <section className="welcome-row">
        <div>
          <p className="eyebrow">YOUR BAKERY, AT A GLANCE</p>
          <h1>Order dashboard</h1>
          <p className="muted">Customer orders and cookie favourites in one place.</p>
        </div>
        <span className="live-indicator"><span /> Private dashboard</span>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <section className="summary-grid" aria-label="Order totals">
        <SummaryCard label="Orders recorded" value={summary ? summary.order_count : '—'} detail="All-time orders" />
        <SummaryCard label="Sales value" value={summary ? currency.format(summary.sales_total) : '—'} detail="Fulfilled orders, incl. delivery, in selected dates" />
        <SummaryCard label="Customers" value={summary ? summary.customer_count : '—'} detail="Unique phone numbers" />
      </section>

      <section className="content-grid">
        <article className="panel favourites-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">WHAT'S IN THE OVEN?</p><h2>Cookie favourites</h2></div>
            <span className="panel-icon" aria-hidden="true">✦</span>
          </div>
          {summary?.popularCookies?.length
            ? <ol className="favourites-list">{summary.popularCookies.map((cookie, index) => (
              <li key={cookie.cookie_name}>
                <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="cookie-name">{cookie.cookie_name}</span>
                <strong>{cookie.quantity} <small>boxes</small></strong>
              </li>
            ))}</ol>
            : <p className="empty-state">Your bestsellers will show up here once orders roll in.</p>}
        </article>

        <article className="panel orders-panel">
          <div className="panel-heading orders-heading">
            <div><p className="eyebrow">THE LATEST BATCH</p><h2>Recent orders</h2></div>
            <div className="orders-controls">
              <div className="date-filters" aria-label="Filter orders by date">
                <label><span>From</span><input aria-label="From date" onChange={event => setStartDate(event.target.value)} type="date" value={startDate} /></label>
                <label><span>To</span><input aria-label="To date" onChange={event => setEndDate(event.target.value)} type="date" value={endDate} /></label>
              </div>
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label="Search customers by name or phone"
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search name or phone"
                  type="search"
                  value={search}
                />
              </label>
            </div>
          </div>
          {loading && <p className="loading-state">Loading orders…</p>}
          {!loading && !error && orders.length === 0 && (
            <p className="empty-state">
              {search ? 'No orders found for that search.' : startDate || endDate ? 'No orders found in that date range.' : 'No orders recorded yet.'}
            </p>
          )}
          {!loading && orders.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Customer</th><th>Order</th><th>Order type</th><th>Fulfilled</th><th>Total</th><th>Placed</th><th>Actions</th></tr></thead>
                <tbody>{orders.map(order => (
                  <tr key={order.id}>
                    <td><strong>{order.customer_name}</strong><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></td>
                    <td><ul className="order-items">{order.items.map(item => <li key={item.name}>{item.quantity} × {item.name}</li>)}</ul></td>
                    <td>
                      <span className={`fulfillment-tag ${order.fulfillment}`}>{order.fulfillment}</span>
                      {order.fulfillment === 'delivery' && (
                        <span className="secondary-detail">
                          {order.distance_km == null ? '—' : `${Number(order.distance_km).toFixed(1)} km`}
                          {order.pincode ? ` · ${order.pincode}` : ''}
                          {order.address ? <><br />{order.address}</> : null}
                        </span>
                      )}
                    </td>
                    <td>
                      <select
                        aria-label={`Order fulfillment for ${order.customer_name}`}
                        className={`order-fulfillment-select ${order.order_fulfillment === 'Yes' ? 'fulfilled' : 'unfulfilled'}`}
                        disabled={busyOrderId === order.id}
                        onChange={event => updateOrderFulfillment(order.id, event.target.value)}
                        value={order.order_fulfillment}
                      >
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    </td>
                    <td><strong>{currency.format(order.total)}</strong><span className="secondary-detail">incl. ₹{order.delivery_fee} delivery</span></td>
                    <td>{dateTime.format(new Date(order.created_at))}</td>
                    <td><button className="delete-button" disabled={busyOrderId === order.id} onClick={() => deleteOrder(order)} type="button">Delete</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </article>
      </section>
      <footer className="footer-note">Keep it cosy. Your CRM data stays in your private database.</footer>
    </main>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(null);

  const checkSession = useCallback(async () => {
    try {
      await apiRequest('/api/admin/session');
      setAuthenticated(true);
    } catch {
      setAuthenticated(false);
    }
  }, []);

  useEffect(() => { checkSession(); }, [checkSession]);

  if (authenticated === null) {
    return <main className="login-shell"><p className="loading-state">Opening your private dashboard…</p></main>;
  }
  return authenticated
    ? <Dashboard onLogout={() => setAuthenticated(false)} />
    : <Login onLogin={() => setAuthenticated(true)} />;
}

createRoot(document.getElementById('root')).render(<App />);

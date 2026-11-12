import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COOKIE_CATALOG, COOKIE_PACK_SIZES } from '../api/orders.js';
import { getStorefrontOrderMetrics } from './analytics.js';

const statusLabels = {
  pending: 'Order placed',
  accepted: 'Accepted',
  baked: 'Baked',
  out_for_delivery: 'Out for delivery',
  ready_for_pickup: 'Ready for pickup',
  delivered: 'Delivered',
  picked_up: 'Picked up',
  rejected: 'Rejected'
};

const sourceLabels = {
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  in_person: 'In person',
  other: 'Other'
};

const cookieMenu = Object.entries(COOKIE_CATALOG).map(([name, unitPrice]) => ({
  name,
  unitPrice,
  packSizeGrams: COOKIE_PACK_SIZES[name]
}));

const emptyManualOrder = () => ({
  name: '',
  phone: '',
  email: '',
  fulfillment: 'delivery',
  address: '',
  pincode: '',
  distanceKm: '',
  latitude: '',
  longitude: '',
  source: 'phone',
  sourceNote: '',
  items: [{ name: cookieMenu[0].name, quantity: 1 }]
});

const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

function formatTimestamp(value) {
  return value?.toDate ? dateTime.format(value.toDate()) : 'Time not recorded';
}

function isInvoiceOrder(order) {
  return order.fulfillment === 'pickup'
    ? order.status === 'picked_up'
    : order.status === 'delivered';
}

function escapeInvoiceText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function downloadCrmInvoice(order) {
  const invoiceWindow = window.open('', '_blank');
  if (!invoiceWindow) {
    window.alert('Allow pop-ups for this site to open and save the invoice as a PDF.');
    return;
  }

  invoiceWindow.opener = null;
  const invoiceReference = order.orderRef || order.id;
  const invoiceDateValue = order.statusTimestamps?.[order.fulfillment === 'pickup' ? 'picked_up' : 'delivered']
    || order.createdAt;
  const invoiceDate = invoiceDateValue?.toDate ? invoiceDateValue.toDate() : new Date();
  const items = Array.isArray(order.items) ? order.items : [];
  const invoiceRows = items.map(item => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    return `<tr><td>${escapeInvoiceText(item.name || 'Cookie order')}</td><td class="number">${quantity}</td><td class="number">${currency.format(unitPrice)}</td><td class="number">${currency.format(quantity * unitPrice)}</td></tr>`;
  }).join('');
  const fulfillment = order.fulfillment === 'pickup' ? 'Bakery pickup' : 'Home delivery';
  const address = order.fulfillment === 'pickup'
    ? ''
    : [order.address, order.pincode].filter(Boolean).join(', ');
  const paymentStatus = order.paymentStatus === 'received'
    ? 'Received'
    : order.paymentStatus === 'reported'
      ? 'Reported by customer; awaiting confirmation'
      : 'Pending';

  invoiceWindow.document.open();
  invoiceWindow.document.write(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Invoice ${escapeInvoiceText(invoiceReference)}</title>
    <style>
      * { box-sizing: border-box; } body { margin: 0; padding: 32px; color: #29231f; font: 14px/1.5 Arial, sans-serif; }
      main { max-width: 760px; margin: 0 auto; } header { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 20px; border-bottom: 2px solid #6d2e13; }
      h1 { margin: 0; color: #6d2e13; font: 700 28px Georgia, serif; } h2 { margin: 0 0 8px; font-size: 15px; }
      p { margin: 4px 0; } .muted { color: #74685f; } .invoice-meta { text-align: right; } section { margin-top: 24px; }
      table { width: 100%; margin-top: 12px; border-collapse: collapse; } th, td { padding: 10px 8px; border-bottom: 1px solid #e8e1da; text-align: left; }
      th { background: #f8f2eb; color: #57351f; font-size: 12px; } .number { text-align: right; white-space: nowrap; }
      .totals { width: min(100%, 340px); margin: 18px 0 0 auto; } .totals p { display: flex; justify-content: space-between; gap: 20px; padding: 4px 0; }
      .grand-total { margin-top: 6px !important; padding-top: 10px !important; border-top: 2px solid #6d2e13; color: #6d2e13; font-size: 18px; font-weight: 700; }
      footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #e8e1da; color: #74685f; text-align: center; } @media print { body { padding: 0; } }
    </style></head><body><main>
      <header><div><h1>Butter Bite Bakers</h1></div><div class="invoice-meta"><h2>ORDER INVOICE</h2>
        <p><strong>Invoice:</strong> ${escapeInvoiceText(invoiceReference)}</p>
        <p><strong>Date:</strong> ${escapeInvoiceText(invoiceDate.toLocaleDateString('en-IN'))}</p></div></header>
      <section><h2>Bill to</h2><p>${escapeInvoiceText(order.customer?.name || 'Customer')}</p>
        <p>${escapeInvoiceText(order.customer?.phone || '')}</p>
        ${order.customer?.email ? `<p>${escapeInvoiceText(order.customer.email)}</p>` : ''}
        <p class="muted">${escapeInvoiceText(fulfillment)}${address ? ` · ${escapeInvoiceText(address)}` : ''}</p></section>
      <section><h2>Order details</h2><table><thead><tr><th>Item</th><th class="number">Qty</th><th class="number">Unit price</th><th class="number">Amount</th></tr></thead>
        <tbody>${invoiceRows || '<tr><td colspan="4">Order details unavailable</td></tr>'}</tbody></table>
        <div class="totals"><p><span>Subtotal</span><strong>${currency.format(Number(order.subtotal) || 0)}</strong></p>
          ${Number(order.discountAmount) > 0 ? `<p><span>Coupon ${escapeInvoiceText(order.couponCode || '')} (${Number(order.discountPercent) || 0}% off)</span><strong>−${currency.format(Number(order.discountAmount))}</strong></p>` : ''}
          <p><span>Delivery fee</span><strong>${currency.format(Number(order.deliveryFee) || 0)}</strong></p>
          <p class="grand-total"><span>Total</span><strong>${currency.format(Number(order.total) || 0)}</strong></p>
          <p><span>Payment status</span><strong>${escapeInvoiceText(paymentStatus)}</strong></p></div></section>
      <footer>Thank you for supporting our bakery!</footer></main></body></html>`);
  invoiceWindow.document.close();
  window.setTimeout(() => {
    invoiceWindow.focus();
    invoiceWindow.print();
  }, 250);
}

function getTimeline(order) {
  if (order.status === 'rejected') {
    return [
      { key: 'placed', label: 'Order placed', value: order.statusTimestamps?.placed || order.createdAt },
      { key: 'rejected', label: 'Rejected', value: order.statusTimestamps?.rejected }
    ];
  }
  return [
    { key: 'placed', label: 'Order placed', value: order.statusTimestamps?.placed || order.createdAt },
    { key: 'accepted', label: 'Accepted', value: order.statusTimestamps?.accepted },
    { key: 'baked', label: 'Baked', value: order.statusTimestamps?.baked },
    order.fulfillment === 'pickup'
      ? { key: 'ready_for_pickup', label: 'Ready for pickup', value: order.statusTimestamps?.ready_for_pickup }
      : { key: 'out_for_delivery', label: 'Out for delivery', value: order.statusTimestamps?.out_for_delivery },
    order.fulfillment === 'pickup'
      ? { key: 'picked_up', label: 'Picked up', value: order.statusTimestamps?.picked_up }
      : { key: 'delivered', label: 'Delivered', value: order.statusTimestamps?.delivered }
  ];
}

function nextStatuses(order) {
  if (order.status === 'pending') {
    return [
      { value: 'accepted', label: 'Accept', style: 'crm-status-action--accept' },
      { value: 'rejected', label: 'Reject', style: 'crm-status-action--reject' }
    ];
  }
  if (order.status === 'accepted') return [{ value: 'baked', label: 'Mark baked', style: 'crm-status-action--accept' }];
  if (order.status === 'baked') {
    return order.fulfillment === 'pickup'
      ? [{ value: 'ready_for_pickup', label: 'Ready for pickup', style: 'crm-status-action--accept' }]
      : [{ value: 'out_for_delivery', label: 'Out for delivery', style: 'crm-status-action--accept' }];
  }
  if (order.status === 'out_for_delivery') return [{ value: 'delivered', label: 'Mark delivered', style: 'crm-status-action--accept' }];
  if (order.status === 'ready_for_pickup') return [{ value: 'picked_up', label: 'Mark picked up', style: 'crm-status-action--accept' }];
  return [];
}

function CRMThemeToggle({ className }) {
  const [darkMode, setDarkMode] = useState(() => window.localStorage.getItem('butterBiteCRMDarkMode') === 'true');

  useEffect(() => {
    document.documentElement.classList.toggle('dark-mode', darkMode);
    window.localStorage.setItem('butterBiteCRMDarkMode', String(darkMode));
  }, [darkMode]);

  return (
    <button
      aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={darkMode}
      className={className}
      onClick={() => setDarkMode(current => !current)}
      title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      type="button"
    >
      <span aria-hidden="true">{darkMode ? '☀' : '☾'}</span>
      {darkMode ? 'Light mode' : 'Dark mode'}
    </button>
  );
}

function FirebaseLogin({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const credential = await window.firebase.auth().signInWithEmailAndPassword(email.trim(), password);
      if (credential.user.email?.toLowerCase() !== window.BAKERY_ADMIN_EMAIL.toLowerCase()) {
        await window.firebase.auth().signOut();
        throw new Error(`Sign in with the authorized baker email: ${window.BAKERY_ADMIN_EMAIL}.`);
      }
      onSignedIn(credential.user);
    } catch (loginError) {
      const messages = {
        'auth/invalid-credential': 'Email or password is incorrect.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/too-many-requests': 'Too many sign-in attempts. Wait a while, then try again.',
        'auth/unauthorized-domain': 'This CRM domain is not authorized for Firebase Authentication. Add butterbitebakers-crm.web.app under Authentication → Settings → Authorized domains.'
      };
      setError(messages[loginError.code] || loginError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <CRMThemeToggle className="quiet-button crm-login-theme-toggle" />
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark" aria-hidden="true">&lt;bbB_&gt;</div>
        <p className="eyebrow">BUTTER BITE BAKERS</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in with the baker account used by the ordering portal.</p>
        <label htmlFor="crm-email">Baker email</label>
        <input autoComplete="username" id="crm-email" onChange={event => setEmail(event.target.value)} required type="email" value={email} />
        <label htmlFor="crm-password">Password</label>
        <input autoComplete="current-password" id="crm-password" onChange={event => setPassword(event.target.value)} required type="password" value={password} />
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button full-width" disabled={busy} type="submit">
          {busy ? 'Signing in…' : 'Sign in securely'}
        </button>
      </form>
    </main>
  );
}

function OrderTimeline({ order }) {
  const stages = getTimeline(order);
  const currentKey = order.status === 'pending' ? 'placed' : order.status;
  const currentIndex = Math.max(0, stages.findIndex(stage => stage.key === currentKey));

  return (
    <ol className="crm-order-timeline">
      {stages.map((stage, index) => (
        <li className="crm-timeline-stage" key={stage.key}>
          <span className={`crm-timeline-marker ${index <= currentIndex ? 'is-complete' : ''}`} />
          {index < stages.length - 1 && <span className={`crm-timeline-line ${index < currentIndex ? 'is-complete' : ''}`} />}
          <div>
            <strong className={index <= currentIndex ? '' : 'is-upcoming'}>{stage.label}</strong>
            <time>{formatTimestamp(stage.value)}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}

const crmNavigationGroups = [
  {
    label: 'Overview',
    links: [
      { id: 'dashboard', label: 'Dashboard', icon: '▦' },
      { id: 'realtime', label: 'Realtime', icon: '⌁' }
    ]
  },
  {
    label: 'Manage',
    links: [
      { id: 'customers', label: 'Customers', icon: '♙' },
      { id: 'coupons', label: 'Coupons', icon: '%' },
      { id: 'orders', label: 'Orders', icon: '▤' },
      { id: 'invoices', label: 'Invoices', icon: '▧' }
    ]
  },
  {
    label: 'Insights',
    links: [{ id: 'analytics', label: 'Analytics', icon: '▥' }]
  }
];

function CRMPageLayout({ activePage, onNavigate, onLogout, children }) {
  return (
    <div className="crm-app-shell">
      <aside className="crm-sidebar">
        <a className="crm-sidebar-brand" href="/" aria-label="Butter Bite Bakers CRM">
          <span className="crm-sidebar-mark">&lt;bbB_&gt;</span>
          <span>Butter Bite Bakers<small>Bakery dashboard</small></span>
        </a>
        <nav aria-label="CRM navigation" className="crm-sidebar-nav">
          {crmNavigationGroups.map(group => (
            <section className="crm-nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.links.map(link => (
                <button
                  aria-current={activePage === link.id ? 'page' : undefined}
                  className={`crm-nav-link ${activePage === link.id ? 'is-active' : ''}`}
                  key={link.id}
                  onClick={() => onNavigate(link.id)}
                  type="button"
                >
                  <span aria-hidden="true">{link.icon}</span>{link.label}
                </button>
              ))}
            </section>
          ))}
        </nav>
        <div className="crm-sidebar-footer">
          <CRMThemeToggle className="crm-nav-link crm-theme-toggle" />
          <a className="crm-nav-link" href="https://butterbitebakers.web.app/">
            <span aria-hidden="true">↗</span>Storefront
          </a>
          <button className="crm-nav-link" onClick={onLogout} type="button">
            <span aria-hidden="true">⇥</span>Sign out
          </button>
        </div>
      </aside>
      <div className="crm-main">{children}</div>
    </div>
  );
}

function WebsiteAnalyticsPage({ user, orders, ordersLoading, activePage, onNavigate, onLogout }) {
  const [range, setRange] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadSequence = useRef(0);

  const loadAnalytics = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError('');
    try {
      const endpoint = window.BAKERY_SITE_ANALYTICS_DASHBOARD_URL;
      if (!endpoint) throw new Error('The PostgreSQL site analytics endpoint is not configured.');
      const token = await user.getIdToken();
      const response = await fetch(`${endpoint}?range=${activePage === 'realtime' ? '1d' : range}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Analytics service returned HTTP ${response.status}.`);
      if (!Number.isFinite(result.visits)
        || !Number.isFinite(result.uniqueVisitors)
        || !Number.isFinite(result.conversions)
        || !Array.isArray(result.daily)
        || !Array.isArray(result.recentEvents)) {
        throw new Error('The analytics API returned an unexpected response. Deploy the updated Render service and try again.');
      }
      if (sequence === loadSequence.current) setData(result);
    } catch (loadError) {
      if (sequence === loadSequence.current) setError(`Could not load website analytics: ${loadError.message}`);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [activePage, range, user]);

  useEffect(() => {
    void loadAnalytics();
    if (activePage !== 'realtime') return undefined;
    const timer = window.setInterval(() => { void loadAnalytics(); }, 30000);
    return () => window.clearInterval(timer);
  }, [activePage, loadAnalytics]);

  const pageTitle = activePage === 'dashboard'
    ? 'Dashboard'
    : activePage === 'realtime'
      ? 'Realtime activity'
      : 'Website analytics';
  const selectedRange = activePage === 'realtime' ? '1' : range.slice(0, -1);
  const orderMetrics = getStorefrontOrderMetrics(orders, selectedRange);
  const dailyRows = (data?.daily || []).map(row => ({
    ...row,
    conversions: orderMetrics.dailyCounts[row.date] || 0
  }));
  const recentEvents = [
    ...(data?.recentEvents || []).filter(event => event.event_type !== 'order_placed'),
    ...orderMetrics.recentEvents
  ].sort((first, second) => Date.parse(second.created_at) - Date.parse(first.created_at)).slice(0, 25);
  const maxVisits = Math.max(1, ...dailyRows.map(row => Number(row.visits) || 0));
  const orderCount = orders.length;
  const pendingCount = orders.filter(order => order.status === 'pending').length;
  const activeCount = orders.filter(order => !['delivered', 'picked_up', 'rejected'].includes(order.status)).length;
  const orderValue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);

  return (
    <CRMPageLayout activePage={activePage} onLogout={onLogout} onNavigate={onNavigate}>
    <main className="dashboard-shell crm-insights-page">
      <header className="topbar">
        <div className="topbar-actions">
          <a className="quiet-button crm-storefront-link" href="https://butterbitebakers.web.app/">Storefront</a>
          <button className="quiet-button" onClick={() => { void loadAnalytics(); }} type="button">Refresh</button>
        </div>
      </header>
      <section className="welcome-row">
        <div>
          <p className="eyebrow">{activePage === 'realtime' ? 'LIVE STOREFRONT ACTIVITY' : 'BUTTER BITE BAKERS · INSIGHTS'}</p>
          <h1>{pageTitle}</h1>
          <p className="muted">Visits and unique browsers are stored in PostgreSQL; current storefront orders are counted from Firestore. Signed in as {user.email}.</p>
        </div>
        <span className="live-indicator"><span />{activePage === 'realtime' ? 'Today · updates every 30 seconds' : 'Live storefront data'}</span>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {activePage === 'dashboard' && (
        <section className="summary-grid crm-overview-grid" aria-label="Order overview">
          <article className="summary-card"><p>Orders</p><strong>{ordersLoading ? '—' : orderCount}</strong><span>All live portal orders</span></article>
          <article className="summary-card"><p>Needs action</p><strong>{ordersLoading ? '—' : pendingCount}</strong><span>Awaiting acceptance</span></article>
          <article className="summary-card"><p>In progress</p><strong>{ordersLoading ? '—' : activeCount}</strong><span>Not yet completed</span></article>
          <article className="summary-card"><p>Order value</p><strong>{ordersLoading ? '—' : currency.format(orderValue)}</strong><span>All live portal orders</span></article>
        </section>
      )}

      {activePage !== 'realtime' && (
        <>
          <div className="crm-analytics-toolbar">
            <div><p className="eyebrow">STOREFRONT PERFORMANCE</p><h2>{activePage === 'dashboard' ? 'Your storefront' : 'Site activity'}</h2></div>
            <div aria-label="Analytics date range" className="crm-range-switch" role="group">
              {['7d', '30d', '90d'].map(value => (
                <button
                  aria-pressed={range === value}
                  className={range === value ? 'is-active' : ''}
                  key={value}
                  onClick={() => setRange(value)}
                  type="button"
                >{value}</button>
              ))}
            </div>
          </div>
          <section aria-label="Website analytics totals" className="summary-grid crm-site-summary">
            <article className="summary-card"><p>Site visits</p><strong>{loading ? '—' : Number(data?.visits || 0).toLocaleString('en-IN')}</strong><span>Storefront page views</span></article>
            <article className="summary-card"><p>Unique visitors</p><strong>{loading ? '—' : Number(data?.uniqueVisitors || 0).toLocaleString('en-IN')}</strong><span>Approx. unique browsers</span></article>
            <article className="summary-card"><p>Conversions</p><strong>{loading || ordersLoading ? '—' : orderMetrics.conversions.toLocaleString('en-IN')}</strong><span>Current storefront orders in Firestore</span></article>
            <article className="summary-card"><p>Conversion rate</p><strong>{loading || ordersLoading ? '—' : `${(data?.uniqueVisitors ? orderMetrics.conversions / data.uniqueVisitors * 100 : 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`}</strong><span>Current orders per unique visitor</span></article>
          </section>
          <section className="panel crm-analytics-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">VISITS & CONVERSIONS</p><h2>Daily storefront activity</h2></div>
              <div className="crm-chart-legend"><span><i className="visits" />Visits</span><span><i className="visitors" />Unique visitors</span></div>
            </div>
            {loading && <p className="loading-state">Loading analytics…</p>}
            {!loading && !error && dailyRows.length === 0 && <p className="empty-state">No storefront activity recorded for this period yet.</p>}
            {!loading && dailyRows.length > 0 && (
              <div aria-label="Daily visits and unique visitors" className="crm-analytics-chart" role="img">
                {dailyRows.map(row => {
                  const visits = Number(row.visits) || 0;
                  const visitors = Number(row.uniqueVisitors) || 0;
                  const dateLabel = new Date(`${row.date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                  return (
                    <div className="crm-chart-day" key={row.date} title={`${dateLabel}: ${visits} visits, ${visitors} unique visitors, ${Number(row.conversions) || 0} conversions`}>
                      <div className="crm-chart-bars">
                        <span className="visits" style={{ height: `${Math.max(visits ? 3 : 0, visits / maxVisits * 100)}%` }} />
                        <span className="visitors" style={{ height: `${Math.max(visitors ? 3 : 0, visitors / maxVisits * 100)}%` }} />
                      </div>
                      <small>{dateLabel}</small>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {(activePage === 'realtime' || activePage === 'analytics') && (
        <section className="panel crm-analytics-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">{activePage === 'realtime' ? 'LATEST EVENTS' : 'RECENT STOREFRONT EVENTS'}</p><h2>{activePage === 'realtime' ? 'Activity feed' : 'Recent activity'}</h2></div>
            <span className="live-indicator"><span />{activePage === 'realtime' ? 'Today' : range}</span>
          </div>
          {loading && <p className="loading-state">Loading activity…</p>}
          {!loading && !error && !recentEvents.length && <p className="empty-state">No activity recorded for this period yet. Visits and orders will appear here as they happen.</p>}
          <ol className="crm-activity-list">
            {recentEvents.map((event, index) => (
              <li key={`${event.created_at}-${index}`}>
                <span aria-hidden="true" className={`crm-activity-icon ${event.event_type === 'order_placed' ? 'is-conversion' : ''}`}>
                  {event.event_type === 'order_placed' ? '✓' : '↗'}
                </span>
                <div>
                  <strong>{event.event_type === 'order_placed' ? 'Order placed' : 'Storefront visit'}</strong>
                  <span>{event.page_path}</span>
                  {event.ip_address && <span className="crm-activity-ip">IP {event.ip_address}</span>}
                </div>
                <time>{event.created_at ? new Date(event.created_at).toLocaleString('en-IN') : 'Just now'}</time>
              </li>
            ))}
          </ol>
        </section>
      )}
      <footer className="footer-note">Site activity includes public IP addresses and anonymous browser IDs. Activity reports are available only to the authorized baker account.</footer>
    </main>
    </CRMPageLayout>
  );
}

function FirebaseCustomersPage({ user, onNavigate, onLogout }) {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState(null);
  const [busyCustomer, setBusyCustomer] = useState('');

  useEffect(() => {
    const unsubscribe = window.firebase.firestore()
      .collection('customerProfiles')
      .onSnapshot(snapshot => {
        const profiles = snapshot.docs
          .map(document => ({ id: document.id, ...document.data() }))
          .sort((first, second) => String(first.name || '').localeCompare(String(second.name || '')));
        setCustomers(profiles);
        setLoading(false);
        setError('');
      }, snapshotError => {
        setLoading(false);
        setError(snapshotError.code === 'permission-denied'
          ? 'Customer access denied. Deploy the latest Firestore rules and sign in with the authorized baker account.'
          : `Could not load customer profiles: ${snapshotError.message}`);
      });
    return unsubscribe;
  }, []);

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return customers;
    return customers.filter(customer => [
      customer.name,
      customer.phone,
      customer.address,
      customer.pincode,
      customer.id
    ].some(value => String(value || '').toLocaleLowerCase().includes(query)));
  }, [customers, search]);

  function startEditing(customer) {
    setError('');
    setSuccess('');
    setEditingId(customer.id);
    setDraft({
      name: customer.name || '',
      phone: customer.phone || '',
      address: customer.address || '',
      pincode: customer.pincode || '',
      latitude: customer.latitude == null ? '' : String(customer.latitude),
      longitude: customer.longitude == null ? '' : String(customer.longitude)
    });
  }

  async function saveCustomer(event, customer) {
    event.preventDefault();
    setError('');
    setSuccess('');

    const latitude = draft.latitude.trim() === '' ? null : Number(draft.latitude);
    const longitude = draft.longitude.trim() === '' ? null : Number(draft.longitude);
    if (!draft.name.trim() || !draft.phone.trim()) {
      setError('Customer name and phone are required.');
      return;
    }
    if ((latitude === null) !== (longitude === null)
      || (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
      || (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
      setError('Enter both valid map coordinates, or leave both fields blank.');
      return;
    }

    setBusyCustomer(customer.id);
    try {
      await window.firebase.firestore().collection('customerProfiles').doc(customer.id).update({
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        address: draft.address.trim(),
        pincode: draft.pincode.trim(),
        latitude,
        longitude
      });
      setEditingId('');
      setDraft(null);
      setSuccess(`Saved changes for ${draft.name.trim()}.`);
    } catch (saveError) {
      setError(`Could not update customer profile: ${saveError.message}`);
    } finally {
      setBusyCustomer('');
    }
  }

  async function deleteCustomer(customer) {
    const name = customer.name || 'this customer';
    setError('');
    setSuccess('');
    setBusyCustomer(customer.id);
    try {
      const firestore = window.firebase.firestore();
      const linkedOrders = await firestore.collection('orders')
        .where('customerUid', '==', customer.id)
        .get();
      const ordersToDelete = new Map(linkedOrders.docs.map(orderDocument => [orderDocument.id, orderDocument]));
      const normalizedPhone = String(customer.phone || '').replace(/\D/g, '');
      const matchingProfiles = normalizedPhone
        ? customers.filter(profile => String(profile.phone || '').replace(/\D/g, '') === normalizedPhone)
        : [];
      const phoneIsUnique = matchingProfiles.length === 1;
      let unlinkedPhoneOrderCount = 0;
      if (phoneIsUnique && customer.phone) {
        const phoneOrders = await firestore.collection('orders')
          .where('customer.phone', '==', customer.phone)
          .get();
        phoneOrders.docs.forEach(orderDocument => {
          if (!orderDocument.data().customerUid && !ordersToDelete.has(orderDocument.id)) {
            ordersToDelete.set(orderDocument.id, orderDocument);
            unlinkedPhoneOrderCount += 1;
          }
        });
      }

      const orderCount = ordersToDelete.size;
      const phoneScope = unlinkedPhoneOrderCount
        ? ` This includes ${unlinkedPhoneOrderCount} unlinked order${unlinkedPhoneOrderCount === 1 ? '' : 's'} with the same unique phone number.`
        : '';
      const ambiguityNote = !phoneIsUnique && normalizedPhone
        ? ' Manual orders with a shared phone number are excluded to avoid deleting another customer’s data.'
        : '';
      if (!window.confirm(`Permanently delete ${name}'s saved profile and ${orderCount} associated order${orderCount === 1 ? '' : 's'}? Generated invoices from those orders will also be removed.${phoneScope}${ambiguityNote} The Firebase sign-in account remains.`)) return;

      const documents = [...ordersToDelete.values()];
      for (let start = 0; start < documents.length; start += 450) {
        const batch = firestore.batch();
        documents.slice(start, start + 450).forEach(orderDocument => batch.delete(orderDocument.ref));
        await batch.commit();
      }
      await firestore.collection('customerProfiles').doc(customer.id).delete();
      if (editingId === customer.id) {
        setEditingId('');
        setDraft(null);
      }
      setSuccess(`Deleted ${name}'s saved profile and ${orderCount} associated order${orderCount === 1 ? '' : 's'} with their generated invoices. Their Firebase sign-in account remains.`);
    } catch (deleteError) {
      setError(`Could not delete the customer profile and order history: ${deleteError.message}. If multiple delete batches were needed, some orders may already be deleted; retry to finish removing the remaining data.`);
    } finally {
      setBusyCustomer('');
    }
  }

  return (
    <CRMPageLayout activePage="customers" onLogout={onLogout} onNavigate={onNavigate}>
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="topbar-actions">
          <a className="quiet-button crm-storefront-link" href="https://butterbitebakers.web.app/">Storefront</a>
        </div>
      </header>

      <section className="welcome-row">
        <div>
          <p className="eyebrow">CUSTOMER PROFILES</p>
          <h1>Customers</h1>
          <p className="muted">Saved customer details from the storefront. Signed in as {user.email}.</p>
        </div>
        <span className="live-indicator"><span /> Live Firestore sync</span>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {success && <div className="success-banner" role="status">{success}</div>}

      <section className="panel crm-customers-panel">
        <div className="panel-heading orders-heading">
          <div>
            <p className="eyebrow">STOREFRONT CUSTOMERS</p>
            <h2>{customers.length} saved {customers.length === 1 ? 'customer' : 'customers'}</h2>
          </div>
          <div className="crm-live-filters">
            <input
              aria-label="Search customers"
              onChange={event => setSearch(event.target.value)}
              placeholder="Search name, phone, address, PIN, UID"
              type="search"
              value={search}
            />
          </div>
        </div>

        {loading && <p className="loading-state">Loading customer profiles…</p>}
        {!loading && customers.length === 0 && <p className="empty-state">No saved customer profiles yet.</p>}
        {!loading && customers.length > 0 && filteredCustomers.length === 0 && <p className="empty-state">No customers match your search.</p>}

        <div className="crm-customer-list">
          {filteredCustomers.map(customer => {
            const isEditing = editingId === customer.id;
            const isBusy = busyCustomer === customer.id;
            return (
              <article className="crm-customer-card" key={customer.id}>
                <div className="crm-customer-heading">
                  <div>
                    <p className="eyebrow">CUSTOMER</p>
                    <h3>{customer.name || 'Unnamed customer'}</h3>
                    <p className="crm-customer-uid">Firebase UID: {customer.id}</p>
                  </div>
                  {!isEditing && (
                    <div className="crm-customer-actions">
                      <button className="quiet-button" disabled={isBusy} onClick={() => startEditing(customer)} type="button">Edit</button>
                      <button className="delete-button" disabled={isBusy} onClick={() => deleteCustomer(customer)} type="button">
                        {isBusy ? 'Working…' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <form className="crm-customer-form" onSubmit={event => saveCustomer(event, customer)}>
                    <label>Customer name *
                      <input autoComplete="name" onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} required value={draft.name} />
                    </label>
                    <label>Phone *
                      <input autoComplete="tel" onChange={event => setDraft(current => ({ ...current, phone: event.target.value }))} required type="tel" value={draft.phone} />
                    </label>
                    <label className="crm-customer-wide">Address
                      <textarea autoComplete="street-address" onChange={event => setDraft(current => ({ ...current, address: event.target.value }))} rows="2" value={draft.address} />
                    </label>
                    <label>PIN code
                      <input autoComplete="postal-code" onChange={event => setDraft(current => ({ ...current, pincode: event.target.value }))} value={draft.pincode} />
                    </label>
                    <label>Latitude
                      <input onChange={event => setDraft(current => ({ ...current, latitude: event.target.value }))} step="any" type="number" value={draft.latitude} />
                    </label>
                    <label>Longitude
                      <input onChange={event => setDraft(current => ({ ...current, longitude: event.target.value }))} step="any" type="number" value={draft.longitude} />
                    </label>
                    <div className="crm-customer-form-actions">
                      <button className="quiet-button" disabled={isBusy} onClick={() => { setEditingId(''); setDraft(null); }} type="button">Cancel</button>
                      <button className="primary-button" disabled={isBusy} type="submit">{isBusy ? 'Saving…' : 'Save changes'}</button>
                    </div>
                  </form>
                ) : (
                  <dl className="crm-customer-details">
                    <div><dt>Phone</dt><dd>{customer.phone || 'Not provided'}</dd></div>
                    <div><dt>Address</dt><dd>{customer.address || 'Not provided'}</dd></div>
                    <div><dt>PIN code</dt><dd>{customer.pincode || 'Not provided'}</dd></div>
                    <div><dt>Latitude</dt><dd>{customer.latitude ?? 'Not provided'}</dd></div>
                    <div><dt>Longitude</dt><dd>{customer.longitude ?? 'Not provided'}</dd></div>
                  </dl>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <footer className="footer-note">Deleting a profile also removes orders linked by Firebase UID and unlinked manual orders with a unique matching phone. Orders with a phone shared across profiles are not included. The Firebase sign-in account is not deleted.</footer>
    </main>
    </CRMPageLayout>
  );
}

function FirebaseCouponsPage({ user, onNavigate, onLogout }) {
  const [coupons, setCoupons] = useState([]);
  const [code, setCode] = useState('NEW25');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingCode, setUpdatingCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const unsubscribe = window.firebase.firestore()
      .collection('coupons')
      .orderBy('createdAt', 'desc')
      .onSnapshot(snapshot => {
        setCoupons(snapshot.docs.map(document => ({ id: document.id, ...document.data() })));
        setLoading(false);
        setError('');
      }, snapshotError => {
        setLoading(false);
        setError(snapshotError.code === 'permission-denied'
          ? 'Coupon access denied. Sign in with the authorized baker account.'
          : `Could not load coupons: ${snapshotError.message}`);
      });
    return unsubscribe;
  }, []);

  async function createCoupon(event) {
    event.preventDefault();
    const normalizedCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,30}$/.test(normalizedCode)) {
      setError('Use 3–30 letters, numbers, hyphens, or underscores for the coupon code.');
      setSuccess('');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const couponRef = window.firebase.firestore().collection('coupons').doc(normalizedCode);
      const existingCoupon = await couponRef.get();
      if (existingCoupon.exists) {
        setError('That coupon code already exists. Expired coupons can be reactivated.');
        return;
      }
      await couponRef.set({
        code: normalizedCode,
        discountPercent: 25,
        status: 'active',
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      });
      setCode('');
      setSuccess(`${normalizedCode} is active for 25% off each eligible first-five order.`);
    } catch (saveError) {
      setError(`Could not create coupon: ${saveError.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function updateCouponStatus(coupon) {
    const nextStatus = coupon.status === 'active' ? 'expired' : 'active';
    setUpdatingCode(coupon.code);
    setError('');
    setSuccess('');
    try {
      await window.firebase.firestore().collection('coupons').doc(coupon.id).update({
        status: nextStatus,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      });
      setSuccess(`${coupon.code} is now ${nextStatus}.`);
    } catch (updateError) {
      setError(`Could not update ${coupon.code}: ${updateError.message}`);
    } finally {
      setUpdatingCode('');
    }
  }

  return (
    <CRMPageLayout activePage="coupons" onLogout={onLogout} onNavigate={onNavigate}>
      <main className="dashboard-shell">
        <header className="topbar">
          <div className="topbar-actions">
            <a className="quiet-button crm-storefront-link" href="https://butterbitebakers.web.app/">Storefront</a>
          </div>
        </header>
        <section className="welcome-row">
          <div>
            <p className="eyebrow">PROMOTIONS · BUTTER BITE BAKERS</p>
            <h1>Coupons</h1>
            <p className="muted">Create a 25% coupon. Each customer can use an active code on their first five orders.</p>
          </div>
          <span className="live-indicator"><span />Synced with Firestore</span>
        </section>

        {error && <div className="error-banner" role="alert">{error}</div>}
        {success && <div className="success-banner" role="status">{success}</div>}

        <section className="panel crm-coupon-create">
          <div className="panel-heading">
            <div><p className="eyebrow">NEW PROMOTION</p><h2>Create a coupon code</h2></div>
            <strong className="crm-coupon-discount">25% OFF</strong>
          </div>
          <form className="crm-coupon-form" onSubmit={createCoupon}>
            <label htmlFor="crm-coupon-code">Coupon code
              <input
                autoCapitalize="characters"
                autoComplete="off"
                id="crm-coupon-code"
                maxLength={30}
                onChange={event => setCode(event.target.value.toUpperCase())}
                placeholder="e.g. WELCOME25"
                value={code}
              />
            </label>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Creating…' : 'Create active coupon'}
            </button>
          </form>
          <p className="muted crm-coupon-note">Codes are case-insensitive. Expired codes can be reactivated; each code remains valid for 25% off eligible orders.</p>
        </section>

        <section className="panel crm-coupon-list">
          <div className="panel-heading">
            <div><p className="eyebrow">FIRESTORE COUPONS</p><h2>Manage promotions</h2></div>
            <span className="live-indicator">{coupons.length} {coupons.length === 1 ? 'coupon' : 'coupons'}</span>
          </div>
          {loading && <p className="loading-state">Loading coupons…</p>}
          {!loading && coupons.length === 0 && <p className="empty-state">No coupons yet. Create a code above to launch your first offer.</p>}
          {coupons.length > 0 && (
            <div className="crm-coupon-table-wrap">
              <table className="crm-coupon-table">
                <thead><tr><th>Code</th><th>Offer</th><th>Per customer</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {coupons.map(coupon => (
                    <tr key={coupon.id}>
                      <td><strong>{coupon.code}</strong></td>
                      <td>{coupon.discountPercent}% off cookie subtotal</td>
                      <td>First 5 orders</td>
                      <td><span className={`crm-coupon-status ${coupon.status === 'active' ? 'is-active' : 'is-expired'}`}>{coupon.status}</span></td>
                      <td>
                        <button
                          className="quiet-button"
                          disabled={updatingCode === coupon.code}
                          onClick={() => { void updateCouponStatus(coupon); }}
                          type="button"
                        >{updatingCode === coupon.code ? 'Saving…' : coupon.status === 'active' ? 'Expire' : 'Reactivate'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <footer className="footer-note">Coupon codes are available only to signed-in customers and validated by Firebase before order placement.</footer>
      </main>
    </CRMPageLayout>
  );
}

function FirebaseInvoicesPage({ user, onLogout, onNavigate, orders, loading, error }) {
  const [search, setSearch] = useState('');
  const invoiceOrders = useMemo(() => orders.filter(isInvoiceOrder), [orders]);
  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return invoiceOrders;
    return invoiceOrders.filter(order => [
      order.orderRef,
      order.customer?.name,
      order.customer?.phone,
      order.customer?.email,
      order.fulfillment,
      order.paymentStatus
    ].some(value => String(value || '').toLocaleLowerCase().includes(query)));
  }, [invoiceOrders, search]);
  const invoicedTotal = invoiceOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);

  return (
    <CRMPageLayout activePage="invoices" onLogout={onLogout} onNavigate={onNavigate}>
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="topbar-actions">
          <a className="quiet-button crm-storefront-link" href="https://butterbitebakers.web.app/">Storefront</a>
        </div>
      </header>

      <section className="welcome-row">
        <div>
          <p className="eyebrow">COMPLETED CUSTOMER ORDERS</p>
          <h1>Invoices</h1>
          <p className="muted">Invoices are generated from delivered or picked-up orders. Signed in as {user.email}.</p>
        </div>
        <span className="live-indicator"><span /> Live Firestore sync</span>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      <section className="summary-grid invoice-summary-grid" aria-label="Invoice totals">
        <article className="summary-card"><p>Invoices</p><strong>{invoiceOrders.length}</strong><span>Delivered and picked-up orders</span></article>
        <article className="summary-card"><p>Invoice total</p><strong>{currency.format(invoicedTotal)}</strong><span>Combined order totals</span></article>
      </section>

      <section className="panel crm-invoices-panel">
        <div className="panel-heading orders-heading">
          <div>
            <p className="eyebrow">INVOICE REGISTER</p>
            <h2>{filteredInvoices.length} {filteredInvoices.length === 1 ? 'invoice' : 'invoices'}</h2>
          </div>
          <div className="crm-live-filters">
            <input
              aria-label="Search invoices"
              onChange={event => setSearch(event.target.value)}
              placeholder="Search invoice, customer, phone"
              type="search"
              value={search}
            />
          </div>
        </div>
        {loading && <p className="loading-state">Loading invoices…</p>}
        {!loading && invoiceOrders.length === 0 && <p className="empty-state">No invoices yet. They appear when an order is delivered or picked up.</p>}
        {!loading && invoiceOrders.length > 0 && filteredInvoices.length === 0 && <p className="empty-state">No invoices match your search.</p>}
        <div className="crm-invoice-list">
          {filteredInvoices.map(order => {
            const paymentLabel = order.paymentStatus === 'received'
              ? 'Received'
              : order.paymentStatus === 'reported'
                ? 'Reported; awaiting confirmation'
                : 'Pending';
            const completedAt = order.statusTimestamps?.[order.fulfillment === 'pickup' ? 'picked_up' : 'delivered']
              || order.createdAt;
            return (
              <article className="crm-invoice-card" key={order.id}>
                <div className="crm-invoice-heading">
                  <div>
                    <p className="eyebrow">INVOICE {order.orderRef || order.id}</p>
                    <h3>{order.customer?.name || 'Customer'}</h3>
                  </div>
                  <strong className="crm-invoice-total">{currency.format(Number(order.total) || 0)}</strong>
                </div>
                <dl className="crm-invoice-details">
                  <div><dt>Invoice date</dt><dd>{formatTimestamp(completedAt)}</dd></div>
                  <div><dt>Fulfillment</dt><dd>{order.fulfillment === 'pickup' ? 'Picked up' : 'Delivered'}</dd></div>
                  <div><dt>Payment</dt><dd>{paymentLabel}</dd></div>
                  <div><dt>Customer contact</dt><dd>{[order.customer?.phone, order.customer?.email].filter(Boolean).join(' · ') || 'Not provided'}</dd></div>
                  {Number(order.discountAmount) > 0 && <div><dt>Coupon discount</dt><dd>{order.couponCode} · {currency.format(Number(order.discountAmount))} off</dd></div>}
                  <div className="crm-invoice-items"><dt>Items</dt><dd>{(order.items || []).map(item => `${item.name} × ${item.quantity}`).join(', ') || 'Order details unavailable'}</dd></div>
                </dl>
                <button className="primary-button crm-invoice-download" onClick={() => downloadCrmInvoice(order)} type="button">Download invoice</button>
              </article>
            );
          })}
        </div>
      </section>
      <footer className="footer-note">Invoice details are derived from completed orders. Removing a linked order also removes its invoice from this register.</footer>
    </main>
    </CRMPageLayout>
  );
}

function FirebaseOrdersCRM({ user, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [activePage, setActivePage] = useState('dashboard');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyOrder, setBusyOrder] = useState('');
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [manualOrder, setManualOrder] = useState(emptyManualOrder);
  const [savingManualOrder, setSavingManualOrder] = useState(false);
  const [success, setSuccess] = useState('');
  const [paymentNotification, setPaymentNotification] = useState('');
  const previousPaymentStatuses = useRef(new Map());
  const hasReceivedInitialOrders = useRef(false);

  useEffect(() => {
    const unsubscribe = window.firebase.firestore()
      .collection('orders')
      .orderBy('createdAt', 'desc')
      .onSnapshot(snapshot => {
        const newPaymentReports = [];
        snapshot.docChanges().forEach(change => {
          const order = change.doc.data();
          const paymentStatus = order.paymentStatus || 'unpaid';
          const previousStatus = previousPaymentStatuses.current.get(change.doc.id);
          if (hasReceivedInitialOrders.current
            && change.type === 'modified'
            && previousStatus !== 'reported'
            && paymentStatus === 'reported') {
            newPaymentReports.push(`${order.customer?.name || 'Customer'} · ${order.orderRef || change.doc.id}`);
          }
          previousPaymentStatuses.current.set(change.doc.id, paymentStatus);
        });
        hasReceivedInitialOrders.current = true;
        const pendingPayments = snapshot.docs
          .filter(document => document.data().paymentStatus === 'reported')
          .map(document => {
            const order = document.data();
            return `${order.customer?.name || 'Customer'} · ${order.orderRef || document.id}`;
          });
        if (pendingPayments.length) {
          setPaymentNotification(newPaymentReports.length
            ? `New payment report${newPaymentReports.length === 1 ? '' : 's'} received. Awaiting confirmation: ${pendingPayments.join(', ')}.`
            : `Payment awaiting confirmation: ${pendingPayments.join(', ')}.`);
        } else {
          setPaymentNotification('');
        }
        setOrders(snapshot.docs.map(document => ({ id: document.id, ...document.data() })));
        setLoading(false);
        setError('');
      }, snapshotError => {
        setLoading(false);
        setError(snapshotError.code === 'permission-denied'
          ? `Order access denied. Sign in as ${window.BAKERY_ADMIN_EMAIL}.`
          : `Could not load live orders: ${snapshotError.message}`);
      });
    return unsubscribe;
  }, []);

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return orders.filter(order => {
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
      const matchesSearch = !query || [
        order.customer?.name,
        order.customer?.phone,
        order.customer?.email,
        order.orderRef
      ].some(value => String(value || '').toLocaleLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [orders, search, statusFilter]);

  const pendingCount = orders.filter(order => order.status === 'pending').length;
  const activeCount = orders.filter(order => !['delivered', 'picked_up', 'rejected'].includes(order.status)).length;
  const totalSales = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const manualSubtotal = manualOrder.items.reduce((sum, item) => {
    const product = cookieMenu.find(cookie => cookie.name === item.name);
    return sum + (product?.unitPrice || 0) * (Number(item.quantity) || 0);
  }, 0);
  const manualDistance = Number(manualOrder.distanceKm);
  const manualDeliveryFee = manualOrder.fulfillment === 'delivery' && manualOrder.distanceKm !== ''
    ? (manualDistance < 5 ? 100 : 200)
    : 0;

  if (activePage === 'customers') {
    return (
      <FirebaseCustomersPage
        onLogout={onLogout}
        onNavigate={setActivePage}
        user={user}
      />
    );
  }
  if (activePage === 'invoices') {
    return (
      <FirebaseInvoicesPage
        error={error}
        loading={loading}
        onLogout={onLogout}
        onNavigate={setActivePage}
        orders={orders}
        user={user}
      />
    );
  }
  if (activePage === 'coupons') {
    return <FirebaseCouponsPage onLogout={onLogout} onNavigate={setActivePage} user={user} />;
  }
  if (['dashboard', 'realtime', 'analytics'].includes(activePage)) {
    return <WebsiteAnalyticsPage
      activePage={activePage}
      onLogout={onLogout}
      onNavigate={setActivePage}
      ordersLoading={loading}
      orders={orders}
      user={user}
    />;
  }

  function updateManualOrder(field, value) {
    setManualOrder(current => ({ ...current, [field]: value }));
  }

  function updateManualOrderItem(index, field, value) {
    setManualOrder(current => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item)
    }));
  }

  function addManualOrderItem() {
    const availableCookie = cookieMenu.find(cookie =>
      !manualOrder.items.some(item => item.name === cookie.name));
    if (availableCookie) {
      setManualOrder(current => ({
        ...current,
        items: [...current.items, { name: availableCookie.name, quantity: 1 }]
      }));
    }
  }

  async function createManualOrder(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    const name = manualOrder.name.trim();
    const phone = manualOrder.phone.trim();
    const address = manualOrder.address.trim();
    const pincode = manualOrder.pincode.trim();
    const items = manualOrder.items.map(item => {
      const product = cookieMenu.find(cookie => cookie.name === item.name);
      return product ? {
        name: product.name,
        quantity: Number(item.quantity),
        unitPrice: product.unitPrice
      } : null;
    });

    if (!name || !phone) {
      setError('Enter the customer name and mobile number.');
      return;
    }
    if (items.some(item => !item || !Number.isInteger(item.quantity) || item.quantity < 1)) {
      setError('Choose a cookie and quantity of at least 1 for every item.');
      return;
    }

    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    if (subtotal <= 0) {
      setError('Add at least one cookie item to the order.');
      return;
    }

    let distanceKm = null;
    let deliveryFee = 0;
    if (manualOrder.fulfillment === 'delivery') {
      distanceKm = Number(manualOrder.distanceKm);
      if (!address || !pincode || manualOrder.distanceKm === '' || !Number.isFinite(distanceKm) || distanceKm < 0) {
        setError('For delivery, enter the address, PIN code, and driving distance from the bakery.');
        return;
      }
      if (distanceKm > 10) {
        setError('Delivery is available only within 10 km of the bakery. Choose pickup or enter a closer delivery distance.');
        return;
      }
      const minimumOrder = distanceKm > 7 ? 1000 : 500;
      if (distanceKm > 5 && subtotal < minimumOrder) {
        setError(`For delivery ${distanceKm > 7 ? 'over 7 km' : 'over 5 km and up to 7 km'}, the minimum cookie order is ${currency.format(minimumOrder)}.`);
        return;
      }
      deliveryFee = distanceKm < 5 ? 100 : 200;
    }

    const latitudeText = manualOrder.latitude.trim();
    const longitudeText = manualOrder.longitude.trim();
    const latitude = latitudeText === '' ? null : Number(latitudeText);
    const longitude = longitudeText === '' ? null : Number(longitudeText);
    if ((latitude === null) !== (longitude === null)
      || (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
      || (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
      setError('Enter both valid map coordinates, or leave both fields blank.');
      return;
    }

    setSavingManualOrder(true);
    try {
      const firestore = window.firebase.firestore();
      const orderRef = crypto.randomUUID();
      const order = {
        orderRef,
        customer: {
          name,
          phone,
          email: manualOrder.email.trim()
        },
        fulfillment: manualOrder.fulfillment,
        address: manualOrder.fulfillment === 'delivery' ? address : '',
        pincode: manualOrder.fulfillment === 'delivery' ? pincode : '',
        latitude: manualOrder.fulfillment === 'delivery' ? latitude : null,
        longitude: manualOrder.fulfillment === 'delivery' ? longitude : null,
        distanceKm,
        items,
        subtotal,
        deliveryFee,
        total: subtotal + deliveryFee,
        status: 'pending',
        paymentStatus: 'unpaid',
        statusTimestamps: {
          placed: window.firebase.firestore.FieldValue.serverTimestamp()
        },
        customerUid: null,
        source: manualOrder.source,
        sourceNote: manualOrder.sourceNote.trim(),
        createdBy: user.uid,
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
      };
      await firestore.collection('orders').doc(orderRef).set(order);
      const signedInUser = window.firebase.auth().currentUser;
      if (window.BAKERY_ORDER_NOTIFICATION_URL && signedInUser) {
        void signedInUser.getIdToken()
          .then(idToken => fetch(window.BAKERY_ORDER_NOTIFICATION_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${idToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ orderId: orderRef })
          }))
          .then(async response => {
            if (!response.ok) {
              const result = await response.json().catch(() => ({}));
              throw new Error(result.error || `Notification service returned HTTP ${response.status}.`);
            }
          })
          .catch(notificationError => {
            setError(`Order added successfully, but the baker email notification failed: ${notificationError.message}`);
          });
      }
      setManualOrder(emptyManualOrder());
      setManualOrderOpen(false);
      setSuccess(`Order ${orderRef.slice(0, 8).toUpperCase()} was added and is now in the live order list.`);
    } catch (createError) {
      setError(`Could not add the order: ${createError.message}`);
    } finally {
      setSavingManualOrder(false);
    }
  }

  async function updateStatus(order, nextStatus) {
    setBusyOrder(order.id);
    setError('');
    try {
      await window.firebase.firestore().collection('orders').doc(order.id).update({
        status: nextStatus,
        [`statusTimestamps.${nextStatus}`]: window.firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (updateError) {
      setError(`Could not update order status: ${updateError.message}`);
    } finally {
      setBusyOrder('');
    }
  }

  async function confirmPaymentReceived(order) {
    setBusyOrder(order.id);
    setError('');
    setSuccess('');
    try {
      await window.firebase.firestore().collection('orders').doc(order.id).update({
        paymentStatus: 'received',
        paymentReceivedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      });
      setSuccess(`Payment received confirmed for order ${order.orderRef || order.id}. The customer will be notified.`);
    } catch (updateError) {
      setError(`Could not confirm payment receipt: ${updateError.message}`);
    } finally {
      setBusyOrder('');
    }
  }

  async function deleteOrder(order) {
    const orderReference = order.orderRef || order.id;
    const customerName = order.customer?.name || 'this customer';
    if (!window.confirm(`Permanently delete order ${orderReference} for ${customerName}? It will also disappear from the customer's order history.`)) return;

    setBusyOrder(order.id);
    setError('');
    try {
      await window.firebase.firestore().collection('orders').doc(order.id).delete();
    } catch (deleteError) {
      setError(`Could not delete order ${orderReference}: ${deleteError.message}`);
    } finally {
      setBusyOrder('');
    }
  }

  return (
    <CRMPageLayout activePage="orders" onLogout={onLogout} onNavigate={setActivePage}>
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="topbar-actions">
          <a className="quiet-button crm-storefront-link" href="https://butterbitebakers.web.app/">Storefront</a>
        </div>
      </header>

      <section className="welcome-row">
        <div>
          <p className="eyebrow">LIVE FROM BUTTER BITE BAKERS</p>
          <h1>Portal orders</h1>
          <p className="muted">Signed in as {user.email}. Status changes sync with customers in real time.</p>
        </div>
        <span className="live-indicator"><span /> Live Firestore sync</span>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {success && <div className="success-banner" role="status">{success}</div>}
      {paymentNotification && (
        <div className="payment-notification-banner" role="alert">
          <span>{paymentNotification}</span>
          <button className="quiet-button" onClick={() => setPaymentNotification('')} type="button">Dismiss</button>
        </div>
      )}

      <section className="summary-grid crm-live-summary" aria-label="Live order totals">
        <article className="summary-card"><p>Orders</p><strong>{orders.length}</strong><span>All portal orders</span></article>
        <article className="summary-card"><p>Needs action</p><strong>{pendingCount}</strong><span>Awaiting acceptance</span></article>
        <article className="summary-card"><p>In progress</p><strong>{activeCount}</strong><span>Not yet completed</span></article>
        <article className="summary-card"><p>Order value</p><strong>{currency.format(totalSales)}</strong><span>All portal orders</span></article>
      </section>

      <section className="panel crm-manual-order-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">PHONE · WHATSAPP · IN PERSON</p><h2>Add an order manually</h2></div>
          <button className="primary-button" onClick={() => setManualOrderOpen(open => !open)} type="button">
            {manualOrderOpen ? 'Close form' : '＋ Add order'}
          </button>
        </div>
        {manualOrderOpen && (
          <form className="manual-order-form" onSubmit={createManualOrder}>
            <p className="muted">Manually entered orders use the same fields, cookie prices, delivery fees, and live tracking timeline as storefront orders.</p>

            <h3 className="manual-form-section-title">Customer details</h3>
            <div className="manual-form-grid">
              <label>Customer name *
                <input autoComplete="name" onChange={event => updateManualOrder('name', event.target.value)} required value={manualOrder.name} />
              </label>
              <label>Mobile number *
                <input autoComplete="tel" onChange={event => updateManualOrder('phone', event.target.value)} required type="tel" value={manualOrder.phone} />
              </label>
              <label>Email address
                <input autoComplete="email" onChange={event => updateManualOrder('email', event.target.value)} type="email" value={manualOrder.email} />
              </label>
              <label>Order received via *
                <select onChange={event => updateManualOrder('source', event.target.value)} value={manualOrder.source}>
                  <option value="phone">Phone</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="in_person">In person</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="manual-form-wide">Order notes
                <textarea onChange={event => updateManualOrder('sourceNote', event.target.value)} placeholder="Optional details from the customer" rows="2" value={manualOrder.sourceNote} />
              </label>
            </div>

            <h3 className="manual-form-section-title">Fulfillment</h3>
            <div className="manual-form-grid">
              <label>Order type *
                <select onChange={event => updateManualOrder('fulfillment', event.target.value)} value={manualOrder.fulfillment}>
                  <option value="delivery">Home delivery</option>
                  <option value="pickup">Bakery pickup</option>
                </select>
              </label>
              {manualOrder.fulfillment === 'delivery' && (
                <>
                  <label>Driving distance from bakery (km) *
                    <input min="0" onChange={event => updateManualOrder('distanceKm', event.target.value)} required step="0.1" type="number" value={manualOrder.distanceKm} />
                  </label>
                  <label>PIN code *
                    <input autoComplete="postal-code" onChange={event => updateManualOrder('pincode', event.target.value)} required value={manualOrder.pincode} />
                  </label>
                  <label className="manual-form-wide">Delivery address *
                    <textarea autoComplete="street-address" onChange={event => updateManualOrder('address', event.target.value)} required rows="2" value={manualOrder.address} />
                  </label>
                  <label>Map latitude (optional)
                    <input onChange={event => updateManualOrder('latitude', event.target.value)} step="any" type="number" value={manualOrder.latitude} />
                  </label>
                  <label>Map longitude (optional)
                    <input onChange={event => updateManualOrder('longitude', event.target.value)} step="any" type="number" value={manualOrder.longitude} />
                  </label>
                </>
              )}
            </div>
            {manualOrder.fulfillment === 'delivery' && (
              <p className="manual-order-hint">Delivery fee: {manualOrder.distanceKm === '' ? 'enter distance to calculate' : currency.format(manualDeliveryFee)}. Orders over 5 km require a ₹500 minimum (₹1,000 over 7 km); deliveries over 10 km are unavailable.</p>
            )}

            <h3 className="manual-form-section-title">Cookie boxes</h3>
            {manualOrder.items.map((item, index) => (
              <div className="manual-cookie-row" key={`manual-item-${index}`}>
                <label>Cookie variety
                  <select onChange={event => updateManualOrderItem(index, 'name', event.target.value)} value={item.name}>
                    {cookieMenu.map(cookie => <option key={cookie.name} value={cookie.name}>{cookie.name} · {currency.format(cookie.unitPrice)} / {cookie.packSizeGrams}g</option>)}
                  </select>
                </label>
                <label>{COOKIE_PACK_SIZES[item.name]}g boxes
                  <input min="1" onChange={event => updateManualOrderItem(index, 'quantity', event.target.value)} required step="1" type="number" value={item.quantity} />
                </label>
                <button className="delete-button" disabled={manualOrder.items.length === 1} onClick={() => setManualOrder(current => ({
                  ...current,
                  items: current.items.filter((_, itemIndex) => itemIndex !== index)
                }))} type="button">Remove</button>
              </div>
            ))}
            <button className="quiet-button manual-add-cookie" disabled={manualOrder.items.length >= cookieMenu.length} onClick={addManualOrderItem} type="button">＋ Add cookie variety</button>

            <div className="manual-order-total">
              <span>Subtotal <strong>{currency.format(manualSubtotal)}</strong></span>
              <span>Delivery fee <strong>{currency.format(manualDeliveryFee)}</strong></span>
              <span>Order total <strong>{currency.format(manualSubtotal + manualDeliveryFee)}</strong></span>
            </div>
            <div className="manual-order-form-actions">
              <button className="quiet-button" onClick={() => setManualOrderOpen(false)} type="button">Cancel</button>
              <button className="primary-button" disabled={savingManualOrder} type="submit">{savingManualOrder ? 'Adding order…' : 'Add to live orders'}</button>
            </div>
          </form>
        )}
      </section>

      <section className="panel crm-live-orders">
        <div className="panel-heading crm-live-heading">
          <div><p className="eyebrow">CUSTOMER CHECKOUTS</p><h2>Live orders</h2></div>
          <div className="crm-live-filters">
            <label><span className="sr-only">Filter order status</span>
              <select onChange={event => setStatusFilter(event.target.value)} value={statusFilter}>
                <option value="all">All statuses</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label><span className="sr-only">Search orders</span>
              <input onChange={event => setSearch(event.target.value)} placeholder="Search name, phone, email, ref" type="search" value={search} />
            </label>
          </div>
        </div>

        {loading && <p className="loading-state">Loading portal orders…</p>}
        {!loading && !error && filteredOrders.length === 0 && (
          <p className="empty-state">{orders.length ? 'No orders match those filters.' : 'No orders have been placed yet.'}</p>
        )}
        <div className="crm-live-order-list">
          {filteredOrders.map(order => (
            <article className="crm-live-order" key={order.id}>
              <div className="crm-order-heading">
                <div>
                  <p className="eyebrow">ORDER {String(order.orderRef || order.id).slice(0, 8).toUpperCase()}</p>
                  <h3>{order.customer?.name || 'Customer'} <span>· {currency.format(Number(order.total || 0))}</span></h3>
                  <p className="muted">{[order.customer?.phone, order.customer?.email].filter(Boolean).join(' · ')}</p>
                </div>
                <span className={`crm-order-status status-${order.status || 'pending'}`}>{statusLabels[order.status] || order.status || 'Order placed'}</span>
              </div>

              <div className="crm-order-details">
                <p><strong>Items:</strong> {(order.items || []).map(item => `${item.name} × ${item.quantity}`).join(', ') || 'No items'}</p>
                <p><strong>Type:</strong> {order.fulfillment === 'pickup' ? 'Pickup' : 'Delivery'}{order.distanceKm != null ? ` · ${Number(order.distanceKm).toFixed(1)} km` : ''}</p>
                {order.fulfillment === 'delivery' && <p><strong>Address:</strong> {[order.address, order.pincode].filter(Boolean).join(' · ') || 'Not provided'}</p>}
                {Number.isFinite(order.latitude) && Number.isFinite(order.longitude) && (
                  <p><strong>Map pin:</strong> <a href={`https://maps.google.com/?q=${encodeURIComponent(`${order.latitude},${order.longitude}`)}`} rel="noreferrer" target="_blank">Open delivery location</a></p>
                )}
                <p><strong>Subtotal:</strong> {currency.format(Number(order.subtotal || 0))}{Number(order.discountAmount) > 0 && <> · <strong>Coupon {order.couponCode}:</strong> −{currency.format(Number(order.discountAmount))}</>} · <strong>Delivery:</strong> {currency.format(Number(order.deliveryFee || 0))}</p>
                {order.source && <p><strong>Received via:</strong> {sourceLabels[order.source] || order.source}{order.sourceNote ? ` · ${order.sourceNote}` : ''}</p>}
                <p><strong>Placed:</strong> {formatTimestamp(order.statusTimestamps?.placed || order.createdAt)}</p>
              </div>

              {(order.paymentStatus || 'unpaid') === 'reported' && (
                <div className="crm-payment-notice" role="status">
                  <div>
                    <strong>Customer reported payment</strong>
                    <p>Verify the payment in your account before confirming receipt.</p>
                  </div>
                  <button
                    className="crm-status-action crm-status-action--accept"
                    disabled={busyOrder === order.id}
                    onClick={() => confirmPaymentReceived(order)}
                    type="button"
                  >
                    {busyOrder === order.id ? 'Confirming…' : 'Confirm payment received'}
                  </button>
                </div>
              )}
              {(order.paymentStatus || 'unpaid') === 'received' && (
                <p className="crm-payment-confirmed" role="status">Payment received. Customer has been notified.</p>
              )}

              <OrderTimeline order={order} />

              <div className="crm-order-actions">
                {nextStatuses(order).map(action => (
                  <button
                    className={`crm-status-action ${action.style}`}
                    disabled={busyOrder === order.id}
                    key={action.value}
                    onClick={() => updateStatus(order, action.value)}
                    type="button"
                  >
                    {busyOrder === order.id ? 'Updating…' : action.label}
                  </button>
                ))}
                <button
                  className="delete-button"
                  disabled={busyOrder === order.id}
                  onClick={() => deleteOrder(order)}
                  type="button"
                >
                  {busyOrder === order.id ? 'Working…' : 'Delete order'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <footer className="footer-note">Customer orders and status updates are shared live with the storefront through Firebase.</footer>
    </main>
    </CRMPageLayout>
  );
}

export default function FirebaseCRMApp() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!window.BAKERY_FIREBASE_CONFIG || !window.firebase) {
      setError('Firebase could not be initialized. Reload the page or contact support.');
      setReady(true);
      return undefined;
    }
    if (!window.firebase.apps.length) window.firebase.initializeApp(window.BAKERY_FIREBASE_CONFIG);
    const unsubscribe = window.firebase.auth().onAuthStateChanged(authUser => {
      if (authUser && authUser.email?.toLowerCase() !== window.BAKERY_ADMIN_EMAIL.toLowerCase()) {
        setUser(null);
        setError(`This account is not authorized. Sign in as ${window.BAKERY_ADMIN_EMAIL}.`);
        window.firebase.auth().signOut().catch(signOutError => {
          setError(`Could not sign out the unauthorized account: ${signOutError.message}`);
        });
      } else {
        setUser(authUser);
        setError('');
      }
      setReady(true);
    }, authError => {
      setError(`Firebase sign-in could not be checked: ${authError.message}`);
      setReady(true);
    });
    return unsubscribe;
  }, []);

  async function logout() {
    try {
      await window.firebase.auth().signOut();
    } catch (logoutError) {
      setError(`Could not sign out: ${logoutError.message}`);
    }
  }

  if (!ready) return <main className="login-shell"><p className="loading-state">Connecting to live orders…</p></main>;
  if (error && !user) return <main className="login-shell"><div className="login-card"><p className="error-message" role="alert">{error}</p></div></main>;
  if (!user) return <FirebaseLogin onSignedIn={setUser} />;
  return <FirebaseOrdersCRM onLogout={logout} user={user} />;
}

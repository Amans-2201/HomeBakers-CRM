import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { COOKIE_CATALOG } from '../api/orders.js';
import FirebaseCRMApp from './firebase-crm.jsx';
import './style.css';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});
const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

function todayDateInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

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

function ManualOrderForm({ onSubmit, onCancel, busy }) {
  const productNames = Object.keys(COOKIE_CATALOG);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [fulfillment, setFulfillment] = useState('pickup');
  const [address, setAddress] = useState('');
  const [pincode, setPincode] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('100');
  const [items, setItems] = useState([{ name: productNames[0], quantity: '1' }]);

  function submit(event) {
    event.preventDefault();
    onSubmit({
      customer: { name: customerName, phone: customerPhone },
      fulfillment,
      address,
      pincode,
      deliveryFee: fulfillment === 'delivery' ? Number(deliveryFee) : 0,
      items: items.map(item => ({ name: item.name, quantity: Number(item.quantity) }))
    });
  }

  function changeItem(index, field, value) {
    setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  }

  return (
    <form className="entry-form" onSubmit={submit}>
      <div className="form-heading"><h3>Add a call order</h3><button className="quiet-button" onClick={onCancel} type="button">Close</button></div>
      <div className="form-grid">
        <label>Customer name<input maxLength="120" onChange={event => setCustomerName(event.target.value)} required value={customerName} /></label>
        <label>Phone number<input maxLength="30" onChange={event => setCustomerPhone(event.target.value)} required type="tel" value={customerPhone} /></label>
        <label>Order type<select onChange={event => setFulfillment(event.target.value)} value={fulfillment}><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select></label>
        {fulfillment === 'delivery' && <>
          <label>Delivery fee (INR)<input min="0" max="10000" onChange={event => setDeliveryFee(event.target.value)} required step="1" type="number" value={deliveryFee} /></label>
          <label className="form-wide">Delivery address<textarea maxLength="500" onChange={event => setAddress(event.target.value)} required rows="2" value={address} /></label>
          <label>PIN code<input maxLength="20" onChange={event => setPincode(event.target.value)} value={pincode} /></label>
        </>}
      </div>
      <div className="form-section-heading"><strong>Order items</strong><button className="quiet-button" disabled={items.length >= productNames.length} onClick={() => {
        const unusedName = productNames.find(name => !items.some(item => item.name === name));
        if (unusedName) setItems(current => [...current, { name: unusedName, quantity: '1' }]);
      }} type="button">Add item</button></div>
      {items.map((item, index) => (
        <div className="order-entry-row" key={item.name}>
          <select aria-label={`Cookie variety ${index + 1}`} onChange={event => changeItem(index, 'name', event.target.value)} value={item.name}>
            {productNames.filter(name => name === item.name || !items.some((other, otherIndex) => otherIndex !== index && other.name === name))
              .map(name => <option key={name} value={name}>{name} · {currency.format(COOKIE_CATALOG[name])}</option>)}
          </select>
          <input aria-label={`Quantity for ${item.name}`} max="99" min="1" onChange={event => changeItem(index, 'quantity', event.target.value)} required type="number" value={item.quantity} />
          {items.length > 1 && <button aria-label={`Remove ${item.name}`} className="delete-button" onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))} type="button">Remove</button>}
        </div>
      ))}
      <div className="form-actions"><button className="primary-button" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save order'}</button></div>
    </form>
  );
}

function InventoryPurchaseForm({ onSubmit, onCancel, busy }) {
  const [itemName, setItemName] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [purchaseDate, setPurchaseDate] = useState(todayDateInputValue);

  function submit(event) {
    event.preventDefault();
    onSubmit({ itemName, unitPrice: Number(unitPrice), quantity: Number(quantity), purchaseDate });
  }

  return (
    <form className="entry-form" onSubmit={submit}>
      <div className="form-heading"><h3>Record inventory purchase</h3><button className="quiet-button" onClick={onCancel} type="button">Close</button></div>
      <div className="form-grid">
        <label>Item name<input maxLength="120" onChange={event => setItemName(event.target.value)} required value={itemName} /></label>
        <label>Price per unit (INR)<input min="0.01" onChange={event => setUnitPrice(event.target.value)} required step="0.01" type="number" value={unitPrice} /></label>
        <label>Quantity<input max="1000000" min="1" onChange={event => setQuantity(event.target.value)} required step="1" type="number" value={quantity} /></label>
        <label>Date of purchase<input onChange={event => setPurchaseDate(event.target.value)} required type="date" value={purchaseDate} /></label>
      </div>
      <div className="form-actions"><button className="primary-button" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save purchase'}</button></div>
    </form>
  );
}

const chartPalette = ['#71381f', '#c87849', '#d7a968', '#739b7d', '#8a719f', '#5f91a4', '#cf8d9a'];

function ChartPanel({ eyebrow, title, children }) {
  return (
    <article className="panel chart-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
      </div>
      {children}
    </article>
  );
}

function SalesCostChart({ rows }) {
  if (!rows.length) return <p className="empty-state">No sales or inventory costs to chart for this period.</p>;
  const width = 720;
  const height = 270;
  const left = 52;
  const right = 14;
  const top = 16;
  const bottom = 48;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(1, ...rows.flatMap(row => [Number(row.sales), Number(row.cost)]));
  const groupWidth = (width - left - right) / rows.length;
  const barWidth = Math.min(30, groupWidth * 0.34);
  const gridValues = [0, 0.25, 0.5, 0.75, 1];
  const visibleLabels = rows.length <= 8
    ? rows
    : rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 6) === 0);

  return (
    <div className="chart-scroll">
      <svg aria-label="Column chart comparing fulfilled sales and inventory costs" className="chart-svg" role="img" viewBox={`0 0 ${width} ${height}`}>
        {gridValues.map(fraction => {
          const y = top + plotHeight * (1 - fraction);
          return <g key={fraction}>
            <line className="chart-gridline" x1={left} x2={width - right} y1={y} y2={y} />
            <text className="chart-axis-label" textAnchor="end" x={left - 7} y={y + 3}>{currency.format(maxValue * fraction)}</text>
          </g>;
        })}
        {rows.map((row, index) => {
          const center = left + groupWidth * (index + 0.5);
          const sales = Number(row.sales);
          const cost = Number(row.cost);
          const salesHeight = sales / maxValue * plotHeight;
          const costHeight = cost / maxValue * plotHeight;
          const coveredSales = Math.min(sales, cost);
          const coveredHeight = coveredSales / maxValue * plotHeight;
          const marginHeight = (sales - coveredSales) / maxValue * plotHeight;
          const label = row.period.length === 7 ? row.period : row.period.slice(5);
          return <g key={row.period}>
            <rect aria-label={`${label}: sales ${currency.format(sales)}, inventory cost ${currency.format(cost)}`} className="chart-bar covered-sales-bar" height={coveredHeight} rx={marginHeight ? 0 : 3} tabIndex="0" width={barWidth} x={center - barWidth - 3} y={top + plotHeight - coveredHeight}>
              <title>{`${label} · Sales: ${currency.format(sales)} · Inventory cost: ${currency.format(cost)} · Profit: ${currency.format(sales - cost)}`}</title>
            </rect>
            {marginHeight > 0 && <rect className="chart-bar profit-bar" height={marginHeight} rx="3" tabIndex="0" width={barWidth} x={center - barWidth - 3} y={top + plotHeight - salesHeight}>
              <title>{`${label} · Sales remaining after inventory costs: ${currency.format(sales - cost)}`}</title>
            </rect>}
            <rect aria-label={`${label}: inventory cost ${currency.format(cost)}`} className="chart-bar cost-bar" height={costHeight} rx="3" tabIndex="0" width={barWidth} x={center + 3} y={top + plotHeight - costHeight}>
              <title>{`${label} · Inventory costs: ${currency.format(cost)}`}</title>
            </rect>
          </g>;
        })}
        {visibleLabels.map(row => {
          const index = rows.indexOf(row);
          const center = left + groupWidth * (index + 0.5);
          return <text className="chart-axis-label" key={row.period} textAnchor="middle" x={center} y={height - 24}>
            {row.period.length === 7 ? row.period : row.period.slice(5)}
          </text>;
        })}
      </svg>
      <div className="chart-legend">
        <span><i className="legend-swatch covered-swatch" />Sales covering inventory cost</span>
        <span><i className="legend-swatch profit-swatch" />Sales remaining after cost</span>
        <span><i className="legend-swatch cost-swatch" />Inventory cost</span>
      </div>
    </div>
  );
}

function SalesTrendChart({ rows }) {
  if (!rows.length) return <p className="empty-state">No fulfilled sales to chart for this period.</p>;
  const width = 720;
  const height = 270;
  const left = 52;
  const right = 16;
  const top = 18;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(1, ...rows.map(row => Number(row.sales)));
  const points = rows.map((row, index) => ({
    row,
    x: rows.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (rows.length - 1),
    y: top + plotHeight * (1 - Number(row.sales) / maxValue)
  }));
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const labels = points.length <= 8 ? points : points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 6) === 0);

  return (
    <div className="chart-scroll">
      <svg aria-label="Line chart showing fulfilled sales over time" className="chart-svg" role="img" viewBox={`0 0 ${width} ${height}`}>
        {[0, 0.25, 0.5, 0.75, 1].map(fraction => {
          const y = top + plotHeight * (1 - fraction);
          return <g key={fraction}>
            <line className="chart-gridline" x1={left} x2={width - right} y1={y} y2={y} />
            <text className="chart-axis-label" textAnchor="end" x={left - 7} y={y + 3}>{currency.format(maxValue * fraction)}</text>
          </g>;
        })}
        <path className="sales-line" d={path} />
        {points.map(point => <circle className="sales-point" cx={point.x} cy={point.y} key={point.row.period} r="4" tabIndex="0">
          <title>{`${point.row.period} · Fulfilled sales: ${currency.format(Number(point.row.sales))}`}</title>
        </circle>)}
        {labels.map(point => <text className="chart-axis-label" key={point.row.period} textAnchor="middle" x={point.x} y={height - 24}>
          {point.row.period.length === 7 ? point.row.period : point.row.period.slice(5)}
        </text>)}
      </svg>
    </div>
  );
}

function PieChart({ rows }) {
  const total = rows.reduce((sum, row) => sum + Number(row.quantity), 0);
  if (!total) return <p className="empty-state">No fulfilled cookie sales to chart for this period.</p>;
  const radius = 75;
  const center = 100;
  let angle = -Math.PI / 2;
  const segments = rows.map((row, index) => {
    const quantity = Number(row.quantity);
    const nextAngle = angle + quantity / total * Math.PI * 2;
    const largeArc = nextAngle - angle > Math.PI ? 1 : 0;
    const startX = center + radius * Math.cos(angle);
    const startY = center + radius * Math.sin(angle);
    const endX = center + radius * Math.cos(nextAngle);
    const endY = center + radius * Math.sin(nextAngle);
    const path = rows.length === 1
      ? `M ${center} ${center - radius} A ${radius} ${radius} 0 1 1 ${center} ${center + radius} A ${radius} ${radius} 0 1 1 ${center} ${center - radius} Z`
      : `M ${center} ${center} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`;
    const segment = {
      row,
      color: chartPalette[index % chartPalette.length],
      percent: quantity / total * 100,
      path
    };
    angle = nextAngle;
    return segment;
  });

  return <div className="pie-chart-layout">
    <svg aria-label="Pie chart of fulfilled cookie quantities sold" className="pie-svg" role="img" viewBox="0 0 200 200">
      {segments.map(segment => <path d={segment.path} fill={segment.color} key={segment.row.cookie_name} tabIndex="0">
        <title>{`${segment.row.cookie_name}: ${segment.row.quantity} boxes (${segment.percent.toFixed(1)}%)`}</title>
      </path>)}
    </svg>
    <ul className="chart-legend pie-legend">
      {segments.map(segment => <li key={segment.row.cookie_name}>
        <i className="legend-swatch" style={{ backgroundColor: segment.color }} />
        <span>{segment.row.cookie_name}</span>
        <strong>{segment.percent.toFixed(0)}%</strong>
        <small>{segment.row.quantity} boxes</small>
      </li>)}
    </ul>
  </div>;
}

function treemapRectangles(rows, x, y, width, height) {
  if (!rows.length) return [];
  if (rows.length === 1) return [{ ...rows[0], x, y, width, height }];
  const total = rows.reduce((sum, row) => sum + Number(row.order_count), 0);
  let running = 0;
  let split = 0;
  while (split < rows.length - 1 && running < total / 2) {
    running += Number(rows[split].order_count);
    split += 1;
  }
  const fraction = running / total;
  if (width >= height) {
    const splitWidth = width * fraction;
    return [
      ...treemapRectangles(rows.slice(0, split), x, y, splitWidth, height),
      ...treemapRectangles(rows.slice(split), x + splitWidth, y, width - splitWidth, height)
    ];
  }
  const splitHeight = height * fraction;
  return [
    ...treemapRectangles(rows.slice(0, split), x, y, width, splitHeight),
    ...treemapRectangles(rows.slice(split), x, y + splitHeight, width, height - splitHeight)
  ];
}

function CustomerTreemap({ rows }) {
  if (!rows.length) return <p className="empty-state">No customer orders to chart for this period.</p>;
  const width = 720;
  const height = 300;
  const rectangles = treemapRectangles(rows, 0, 0, width, height);
  return <div className="chart-scroll">
    <svg aria-label="Treemap of customers sized by total orders" className="treemap-svg" role="img" viewBox={`0 0 ${width} ${height}`}>
      {rectangles.map((rect, index) => <g key={rect.id}>
        <rect
          fill={chartPalette[index % chartPalette.length]}
          height={Math.max(0, rect.height - 3)}
          rx="5"
          tabIndex="0"
          width={Math.max(0, rect.width - 3)}
          x={rect.x + 1.5}
          y={rect.y + 1.5}
        >
          <title>{`${rect.customer_name}: ${rect.order_count} ${Number(rect.order_count) === 1 ? 'order' : 'orders'}`}</title>
        </rect>
        {rect.width > 74 && rect.height > 34 && <>
          <text className="treemap-label" x={rect.x + 10} y={rect.y + 20}>{rect.customer_name.slice(0, Math.max(8, Math.floor(rect.width / 8)))}</text>
          <text className="treemap-value" x={rect.x + 10} y={rect.y + 38}>{rect.order_count} {Number(rect.order_count) === 1 ? 'order' : 'orders'}</text>
        </>}
      </g>)}
    </svg>
  </div>;
}

function Dashboard({ onLogout }) {
  const [summary, setSummary] = useState(null);
  const [analytics, setAnalytics] = useState({ salesCosts: [], cookieSales: [], customerOrders: [] });
  const [orders, setOrders] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState(null);
  const [busyForm, setBusyForm] = useState(false);
  const [activeForm, setActiveForm] = useState('');

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
      const inventoryQuery = new URLSearchParams({ limit: '100' });
      if (fromDate) inventoryQuery.set('startDate', fromDate);
      if (toDate) inventoryQuery.set('endDate', toDate);
      const [nextSummary, nextOrders, nextPurchases, nextAnalytics] = await Promise.all([
        apiRequest(`/api/admin/summary${dateQuery ? `?${dateQuery}` : ''}`),
        apiRequest(`/api/admin/orders?${orderQuery}`),
        apiRequest(`/api/admin/inventory?${inventoryQuery}`),
        apiRequest(`/api/admin/analytics${dateQuery ? `?${dateQuery}` : ''}`)
      ]);
      setSummary(nextSummary);
      setOrders(nextOrders.orders);
      setPurchases(nextPurchases.purchases);
      setAnalytics(nextAnalytics);
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

  async function saveManualOrder(order) {
    setBusyForm(true);
    setError('');
    try {
      await apiRequest('/api/admin/orders', { method: 'POST', body: JSON.stringify(order) });
      setActiveForm('');
      await loadDashboard(search, startDate, endDate);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusyForm(false);
    }
  }

  async function saveInventoryPurchase(purchase) {
    setBusyForm(true);
    setError('');
    try {
      await apiRequest('/api/admin/inventory', { method: 'POST', body: JSON.stringify(purchase) });
      setActiveForm('');
      await loadDashboard(search, startDate, endDate);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusyForm(false);
    }
  }

  async function deleteInventoryPurchase(purchase) {
    if (!window.confirm(`Delete the inventory purchase for ${purchase.item_name}? This cannot be undone.`)) return;
    setBusyOrderId(purchase.id);
    setError('');
    try {
      await apiRequest(`/api/admin/inventory/${purchase.id}`, { method: 'DELETE' });
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
          <button className="quiet-button" onClick={() => setActiveForm(activeForm === 'order' ? '' : 'order')} type="button">Add call order</button>
          <button className="quiet-button" onClick={() => setActiveForm(activeForm === 'purchase' ? '' : 'purchase')} type="button">Record purchase</button>
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

      {activeForm === 'order' && <ManualOrderForm busy={busyForm} onCancel={() => setActiveForm('')} onSubmit={saveManualOrder} />}
      {activeForm === 'purchase' && <InventoryPurchaseForm busy={busyForm} onCancel={() => setActiveForm('')} onSubmit={saveInventoryPurchase} />}

      <section className="summary-grid" aria-label="Order totals">
        <SummaryCard label="Orders recorded" value={summary ? summary.order_count : '—'} detail="All-time orders" />
        <SummaryCard label="Sales value" value={summary ? currency.format(summary.sales_total) : '—'} detail="Fulfilled orders, incl. delivery, in selected dates" />
        <SummaryCard
          label="Total cost"
          value={summary ? currency.format(Number(summary.inventory_cost)) : '—'}
          detail="Inventory purchases in selected dates"
        />
        <SummaryCard
          label="Profit"
          value={summary ? currency.format(Number(summary.profit_total)) : '—'}
          detail={summary ? `${currency.format(summary.sales_total)} sales − ${currency.format(Number(summary.inventory_cost))} inventory` : 'Sales minus inventory cost'}
        />
        <SummaryCard label="Customers" value={summary ? summary.customer_count : '—'} detail="Unique phone numbers" />
      </section>

      <section aria-label="Sales and customer charts" className="charts-grid">
        <ChartPanel eyebrow="SALES & COSTS" title="Sales vs inventory cost">
          <SalesCostChart rows={analytics.salesCosts} />
        </ChartPanel>
        <ChartPanel eyebrow="OVER TIME" title="Sales trend">
          <SalesTrendChart rows={analytics.salesCosts} />
        </ChartPanel>
        <ChartPanel eyebrow="COOKIE MIX" title="Cookies sold">
          <PieChart rows={analytics.cookieSales} />
        </ChartPanel>
        <ChartPanel eyebrow="CUSTOMER LOYALTY" title="Orders by customer">
          <CustomerTreemap rows={analytics.customerOrders} />
        </ChartPanel>
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
      <section className="panel inventory-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">BAKING SUPPLIES</p><h2>Inventory purchases</h2></div>
          <button className="quiet-button" onClick={() => setActiveForm(activeForm === 'purchase' ? '' : 'purchase')} type="button">Add purchase</button>
        </div>
        {!loading && purchases.length === 0
          ? <p className="empty-state">{startDate || endDate ? 'No inventory purchases in that date range.' : 'Your inventory purchases will show up here.'}</p>
          : purchases.length > 0 && <div className="table-wrap">
            <table>
              <thead><tr><th>Item</th><th>Price per unit</th><th>Quantity</th><th>Total cost</th><th>Date</th><th>Actions</th></tr></thead>
              <tbody>{purchases.map(purchase => (
                <tr key={purchase.id}>
                  <td><strong>{purchase.item_name}</strong></td>
                  <td>{currency.format(Number(purchase.unit_price))}</td>
                  <td>{purchase.quantity}</td>
                  <td><strong>{currency.format(Number(purchase.total_cost))}</strong></td>
                  <td>{String(purchase.purchased_on).slice(0, 10)}</td>
                  <td><button className="delete-button" disabled={busyOrderId === purchase.id} onClick={() => deleteInventoryPurchase(purchase)} type="button">Delete</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>}
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

const isFirebaseCRM = window.location.hostname === 'butterbitebakers-crm.web.app'
  || new URLSearchParams(window.location.search).has('firebaseCRM');

createRoot(document.getElementById('root')).render(isFirebaseCRM ? <FirebaseCRMApp /> : <App />);

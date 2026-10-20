import React, { useEffect, useMemo, useState } from 'react';

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

const cookieMenu = [
  { name: 'Vanilla Butter Cookies', unitPrice: 220 },
  { name: 'Choco Chip Cookies', unitPrice: 260 },
  { name: 'Almond Cashew Cookies', unitPrice: 290 },
  { name: 'Coconut Cookies', unitPrice: 230 },
  { name: 'Sweet and Salty Zeera Cookies', unitPrice: 210 }
];

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
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark" aria-hidden="true">HB</div>
        <p className="eyebrow">HOME BAKERS · LIVE ORDERS CRM</p>
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
        <p className="privacy-note">Order access is restricted to {window.BAKERY_ADMIN_EMAIL}.</p>
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

function FirebaseOrdersCRM({ user, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyOrder, setBusyOrder] = useState('');
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [manualOrder, setManualOrder] = useState(emptyManualOrder);
  const [savingManualOrder, setSavingManualOrder] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const unsubscribe = window.firebase.firestore()
      .collection('orders')
      .orderBy('createdAt', 'desc')
      .onSnapshot(snapshot => {
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
    <main className="dashboard-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Home Bakers CRM home">
          <span className="brand-mark small">HB</span>
          <span>Home Bakers <small>Live Orders CRM</small></span>
        </a>
        <div className="topbar-actions">
          <a className="quiet-button crm-storefront-link" href="https://butterbitebakers.web.app/">Storefront</a>
          <button className="quiet-button" onClick={onLogout} type="button">Sign out</button>
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
                    {cookieMenu.map(cookie => <option key={cookie.name} value={cookie.name}>{cookie.name} · {currency.format(cookie.unitPrice)} / 250g</option>)}
                  </select>
                </label>
                <label>250g boxes
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
                <p><strong>Subtotal:</strong> {currency.format(Number(order.subtotal || 0))} · <strong>Delivery:</strong> {currency.format(Number(order.deliveryFee || 0))}</p>
                {order.source && <p><strong>Received via:</strong> {sourceLabels[order.source] || order.source}{order.sourceNote ? ` · ${order.sourceNote}` : ''}</p>}
                <p><strong>Placed:</strong> {formatTimestamp(order.statusTimestamps?.placed || order.createdAt)}</p>
              </div>

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

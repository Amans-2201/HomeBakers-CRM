const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});
const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata'
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatPlacedAt(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : dateTime.format(date);
}

export function buildOrderEmail(order, documentId) {
  const customer = order.customer || {};
  const orderReference = order.orderRef || documentId;
  const fulfillment = order.fulfillment === 'pickup' ? 'Bakery pickup' : 'Home delivery';
  const items = Array.isArray(order.items) ? order.items : [];
  const lines = items.map(item => {
    const quantity = Number(item.quantity) || 0;
    const lineTotal = quantity * (Number(item.unitPrice) || 0);
    return `${item.name || 'Cookie'} × ${quantity} — ${currency.format(lineTotal)}`;
  });
  const address = order.fulfillment === 'delivery'
    ? [order.address, order.pincode].filter(Boolean).join(', ') || 'Not provided'
    : 'Not applicable (pickup)';
  const mapUrl = Number.isFinite(order.latitude) && Number.isFinite(order.longitude)
    ? `https://maps.google.com/?q=${encodeURIComponent(`${order.latitude},${order.longitude}`)}`
    : '';
  const source = order.source
    ? `\nReceived via: ${order.source}${order.sourceNote ? ` — ${order.sourceNote}` : ''}`
    : '';
  const orderId = String(orderReference);
  const subject = `New ${fulfillment.toLowerCase()} order ${orderId.slice(0, 8)}`;
  const text = [
    `New order ${orderId}`,
    `Placed: ${formatPlacedAt(order.createdAt)}`,
    `Customer: ${customer.name || 'Not provided'}`,
    `Phone: ${customer.phone || 'Not provided'}`,
    customer.email ? `Email: ${customer.email}` : '',
    `Fulfillment: ${fulfillment}`,
    `Address: ${address}`,
    mapUrl ? `Map: ${mapUrl}` : '',
    '',
    'Items:',
    lines.length ? lines.join('\n') : 'No items listed',
    '',
    `Subtotal: ${currency.format(Number(order.subtotal) || 0)}`,
    `Delivery fee: ${currency.format(Number(order.deliveryFee) || 0)}`,
    `Total: ${currency.format(Number(order.total) || 0)}`,
    `Status: ${order.status || 'pending'}${source}`
  ].filter(Boolean).join('\n');
  const htmlItems = items.length
    ? `<ul>${items.map(item => {
      const quantity = Number(item.quantity) || 0;
      const lineTotal = quantity * (Number(item.unitPrice) || 0);
      return `<li>${escapeHtml(item.name || 'Cookie')} × ${quantity} — ${escapeHtml(currency.format(lineTotal))}</li>`;
    }).join('')}</ul>`
    : '<p>No items listed</p>';
  const html = `
    <div style="font-family:Arial,sans-serif;color:#33231c;line-height:1.6">
      <h2 style="color:#6e3520">New order ${escapeHtml(orderId)}</h2>
      <p><strong>Placed:</strong> ${escapeHtml(formatPlacedAt(order.createdAt))}</p>
      <h3>Customer and fulfillment</h3>
      <p><strong>Name:</strong> ${escapeHtml(customer.name || 'Not provided')}<br>
      <strong>Phone:</strong> ${escapeHtml(customer.phone || 'Not provided')}<br>
      ${customer.email ? `<strong>Email:</strong> ${escapeHtml(customer.email)}<br>` : ''}
      <strong>Type:</strong> ${escapeHtml(fulfillment)}<br>
      <strong>Address:</strong> ${escapeHtml(address)}
      ${mapUrl ? `<br><a href="${escapeHtml(mapUrl)}">Open delivery map</a>` : ''}</p>
      <h3>Items</h3>${htmlItems}
      <p><strong>Subtotal:</strong> ${escapeHtml(currency.format(Number(order.subtotal) || 0))}<br>
      <strong>Delivery fee:</strong> ${escapeHtml(currency.format(Number(order.deliveryFee) || 0))}<br>
      <strong>Total:</strong> ${escapeHtml(currency.format(Number(order.total) || 0))}<br>
      <strong>Status:</strong> ${escapeHtml(order.status || 'pending')}</p>
      ${order.source ? `<p><strong>Received via:</strong> ${escapeHtml(order.source)}${order.sourceNote ? ` — ${escapeHtml(order.sourceNote)}` : ''}</p>` : ''}
    </div>`;

  return { subject, text, html };
}

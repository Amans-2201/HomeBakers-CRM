const manualOrderSources = new Set(['phone', 'whatsapp', 'in_person', 'other']);

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function getDateKey(date) {
  const parts = dateFormatter.formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDateKey(dateKey, offset) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function getOrderDate(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getStorefrontOrderMetrics(orders, range, now = new Date()) {
  const rangeDays = Number.parseInt(range, 10);
  if (!Number.isInteger(rangeDays) || rangeDays < 1) {
    throw new Error('Analytics range must be a positive number of days.');
  }

  const today = getDateKey(now);
  const firstDay = shiftDateKey(today, 1 - rangeDays);
  const dailyCounts = {};
  const recentEvents = [];

  for (const order of orders) {
    if (order.createdBy || manualOrderSources.has(order.source)) continue;
    const createdAt = getOrderDate(order.createdAt);
    if (!createdAt || createdAt > now) continue;

    const date = getDateKey(createdAt);
    if (date < firstDay || date > today) continue;

    dailyCounts[date] = (dailyCounts[date] || 0) + 1;
    recentEvents.push({
      event_type: 'order_placed',
      page_path: '/',
      created_at: createdAt.toISOString()
    });
  }

  recentEvents.sort((first, second) => Date.parse(second.created_at) - Date.parse(first.created_at));

  return {
    conversions: recentEvents.length,
    dailyCounts,
    recentEvents: recentEvents.slice(0, 25)
  };
}

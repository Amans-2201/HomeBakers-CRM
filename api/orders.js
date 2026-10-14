export const COOKIE_CATALOG = Object.freeze({
  'Vanilla Butter Cookies': 220,
  'Choco Chip Cookies': 260,
  'Almond Cashew Cookies': 290,
  'Coconut Cookies': 230,
  'Sweet and Salty Zeera Cookies': 210
});

const fail = message => ({ error: message });

export function validateOrderPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('Order details are invalid.');
  }

  const { orderRef, customer, order, items } = payload;
  if (typeof orderRef !== 'string' || !/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(orderRef)) {
    return fail('Order reference is invalid.');
  }
  if (!customer || typeof customer !== 'object' || Array.isArray(customer)) {
    return fail('Customer details are missing.');
  }
  const name = typeof customer.name === 'string' ? customer.name.trim() : '';
  const phone = typeof customer.phone === 'string' ? customer.phone.trim() : '';
  const phoneDigits = phone.replace(/\D/g, '');
  if (!name || name.length > 120) return fail('Please provide a valid customer name.');
  if (!phone || phone.length > 30 || phoneDigits.length < 7 || phoneDigits.length > 15) {
    return fail('Please provide a valid customer phone number.');
  }

  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    return fail('Order details are missing.');
  }
  if (!['delivery', 'pickup'].includes(order.fulfillment)) {
    return fail('Order fulfillment option is invalid.');
  }
  const address = typeof order.address === 'string' ? order.address.trim() : '';
  const pincode = typeof order.pincode === 'string' ? order.pincode.trim() : '';
  if (address.length > 500 || pincode.length > 20) {
    return fail('Delivery address details are too long.');
  }

  if (!Array.isArray(items) || items.length === 0 || items.length > Object.keys(COOKIE_CATALOG).length) {
    return fail('Order must contain one or more valid cookie varieties.');
  }
  const seenItems = new Set();
  const normalizedItems = [];
  let subtotal = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return fail('One or more cookie items are invalid.');
    }
    const unitPrice = COOKIE_CATALOG[item.name];
    if (unitPrice === undefined || seenItems.has(item.name)) {
      return fail('One or more cookie varieties are invalid.');
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      return fail('Cookie quantities must be between 1 and 99.');
    }
    seenItems.add(item.name);
    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;
    normalizedItems.push({ name: item.name, unitPrice, quantity: item.quantity, lineTotal });
  }

  let distanceKm = null;
  let latitude = null;
  let longitude = null;
  let deliveryFee = 0;
  if (order.fulfillment === 'delivery') {
    if (typeof order.distanceKm !== 'number' || !Number.isFinite(order.distanceKm) || order.distanceKm < 0) {
      return fail('A valid driving distance is required for delivery.');
    }
    if (!Number.isFinite(order.latitude) || order.latitude < -90 || order.latitude > 90
      || !Number.isFinite(order.longitude) || order.longitude < -180 || order.longitude > 180) {
      return fail('A valid delivery map pin is required.');
    }
    distanceKm = order.distanceKm;
    latitude = order.latitude;
    longitude = order.longitude;
    if (distanceKm > 10) return fail('Delivery is available only within 10 km.');
    if (distanceKm > 5 && subtotal < (distanceKm > 7 ? 1000 : 500)) {
      return fail(`The cookie subtotal does not meet the minimum for a ${distanceKm.toFixed(1)} km delivery.`);
    }
    deliveryFee = distanceKm < 5 ? 100 : 200;
  }

  return {
    value: {
      orderRef,
      customer: { name, phone },
      order: {
        fulfillment: order.fulfillment,
        address,
        pincode,
        latitude,
        longitude,
        distanceKm,
        subtotal,
        deliveryFee,
        total: subtotal + deliveryFee
      },
      items: normalizedItems
    }
  };
}

export function validateManualOrderPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('Order details are invalid.');
  }

  const { customer, fulfillment, address, pincode, deliveryFee, items } = payload;
  if (!customer || typeof customer !== 'object' || Array.isArray(customer)) {
    return fail('Customer details are missing.');
  }
  const name = typeof customer.name === 'string' ? customer.name.trim() : '';
  const phone = typeof customer.phone === 'string' ? customer.phone.trim() : '';
  const phoneDigits = phone.replace(/\D/g, '');
  if (!name || name.length > 120) return fail('Please provide a valid customer name.');
  if (!phone || phone.length > 30 || phoneDigits.length < 7 || phoneDigits.length > 15) {
    return fail('Please provide a valid customer phone number.');
  }
  if (!['delivery', 'pickup'].includes(fulfillment)) {
    return fail('Order type must be delivery or pickup.');
  }

  const normalizedAddress = typeof address === 'string' ? address.trim() : '';
  const normalizedPincode = typeof pincode === 'string' ? pincode.trim() : '';
  if (normalizedAddress.length > 500 || normalizedPincode.length > 20) {
    return fail('Delivery address details are too long.');
  }
  if (fulfillment === 'delivery' && !normalizedAddress) {
    return fail('A delivery address is required for delivery orders.');
  }
  if (!Number.isSafeInteger(deliveryFee) || deliveryFee < 0 || deliveryFee > 10000) {
    return fail('Delivery fee must be a whole INR amount between 0 and 10,000.');
  }
  if (fulfillment === 'pickup' && deliveryFee !== 0) {
    return fail('Pickup orders cannot have a delivery fee.');
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > Object.keys(COOKIE_CATALOG).length) {
    return fail('Order must contain one or more valid cookie varieties.');
  }

  const seenItems = new Set();
  const normalizedItems = [];
  let subtotal = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return fail('One or more cookie items are invalid.');
    }
    const unitPrice = COOKIE_CATALOG[item.name];
    if (unitPrice === undefined || seenItems.has(item.name)) {
      return fail('One or more cookie varieties are invalid.');
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      return fail('Cookie quantities must be between 1 and 99.');
    }
    seenItems.add(item.name);
    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;
    normalizedItems.push({ name: item.name, unitPrice, quantity: item.quantity, lineTotal });
  }

  return {
    value: {
      customer: { name, phone },
      order: {
        fulfillment,
        address: normalizedAddress,
        pincode: normalizedPincode,
        deliveryFee,
        subtotal,
        total: subtotal + deliveryFee
      },
      items: normalizedItems
    }
  };
}

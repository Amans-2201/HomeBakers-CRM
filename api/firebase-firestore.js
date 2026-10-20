export function decodeFirestoreValue(value) {
  if (Object.hasOwn(value, 'stringValue')) return value.stringValue;
  if (Object.hasOwn(value, 'integerValue')) return Number(value.integerValue);
  if (Object.hasOwn(value, 'doubleValue')) return value.doubleValue;
  if (Object.hasOwn(value, 'booleanValue')) return value.booleanValue;
  if (Object.hasOwn(value, 'timestampValue')) return new Date(value.timestampValue);
  if (Object.hasOwn(value, 'nullValue')) return null;
  if (value.mapValue) return decodeFirestoreFields(value.mapValue.fields || {});
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  return undefined;
}

function decodeFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [
    key,
    decodeFirestoreValue(value)
  ]));
}

export async function getFirestoreOrder({ orderId, idToken, apiKey, projectId, fetchImpl = fetch }) {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/orders/${encodeURIComponent(orderId)}`
  );
  url.searchParams.set('key', apiKey);
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${idToken}` },
    signal: AbortSignal.timeout(10000)
  });

  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) {
    throw new Error(`Firestore order lookup returned HTTP ${response.status}.`);
  }

  const document = await response.json();
  return decodeFirestoreFields(document.fields || {});
}

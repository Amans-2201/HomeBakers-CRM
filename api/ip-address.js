const nonPublicIPv4Ranges = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4]
];

function parseIPv4(address) {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every(octet => octet <= 255) ? octets : null;
}

function isPublicIPv4(octets) {
  const address = octets.reduce((value, octet) => value * 256 + octet, 0);
  return !nonPublicIPv4Ranges.some(([network, prefix]) => {
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return (address & mask) >>> 0 === (network & mask) >>> 0;
  });
}

function parseIPv6(address) {
  if (address.includes('.')) return null;
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parseHalf = half => {
    if (!half) return [];
    const groups = half.split(':');
    if (groups.some(group => !/^[\da-f]{1,4}$/i.test(group))) return null;
    return groups.map(group => Number.parseInt(group, 16));
  };
  const first = parseHalf(halves[0]);
  const last = parseHalf(halves[1] || '');
  if (!first || !last) return null;
  if (halves.length === 1) return first.length === 8 ? first : null;
  const zeroCount = 8 - first.length - last.length;
  return zeroCount > 0 ? [...first, ...Array(zeroCount).fill(0), ...last] : null;
}

export function normalizePublicIp(value) {
  if (typeof value !== 'string') return null;
  const address = value.trim().replace(/\/\d+$/, '');
  const ipv4 = parseIPv4(address);
  if (ipv4) return isPublicIPv4(ipv4) ? ipv4.join('.') : null;

  const ipv6 = parseIPv6(address);
  if (!ipv6 || (ipv6[0] & 0xe000) !== 0x2000) return null;
  if (ipv6[0] === 0x2001 && (ipv6[1] < 0x0200 || ipv6[1] === 0x0db8)) return null;
  return address.toLowerCase();
}

// Zstandard's optional checksum is the low 32 bits of XXH64 with seed zero.
const mask = (1n << 64n) - 1n;
const primes = [
  11400714785074694791n,
  14029467366897019727n,
  1609587929392839161n,
  9650029242287828579n,
  2870177450012600261n,
];
const [p1, p2, p3, p4, p5] = primes as [bigint, bigint, bigint, bigint, bigint];
const rot = (n: bigint, shift: bigint) => ((n << shift) | (n >> (64n - shift))) & mask;
const round = (a: bigint, n: bigint) => (rot((a + n * p2) & mask, 31n) * p1) & mask;

export function xxhashChecksum(data: Buffer): number {
  let offset = 0;
  let result: bigint;
  if (data.length >= 32) {
    const lanes = [(p1 + p2) & mask, p2, 0n, -p1 & mask];
    while (offset <= data.length - 32) {
      for (let i = 0; i < 4; i++) lanes[i] = round(lanes[i]!, data.readBigUInt64LE(offset + i * 8));
      offset += 32;
    }
    result =
      (rot(lanes[0]!, 1n) + rot(lanes[1]!, 7n) + rot(lanes[2]!, 12n) + rot(lanes[3]!, 18n)) & mask;
    for (const lane of lanes) result = ((result ^ round(0n, lane)) * p1 + p4) & mask;
  } else result = p5;
  result = (result + BigInt(data.length)) & mask;
  while (offset <= data.length - 8) {
    result = (rot(result ^ round(0n, data.readBigUInt64LE(offset)), 27n) * p1 + p4) & mask;
    offset += 8;
  }
  if (offset <= data.length - 4) {
    result =
      (rot(result ^ ((BigInt(data.readUInt32LE(offset)) * p1) & mask), 23n) * p2 + p3) & mask;
    offset += 4;
  }
  while (offset < data.length)
    result = (rot(result ^ ((BigInt(data[offset++]!) * p5) & mask), 11n) * p1) & mask;
  result ^= result >> 33n;
  result = (result * p2) & mask;
  result ^= result >> 29n;
  result = (result * p3) & mask;
  result ^= result >> 32n;
  return Number(result & 0xffffffffn);
}

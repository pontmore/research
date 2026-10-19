// Reference implementation + vector generator for the resolver-recoverable
// preimage (RRP) draft. Deterministic: all "random" values derive from SEED.
const NOBLE = process.env.NOBLE_DIR ?? new URL("../../pontspark/node_modules/nostr-tools/node_modules/@noble", import.meta.url).pathname;
const { secp256k1, schnorr } = await import(`${NOBLE}/curves/secp256k1.js`);
const { sha256 } = await import(`${NOBLE}/hashes/sha2.js`);

const Point = secp256k1.Point;
const G = Point.BASE;
const N = Point.Fn.ORDER;
const { taggedHash, lift_x } = schnorr.utils;

const hex = (b) => Buffer.from(b).toString("hex");
const unhex = (h) => Uint8Array.from(Buffer.from(h, "hex"));
const cat = (...a) => Uint8Array.from(Buffer.concat(a.map((x) => Buffer.from(x))));
const int = (b) => BigInt("0x" + hex(b));
const ser32 = (x) => unhex(x.toString(16).padStart(64, "0"));
const ser33 = (P) => P.toBytes(true);
const u16 = (i) => Uint8Array.from([i >> 8, i & 255]);
const u8 = (i) => Uint8Array.from([i]);
const mod = (a) => ((a % N) + N) % N;
const enc = (s) => new TextEncoder().encode(s);

function inv(a) {
  let [t, nt, r, nr] = [0n, 1n, N, mod(a)];
  while (nr) { const q = r / nr; [t, nt] = [nt, t - q * nt]; [r, nr] = [nr, r - q * nr]; }
  return mod(t);
}

/** Deterministic test randomness; real implementations MUST use a CSPRNG. */
const SEED = enc("pontmore rrp test vectors v1");
const rnd = (label) => {
  const x = mod(int(taggedHash("pontmore/rrp/test-rng", SEED, enc(label))));
  if (x === 0n) throw new Error("zero");
  return x;
};

// -- primitives -----------------------------------------------------------------

/** Resolver key from a 32-byte BIP340 secret: normalized so r·G = lift_x(xonly). */
function resolverKey(d) {
  const P = G.multiply(d);
  const xonly = P.toBytes(true).slice(1);
  const r = P.y % 2n === 0n ? d : N - d;
  return { r, xonly, R: lift_x(int(xonly)) };
}

function mask(S, E, rootId, i, m) {
  return mod(int(taggedHash("pontmore/rrp/mask", ser33(S), ser33(E), rootId, u16(i), u8(m))));
}

function evalPoly(coeffs, x) {
  let y = 0n;
  for (let k = coeffs.length - 1; k >= 0; k--) y = mod(y * x + coeffs[k]);
  return y;
}

/** Lagrange interpolation at 0 from [(x, y)]. */
function interpolate0(points) {
  let acc = 0n;
  for (const [xi, yi] of points) {
    let num = 1n, den = 1n;
    for (const [xj] of points) if (xj !== xi) { num = mod(num * -xj); den = mod(den * (xi - xj)); }
    acc = mod(acc + yi * num * inv(den));
  }
  return acc;
}

/** Lagrange evaluation at x from [(x, y)]. */
function interpolateAt(points, x) {
  let acc = 0n;
  for (const [xi, yi] of points) {
    let num = 1n, den = 1n;
    for (const [xj] of points) if (xj !== xi) { num = mod(num * (x - xj)); den = mod(den * (xi - xj)); }
    acc = mod(acc + yi * num * inv(den));
  }
  return acc;
}

// -- provider -------------------------------------------------------------------

function commit({ rootId, resolvers, t, k, label }) {
  const secrets = [];
  const candidates = [];
  for (let i = 0; i < k; i++) {
    const e = rnd(`${label}/e/${i}`);
    const E = G.multiply(e);
    const coeffs = [rnd(`${label}/p/${i}`)];
    for (let d = 1; d < t; d++) coeffs.push(rnd(`${label}/coef/${i}/${d}`));
    const P = coeffs[0];
    const H = sha256(ser32(P));
    const c = resolvers.map((R, idx) => {
      const m = idx + 1;
      const S = R.multiply(e);
      return mod(evalPoly(coeffs, BigInt(m)) + mask(S, E, rootId, i, m));
    });
    secrets.push({ e, P });
    candidates.push({ E: hex(ser33(E)), H: hex(H), c: c.map((x) => hex(ser32(x))) });
  }
  return { secrets, candidates };
}

// -- recipient ------------------------------------------------------------------

function verifyOpening({ rootId, resolvers, t, candidate, i, eHex }) {
  const e = int(unhex(eHex));
  if (e <= 0n || e >= N) return "e out of range";
  const E = Point.fromHex(candidate.E);
  if (!G.multiply(e).equals(E)) return "E != e·G";
  const shares = resolvers.map((R, idx) => {
    const m = idx + 1;
    return [BigInt(m), mod(int(unhex(candidate.c[idx])) - mask(R.multiply(e), E, rootId, i, m))];
  });
  const base = shares.slice(0, t);
  for (const [x, y] of shares.slice(t)) if (interpolateAt(base, x) !== y) return "shares not on one degree t-1 polynomial";
  const P = interpolate0(base);
  if (P === 0n) return "zero preimage";
  if (hex(sha256(ser32(P))) !== candidate.H) return "H != sha256(P)";
  return null;
}

// -- resolver -------------------------------------------------------------------

function recoverShare({ rootId, r, m, candidate, j }) {
  const E = Point.fromHex(candidate.E);
  const S = E.multiply(r);
  return { S, share: mod(int(unhex(candidate.c[m - 1])) - mask(S, E, rootId, j, m)) };
}

function dleqProve(x, E, aux) {
  const A = G.multiply(x), S = E.multiply(x);
  const k = mod(int(taggedHash("pontmore/rrp/dleq-nonce", ser32(x), ser33(E), aux)));
  const R1 = G.multiply(k), R2 = E.multiply(k);
  const c = mod(int(taggedHash("pontmore/rrp/dleq", ser33(A), ser33(E), ser33(S), ser33(R1), ser33(R2))));
  return { S, proof: { c: hex(ser32(c)), z: hex(ser32(mod(k + c * x))) } };
}

function dleqVerify(A, E, S, { c, z }) {
  const ci = int(unhex(c)), zi = int(unhex(z));
  const R1 = G.multiply(zi).subtract(A.multiply(ci));
  const R2 = E.multiply(zi).subtract(S.multiply(ci));
  return mod(int(taggedHash("pontmore/rrp/dleq", ser33(A), ser33(E), ser33(S), ser33(R1), ser33(R2)))) === ci;
}

// -- vectors --------------------------------------------------------------------

function vector({ label, t, nRes, k, j }) {
  const rootId = sha256(enc(`${label}/root`));
  const keys = Array.from({ length: nRes }, (_, idx) => resolverKey(rnd(`${label}/resolver/${idx}`)));
  const resolvers = keys.map((x) => x.R);
  const { secrets, candidates } = commit({ rootId, resolvers, t, k, label });

  const openings = {};
  for (let i = 0; i < k; i++) if (i !== j) openings[i] = hex(ser32(secrets[i].e));
  for (const [i, eHex] of Object.entries(openings)) {
    const err = verifyOpening({ rootId, resolvers, t, candidate: candidates[i], i: Number(i), eHex });
    if (err) throw new Error(`honest opening ${i} failed: ${err}`);
  }

  const recovered = keys.slice(0, t).map((key, idx) => {
    const m = idx + 1;
    const { S, share } = recoverShare({ rootId, r: key.r, m, candidate: candidates[j], j });
    const { proof } = dleqProve(key.r, Point.fromHex(candidates[j].E), rootId);
    if (!dleqVerify(key.R, Point.fromHex(candidates[j].E), S, proof)) throw new Error("dleq");
    return { m, share: hex(ser32(share)), S: hex(ser33(S)), dleq: proof };
  });
  const P = interpolate0(recovered.map((x) => [BigInt(x.m), int(unhex(x.share))]));
  if (P !== secrets[j].P || hex(sha256(ser32(P))) !== candidates[j].H) throw new Error("recovery failed");

  // A cheating provider: corrupt candidate j's H and confirm only j escapes the check.
  const bad = structuredClone(candidates);
  bad[j].H = hex(sha256(enc("not the derived preimage")));
  const allPass = Object.keys(openings).every((i) => !verifyOpening({ rootId, resolvers, t, candidate: bad[i], i: Number(i), eHex: openings[i] }));
  if (!allPass) throw new Error("sanity: honest openings must still pass");

  return {
    label,
    params: { k, t, n: nRes, j },
    root_id: hex(rootId),
    resolvers: keys.map((x, idx) => ({ m: idx + 1, secret: hex(ser32(rnd(`${label}/resolver/${idx}`))), xonly: hex(x.xonly) })),
    commitment: candidates,
    challenge: j,
    openings,
    resolution: { shares: recovered, preimage: hex(ser32(P)), payment_hash: candidates[j].H },
  };
}

const vectors = [
  vector({ label: "single-resolver", t: 1, nRes: 1, k: 4, j: 2 }),
  vector({ label: "panel-2-of-3", t: 2, nRes: 3, k: 4, j: 1 }),
];

// Negative cases on the single-resolver vector.
{
  const v = vectors[0];
  const resolvers = v.resolvers.map((x) => lift_x(int(unhex(x.xonly))));
  const rootId = unhex(v.root_id);
  const [i, eHex] = Object.entries(v.openings)[0];
  const tamperedH = { ...v.commitment[i], H: hex(sha256(enc("x"))) };
  const tamperedC = { ...v.commitment[i], c: [hex(ser32(1n))] };
  const wrongE = hex(ser32(int(unhex(eHex)) + 1n));
  v.negative = [
    { case: "wrong H", opening: Number(i), error: verifyOpening({ rootId, resolvers, t: 1, candidate: tamperedH, i: Number(i), eHex }) },
    { case: "wrong c", opening: Number(i), error: verifyOpening({ rootId, resolvers, t: 1, candidate: tamperedC, i: Number(i), eHex }) },
    { case: "wrong e", opening: Number(i), error: verifyOpening({ rootId, resolvers, t: 1, candidate: v.commitment[i], i: Number(i), eHex: wrongE }) },
  ];
  if (v.negative.some((x) => !x.error)) throw new Error("negative case passed");
}
// Panel: one share inconsistent with the polynomial is rejected.
{
  const v = vectors[1];
  const resolvers = v.resolvers.map((x) => lift_x(int(unhex(x.xonly))));
  const [i, eHex] = Object.entries(v.openings)[0];
  const cand = structuredClone(v.commitment[i]);
  cand.c[2] = hex(ser32(mod(int(unhex(cand.c[2])) + 1n)));
  v.negative = [{ case: "share 3 off-polynomial", opening: Number(i), error: verifyOpening({ rootId: unhex(v.root_id), resolvers, t: 2, candidate: cand, i: Number(i), eHex }) }];
  if (!v.negative[0].error) throw new Error("negative case passed");
}

console.log(JSON.stringify(vectors, null, 2));

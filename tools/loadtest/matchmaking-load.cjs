/* Matchmaking load harness — spins up N socket clients, sends them all into the
 * video queue, and measures match success-rate + join→matched latency.
 *
 * Run (stack must be up):
 *   NODE_PATH="$PWD/node_modules:$PWD/apps/web/node_modules" \
 *     node tools/loadtest/matchmaking-load.cjs [N]
 *
 * N = number of clients (default 8; even number → N/2 simultaneous matches).
 * NOTE: registration is on the strict auth rate-limiter (~10/min/IP). For large
 * runs (hundreds+), SEED users directly into Mongo and pass an existing-user
 * pool instead of registering — and drive from multiple source IPs. This
 * harness proves the matchmaking+socket path and gives a baseline latency.
 */
const { io } = require('socket.io-client');

const API = process.env.API || 'http://localhost:4000/api';
const WS = process.env.WS || 'http://localhost:4000';
const N = Math.max(2, parseInt(process.argv[2] || '8', 10));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Number(process.hrtime.bigint() / 1000000n);

async function authToken(i) {
  const email = `e2e.load.${i}@ruletka.top`;
  const body = { email, password: 'Demo12345!', nickname: `load_${i}`, gender: i % 2 ? 'male' : 'female', birthDate: '2000-01-01', country: 'RU', locale: 'ru', acceptedTerms: true };
  let res = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 409) res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Demo12345!' }) });
  if (!res.ok) throw new Error(`user ${i}: auth ${res.status} (${res.status === 429 ? 'rate-limited — seed users for large runs' : await res.text()})`);
  return (await res.json()).tokens.accessToken;
}
async function allowEveryone(token) {
  await fetch(`${API}/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ privacy: { whoCanCall: 'everyone' } }) });
}

(async () => {
  console.log(`▶ matchmaking load: ${N} clients`);
  const tokens = [];
  for (let i = 0; i < N; i++) tokens.push(await authToken(i)); // sequential: respect the auth limiter
  await Promise.all(tokens.map(allowEveryone));
  console.log(`  ${N} users ready (whoCanCall=everyone)`);

  const sockets = tokens.map((t) => io(`${WS}/mm`, { auth: { token: t }, transports: ['websocket'], reconnection: false }));
  await Promise.all(sockets.map((s) => new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej); setTimeout(() => rej(new Error('connect timeout')), 10000); })));
  console.log(`  ${N} sockets connected`);
  await wait(800); // let handleConnection bind identity on every socket

  const join = { type: 'video', filters: { gender: 'any', ageMin: 18, ageMax: 120, countries: [] } };
  const matched = new Array(N).fill(null);
  const latencies = [];
  const joinAt = new Array(N).fill(0);
  sockets.forEach((s, i) => s.once('mm:matched', () => { matched[i] = true; if (joinAt[i]) latencies.push(now() - joinAt[i]); }));

  const t0 = now();
  sockets.forEach((s, i) => { joinAt[i] = now(); s.emit('mm:join', join); });
  // wait for matches to settle (or 15s)
  const deadline = now() + 15000;
  while (matched.filter(Boolean).length < N && now() < deadline) await wait(200);

  const matchedCount = matched.filter(Boolean).length;
  const wall = now() - t0;
  latencies.sort((a, b) => a - b);
  const p = (q) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))] : 0;
  console.log(`\n── RESULT ──`);
  console.log(`  matched:        ${matchedCount}/${N} clients (${((matchedCount / N) * 100).toFixed(0)}%)`);
  console.log(`  match latency:  p50=${p(0.5)}ms  p90=${p(0.9)}ms  max=${latencies[latencies.length - 1] ?? 0}ms`);
  console.log(`  wall time:      ${wall}ms for ${N} clients`);
  sockets.forEach((s) => s.close());
  process.exit(matchedCount >= N - 1 ? 0 : 1); // allow 1 odd-man-out
})().catch((e) => { console.error('💥', e.message); process.exit(2); });

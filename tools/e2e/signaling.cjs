/*
 * 2-client roulette signaling E2E.
 *
 * Drives the real matchmaking + signaling path end-to-end against a running API:
 *   auth two users → mm:join (both) → mm:matched (same room, complementary
 *   initiator) → rtc:offer / rtc:answer / rtc:ice-candidate relayed through the
 *   gateway. Deterministic (fake SDP strings, no media) so it is a reliable CI
 *   gate. Exit 0 = all assertions pass, non-zero = failure.
 *
 * Targets http://localhost:4000 by default; override with E2E_API_URL / E2E_WS_URL.
 */
const { io } = require('socket.io-client');

const API = process.env.E2E_API_URL || 'http://localhost:4000/api';
const WS = process.env.E2E_WS_URL || 'http://localhost:4000';
const results = [];
const ok = (m) => {
  results.push(['PASS', m]);
  console.log('  ✅', m);
};
const bad = (m) => {
  results.push(['FAIL', m]);
  console.log('  ❌', m);
};

function once(sock, ev, ms = 10000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms);
    sock.once(ev, (p) => {
      clearTimeout(t);
      res(p);
    });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function authToken(email, password, nickname, gender) {
  const reg = {
    email,
    password,
    nickname,
    gender,
    birthDate: '2000-01-01',
    country: 'RU',
    locale: 'ru',
    acceptedTerms: true,
  };
  let res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reg),
  });
  if (res.status === 409) {
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  }
  if (!res.ok) throw new Error(`${email}: auth ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.tokens.accessToken;
}

async function allowEveryone(token) {
  const res = await fetch(`${API}/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ privacy: { whoCanCall: 'everyone' } }),
  });
  if (!res.ok) throw new Error(`settings PATCH ${res.status} ${await res.text()}`);
}

function connect(token, label) {
  const s = io(`${WS}/mm`, { auth: { token }, transports: ['websocket'], reconnection: false });
  s.on('ws:error', (p) => console.log(`  ⚠️  ${label} ws:error`, JSON.stringify(p)));
  s.on('connect_error', (e) => console.log(`  ⚠️  ${label} connect_error`, e.message));
  return s;
}

(async () => {
  console.log('① Auth two distinct users');
  const tokenA = await authToken('e2e.alice@ruletka.top', 'Demo12345!', 'e2e_alice', 'female');
  const tokenB = await authToken('e2e.peer@ruletka.top', 'Demo12345!', 'e2e_peer', 'male');
  ok('Logged in two fresh users (e2e_alice + e2e_peer)');

  console.log('② Open whoCanCall=everyone for both');
  await allowEveryone(tokenA);
  await allowEveryone(tokenB);
  ok('Both set whoCanCall=everyone');

  console.log('③ Connect two sockets');
  const sA = connect(tokenA, 'A');
  const sB = connect(tokenB, 'B');
  await Promise.all([once(sA, 'connect', 8000), once(sB, 'connect', 8000)]);
  // Let the server's async handleConnection bind identity (userId) before emitting.
  await wait(700);
  ok(`Both sockets connected (A=${sA.id}, B=${sB.id})`);

  console.log('④ mm:join (video) on both → expect mm:matched');
  const join = {
    type: 'video',
    filters: { gender: 'any', ageMin: 18, ageMax: 120, countries: [] },
  };
  const mA = once(sA, 'mm:matched');
  const mB = once(sB, 'mm:matched');
  sA.emit('mm:join', join);
  await wait(400); // let A enter the queue first
  sB.emit('mm:join', join);
  const [matchA, matchB] = await Promise.all([mA, mB]);
  if (matchA.roomId && matchA.roomId === matchB.roomId)
    ok(`Both matched into the same room: ${matchA.roomId}`);
  else bad(`roomId mismatch: A=${matchA.roomId} B=${matchB.roomId}`);
  if (matchA.isInitiator !== matchB.isInitiator)
    ok(`Exactly one initiator (A=${matchA.isInitiator}, B=${matchB.isInitiator})`);
  else bad(`initiator flags not complementary`);
  if (matchA.type === 'video' && matchB.type === 'video') ok('Match type = video on both');
  else bad('match type wrong');
  if (matchA.peer && matchB.peer) ok('Each side received peer info');
  else bad('missing peer info');

  console.log('⑤ WebRTC signaling relay through the gateway');
  const roomId = matchA.roomId;
  const initiator = matchA.isInitiator ? sA : sB;
  const callee = matchA.isInitiator ? sB : sA;

  const offerRecv = once(callee, 'rtc:offer');
  initiator.emit('rtc:offer', { roomId, sdp: 'FAKE_OFFER_SDP_v=0' });
  const offer = await offerRecv;
  if (offer.sdp === 'FAKE_OFFER_SDP_v=0' && offer.roomId === roomId)
    ok('Initiator→callee rtc:offer relayed intact');
  else bad(`offer relay wrong: ${JSON.stringify(offer)}`);

  const answerRecv = once(initiator, 'rtc:answer');
  callee.emit('rtc:answer', { roomId, sdp: 'FAKE_ANSWER_SDP_v=0' });
  const answer = await answerRecv;
  if (answer.sdp === 'FAKE_ANSWER_SDP_v=0') ok('Callee→initiator rtc:answer relayed intact');
  else bad(`answer relay wrong: ${JSON.stringify(answer)}`);

  const iceRecv = once(callee, 'rtc:ice-candidate');
  initiator.emit('rtc:ice-candidate', {
    roomId,
    candidate: { candidate: 'candidate:fake 1 udp', sdpMid: '0', sdpMLineIndex: 0 },
  });
  const ice = await iceRecv;
  if (ice.candidate && ice.roomId === roomId) ok('rtc:ice-candidate relayed intact');
  else bad('ice relay wrong');

  sA.close();
  sB.close();
  const passed = results.filter((r) => r[0] === 'PASS').length;
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n══ SIGNALING E2E: ${passed} passed, ${failed} failed ══`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('\n💥 E2E ERROR:', e.message);
  process.exit(2);
});

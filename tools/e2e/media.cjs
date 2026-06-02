/*
 * Real-media E2E: two werift RTCPeerConnections negotiate video+audio
 * transceivers through the live /mm gateway (mm:join → mm:matched →
 * rtc:offer/answer/ice) and must reach ICE 'connected' — proving the actual media
 * transport, not just signaling. Heavier + ICE-timing sensitive, so in CI it runs
 * informationally (does not gate); locally it's a strong real-call smoke test.
 *
 * Targets http://localhost:4000 by default; override with E2E_API_URL / E2E_WS_URL.
 */
const { io } = require('socket.io-client');
const { RTCPeerConnection } = require('werift');

const API = process.env.E2E_API_URL || 'http://localhost:4000/api';
const WS = process.env.E2E_WS_URL || 'http://localhost:4000';
const log = (...a) => console.log(...a);

function once(sock, ev, ms = 12000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
    sock.once(ev, (p) => {
      clearTimeout(t);
      res(p);
    });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function authToken(email, nickname, gender) {
  const reg = {
    email,
    password: 'Demo12345!',
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
  if (res.status === 409)
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo12345!' }),
    });
  if (!res.ok) throw new Error(`${email}: auth ${res.status}`);
  return (await res.json()).tokens.accessToken;
}
async function allowEveryone(token) {
  await fetch(`${API}/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ privacy: { whoCanCall: 'everyone' } }),
  });
}

function makePc() {
  const pc = new RTCPeerConnection({ iceServers: [] }); // localhost host candidates suffice
  pc.addTransceiver('video', { direction: 'sendrecv' });
  pc.addTransceiver('audio', { direction: 'sendrecv' });
  return pc;
}

(async () => {
  log('① auth + open whoCanCall');
  const [tA, tB] = await Promise.all([
    authToken('e2e.alice@ruletka.top', 'e2e_alice', 'female'),
    authToken('e2e.peer@ruletka.top', 'e2e_peer', 'male'),
  ]);
  await Promise.all([allowEveryone(tA), allowEveryone(tB)]);

  log('② connect /mm + join');
  const sA = io(`${WS}/mm`, {
    auth: { token: tA },
    transports: ['websocket'],
    reconnection: false,
  });
  const sB = io(`${WS}/mm`, {
    auth: { token: tB },
    transports: ['websocket'],
    reconnection: false,
  });
  await Promise.all([once(sA, 'connect', 8000), once(sB, 'connect', 8000)]);
  await wait(700);
  const mA = once(sA, 'mm:matched'),
    mB = once(sB, 'mm:matched');
  const join = {
    type: 'video',
    filters: { gender: 'any', ageMin: 18, ageMax: 120, countries: [] },
  };
  sA.emit('mm:join', join);
  await wait(400);
  sB.emit('mm:join', join);
  const [matchA] = await Promise.all([mA, mB]);
  const roomId = matchA.roomId;
  log(`   matched room=${roomId} (A.initiator=${matchA.isInitiator})`);

  log('③ wire two real RTCPeerConnections (werift) through the gateway');
  const pcA = makePc(),
    pcB = makePc();
  const sockOf = { A: sA, B: sB };
  const pcOf = { A: pcA, B: pcB };
  const initiator = matchA.isInitiator ? 'A' : 'B';
  const callee = initiator === 'A' ? 'B' : 'A';

  for (const side of ['A', 'B']) {
    const pc = pcOf[side],
      sock = sockOf[side];
    pc.onicecandidate = (e) => {
      if (e.candidate)
        sock.emit('rtc:ice-candidate', {
          roomId,
          candidate: {
            candidate: e.candidate.candidate,
            sdpMid: e.candidate.sdpMid,
            sdpMLineIndex: e.candidate.sdpMLineIndex,
          },
        });
    };
    sock.on('rtc:ice-candidate', async (p) => {
      try {
        await pc.addIceCandidate(p.candidate);
      } catch {
        /* ignore late candidate */
      }
    });
  }
  sockOf[callee].on('rtc:offer', async (p) => {
    await pcOf[callee].setRemoteDescription({ type: 'offer', sdp: p.sdp });
    await pcOf[callee].setLocalDescription(await pcOf[callee].createAnswer());
    sockOf[callee].emit('rtc:answer', { roomId, sdp: pcOf[callee].localDescription.sdp });
  });
  sockOf[initiator].on('rtc:answer', async (p) => {
    await pcOf[initiator].setRemoteDescription({ type: 'answer', sdp: p.sdp });
  });

  const connected = (pc) =>
    ['connected', 'completed'].includes(pc.iceConnectionState) ||
    pc.connectionState === 'connected';
  const waitConnected = (pc, label) =>
    new Promise((res, rej) => {
      if (connected(pc)) return res();
      const t = setTimeout(
        () => rej(new Error(`${label} never connected (ice=${pc.iceConnectionState})`)),
        20000,
      );
      const check = () => {
        if (connected(pc)) {
          clearTimeout(t);
          res();
        }
      };
      pc.oniceconnectionstatechange = () => {
        log(`   ${label} iceState=${pc.iceConnectionState}`);
        check();
      };
      pc.onconnectionstatechange = check;
    });

  await pcOf[initiator].setLocalDescription(await pcOf[initiator].createOffer());
  sockOf[initiator].emit('rtc:offer', { roomId, sdp: pcOf[initiator].localDescription.sdp });

  log('④ awaiting ICE connectivity on both peers…');
  await Promise.all([waitConnected(pcA, 'A'), waitConnected(pcB, 'B')]);
  log('\n✅ REAL MEDIA E2E PASSED — both peers reached ICE connected through the gateway.');
  pcA.close();
  pcB.close();
  sA.close();
  sB.close();
  process.exit(0);
})().catch((e) => {
  console.error('\n💥 MEDIA E2E:', e.message);
  process.exit(1);
});

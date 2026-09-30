// A stand-in for the Artifact `room` capability, for local tests: pages in the
// same browser context share presence over a BroadcastChannel, with optional
// latency (window.__FAKE_LATENCY ms). Implements the subset Wide Load uses.
(function () {
  const bc = new BroadcastChannel('wideload-fake-room');
  const me = 'p' + Math.random().toString(36).slice(2, 10);
  const rooms = new Map();
  const latency = () => Number(window.__FAKE_LATENCY || 0) + Math.random() * Number(window.__FAKE_JITTER || 0);
  const send = (msg) => {
    const d = latency();
    if (d > 0) setTimeout(() => bc.postMessage(msg), d);
    else bc.postMessage(msg);
  };

  function makeRoom(name) {
    if (rooms.has(name)) return rooms.get(name);
    const peers = new Map();
    const handlers = [];
    const connHandlers = [];
    let mine = {};
    let snap = null;
    const snapshot = () => {
      if (!snap) snap = Object.freeze([...peers.entries()].map(([peer, p]) => Object.freeze({ peer, by: null, isMe: peer === me, sameTab: peer === me, kind: 'viewer', guest: false, presence: p.presence, updatedAt: p.updatedAt })));
      return snap;
    };
    const find = (peer) => snapshot().find((p) => p.peer === peer);
    const fire = (joined, left, updated) => {
      snap = null;
      const ps = snapshot();
      const ch = { peers: ps, joined: joined.map(find).filter(Boolean), left, updated: updated.map(find).filter(Boolean) };
      for (const h of handlers) h(ch);
    };
    peers.set(me, { presence: {}, updatedAt: Date.now() });
    let lastSent = 0, pendingSend = null;
    const flush = () => {
      pendingSend = null;
      lastSent = performance.now();
      send({ t: 'pres', room: name, peer: me, presence: mine });
    };
    const room = {
      name,
      _msg(m) {
        if (m.t === 'hello') {
          const isNew = !peers.has(m.peer);
          if (isNew) peers.set(m.peer, { presence: {}, updatedAt: Date.now() });
          send({ t: 'pres', room: name, peer: me, presence: mine });
          if (isNew) fire([m.peer], [], []);
        } else if (m.t === 'pres') {
          const isNew = !peers.has(m.peer);
          peers.set(m.peer, { presence: Object.freeze(m.presence), updatedAt: Date.now() });
          fire(isNew ? [m.peer] : [], [], isNew ? [] : [m.peer]);
        } else if (m.t === 'bye') {
          const old = find(m.peer);
          if (peers.delete(m.peer)) fire([], old ? [old] : [], []);
        }
      },
      presence(patch) {
        const next = { ...mine };
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) delete next[k];
          else next[k] = v;
        }
        const size = JSON.stringify(next).length;
        if (size > 4096) return Promise.reject({ code: 'invalid_argument', message: 'presence over 4 KiB: ' + size });
        mine = next;
        peers.set(me, { presence: Object.freeze(JSON.parse(JSON.stringify(mine))), updatedAt: Date.now() });
        snap = null;
        // coalesce to ~30 Hz like the real channel
        const now = performance.now();
        if (now - lastSent > 33) flush();
        else if (!pendingSend) pendingSend = setTimeout(flush, 33 - (now - lastSent));
        return Promise.resolve();
      },
      onPeers(h) {
        handlers.push(h);
        setTimeout(() => h({ peers: snapshot(), joined: snapshot(), left: [], updated: [] }), 0);
        return () => handlers.splice(handlers.indexOf(h), 1);
      },
      peers: snapshot,
      connected: () => true,
      onConnection(h) {
        connHandlers.push(h);
        setTimeout(() => h(true), 0);
        return () => {};
      },
      emit() {
        return Promise.resolve();
      },
      on() {
        return () => {};
      },
      join(n) {
        return Promise.resolve(makeRoom(n));
      },
      leave() {
        send({ t: 'bye', room: name, peer: me });
        rooms.delete(name);
        return Promise.resolve();
      },
    };
    rooms.set(name, room);
    send({ t: 'hello', room: name, peer: me });
    return room;
  }

  bc.onmessage = (e) => {
    const m = e.data;
    const r = rooms.get(m.room);
    if (r) r._msg(m);
  };
  addEventListener('pagehide', () => {
    for (const name of rooms.keys()) bc.postMessage({ t: 'bye', room: name, peer: me });
  });
  const lobby = makeRoom('__lobby');
  window.__fakePeer = me;
  window.claude = { use: async (n) => (n === 'room' ? lobby : null) };
})();

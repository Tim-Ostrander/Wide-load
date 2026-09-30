// Sessions: who is host, who owns the rig, and how state and actions travel.
//
// Everything rides on the Artifact `room` capability's presence channel:
// each peer publishes one object (its avatar, inputs and recent actions);
// the host adds the world state (W) and the rig owner adds the rig state (R).
// Presence needs no special permission, is handed to late joiners, and is
// cleared when a peer leaves, which suits a small co-op game.

export const PROTOCOL = 3;
const ACT_TTL = 2500;
const SEND_HZ = 20;

class BaseSession {
  constructor({ name, color }) {
    this.name = name;
    this.color = color;
    this.me = 'me';
    this.host = 'me';
    this.isHost = true;
    this.seq = 0;
    this.acts = [];
    this.handlers = [];
    this.peers = new Map(); // peer -> {presence, joinedAt, lastSeq: {W,R}, bufR: [], lastRt}
    this.local = {}; // my presence fields
    this.lastSend = 0;
    this.connected = true;
    this.clockOffset = new Map();
  }

  /** Register a processor: fn(peer, action) -> handled for domains you own. */
  onAction(fn) {
    this.handlers.push(fn);
  }

  /** Queue an action for its processor (host = 'W', rig owner = 'R'). */
  act(domain, type, ...args) {
    const a = [++this.seq, domain, type, ...args];
    this.acts.push({ a, at: performance.now() });
    // process locally if we own that domain
    for (const h of this.handlers) h(this.me, domain, type, args, true);
  }

  set(fields) {
    Object.assign(this.local, fields);
  }

  others() {
    return [...this.peers.entries()].filter(([p]) => p !== this.me);
  }

  presenceOf(peer) {
    return peer === this.me ? this.local : this.peers.get(peer)?.presence;
  }

  hostPresence() {
    return this.presenceOf(this.host);
  }

  tick() {}
  leave() {}
}

/** Single player: no network at all. */
export class SoloSession extends BaseSession {
  constructor(opts) {
    super(opts);
    this.solo = true;
  }
}

/** Online: a named room of the Artifact `room` capability. */
export class RoomSession extends BaseSession {
  constructor(opts) {
    super(opts);
    this.room = opts.room; // NamedRoom
    this.me = opts.me;
    this.host = opts.host;
    this.isHost = opts.me === opts.host;
    this.code = opts.code;
    this.onPeerJoin = null;
    this.onPeerLeave = null;
    this.onHostLost = null;
    this.hostSeen = this.isHost;
    this.unsub = this.room.onPeers((c) => this._peers(c), (e) => {
      this.connected = false;
      this.error = e?.code || 'error';
    });
    this.unsubConn = this.room.onConnection((ok) => {
      this.connected = ok;
    });
  }

  _peers(change) {
    const now = performance.now();
    for (const p of change.left) {
      if (p.peer === this.me) continue;
      const info = this.peers.get(p.peer);
      this.peers.delete(p.peer);
      if (this.onPeerLeave) this.onPeerLeave(p.peer, info);
      if (p.peer === this.host && this.onHostLost) this.onHostLost();
    }
    for (const p of [...change.joined, ...change.updated]) {
      if (p.isMe && p.sameTab) continue;
      if (p.kind !== 'viewer') continue;
      let info = this.peers.get(p.peer);
      if (!info) {
        info = { presence: {}, joinedAt: now, lastSeq: { W: 0, R: 0 }, bufR: [], seenActs: new Set(), guest: p.guest };
        this.peers.set(p.peer, info);
        if (this.onPeerJoin) this.onPeerJoin(p.peer);
      }
      const pr = p.presence || {};
      if (pr.v !== undefined && pr.v !== PROTOCOL) continue;
      info.presence = pr;
      info.at = now;
      if (p.peer === this.host) this.hostSeen = true;
      // rig snapshots: keep a short buffer keyed by the sender's clock
      if (pr.R && pr.R.t !== info.lastRt) {
        info.lastRt = pr.R.t;
        const off = now / 1000 - pr.R.t;
        const prev = this.clockOffset.get(p.peer);
        this.clockOffset.set(p.peer, prev === undefined ? off : Math.min(prev + 0.002, off));
        info.bufR.push(pr.R);
        if (info.bufR.length > 30) info.bufR.shift();
      }
      // actions
      if (Array.isArray(pr.acts)) {
        for (const a of pr.acts) {
          if (!Array.isArray(a) || a.length < 3) continue;
          const [seq, dom, type, ...args] = a;
          if (info.seenActs.has(seq)) continue;
          info.seenActs.add(seq);
          if (info.seenActs.size > 200) info.seenActs = new Set([...info.seenActs].slice(-100));
          for (const h of this.handlers) h(p.peer, dom, type, args, false);
        }
      }
    }
  }

  /** Interpolated rig snapshot pair from `peer`, rendered ~120 ms behind. */
  rigSample(peer, delay = 0.12) {
    const info = this.peers.get(peer);
    if (!info || !info.bufR.length) return null;
    const buf = info.bufR;
    const off = this.clockOffset.get(peer) ?? 0;
    const t = performance.now() / 1000 - off - delay;
    if (buf.length === 1 || t <= buf[0].t) return { a: buf[0], b: buf[0], u: 0 };
    for (let k = buf.length - 1; k > 0; k--) {
      const A = buf[k - 1], B = buf[k];
      if (t >= A.t) {
        if (t > B.t) return { a: B, b: B, u: 0, late: t - B.t };
        return { a: A, b: B, u: (t - A.t) / Math.max(1e-3, B.t - A.t) };
      }
    }
    const L = buf[buf.length - 1];
    return { a: L, b: L, u: 0 };
  }

  latestRig(peer) {
    const info = this.peers.get(peer);
    return info && info.bufR.length ? info.bufR[info.bufR.length - 1] : null;
  }

  tick(now) {
    if (now - this.lastSend < 1000 / SEND_HZ) return;
    this.lastSend = now;
    this.acts = this.acts.filter((x) => now - x.at < ACT_TTL).slice(-14);
    const msg = { v: PROTOCOL, ...this.local, acts: this.acts.map((x) => x.a) };
    for (const k of Object.keys(msg)) if (msg[k] === undefined) delete msg[k];
    let size = 0;
    try {
      size = JSON.stringify(msg).length;
    } catch {
      return;
    }
    if (size > 3950 && msg.W) {
      // trim resting item transforms far from the action first
      msg.W = { ...msg.W, items: { ...msg.W.items, l: msg.W.items.l.map((e) => (e[1] === 3 ? [e[0], 4] : e)) } };
    }
    // keys we stopped sending must be cleared explicitly (presence merges)
    for (const k of this.sentKeys || []) if (!(k in msg) || msg[k] === undefined) msg[k] = null;
    this.sentKeys = Object.keys(msg).filter((k) => msg[k] !== null);
    this.room.presence(msg).catch(() => {});
    this.lastSize = size;
  }

  leave() {
    try {
      this.unsub?.();
      this.unsubConn?.();
      this.room.leave?.();
    } catch {
      /* ignore */
    }
  }
}

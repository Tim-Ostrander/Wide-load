// A minimal in-memory Nostr relay for local tests of Trystero's signaling.
// Handles REQ / EVENT / CLOSE with kind and "#x" tag filters.
import { WebSocketServer } from 'ws';

export function startRelay(port = 7777) {
  const wss = new WebSocketServer({ port });
  const subs = new Map(); // socket -> Map(subId -> filters[])
  const match = (ev, f) => (!f.kinds || f.kinds.includes(ev.kind)) && (!f['#x'] || ev.tags.some((t) => t[0] === 'x' && f['#x'].includes(t[1])));
  wss.on('connection', (ws) => {
    subs.set(ws, new Map());
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const [type, ...rest] = msg;
      if (type === 'REQ') {
        const [subId, ...filters] = rest;
        subs.get(ws).set(subId, filters);
        ws.send(JSON.stringify(['EOSE', subId]));
      } else if (type === 'CLOSE') {
        subs.get(ws).delete(rest[0]);
      } else if (type === 'EVENT') {
        const ev = rest[0];
        ws.send(JSON.stringify(['OK', ev.id, true, '']));
        for (const [sock, m] of subs) {
          for (const [subId, filters] of m) {
            if (filters.some((f) => match(ev, f)) && sock.readyState === 1) sock.send(JSON.stringify(['EVENT', subId, ev]));
          }
        }
      }
    });
    ws.on('close', () => subs.delete(ws));
  });
  return wss;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startRelay(Number(process.argv[2] || 7777));
  console.log('nostr relay on', process.argv[2] || 7777);
}

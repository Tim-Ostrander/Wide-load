// Two players in one browser context over the fake room: host a job, join it,
// hand the rig to the joiner, drive, and check both views agree.
import { startServer, launch, openPage, shot } from './harness.mjs';
const srv = await startServer();
const { browser, context } = await launch({ width: 640, height: 360 });
const lat = Number(process.env.LAT || 60);
const init = `window.__FAKE_LATENCY = ${lat}; window.__FAKE_JITTER = 20;`;
const A = await openPage(context, { fakeRoom: true, init });
const B = await openPage(context, { fakeRoom: true, init });
const ready = (p) => p.page.waitForFunction(() => window.__wl && window.__wl.startSolo, null, { timeout: 120000 });
await ready(A);
await ready(B);
const log = (...a) => console.log('[coop]', ...a);
const ev = (p, fn, arg) => p.page.evaluate(fn, arg);
try {
  await A.page.fill('#name', 'Hosty');
  await B.page.fill('#name', 'Joiner');
  await B.page.click('.hat:nth-child(3)');
  await A.page.waitForTimeout(1500);
  await A.page.click('#btn-host');
  await A.page.waitForTimeout(2500);
  log('A mode', await ev(A, () => ({ mode: window.__wl.game.mode, host: window.__wl.game.session.isHost, code: window.__wl.game.session.code })));
  await B.page.waitForSelector('#lobby-list li button', { timeout: 20000 });
  log('B lobby', await ev(B, () => document.querySelector('#lobby-list').innerText));
  await B.page.click('#lobby-list li button');
  await B.page.waitForFunction(() => window.__wl.game.ready, null, { timeout: 30000 });
  log('B joined; ready', await ev(B, () => ({ ready: window.__wl.game.ready, others: window.__wl.game.session.others().length })));
  await A.page.waitForTimeout(2000);
  log('A sees', await ev(A, () => ({ remotes: window.__wl.game.remotes.size, size: window.__wl.game.session.lastSize })));
  log('B sees', await ev(B, () => ({ remotes: window.__wl.game.remotes.size, size: window.__wl.game.session.lastSize, owner: window.__wl.game.rig.owner })));
  console.log(await shot(A.page, 'c_A1'));
  console.log(await shot(B.page, 'c_B1'));
  // B takes the driver's seat
  await ev(B, () => {
    const g = window.__wl.game;
    const a = g.rig.anchors().find((x) => x.kind === 'seat' && x.seat === 'driver');
    g.player.teleport(a.pos);
  });
  await B.page.waitForTimeout(600);
  await B.page.keyboard.press('f');
  await B.page.waitForTimeout(2500);
  log('seats', await ev(A, () => JSON.stringify(window.__wl.game.W.seats)), 'B owner', await ev(B, () => window.__wl.game.rig.owner), 'A owner', await ev(A, () => window.__wl.game.rig.owner));
  // A walks onto the trailer deck to ride along
  await ev(A, () => {
    const g = window.__wl.game;
    g.player.teleport(g.rig.toWorld('trailer', [0.9, 0.5, 4.6]));
  });
  await B.page.keyboard.down('w');
  await B.page.waitForTimeout(8000);
  await B.page.keyboard.up('w');
  await B.page.waitForTimeout(1500);
  const pa = await ev(A, () => ({ truck: window.__wl.game.rig.truck.position, me: window.__wl.game.player.body.position, ground: window.__wl.game.player.groundBody === window.__wl.game.rig.trailer }));
  const pb = await ev(B, () => ({ truck: window.__wl.game.rig.truck.position, kmh: window.__wl.game.rig.speed * 3.6, remote: [...window.__wl.game.remotes.values()].map((r) => r.avatar.group.position) }));
  log('A view', JSON.stringify(pa));
  log('B view', JSON.stringify(pb));
  console.log(await shot(A.page, 'c_A2'));
  console.log(await shot(B.page, 'c_B2'));
  // A (host) picks the chainsaw via toolbox; B sees the item held
  await ev(A, () => {
    const g = window.__wl.game;
    g.player.teleport(g.rig.anchors().find((a) => a.kind === 'toolbox').pos);
  });
  await A.page.waitForTimeout(700);
  await A.page.keyboard.press('e');
  await A.page.waitForTimeout(1500);
  log('A held', await ev(A, () => window.__wl.game.player.held), 'B sees holder', await ev(B, () => JSON.stringify([...window.__wl.game.items.map.values()].filter((i) => i.holder).map((i) => [i.type, i.holder]))));
  // B hands back the rig: leave seat
  await B.page.keyboard.press('f');
  await B.page.waitForTimeout(2000);
  log('after B leaves: A owner', await ev(A, () => window.__wl.game.rig.owner), 'B owner', await ev(B, () => window.__wl.game.rig.owner));
} catch (e) {
  console.log('ERROR', e.message);
}
console.log('--- A logs'); console.log(A.logs.filter((l) => !l.includes('toNonIndexed')).slice(0, 20).join('\n'));
console.log('--- B logs'); console.log(B.logs.filter((l) => !l.includes('toNonIndexed')).slice(0, 20).join('\n'));
await browser.close();
srv.kill();

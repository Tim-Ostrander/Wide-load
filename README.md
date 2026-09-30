# Wide Load

A co-op 3D browser game about hauling absurd, fragile cargo across a wild map
on a rig that's too big for the road. You don't just drive the route, you
make it.

**Job #0412:** get Dolores, a beluga whale in a glass tank, from the Two Guys
& a Flatbed depot to the Gull Harbor boat ramp. On the way:

| Obstacle | What you do |
|---|---|
| Fallen tree | Take the chainsaw from the truck's toolbox and cut the log |
| Low power lines | Hook the wires higher at a pole with the hot stick, or ride on top of the tank and lift them by hand as the rig passes |
| Rail bridge, 14'-5" clearance | Lower the trailer bed (B) and creep under at 12 km/h |
| Gas station and water tower | Refuel at the pump; park the tank under the spout to refill Dolores |
| Weak bridge (20 t limit) | Carry support posts into the creek and wedge at least 3 of 4 under the deck |
| Washout | Carry planks and lay them across the gap under both wheel tracks |
| Switchbacks | Tight hairpins; a crewmate in the tiller seat steers the trailer's rear wheels |
| Gull Harbor | Narrow streets, parked cars, mailboxes: every one is a fine |

Along the way the water sloshes (and spills), straps loosen and snap, tires
blow on hard hits, and fuel runs low. Pay is $12,000 minus damage to Dolores
and fines.

## Play

**On claude.ai:** the published artifact. Solo works for anyone who can open it;
co-op connects signed-in viewers through the page's `room` capability.

**Anywhere else (no accounts):** host the static build and share the crew
password. The lobby asks for it; solo needs none.

```sh
npm run build        # writes dist/ (a complete static site)
npm run serve        # dev server at http://localhost:8765
```

Hosting options for `dist/`:

- **GitHub Pages:** `.github/workflows/pages.yml` deploys `main`. One-time
  setup: Settings → Pages → Source: GitHub Actions. Pages needs a public repo,
  or GitHub Pro for a private one.
- **Cloudflare Pages / Netlify / Vercel:** connect the repo (private is fine)
  with build command `node tools/build-web.mjs dist` and output folder `dist`.
- **itch.io or Netlify Drop:** every push builds a `wide-load-web` artifact in
  GitHub Actions; download it and upload the folder.

### Crew password

Web co-op is gated by one shared password. Only a salted PBKDF2 hash ships in
the code (`src/net/crewkey.js`). To change it:

```sh
node tools/set-password.mjs "new-password"    # or omit to generate one
```

The password picks the room namespace and encrypts WebRTC signaling. Public
Nostr relays only introduce players to each other (via
[Trystero](https://github.com/dmotz/trystero), vendored in `vendor/`); game
traffic then flows directly between browsers. It's a casual gate for a friends'
game, not account security.

### Controls

| | |
|---|---|
| WASD, Shift, Space | Walk, run, jump |
| Mouse | Look (click to lock the pointer) |
| E | Use / pick up; hold for timed jobs |
| Q | Drop what you're carrying |
| F | Get in or out of a seat (driver, passenger, tiller) |
| In the cab | W/S throttle and brake, A/D steer, B bed up/down, X trailer auto-steer, H horn, L lights, Space parking brake |
| Tiller seat | A/D steer the trailer's rear wheels |
| G / T / V | Ping, quick chat (1–6), wave |
| Esc | Pause: call a tow, restart, mute |
| Backspace | Respawn next to the truck |

## How it's built

Plain ES modules; the only build step wraps `index.html` in a document for
static hosts. three.js r169 renders with cel shading and a depth-based ink
outline pass; cannon-es 0.20 runs the physics. Both load from jsDelivr
(`src/lib.js`). Every model, texture and sound is generated in code.

```
src/
  main.js            boot, title menu, lobby, host/join flows
  game.js            the loop: host rules, rig ownership, interactions, sync
  physics.js         cannon world, collision groups, materials
  rig/rig.js         truck + steerable trailer (two raycast vehicles on a
                     fifth-wheel joint), bed height, slosh, straps, tires, fuel
  rig/models.js      truck, trailer, tank and Dolores models
  world/road.js      the route spline, sampled every metre, with a spatial hash
  world/terrain.js   1 km heightfield shaped around the road, creek, railway
                     embankment, washout gully and coast
  world/structures.js obstacles, buildings, scenery and their colliders
  world/env.js       sky, sun, fog, sea shader
  items.js           carryable items (host-simulated)
  player.js          crew avatar and the local character controller
  net/session.js     solo and room sessions
  net/mesh.js        the same room API over WebRTC, for password co-op
  render/            cel shading ramp and the ink-outline pass
  ui/hud.js          HUD, minimap, toasts
  audio.js           procedural WebAudio
```

### Networking

Everything travels over the room capability's **presence** channel (about 30
updates per second, 4 KiB per peer):

- Every peer publishes its avatar, inputs and a short list of recent actions.
- The **host** publishes the world state `W`: obstacles, items, seats, fines,
  progress and phase. The host processes `W` actions such as picking up a
  plank or laying it in a slot.
- The **rig owner** publishes the rig state `R`. The rig owner is whoever is
  driving, so the driver gets no input lag; with no driver it is the host.
  Everyone else interpolates `R` about 120 ms behind. The rig owner processes
  `R` actions such as tightening a strap or changing a tire.
- Players standing on the moving rig publish rig-relative positions, so riders
  stay put on every screen.

## Tests

```sh
npm install
npm run test:smoke        # boots the page, screenshots the title screen
npm run test:playthrough  # a bot clears every obstacle and releases Dolores
npm run test:coop         # two tabs over a fake room: host, join, hand over the rig
CREW_PW=... npm run test:coop-web  # the same over real WebRTC through a local Nostr relay
```

The tests route the CDN imports to `node_modules` and use Chromium from
Playwright. `tests/fake-room.js` stands in for the room capability.

## Roadmap

- More cargo: wedding cake (melts), giant egg (hatches), cathedral bell, grand piano, a whole house
- A depot hub with contracts and rig upgrades (winch, crane arm, plow)
- Night camps, weather, a pilot car and the CB radio
- More regions: snowy pass, bayou (float the rig on a barge), canyon desert

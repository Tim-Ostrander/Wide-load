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

Open `index.html` through any static web server (ES modules need `http://`):

```sh
npm run serve        # http://localhost:8765
```

Solo play works anywhere. Online co-op (up to 4) uses the Claude Artifact
`room` capability, so it works when the game is published as a Claude
artifact and players open it on claude.ai while signed in.

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

Plain ES modules, no build step. three.js r169 renders; cannon-es 0.20 runs the
physics. Both load from jsDelivr (`src/lib.js`). Every model, texture and sound is
generated in code.

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
```

The tests route the CDN imports to `node_modules` and use Chromium from
Playwright. `tests/fake-room.js` stands in for the room capability.

## Roadmap

- More cargo: wedding cake (melts), giant egg (hatches), cathedral bell, grand piano, a whole house
- A depot hub with contracts and rig upgrades (winch, crane arm, plow)
- Night camps, weather, a pilot car and the CB radio
- More regions: snowy pass, bayou (float the rig on a barge), canyon desert

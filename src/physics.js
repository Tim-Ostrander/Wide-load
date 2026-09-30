// Physics world setup, collision groups and materials.
import { CANNON } from './lib.js';

export const G = {
  GROUND: 1, // terrain and static scenery
  RIG: 2,
  PLAYER: 4,
  ITEM: 8,
  PROP: 16,
  DEBRIS: 32,
};

export function createPhysics() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = 14;
  world.defaultContactMaterial.friction = 0.5;
  world.defaultContactMaterial.restitution = 0.05;

  const mats = {
    ground: new CANNON.Material('ground'),
    rig: new CANNON.Material('rig'),
    player: new CANNON.Material('player'),
    item: new CANNON.Material('item'),
  };
  world.addContactMaterial(new CANNON.ContactMaterial(mats.player, mats.ground, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mats.player, mats.rig, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mats.player, mats.item, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mats.rig, mats.ground, { friction: 0.35, restitution: 0.02 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mats.item, mats.ground, { friction: 0.7, restitution: 0.05 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mats.item, mats.rig, { friction: 0.6, restitution: 0.05 }));
  return { world, mats };
}

/** Static box collider helper. */
export function staticBox(world, mat, [w, h, d], [x, y, z], yaw = 0, group = G.GROUND) {
  const body = new CANNON.Body({ mass: 0, material: mat, collisionFilterGroup: group });
  body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
  body.position.set(x, y, z);
  if (yaw) body.quaternion.setFromEuler(0, yaw, 0);
  world.addBody(body);
  return body;
}

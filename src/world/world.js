// Builds the static world: terrain, road, water, sky and scenery.
import { THREE } from '../lib.js';
import { Road } from './road.js';
import { Terrain } from './terrain.js';
import { createRoadMesh } from './roadmesh.js';
import { createSky, createLights, createSea, createCreekMaterial, HORIZON } from './env.js';

export class World {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    const t0 = performance.now();
    this.road = new Road();
    this.terrain = new Terrain(this.road);
    this.buildMs = performance.now() - t0;

    scene.background = HORIZON.clone();
    scene.fog = new THREE.Fog(HORIZON.clone(), 160, 900);
    this.sky = createSky();
    scene.add(this.sky);
    this.lights = createLights(scene);

    this.terrainMesh = this.terrain.createMeshes();
    scene.add(this.terrainMesh);
    this.terrainBody = this.terrain.createBody(physics.mats.ground);
    physics.world.addBody(this.terrainBody);

    const f = this.terrain.features;
    const r = this.road;
    this.roadMesh = createRoadMesh(r, (i) => Math.abs(i - f.bridge.i) <= 13 || Math.abs(i - f.washout.i) * r.ds < 3.6);
    scene.add(this.roadMesh);

    this.sea = createSea(this.terrain);
    scene.add(this.sea);
    this.creek = this.terrain.createCreekMesh(createCreekMaterial());
    scene.add(this.creek);
  }

  update(dt, time, focus) {
    this.sea.material.uniforms.uTime.value = time;
    this.sky.position.copy(focus);
  }

  heightAt(x, z) {
    return this.terrain.heightAt(x, z);
  }
}

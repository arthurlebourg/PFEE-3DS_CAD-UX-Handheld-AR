import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

document.body.appendChild(ARButton.createButton(renderer));

const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
const material = new THREE.MeshNormalMaterial();
const cube = new THREE.Mesh(geometry, material);
cube.position.set(0, 1.5, -2);
scene.add(cube);

renderer.setAnimationLoop(() =>
{
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;

  renderer.render(scene, camera);
});

window.addEventListener('resize', () =>
{
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

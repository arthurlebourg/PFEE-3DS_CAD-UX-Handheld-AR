import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { UIManager } from './ui.js';

const params = new URLSearchParams(window.location.search);
const DEV_TOKEN = import.meta.env.VITE_DEV_TOKEN as string;
export const isDevMode = DEV_TOKEN?.length > 0 && params.get('dev') === DEV_TOKEN;

if (isDevMode) {
  const clean = new URL(window.location.href);
  clean.searchParams.delete('dev');
  window.history.replaceState({}, '', clean);
  console.info('[DEV MODE]');
}

export function setupDevMode(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  uiManager: UIManager
): () => void {
  scene.add(new THREE.AxesHelper(1));
  scene.add(new THREE.GridHelper(10, 10));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.5, -2);
  controls.update();

  // No XR session fires 'sessionstart' in dev mode, so surface the in-app UI
  // (model picker, debug/perf toggles) directly. Selection mode is the useful
  // default here since placement relies on AR hit-testing.
  uiManager.toggleVisibility(true);
  uiManager.forcePlacementMode(false);

  const hud = document.createElement('div');
  hud.style.cssText = `
    position: fixed; top: 12px; left: 12px;
    background: rgba(0,0,0,0.6); color: #0f0;
    font: 12px monospace; padding: 8px 12px;
    border-radius: 4px; pointer-events: none; z-index: 999;
  `;
  hud.textContent = '⚙ DEV MODE';
  document.body.appendChild(hud);
  addFovControl(camera);
    return () => controls.update();
}   
  
function addFovControl(camera: THREE.PerspectiveCamera) {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; bottom: 20px; left: 12px;
    background: rgba(0,0,0,0.6); color: #0f0;
    font: 12px monospace; padding: 8px 12px;
    border-radius: 4px; z-index: 999;
  `;

  const label = document.createElement('div');
  label.textContent = `FOV: ${camera.fov}°`;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '10';
  slider.max = '120';
  slider.value = String(camera.fov);
  slider.style.width = '150px';

  slider.addEventListener('input', () => {
    camera.fov = Number(slider.value);
    camera.updateProjectionMatrix();
    label.textContent = `FOV: ${camera.fov}°`;
  });

  container.appendChild(label);
  container.appendChild(slider);
  document.body.appendChild(container);
}

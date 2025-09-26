import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ----- renderer -----
const canvas = document.querySelector('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

// ----- scene -----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202533);

// ----- camera -----
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.1, 5);
camera.lookAt(0, 0.6, 0);
scene.add(camera);

// OrbitControls 
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.6, 0);

// ----- lights -----
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(2.5, 6, 3.5);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 30;
scene.add(dir);

// ----- suelo -----
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x1a1e27, metalness: 0, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
floor.receiveShadow = true;
scene.add(floor);

// ----- cube -----
const box = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x66aaff, metalness: 0.2, roughness: 0.7 })
);
box.position.set(0, 0.9, 0);
box.castShadow = true;
scene.add(box);

// Textura dinámica en el cubo (video)
let usingGif = false;

const video = document.createElement('video');
video.src = 'assets/diffuse.mp4';
video.muted = true;
video.loop = true;
video.playsInline = true;
video.preload = 'auto';
video.addEventListener('canplay', () => {
  const vidTex = new THREE.VideoTexture(video);
  vidTex.wrapS = vidTex.wrapT = THREE.RepeatWrapping;
  vidTex.anisotropy = 8;
  box.material = new THREE.MeshStandardMaterial({ map: vidTex, metalness: 0.1, roughness: 0.8 });
  video.play().catch(()=>{});
});

const gifImg = new Image();
gifImg.src = 'assets/diffuse.gif';
gifImg.crossOrigin = 'anonymous';
const off = document.createElement('canvas');
const ctx = off.getContext('2d', { willReadFrequently: true });
gifImg.onload = () => {
  if (box.material.map && box.material.map.isVideoTexture) return;
  off.width = gifImg.width; off.height = gifImg.height;
  const gifTex = new THREE.CanvasTexture(off);
  gifTex.anisotropy = 8;
  gifTex.wrapS = gifTex.wrapT = THREE.RepeatWrapping;
  box.material = new THREE.MeshStandardMaterial({ map: gifTex, metalness: 0.1, roughness: 0.8 });
  box.userData.gif = { tex: gifTex };
  usingGif = true;
};

// ===== STL: dragón (estático) =====
let stlMesh = null;
let dragonBaseHalfHeight = 0; 
let currentObject = box;

const STL_RELEASE_URL = 'https://github.com/KevinCorona09/multimedia-tps/releases/download/assets-td2/model.stl';
const STL_LOCAL_URL = 'assets/model_simplified.stl';

const stlLoader = new STLLoader();

function setupDragon(geometry) {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  geometry.center();

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const size = new THREE.Vector3().subVectors(bb.max, bb.min);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  const targetSize = 3.0;
  const baseScale = targetSize / maxDim;
  geometry.scale(baseScale, baseScale, baseScale);

  geometry.computeBoundingBox();
  const size2 = new THREE.Vector3().subVectors(geometry.boundingBox.max, geometry.boundingBox.min);
  const height = size2.y;
  dragonBaseHalfHeight = height / 2;

  stlMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 0.15, roughness: 0.6 })
  );
  stlMesh.position.set(0, dragonBaseHalfHeight, 0);
  stlMesh.castShadow = true;
  stlMesh.visible = false;
  scene.add(stlMesh);
}

// 1º intento: Release (funciona en GitHub Pages)
stlLoader.load(
  STL_LOCAL_URL,
  (geom) => setupDragon(geom),  
  undefined,
  (err) => console.error('Error cargando STL:', err)
);


// ===== Lluvia (partículas) + toggle =====
const rainCount = 800;
const pos = new Float32Array(rainCount * 3);
for (let i=0; i<rainCount; i++) {
  pos[3*i]   = (Math.random()-0.5)*30;
  pos[3*i+1] = Math.random()*20 + 4;
  pos[3*i+2] = (Math.random()-0.5)*30;
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
const rainMat = new THREE.PointsMaterial({ size: 0.05, color: 0x99ccff });
const rain = new THREE.Points(rainGeo, rainMat);
let rainEnabled = true;
scene.add(rain);

document.getElementById('toggleRain').addEventListener('click', (e) => {
  rainEnabled = !rainEnabled;
  rain.visible = rainEnabled;
  e.currentTarget.textContent = `Pluie: ${rainEnabled ? 'ON' : 'OFF'}`;
});

// ===== Botones: cubo - dragón =====
document.getElementById('showCube').addEventListener('click', () => {
  if (stlMesh) stlMesh.visible = false;
  box.visible = true;
  currentObject = box;
  controls.target.set(0, 0.9, 0);
});

document.getElementById('showModel').addEventListener('click', () => {
  box.visible = false;
  if (stlMesh) {
    stlMesh.visible = true;
    currentObject = stlMesh;
    controls.target.set(0, dragonBaseHalfHeight, 0);
  }
});

// ===== Slider: escala del dragón  =====
const dragonScale = document.getElementById('dragonScale');
const dragonScaleVal = document.getElementById('dragonScaleVal');
dragonScale.addEventListener('input', () => {
  const s = parseFloat(dragonScale.value);
  dragonScaleVal.textContent = `${s.toFixed(1)}×`;
  if (stlMesh) {
    stlMesh.scale.set(s, s, s);
    stlMesh.position.y = dragonBaseHalfHeight * s; 
    if (currentObject === stlMesh) {
      controls.target.set(0, stlMesh.position.y, 0);
    }
  }
});

// ===== Sensores del smartphone (toggle ON/OFF, no desaparece) =====
let alpha = 0, beta = 0, gamma = 0;
let sensorsEnabled = false;
let orientationHandler = null;

const sensorBtn = document.getElementById('enableSensors');
const enableSensors = async () => {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { await DeviceOrientationEvent.requestPermission(); } catch (e) {}
  }
  orientationHandler = (e) => {
    alpha = e.alpha ?? 0;
    beta  = e.beta  ?? 0;
    gamma = e.gamma ?? 0;
  };
  window.addEventListener('deviceorientation', orientationHandler);
  sensorsEnabled = true;
  sensorBtn.textContent = 'Capteurs: ON';
};
const disableSensors = () => {
  if (orientationHandler) {
    window.removeEventListener('deviceorientation', orientationHandler);
    orientationHandler = null;
  }
  sensorsEnabled = false;
  alpha = beta = gamma = 0;
  sensorBtn.textContent = 'Capteurs: OFF';
};

sensorBtn.textContent = 'Capteurs: OFF';
sensorBtn.addEventListener('click', async () => {
  if (!sensorsEnabled) {
    await enableSensors();
  } else {
    disableSensors();
  }
});

// ===== resize =====
addEventListener('resize', () => {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// ===== animation loop =====
let spin = { x: 0, y: 0, z: 0 };

renderer.setAnimationLoop((t) => {
  if (usingGif && gifImg.complete && gifImg.naturalWidth > 0 && box.userData.gif) {
    ctx.clearRect(0, 0, off.width, off.height);
    ctx.drawImage(gifImg, 0, 0, off.width, off.height);
    box.userData.gif.tex.needsUpdate = true;
  }

  // Cubo: giro propio + tilt opcional de sensores
  if (currentObject === box) {
    spin.x += 0.010;
    spin.y += 0.020;
    spin.z += 0.007;

    const tiltX = sensorsEnabled ? THREE.MathUtils.degToRad(beta)  * 0.30 : 0;
    const tiltY = sensorsEnabled ? THREE.MathUtils.degToRad(alpha) * 0.30 : 0;
    const tiltZ = sensorsEnabled ? THREE.MathUtils.degToRad(gamma) * 0.30 : 0;

    box.rotation.set(spin.x + tiltX, spin.y + tiltY, spin.z + tiltZ);
  }

  // Lluvia
  if (rainEnabled) {
    const positions = rain.geometry.attributes.position.array;
    for (let i=1; i<positions.length; i+=3) {
      positions[i] -= 0.12;
      if (positions[i] < 0) positions[i] = 22;
    }
    rain.geometry.attributes.position.needsUpdate = true;
  }

  controls.update();
  renderer.render(scene, camera);
});

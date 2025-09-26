import * as THREE from 'three';

// ----- renderer -----
const canvas = document.querySelector('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

// ----- scene -----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202533);

// ----- camera (centrando el cubo en la vista) -----
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0.6, 3.2);
camera.lookAt(0, 0.4, 0);
scene.add(camera);

// ----- lights -----
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(2.5, 5, 3);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 20;
scene.add(dir);

// ----- cube -----
const box = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x66aaff, metalness: 0.2, roughness: 0.7 })
);
box.position.set(0, 0.5, 0);
box.castShadow = true;
scene.add(box);

// suelo para sombras
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 12),
  new THREE.MeshStandardMaterial({ color: 0x1a1e27, metalness: 0, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.55;
floor.receiveShadow = true;
scene.add(floor);

// ===== GIF animado como textura =====
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
  const mat = new THREE.MeshStandardMaterial({
    map: vidTex,
    metalness: 0.1,
    roughness: 0.8
  });
  box.material = mat;
  video.play().catch(()=>{});
});

const gifImg = new Image();
gifImg.src = 'assets/diffuse.gif';
gifImg.crossOrigin = 'anonymous';

const off = document.createElement('canvas');
const ctx = off.getContext('2d', { willReadFrequently: true });

gifImg.onload = () => {
  if (box.material.map && box.material.map.isVideoTexture) return;
  off.width = gifImg.width;
  off.height = gifImg.height;
  const gifTex = new THREE.CanvasTexture(off);
  gifTex.anisotropy = 8;
  gifTex.wrapS = gifTex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({
    map: gifTex,
    metalness: 0.1,
    roughness: 0.8
  });
  box.material = mat;
  box.userData.gif = { tex: gifTex };
  usingGif = true;
};

// ----- resize -----
addEventListener('resize', () => {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// ----- animation loop -----
renderer.setAnimationLoop((t) => {
  if (usingGif && gifImg.complete && gifImg.naturalWidth > 0) {
    ctx.clearRect(0, 0, off.width, off.height);
    ctx.drawImage(gifImg, 0, 0, off.width, off.height);
    box.userData.gif.tex.needsUpdate = true;
  }

  box.rotation.x = 0.6 + Math.sin(t * 0.001) * 0.05;
  box.rotation.y = t * 0.0016;
  box.rotation.z = t * 0.0008;

  renderer.render(scene, camera);
});

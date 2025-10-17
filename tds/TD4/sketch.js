
let faceMesh;
let video;
let faces = [];
let isReady = false;

// Opciones de detección
let options = {
  maxFaces: 1,
  refineLandmarks: false,
  flipHorizontal: false  // NO flipear en el modelo, lo haremos manualmente
};

// Controles
let isDetecting = false;
let showKeypoints = false;
let enableDeformation = true;
let lightIntensity = 200;
let rotationAngle = 0;

// Elementos de UI
let statusEl, errorEl;

// ==================== SETUP ====================
function preload() {
  // Cargar el modelo antes de setup
  faceMesh = ml5.faceMesh(options);
}

function setup() {
  // Crear canvas dentro del contenedor
  const container = document.getElementById('canvas-container');
  const w = Math.min(720, container.clientWidth || windowWidth);
  const h = Math.round(w * 0.75); // Ratio 4:3
  
  const canvas = createCanvas(w, h, WEBGL);
  canvas.parent('canvas-container');
  
  pixelDensity(1);
  frameRate(30);
  
  // Referencias a elementos
  statusEl = select('#status');
  errorEl = select('#error-msg');
  
  // Iniciar cámara
  video = createCapture(VIDEO, videoReady);
  video.size(w, h);
  video.hide(); // Ocultamos el elemento HTML del video
  
  // Crear controles
  createControls();
}

function videoReady() {
  console.log('Video listo:', video.width, 'x', video.height);
  isReady = true;
  statusEl.removeClass('fail warn').addClass('ok').html('✓ Cámara lista');
}

// ==================== DRAW ====================
function draw() {
  background(0);
  
  // Si el video no está listo, salir
  if (!video || !isReady) {
    fill(255);
    textAlign(CENTER, CENTER);
    text('Esperando cámara...', 0, 0);
    return;
  }
  
  // ===== PASO 1: DIBUJAR VIDEO COMO FONDO =====
  push();
  translate(-width/2, -height/2, 0); // Esquina superior izquierda
  
  // Espejo horizontal del video
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height);
  pop();
  
  pop();
  
  // ===== PASO 2: DIBUJAR MALLA 3D ENCIMA =====
  if (isDetecting && faces.length > 0) {
    // Habilitar control orbital
    orbitControl(2, 2, 0.1);
    
    // Configurar iluminación
    setupLighting();
    
    // Dibujar la malla
    push();
    scale(1, -1, 1); // Invertir Y para coordenadas correctas
    drawFaceMesh();
    pop();
    
    statusEl.removeClass('warn fail').addClass('ok').html('✓ Rostro detectado');
  } else if (isDetecting) {
    statusEl.removeClass('ok fail').addClass('warn').html('⚠ Buscando rostro...');
  } else {
    statusEl.removeClass('ok warn').addClass('fail').html('✖ Detección pausada');
  }
  
  // Rotar la luz
  rotationAngle += 0.01;
}

// ==================== ILUMINACIÓN ====================
function setupLighting() {
  ambientLight(lightIntensity * 0.4);
  
  // Luz direccional rotativa
  const lx = cos(rotationAngle) * 0.7;
  const ly = -0.5;
  const lz = sin(rotationAngle) * 0.7;
  
  directionalLight(lightIntensity, lightIntensity, lightIntensity, lx, ly, lz);
}

// ==================== DIBUJAR MALLA ====================
function drawFaceMesh() {
  const face = faces[0];
  if (!face || !face.keypoints) return;
  
  const keypoints = face.keypoints;
  
  // Convertir puntos a coordenadas centradas
  const points = keypoints.map(kp => {
    // Espejo horizontal para que coincida con el video
    const x = -(kp.x - video.width / 2);
    const y = kp.y - video.height / 2;
    const z = (kp.z || 0) * -150; // Profundidad amplificada
    return { x, y, z };
  });
  
  // Detectar expresiones
  const mouthOpen = detectMouthOpen(points);
  const isBlink = detectBlink(points);
  
  // Deformación por boca abierta
  const deformStrength = enableDeformation ? constrain(map(mouthOpen, 0.05, 0.3, 0, 1), 0, 1) : 0;
  
  // Color del material según expresión
  noStroke();
  if (isBlink) {
    emissiveMaterial(80, 80, 100); // Azulado al parpadear
  } else if (deformStrength > 0.1) {
    ambientMaterial(200, 150 - 50 * deformStrength, 150 - 50 * deformStrength);
  } else {
    ambientMaterial(180, 180, 180);
  }
  
  // Dibujar triángulos
  beginShape(TRIANGLES);
  for (let i = 0; i < TRIANGULATION.length; i += 3) {
    const p0 = applyDeformation(points[TRIANGULATION[i]], points, deformStrength);
    const p1 = applyDeformation(points[TRIANGULATION[i + 1]], points, deformStrength);
    const p2 = applyDeformation(points[TRIANGULATION[i + 2]], points, deformStrength);
    
    vertex(p0.x, p0.y, p0.z);
    vertex(p1.x, p1.y, p1.z);
    vertex(p2.x, p2.y, p2.z);
  }
  endShape();
  
  // Dibujar keypoints si está activado
  if (showKeypoints) {
    stroke(0, 255, 255);
    strokeWeight(4);
    noFill();
    for (const p of points) {
      point(p.x, p.y, p.z);
    }
  }
}

// ==================== DEFORMACIÓN ====================
function applyDeformation(p, points, strength) {
  if (strength < 0.01) return p;
  
  // Centro de la boca (promedio de puntos labiales superiores e inferiores)
  const mouthCenter = {
    x: (points[13].x + points[14].x) / 2,
    y: (points[13].y + points[14].y) / 2,
    z: (points[13].z + points[14].z) / 2
  };
  
  const dx = p.x - mouthCenter.x;
  const dy = p.y - mouthCenter.y;
  const dz = p.z - mouthCenter.z;
  const distSq = dx * dx + dy * dy + dz * dz;
  
  // Radio de influencia
  const radiusSq = 80 * 80;
  
  if (distSq > radiusSq) return p;
  
  // Factor de deformación basado en distancia
  const factor = (1 - distSq / radiusSq) * strength;
  
  return {
    x: p.x,
    y: p.y + 12 * factor,
    z: p.z - 18 * factor
  };
}

// ==================== DETECCIÓN DE EXPRESIONES ====================
function detectMouthOpen(points) {
  if (!points[13] || !points[14] || !points[61] || !points[291]) return 0;
  
  const upperLip = points[13];
  const lowerLip = points[14];
  const leftMouth = points[61];
  const rightMouth = points[291];
  
  const mouthHeight = dist(upperLip.x, upperLip.y, lowerLip.x, lowerLip.y);
  const mouthWidth = dist(leftMouth.x, leftMouth.y, rightMouth.x, rightMouth.y);
  
  return mouthHeight / (mouthWidth || 1);
}

function detectBlink(points) {
  // Puntos de los ojos
  const leftEyePoints = [159, 145, 33, 133];
  const rightEyePoints = [386, 374, 362, 263];
  
  // Verificar que existen
  for (const i of [...leftEyePoints, ...rightEyePoints]) {
    if (!points[i]) return false;
  }
  
  // Ratio de apertura del ojo
  const leftRatio = dist3D(points[159], points[145]) / dist3D(points[33], points[133]);
  const rightRatio = dist3D(points[386], points[374]) / dist3D(points[362], points[263]);
  
  return leftRatio < 0.05 && rightRatio < 0.05;
}

function dist3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ==================== CALLBACK DE DETECCIÓN ====================
function gotFaces(results) {
  faces = results || [];
}

// ==================== CONTROLES ====================
function createControls() {
  const container = select('#controls');
  
  // Botón de inicio/pausa
  const btnStart = createButton('▶️ Iniciar Detección');
  btnStart.parent(container);
  btnStart.mousePressed(() => {
    if (!isDetecting) {
      faceMesh.detectStart(video, gotFaces);
      isDetecting = true;
      btnStart.html('⏸️ Pausar Detección');
      statusEl.removeClass('fail warn').addClass('ok').html('✓ Detectando...');
    } else {
      faceMesh.detectStop();
      isDetecting = false;
      btnStart.html('▶️ Iniciar Detección');
      faces = [];
      statusEl.removeClass('ok warn').addClass('fail').html('✖ Detección pausada');
    }
  });
  
  // Control de luz
  const lightBox = createDiv('').addClass('control').parent(container);
  createElement('label', 'Luz: ').parent(lightBox);
  const lightSlider = createSlider(50, 255, lightIntensity, 5);
  lightSlider.parent(lightBox);
  lightSlider.input(() => {
    lightIntensity = lightSlider.value();
  });
  
  // Checkbox deformación
  const deformBox = createDiv('').addClass('control').parent(container);
  const chkDeform = createCheckbox(' Deformación', enableDeformation);
  chkDeform.parent(deformBox);
  chkDeform.changed(() => {
    enableDeformation = chkDeform.checked();
  });
  
  // Checkbox keypoints
  const keypointsBox = createDiv('').addClass('control').parent(container);
  const chkKeypoints = createCheckbox(' Mostrar puntos', showKeypoints);
  chkKeypoints.parent(keypointsBox);
  chkKeypoints.changed(() => {
    showKeypoints = chkKeypoints.checked();
  });
}

// ==================== RESIZE ====================
function windowResized() {
  const container = document.getElementById('canvas-container');
  const w = Math.min(720, container.clientWidth || windowWidth);
  const h = Math.round(w * 0.75);
  resizeCanvas(w, h);
  if (video) video.size(w, h);
}

// ==================== TRIANGULACIÓN ====================
const TRIANGULATION = [
  127,34,139,11,0,37,232,231,120,72,37,39,128,121,47,232,121,128,104,69,67,
  175,171,148,157,154,155,118,50,101,73,39,40,9,151,108,48,115,131,194,204,211,
  74,40,185,80,42,183,40,92,186,230,229,118,202,212,214,83,18,17,76,61,146,
  160,29,30,56,157,173,106,204,194,135,214,192,203,165,98,21,71,68,51,45,4,
  5,4,275,440,275,4,363,343,412,386,258,387,258,445,387,265,353,342,387,259,386,
  260,386,259,257,386,260,249,390,373,463,341,464,453,357,465,289,251,375,308,324,318,
  291,375,251,285,417,335,405,314,313,17,16,8,264,356,454,356,264,19,236,353,265,
  454,356,461,359,255,339,254,448,261,370,345,372,423,358,327,327,358,326,320,321,405,
  280,267,311,309,438,291,305,290,392,290,305,460,300,276,383,292,308,324,290,460,328,
  376,433,435,250,290,328,385,258,259,257,259,258,386,257,385,443,444,282,285,336,417,
  406,418,419,426,436,423,429,420,421,360,363,440,437,399,456,420,437,456,363,360,279,
  278,279,360,333,332,297,175,152,377,365,397,367,440,437,438,297,338,337,335,273,321,
  348,330,329,293,298,333,252,272,271,322,320,406,271,311,268,313,314,17,287,291,423,
  406,422,322,374,386,380,285,295,336,265,372,353
];
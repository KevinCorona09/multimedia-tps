/* 
  FaceMesh ml5 - Doble panel
  - Izquierda: Cámara frontal + malla 468 con eventos (boca/parpadeo)
  - Derecha: Imagen estática (drag&drop / file picker / URL arrastrada) -> malla 2D
*/

/* ------------------- Colores y umbrales ------------------- */
const COLOR_MESH_BASE = [0, 255, 200];      // turquesa (cámara)
const COLOR_MESH_MOUTH_OPEN = [255, 90, 90];// rojo/rosa
const COLOR_EYES = [80, 160, 255];          // azul
const COLOR_MOUTH = [255, 120, 180];        // rosado
const COLOR_MOUTH_OPEN_FILL = [255, 215, 0];// dorado cuando boca abierta (cámara)
const COLOR_NOSE = [160, 255, 120];         // verde suave
const COLOR_MESH_2D = [180, 220, 255];      // malla base para imagen

// Umbrales cámara (ajustables):
const MOUTH_OPEN_THRESHOLD = 0.050;  // apertura/anchura cara
const EYE_CLOSED_THRESHOLD = 0.180;  // cierre (apertura/anchura)
const EYE_OPEN_THRESHOLD   = 0.220;  // histéresis

/* ------------------- Utilidades numéricas ------------------- */
const dist2 = (x1,y1,x2,y2) => Math.hypot(x2-x1, y2-y1);

/* ============================================================ */
/* ================    PANEL IZQUIERDO: CÁMARA    ============= */
/* ============================================================ */

let p5Cam;                 // instancia p5
let camVideo;              // captura (p5)
let facemeshStream;        // modelo para vídeo
let camPredictions = [];
let modelReadyCam = false;
let camStatusEl = null;

// Estado visual dinámico
let meshColor = COLOR_MESH_BASE;
let blinkEffectUntil = 0;
const BLINK_EFFECT_MS = 260;
let lastBlinkClosed = false;

function cameraSketch(p) {
  let canvasW = 640, canvasH = 480;

  p.setup = function(){
    camStatusEl = document.getElementById('cam-status');
    const container = document.getElementById('cam-container');

    const cnv = p.createCanvas(canvasW, canvasH);
    cnv.parent(container);
    p.pixelDensity(1);

    // Cámara frontal
    const constraints = {
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: canvasW },
        height:{ ideal: canvasH }
      }
    };

    camVideo = p.createCapture(constraints, () => {
      const vw = camVideo.width || canvasW;
      const vh = camVideo.height || canvasH;
      p.resizeCanvas(vw, vh);
    });
    camVideo.size(canvasW, canvasH);
    camVideo.elt.setAttribute('playsinline','');
    camVideo.hide();

    // Cargar FaceMesh para stream
    facemeshStream = ml5.facemesh(camVideo.elt, () => {
      modelReadyCam = true;
      updateCamStatus('Modelo listo. Detectando...');
    });

    facemeshStream.on('predict', (results) => {
      camPredictions = results || [];
    });
  };

  p.draw = function(){
    p.background(0);

    // Selfie mirror
    p.push();
    p.translate(p.width, 0);
    p.scale(-1, 1);

    // vídeo
    p.image(camVideo, 0, 0, p.width, p.height);

    if (!modelReadyCam) {
      p.pop(); drawChipOverCanvas(p, 'Cargando modelo...'); return;
    }

    if (!camPredictions || camPredictions.length === 0) {
      p.pop(); drawChipOverCanvas(p, 'Acerca tu rostro a la cámara...'); return;
    }

    const face = camPredictions[0];
    const pts = face.scaledMesh;
    const ann = face.annotations || {};

    // escala base (anchura de la cara)
    const faceWidth = (() => {
      let minX = Infinity, maxX = -Infinity;
      for (const pt of pts){ if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0]; }
      return Math.max(1, maxX - minX);
    })();

    // --- Eventos: boca abierta / parpadeo
    const mouthOpenRatio = computeMouthOpenRatioP5(p, ann, faceWidth);
    const mouthOpen = mouthOpenRatio > MOUTH_OPEN_THRESHOLD;
    meshColor = mouthOpen ? COLOR_MESH_MOUTH_OPEN : COLOR_MESH_BASE;

    const leftEyeRatio  = computeEyeOpenRatioP5(p, ann, 'leftEyeUpper1', 'leftEyeLower1');
    const rightEyeRatio = computeEyeOpenRatioP5(p, ann, 'rightEyeUpper1','rightEyeLower1');
    const eyesClosed = (leftEyeRatio < EYE_CLOSED_THRESHOLD && rightEyeRatio < EYE_CLOSED_THRESHOLD);
    const eyesOpen   = (leftEyeRatio > EYE_OPEN_THRESHOLD   && rightEyeRatio > EYE_OPEN_THRESHOLD);
    if (eyesClosed && !lastBlinkClosed) blinkEffectUntil = p.millis() + BLINK_EFFECT_MS;
    if (eyesOpen) lastBlinkClosed = false;
    else if (eyesClosed) lastBlinkClosed = true;

    // --- Dibujo de malla (triangulación completa)
    const now = p.millis();
    const blinkActive = now < blinkEffectUntil;
    let strokeMesh = meshColor;
    if (blinkActive) {
      const phase = (now % 400) / 400;
      strokeMesh = [
        mapSin(phase, 0), mapSin(phase, 2.1), mapSin(phase, 4.2)
      ];
    }

    if (typeof TRIANGULATION !== 'undefined' && Array.isArray(TRIANGULATION)) {
      p.stroke(strokeMesh[0], strokeMesh[1], strokeMesh[2], 190);
      p.strokeWeight(1);
      p.noFill();
      for (let i=0; i<TRIANGULATION.length; i+=3){
        const a = pts[TRIANGULATION[i]];
        const b = pts[TRIANGULATION[i+1]];
        const c = pts[TRIANGULATION[i+2]];
        p.line(a[0],a[1], b[0],b[1]);
        p.line(b[0],b[1], c[0],c[1]);
        p.line(c[0],c[1], a[0],a[1]);
      }
    } else {
      p.stroke(strokeMesh[0], strokeMesh[1], strokeMesh[2], 210);
      p.strokeWeight(2);
      for (const pt of pts) p.point(pt[0], pt[1]);
    }

    // Regiones: OJOS
    drawClosedRegionP5(p, ann.leftEyeUpper0, ann.leftEyeLower0, COLOR_EYES, 50);
    drawClosedRegionP5(p, ann.rightEyeUpper0,ann.rightEyeLower0,COLOR_EYES, 50);

    // BOCA
    const mouthFill = (mouthOpen ? COLOR_MOUTH_OPEN_FILL : COLOR_MOUTH);
    drawClosedRegionP5(p, ann.lipsUpperOuter, ann.lipsLowerOuter, mouthFill, mouthOpen ? 70 : 40);

    // NARIZ
    drawPolylineP5(p, ann.noseBridge, COLOR_NOSE, 3);
    drawPolylineP5(p, ann.noseBottom, COLOR_NOSE, 3);
    if (ann.noseTip && ann.noseTip[0]) {
      p.noStroke(); p.fill(COLOR_NOSE[0], COLOR_NOSE[1], COLOR_NOSE[2], 220);
      p.circle(ann.noseTip[0][0], ann.noseTip[0][1], 6);
    }

    p.pop();

    updateCamStatus(mouthOpen ? 'Boca abierta: ¡malla activa!' : 'Rostro detectado');
  };

  // Helpers P5 de cámara
  function mapSin(phase, shift){
    const v = Math.sin(phase * Math.PI * 2 + shift);
    return (v + 1) * 0.5 * (255-60) + 60; // 60..255
  }

  function drawChipOverCanvas(p, msg){
    p.push();
    p.noStroke(); p.fill(0,0,0,120);
    const padX=12, padY=8;
    p.textSize(14);
    const w = p.textWidth(msg) + padX*2;
    p.rect(16,16,w,36,10);
    p.fill(255);
    p.text(msg, 16+padX, 16+padY+12);
    p.pop();
  }

  function drawPolylineP5(p, points, colorArr=[255,255,255], weight=2){
    if (!points || !points.length) return;
    p.noFill();
    p.stroke(colorArr[0], colorArr[1], colorArr[2], 210);
    p.strokeWeight(weight);
    p.beginShape();
    for (const pt of points) p.vertex(pt[0], pt[1]);
    p.endShape();
    p.strokeWeight(1);
  }

  function drawClosedRegionP5(p, upper, lower, colorArr=[255,255,255], fillAlpha=40){
    if (!upper || !lower || !upper.length || !lower.length) return;
    p.stroke(colorArr[0], colorArr[1], colorArr[2], 210);
    p.fill(colorArr[0], colorArr[1], colorArr[2], fillAlpha);
    p.strokeWeight(2);
    p.beginShape();
    for (const pt of upper) p.vertex(pt[0], pt[1]);
    for (let i=lower.length-1; i>=0; i--) {
      const pt = lower[i]; p.vertex(pt[0], pt[1]);
    }
    p.endShape(p.CLOSE);
    p.strokeWeight(1);
  }

  function computeMouthOpenRatioP5(p, ann, faceWidth){
    if (!ann.lipsUpperInner || !ann.lipsLowerInner) return 0;
    const upper = ann.lipsUpperInner, lower = ann.lipsLowerInner;
    const len = Math.min(upper.length, lower.length) || 0;
    if (!len) return 0;
    let sum = 0;
    for (let i=0; i<len; i++) sum += p.dist(upper[i][0], upper[i][1], lower[i][0], lower[i][1]);
    return (sum/len) / Math.max(1, faceWidth);
  }

  function computeEyeOpenRatioP5(p, ann, upperKey, lowerKey){
    const upper = ann[upperKey], lower = ann[lowerKey];
    if (!upper || !lower) return 1;
    const len = Math.min(upper.length, lower.length) || 0;
    if (!len) return 1;

    let sum = 0;
    for (let i=0; i<len; i++) sum += p.dist(upper[i][0], upper[i][1], lower[i][0], lower[i][1]);
    const avgV = sum / len;

    const cloud = upper.concat(lower);
    let minX = Infinity, maxX = -Infinity;
    for (const pt of cloud) { if (pt[0]<minX) minX=pt[0]; if (pt[0]>maxX) maxX=pt[0]; }
    const eyeWidth = Math.max(1, maxX - minX);
    return avgV / eyeWidth;
  }

  function updateCamStatus(text){
    if (camStatusEl) camStatusEl.textContent = text;
  }
}

// Inicializa el sketch de cámara
p5Cam = new p5(cameraSketch);

/* ============================================================ */
/* ===============    PANEL DERECHO: IMAGEN 2D    ============= */
/* ============================================================ */

let facemeshImage = null;     // modelo para imagen
let imageModelReady = false;
let imgCanvas = null, imgCtx = null;
let dropzone = null, fileInput = null, pickBtn = null, imgStatusEl = null;
let imgWrap = null;

let currentImg = null;        // HTMLImageElement actual
let imgPred = null;           // predicción para imagen
let imgScale = { sx: 1, sy: 1 }; // escala de dibujo (imagen -> canvas)

document.addEventListener('DOMContentLoaded', () => {
  imgCanvas = document.getElementById('img-canvas');
  imgCtx = imgCanvas.getContext('2d');
  dropzone = document.getElementById('dropzone');
  fileInput = document.getElementById('file-input');
  pickBtn = document.getElementById('pick-btn');
  imgStatusEl = document.getElementById('img-status');
  imgWrap = document.getElementById('img-wrap');

  // Carga FaceMesh para imágenes (modo estático)
  const options = {
    maxContinuousChecks: 5,
    detectionConfidence: 0.9,
    maxFaces: 1,
    refineLandmarks: false,
    flipHorizontal: false
  };

  facemeshImage = ml5.facemesh(options, () => {
    imageModelReady = true;
    console.log('Modelo de imagen listo');
    setImgStatus('Modelo listo. Arrastra o sube una foto.');
  });

  // Listeners de arrastre - soporta archivos y URLs
  dropzone.addEventListener('dragenter', handleDragEnter);
  dropzone.addEventListener('dragover', handleDragOver);
  dropzone.addEventListener('dragleave', handleDragLeave);
  dropzone.addEventListener('drop', handleDrop);

  imgWrap.addEventListener('dragenter', handleDragEnter);
  imgWrap.addEventListener('dragover', handleDragOver);
  imgWrap.addEventListener('dragleave', handleDragLeave);
  imgWrap.addEventListener('drop', handleDrop);

  imgCanvas.addEventListener('dragenter', handleDragEnter);
  imgCanvas.addEventListener('dragover', handleDragOver);
  imgCanvas.addEventListener('dragleave', handleDragLeave);
  imgCanvas.addEventListener('drop', handleDrop);

  // Botón y file input
  pickBtn.addEventListener('click', ()=> {
    console.log('Click en botón elegir imagen');
    fileInput.click();
  });
  
  fileInput.addEventListener('change', (e)=>{
    console.log('File input change', e.target.files);
    const file = e.target.files && e.target.files[0];
    if (file) {
      console.log('Archivo seleccionado:', file.name, file.type);
      handleFile(file);
    }
    fileInput.value = '';
  });

  // Tamaño inicial y onresize
  resizeImageCanvasToWrap();
  window.addEventListener('resize', () => {
    const prev = currentImg ? { w: currentImg.naturalWidth, h: currentImg.naturalHeight } : null;
    resizeImageCanvasToWrap(prev);
    if (currentImg && imgPred) drawImageAndMesh();
  });
});

/* ------------------- Handlers de arrastre ------------------- */
function handleDragEnter(e) {
  e.preventDefault();
  e.stopPropagation();
  dropzone.classList.remove('hidden');
  dropzone.classList.add('dragover');
}

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'copy';
  dropzone.classList.add('dragover');
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.target === dropzone) {
    dropzone.classList.remove('dragover');
  }
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  console.log('Drop detectado');
  dropzone.classList.remove('dragover');
  
  const dt = e.dataTransfer;
  
  if (dt.files && dt.files.length) {
    console.log('Archivos detectados:', dt.files.length);
    const file = [...dt.files].find(f => f.type.startsWith('image/'));
    if (file) {
      console.log('Imagen encontrada:', file.name);
      handleFile(file);
      return;
    }
  }
  
  const url = dt.getData('text/uri-list') || dt.getData('text/plain');
  console.log('URL detectada:', url);
  if (url && /^https?:\/\//i.test(url)) {
    handleUrl(url.trim());
    return;
  }
  
  setImgStatus('No se encontró una imagen válida en el arrastre.');
}

/* ------------------- Manejo de archivos/URL ------------------- */

async function handleFile(file){
  console.log('handleFile llamado con:', file);
  if (!file.type.startsWith('image/')) { 
    setImgStatus('El archivo no es una imagen.'); 
    return; 
  }
  setImgStatus('Cargando imagen...');

  const reader = new FileReader();
  reader.onload = () => {
    console.log('FileReader onload');
    const img = new Image();
    img.onload = () => {
      console.log('Imagen cargada:', img.width, 'x', img.height);
      processLoadedImage(img);
    };
    img.onerror = () => {
      console.error('Error al cargar la imagen');
      setImgStatus('No se pudo cargar la imagen.');
    };
    img.src = reader.result;
  };
  reader.onerror = () => {
    console.error('Error en FileReader');
    setImgStatus('Error al leer el archivo.');
  };
  reader.readAsDataURL(file);
}

function handleUrl(url){
  console.log('handleUrl llamado con:', url);
  setImgStatus('Cargando imagen desde URL...');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    console.log('Imagen URL cargada:', img.width, 'x', img.height);
    processLoadedImage(img);
  };
  img.onerror = () => {
    console.error('Error al cargar URL');
    setImgStatus('No se pudo cargar la URL de la imagen.');
  };
  img.src = url;
}

async function processLoadedImage(img){
  console.log('processLoadedImage iniciado');
  currentImg = img;
  
  resizeImageCanvasToWrap({ w: img.naturalWidth, h: img.naturalHeight });
  dropzone.classList.add('hidden');
  setImgStatus('Detectando rostro...');

  if (!imageModelReady) {
    console.log('Esperando modelo...');
    await waitForImageModel();
  }

  try {
    console.log('Llamando a predictImage...');
    const results = await predictImage(img);
    console.log('Resultados de predicción:', results);
    
    imgPred = (results && results[0]) ? results[0] : null;
    
    if (!imgPred) {
      setImgStatus('No se detectó rostro. Prueba otra foto (frontal, bien iluminada).');
      clearCanvas(imgCtx);
      imgCtx.drawImage(img, 0, 0, imgCanvas.width, imgCanvas.height);
      setTimeout(()=> dropzone.classList.remove('hidden'), 500);
      return;
    }
    
    console.log('Rostro detectado, dibujando malla...');
    setImgStatus('¡Rostro detectado!');
    drawImageAndMesh();
  } catch (err){
    console.error('Error en processLoadedImage:', err);
    setImgStatus('Ocurrió un error con el modelo.');
    setTimeout(()=> dropzone.classList.remove('hidden'), 500);
  }
}

function waitForImageModel(){
  return new Promise(resolve=>{
    const chk = () => {
      if (imageModelReady) {
        resolve();
      } else {
        setTimeout(chk, 100);
      }
    };
    chk();
  });
}

function predictImage(imgEl){
  return new Promise((resolve, reject) => {
    try {
      console.log('Iniciando predicción en imagen...');
      facemeshImage.predict(imgEl, (results) => {
        console.log('Predicción completada');
        resolve(results);
      });
    } catch (e) { 
      console.error('Error en predict:', e);
      reject(e); 
    }
  });
}

/* ------------------- Dibujo: Imagen + Malla 2D ------------------- */

function drawImageAndMesh(){
  if (!currentImg || !imgPred) return;

  clearCanvas(imgCtx);
  imgCtx.drawImage(currentImg, 0, 0, imgCanvas.width, imgCanvas.height);

  const face = imgPred;
  const pts = face.scaledMesh;
  const ann = face.annotations || {};

  if (typeof TRIANGULATION !== 'undefined' && Array.isArray(TRIANGULATION)) {
    imgCtx.lineWidth = 1;
    imgCtx.strokeStyle = rgba(COLOR_MESH_2D, 0.85);
    for (let i=0; i<TRIANGULATION.length; i+=3){
      const a = scalePt(pts[TRIANGULATION[i]]);
      const b = scalePt(pts[TRIANGULATION[i+1]]);
      const c = scalePt(pts[TRIANGULATION[i+2]]);
      line2D(imgCtx, a, b);
      line2D(imgCtx, b, c);
      line2D(imgCtx, c, a);
    }
  } else {
    imgCtx.fillStyle = rgba(COLOR_MESH_2D, 0.9);
    for (const p of pts) {
      const s = scalePt(p);
      imgCtx.fillRect(s[0], s[1], 2, 2);
    }
  }

  drawClosedRegion2D(imgCtx, ann.leftEyeUpper0, ann.leftEyeLower0, COLOR_EYES, 0.22);
  drawClosedRegion2D(imgCtx, ann.rightEyeUpper0, ann.rightEyeLower0, COLOR_EYES, 0.22);

  drawClosedRegion2D(imgCtx, ann.lipsUpperOuter, ann.lipsLowerOuter, COLOR_MOUTH, 0.18);

  drawPolyline2D(imgCtx, ann.noseBridge, COLOR_NOSE, 3);
  drawPolyline2D(imgCtx, ann.noseBottom, COLOR_NOSE, 3);
  if (ann.noseTip && ann.noseTip[0]) {
    const tip = scalePt(ann.noseTip[0]);
    imgCtx.fillStyle = rgba(COLOR_NOSE, 0.95);
    circle2D(imgCtx, tip[0], tip[1], 3);
  }
}

/* ------------------- Helpers Canvas 2D ------------------- */

function rgba([r,g,b], alpha=1){ return `rgba(${r},${g},${b},${alpha})`; }

function line2D(ctx, a, b){
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}

function circle2D(ctx, x, y, r){
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
}

function drawPolyline2D(ctx, points, colorArr=[255,255,255], weight=2){
  if (!points || !points.length) return;
  ctx.lineWidth = weight;
  ctx.strokeStyle = rgba(colorArr, 0.9);
  ctx.beginPath();
  const p0 = scalePt(points[0]); ctx.moveTo(p0[0], p0[1]);
  for (let i=1; i<points.length; i++){
    const p = scalePt(points[i]); ctx.lineTo(p[0], p[1]);
  }
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawClosedRegion2D(ctx, upper, lower, colorArr=[255,255,255], fillAlpha=0.2){
  if (!upper || !lower || !upper.length || !lower.length) return;
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(colorArr, 0.9);
  ctx.fillStyle = rgba(colorArr, fillAlpha);
  ctx.beginPath();
  let p = scalePt(upper[0]); ctx.moveTo(p[0], p[1]);
  for (let i=1; i<upper.length; i++){
    p = scalePt(upper[i]); ctx.lineTo(p[0], p[1]);
  }
  for (let i=lower.length-1; i>=0; i--){
    p = scalePt(lower[i]); ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1;
}

/* ------------------- Redimensionado y estado ------------------- */

function resizeImageCanvasToWrap(imgSize){
  const wrap = document.getElementById('img-wrap');
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(320, wrap.clientWidth);
  let cssH = Math.round(cssW * 3/4);

  if (imgSize && imgSize.w && imgSize.h){
    cssH = Math.round(cssW * (imgSize.h / imgSize.w));
  }

  imgCanvas.width  = Math.floor(cssW * dpr);
  imgCanvas.height = Math.floor(cssH * dpr);
  imgCanvas.style.width  = cssW + 'px';
  imgCanvas.style.height = cssH + 'px';

  const sx = imgCanvas.width  / (imgSize?.w || imgCanvas.width);
  const sy = imgCanvas.height / (imgSize?.h || imgCanvas.height);
  imgScale = { sx, sy };
}

function scalePt(pt){
  return [ pt[0] * imgScale.sx, pt[1] * imgScale.sy ];
}

function clearCanvas(ctx){
  ctx.clearRect(0, 0, imgCanvas.width, imgCanvas.height);
}

function setImgStatus(text){
  if (imgStatusEl) imgStatusEl.textContent = text;
  if (!currentImg) dropzone.classList.remove('hidden');
}
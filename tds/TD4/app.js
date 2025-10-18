/* ============================================================
   FaceMesh ml5 — Multi-visages : Caméra + Image
   - Caméra : overlay 2D + viewer 3D (WEBGL) pour N visages
   - Image  : drag&drop / file + maillage 2D multi-visages
   ============================================================ */

/* ---------- Couleurs ---------- */
const COLOR_MESH_2D = [180, 220, 255];
const COLOR_EYES    = [ 80, 160, 255];
const COLOR_MOUTH   = [255, 120, 180];
const COLOR_NOSE    = [160, 255, 120];

const COLOR_MESH_BASE       = [  0, 255, 200];
const COLOR_MESH_MOUTH_OPEN = [255,  90,  90];
const COLOR_MOUTH_OPEN_FILL = [255, 215,   0];

/* ---------- Seuils (caméra) ---------- */
const MOUTH_OPEN_THRESHOLD = 0.050;
const EYE_CLOSED_THRESHOLD = 0.180;
const EYE_OPEN_THRESHOLD   = 0.220;

/* Utils */
const rgba  = ([r,g,b], a=1) => `rgba(${r},${g},${b},${a})`;
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

/* ============================================================
   CAMÉRA : p5 2D overlay
   ============================================================ */
let p5Cam, p5Cam3D;
let camVideo, facemeshStream;
let camPredictions = [];      // ARRAY de visages
let modelReadyCam = false;
let camStatusEl = null;

let blinkEffectUntil = 0;
const BLINK_EFFECT_MS = 260;

function cameraSketch(p){
  let canvasW = 640, canvasH = 480;

  p.setup = function(){
    camStatusEl = document.getElementById('cam-status');
    const container = document.getElementById('cam-container');

    const cnv = p.createCanvas(canvasW, canvasH);
    cnv.parent(container);
    p.pixelDensity(1);

    const constraints = {
      audio:false,
      video:{ facingMode:'user', width:{ideal:canvasW}, height:{ideal:canvasH} }
    };

    camVideo = p.createCapture(constraints, () => {
      const vw = camVideo.width || canvasW;
      const vh = camVideo.height || canvasH;
      p.resizeCanvas(vw, vh);
    });
    camVideo.size(canvasW, canvasH);
    camVideo.elt.setAttribute('playsinline','');
    camVideo.hide();

    // FaceMesh multi-visages
    facemeshStream = ml5.facemesh(camVideo.elt, () => {
      modelReadyCam = true;
      updateCamStatus('Modèle prêt — détection en cours…');
      try { facemeshStream.model.setOptions({ maxFaces: 5, refineLandmarks: true }); } catch(e){}
    });
    try { facemeshStream.model.setOptions({ maxFaces: 5 }); } catch(e){}

    facemeshStream.on('predict', results => { camPredictions = results || []; });
  };

  p.draw = function(){
    p.background(0);
    p.push(); p.translate(p.width,0); p.scale(-1,1);
    p.image(camVideo, 0, 0, p.width, p.height);

    if (!modelReadyCam){
      p.pop(); chip(p,'Chargement du modèle…'); return;
    }
    if (!camPredictions.length){
      p.pop(); chip(p,'Aucun visage. Placez-vous face à la caméra.'); return;
    }

    const now = p.millis();
    let anyBlinkNow = false;

    for (let idx=0; idx<camPredictions.length; idx++){
      const face = camPredictions[idx];
      const pts  = face.scaledMesh;
      const ann  = face.annotations || {};

      // Largeur du visage (normalisation)
      const faceW = (() => {
        let minX=Infinity,maxX=-Infinity;
        for (const pt of pts){ if (pt[0]<minX) minX=pt[0]; if (pt[0]>maxX) maxX=pt[0]; }
        return Math.max(1, maxX-minX);
      })();

      // Évènements par visage
      const mouthOpenRatio = computeMouthOpenRatioP5(p, ann, faceW);
      const mouthOpen = mouthOpenRatio > MOUTH_OPEN_THRESHOLD;

      const leftR  = computeEyeOpenRatioP5(p, ann, 'leftEyeUpper1',  'leftEyeLower1');
      const rightR = computeEyeOpenRatioP5(p, ann, 'rightEyeUpper1', 'rightEyeLower1');
      const blink  = (leftR < EYE_CLOSED_THRESHOLD && rightR < EYE_CLOSED_THRESHOLD);
      anyBlinkNow = anyBlinkNow || blink;

      // Couleur du maillage pour ce visage
      let strokeMesh = mouthOpen ? COLOR_MESH_MOUTH_OPEN : COLOR_MESH_BASE;

      // Effet clignement global (sin glow)
      if (now < blinkEffectUntil){
        const phase = (now % 400) / 400;
        strokeMesh = [ mapSin(phase,0), mapSin(phase,2.1), mapSin(phase,4.2) ];
      }

      // ---------- Maillage triangulé (2D) ----------
      if (typeof TRIANGULATION !== 'undefined' && Array.isArray(TRIANGULATION)){
        p.stroke(strokeMesh[0], strokeMesh[1], strokeMesh[2], 190);
        p.strokeWeight(1); p.noFill();
        for (let i=0;i<TRIANGULATION.length;i+=3){
          const a=pts[TRIANGULATION[i]],
                b=pts[TRIANGULATION[i+1]],
                c=pts[TRIANGULATION[i+2]];
          p.line(a[0],a[1], b[0],b[1]); 
          p.line(b[0],b[1], c[0],c[1]); 
          p.line(c[0],c[1], a[0],a[1]);
        }
      } else {
        p.stroke(strokeMesh[0], strokeMesh[1], strokeMesh[2], 210);
        p.strokeWeight(2);
        for (const pt of pts) p.point(pt[0], pt[1]);
      }

      // ---------- Zonas ----------
      drawClosedRegionP5(p, ann.leftEyeUpper0,  ann.leftEyeLower0,  COLOR_EYES, 50);
      drawClosedRegionP5(p, ann.rightEyeUpper0, ann.rightEyeLower0, COLOR_EYES, 50);
      const mouthFill = (mouthOpen ? COLOR_MOUTH_OPEN_FILL : COLOR_MOUTH);
      drawClosedRegionP5(p, ann.lipsUpperOuter, ann.lipsLowerOuter, mouthFill, mouthOpen ? 70 : 40);
      drawPolylineP5(p, ann.noseBridge, COLOR_NOSE, 3);
      drawPolylineP5(p, ann.noseBottom, COLOR_NOSE, 3);
      if (ann.noseTip && ann.noseTip[0]){
        p.noStroke(); p.fill(COLOR_NOSE[0],COLOR_NOSE[1],COLOR_NOSE[2],220);
        p.circle(ann.noseTip[0][0], ann.noseTip[0][1], 6);
      }
    }

    if (anyBlinkNow) blinkEffectUntil = now + BLINK_EFFECT_MS;

    p.pop();
    updateCamStatus(`${camPredictions.length} visage(s) détecté(s)`);
  };

  /* helpers */
  function chip(p,msg){ p.push(); p.noStroke(); p.fill(0,0,0,120); const padX=12,padY=8; p.textSize(14); const w=p.textWidth(msg)+padX*2; p.rect(16,16,w,36,10); p.fill(255); p.text(msg, 16+padX, 16+padY+12); p.pop(); }
  function mapSin(phase,shift){ const v=Math.sin(phase*Math.PI*2+shift); return (v+1)*0.5*(255-60)+60; }
  function drawPolylineP5(p, pts, color=[255,255,255], w=2){ if(!pts?.length) return; p.noFill(); p.stroke(color[0],color[1],color[2],210); p.strokeWeight(w); p.beginShape(); for (const t of pts) p.vertex(t[0],t[1]); p.endShape(); p.strokeWeight(1); }
  function drawClosedRegionP5(p, up, low, color=[255,255,255], a=40){ if(!up?.length||!low?.length) return; p.stroke(color[0],color[1],color[2],210); p.fill(color[0],color[1],color[2],a); p.strokeWeight(2); p.beginShape(); for(const t of up) p.vertex(t[0],t[1]); for(let i=low.length-1;i>=0;i--){ const t=low[i]; p.vertex(t[0],t[1]); } p.endShape(p.CLOSE); p.strokeWeight(1); }
  function computeMouthOpenRatioP5(p, ann, faceW){ if(!ann.lipsUpperInner||!ann.lipsLowerInner) return 0; const up=ann.lipsUpperInner, low=ann.lipsLowerInner; const len=Math.min(up.length,low.length)||0; if(!len) return 0; let sum=0; for(let i=0;i<len;i++) sum+=p.dist(up[i][0],up[i][1], low[i][0],low[i][1]); return (sum/len)/Math.max(1,faceW); }
  function computeEyeOpenRatioP5(p, ann, kU, kL){ const up=ann[kU], low=ann[kL]; if(!up||!low) return 1; const len=Math.min(up.length,low.length)||0; if(!len) return 1; let sum=0; for(let i=0;i<len;i++) sum+=p.dist(up[i][0],up[i][1], low[i][0],low[i][1]); const avg=sum/len; const cloud=up.concat(low); let minX=Infinity,maxX=-Infinity; for(const pt of cloud){ if(pt[0]<minX)minX=pt[0]; if(pt[0]>maxX)maxX=pt[0]; } const w=Math.max(1, maxX-minX); return avg/w; }
  function updateCamStatus(t){ if (camStatusEl) camStatusEl.textContent=t; }
}
p5Cam = new p5(cameraSketch);

/* ============================================================
   VIEWER 3D WEBGL (multi-visages)
   ============================================================ */
function cameraSketch3D(p){
  p.setup = function(){
    const container = document.getElementById('cam-3d-container');
    const cnv = p.createCanvas(520, 360, p.WEBGL);
    cnv.parent(container);
    p.pixelDensity(1);
  };
  p.draw = function(){
    p.background(8,12,24);
    p.orbitControl(2, 1, 0.2);
    p.rotateY(p.frameCount * 0.005);
    p.ambientLight(180);
    p.directionalLight(255,255,255, 0.4, 0.2, -1);

    if (!camPredictions.length){
      p.resetMatrix(); p.translate(-p.width/2+16, -p.height/2+22, 0);
      p.noStroke(); p.fill(255); p.textSize(14); p.text('En attente de points…', 0, 0);
      return;
    }

    for (let i=0;i<camPredictions.length;i++){
      const face = camPredictions[i];
      if (!face?.scaledMesh) continue;
      const geom = normalizePoints(face.scaledMesh);
      const col = faceColor(i);
      p.noFill(); p.stroke(col[0], col[1], col[2], 210); p.strokeWeight(0.9);

      if (typeof TRIANGULATION !== 'undefined' && Array.isArray(TRIANGULATION)){
        p.beginShape(p.LINES);
        for (let t=0; t<TRIANGULATION.length; t+=3){
          const ia=TRIANGULATION[t], ib=TRIANGULATION[t+1], ic=TRIANGULATION[t+2];
          const a=geom[ia], b=geom[ib], c=geom[ic];
          p.vertex(a[0], -a[1], a[2]); p.vertex(b[0], -b[1], b[2]);
          p.vertex(b[0], -b[1], b[2]); p.vertex(c[0], -c[1], c[2]);
          p.vertex(c[0], -c[1], c[2]); p.vertex(a[0], -a[1], a[2]);
        }
        p.endShape();
      } else {
        p.strokeWeight(3);
        p.beginShape(p.POINTS);
        for (const v of geom) p.vertex(v[0], -v[1], v[2]);
        p.endShape();
      }
    }

    function normalizePoints(points){
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
      for (const [x,y,z] of points){ if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y; if (z<minZ)minZ=z; if (z>maxZ)maxZ=z; }
      const cx=(minX+maxX)/2, cy=(minY+maxY)/2, cz=(minZ+maxZ)/2;
      const sx=(maxX-minX)||1, sy=(maxY-minY)||1;
      const s = 280 / Math.max(sx, sy);
      return points.map(([x,y,z]) => [(x-cx)*s, (y-cy)*s, (z-cz)*s]);
    }
    function faceColor(i){
      const h = (i*70) % 360, s=70, l=65;
      const a = s * Math.min(l,100-l) / 10000;
      const f = n => { const k=(n+h/30)%12; const c=l/100 - a*Math.max(Math.min(k-3,9-k,1),-1); return Math.round(255*c); };
      return [f(0),f(8),f(4)];
    }
  };
}
p5Cam3D = new p5(cameraSketch3D);

/* ============================================================
   IMAGE : multi-visages + recharger/effacer
   ============================================================ */
let facemeshImage=null, imageModelReady=false;
let imgCanvas=null, imgCtx=null, dropzone=null, fileInput=null, imgStatusEl=null, imgWrap=null;
let toolbar=null, btnNew=null, btnClear=null;

let currentImg=null, imgPreds=[], imgScale={sx:1, sy:1};

document.addEventListener('DOMContentLoaded', () => {
  imgCanvas  = document.getElementById('img-canvas');
  imgCtx     = imgCanvas.getContext('2d');
  dropzone   = document.getElementById('dropzone');
  fileInput  = document.getElementById('file-input');
  imgStatusEl= document.getElementById('img-status');
  imgWrap    = document.getElementById('img-wrap');
  toolbar    = document.getElementById('img-toolbar');
  btnNew     = document.getElementById('btn-new');
  btnClear   = document.getElementById('btn-clear');

  // Modèle FaceMesh pour images (multi-visages)
  facemeshImage = ml5.facemesh(
    { maxContinuousChecks:5, detectionConfidence:0.9, maxFaces:5, refineLandmarks:true, flipHorizontal:false },
    () => { imageModelReady=true; setImgStatus('Modèle prêt. Glissez ou importez une photo.'); }
  );

  // DnD
  for (const el of [dropzone, imgWrap, imgCanvas]){
    el.addEventListener('dragenter', onDragEnter);
    el.addEventListener('dragover',  onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop',      onDrop);
  }

  // Fichier
  fileInput.addEventListener('change', (e)=>{ const f=e.target.files&&e.target.files[0]; if(f) handleFile(f); fileInput.value=''; });
  // Toolbar
  btnNew.addEventListener('click', ()=> fileInput.click());
  btnClear.addEventListener('click', clearImagePanel);

  resizeImageCanvasToWrap();
  window.addEventListener('resize', () => {
    const prev = currentImg ? { w: currentImg.naturalWidth, h: currentImg.naturalHeight } : null;
    resizeImageCanvasToWrap(prev);
    if (currentImg && imgPreds.length===0) renderImageOnly();
    if (currentImg && imgPreds.length)     drawImageAndMesh();
  });
});

/* ---- Drag & drop ---- */
function onDragEnter(e){ e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('hidden'); dropzone.classList.add('dragover'); }
function onDragOver(e){  e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect='copy'; dropzone.classList.add('dragover'); }
function onDragLeave(e){ e.preventDefault(); e.stopPropagation(); if (e.target===dropzone) dropzone.classList.remove('dragover'); }
function onDrop(e){
  e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('dragover');
  const dt=e.dataTransfer;
  if (dt.files?.length){ const f=[...dt.files].find(x=>x.type.startsWith('image/')); if (f){ handleFile(f); return; } }
  const url = dt.getData('text/uri-list') || dt.getData('text/plain');
  if (url && /^https?:\/\//i.test(url)) { handleUrl(url.trim()); return; }
  setImgStatus('Aucune image valide détectée.');
}

/* ---- Chargement d'image ---- */
function handleFile(file){
  if (!file.type.startsWith('image/')){ setImgStatus("Le fichier n'est pas une image."); return; }
  setImgStatus('Chargement de la photo…');
  const img=new Image(); img.decoding='async';
  const blobUrl=URL.createObjectURL(file);
  img.onload=()=>{ URL.revokeObjectURL(blobUrl); processLoadedImage(img); };
  img.onerror=()=>{ URL.revokeObjectURL(blobUrl); setImgStatus("Impossible de charger l'image."); };
  img.src=blobUrl;
}
function handleUrl(url){
  setImgStatus("Chargement de l'URL…");
  const img=new Image(); img.crossOrigin='anonymous'; img.decoding='async';
  img.onload=()=>processLoadedImage(img);
  img.onerror=()=>setImgStatus("Impossible de charger l'URL de l'image.");
  img.src=url;
}
async function processLoadedImage(img){
  currentImg = img;
  imgPreds   = [];
  resizeImageCanvasToWrap({ w: img.naturalWidth, h: img.naturalHeight });
  renderImageOnly();
  dropzone.classList.add('hidden');
  toolbar.hidden = false;
  setImgStatus('Détection des visages…');

  if (!imageModelReady) await waitForModelImage();
  try{
    const results = await predictImage(img);
    imgPreds = Array.isArray(results) ? results : [];
    if (!imgPreds.length){
      setImgStatus('Aucun visage détecté. Essayez une photo frontale bien éclairée.');
      return;
    }
    drawImageAndMesh();
    setImgStatus(`${imgPreds.length} visage(s) détecté(s)`);
  } catch {
    setImgStatus('Erreur lors de la détection.');
  }
}
function waitForModelImage(){ return new Promise(res=>{ const t=()=> imageModelReady?res():setTimeout(t,100); t(); }); }
function predictImage(imgEl){ return new Promise((resolve,reject)=>{ try{ facemeshImage.predict(imgEl, r=>resolve(r)); }catch(e){ reject(e); } }); }
function clearImagePanel(){
  currentImg=null; imgPreds=[]; toolbar.hidden=true;
  clearCanvas(); dropzone.classList.remove('hidden');
  setImgStatus('Glissez une photo ou choisissez un fichier.');
}

/* ---- Dessin 2D multi-visages ---- */
function renderImageOnly(){
  if (!currentImg) return;
  clearCanvas();
  imgCtx.drawImage(currentImg, 0, 0, imgCanvas.width, imgCanvas.height);
}
function drawImageAndMesh(){
  if (!currentImg || !imgPreds.length) return;
  renderImageOnly();

  for (let i=0;i<imgPreds.length;i++){
    const face = imgPreds[i];
    const pts  = face.scaledMesh;
    const ann  = face.annotations || {};

    const tint = faceTint(i);

    // Dibujar malla triangulada directamente
    if (typeof TRIANGULATION !== 'undefined' && Array.isArray(TRIANGULATION)){
      imgCtx.lineWidth = 1;
      imgCtx.strokeStyle = rgba(tint, 0.95);
      for (let t=0;t<TRIANGULATION.length;t+=3){
        const a=scalePt(pts[TRIANGULATION[t]]);
        const b=scalePt(pts[TRIANGULATION[t+1]]);
        const c=scalePt(pts[TRIANGULATION[t+2]]);
        line2D(a,b); line2D(b,c); line2D(c,a);
      }
    } else {
      imgCtx.fillStyle = rgba(tint, 0.9);
      for (const p of pts){ const s=scalePt(p); imgCtx.fillRect(s[0], s[1], 2, 2); }
    }

    // Regiones
    drawClosedRegion2D(ann.leftEyeUpper0,  ann.leftEyeLower0,  COLOR_EYES,  0.22);
    drawClosedRegion2D(ann.rightEyeUpper0, ann.rightEyeLower0, COLOR_EYES,  0.22);
    drawClosedRegion2D(ann.lipsUpperOuter, ann.lipsLowerOuter, COLOR_MOUTH, 0.18);

    drawPolyline2D(ann.noseBridge, COLOR_NOSE, 3);
    drawPolyline2D(ann.noseBottom, COLOR_NOSE, 3);
    if (ann.noseTip && ann.noseTip[0]){
      const tip = scalePt(ann.noseTip[0]);
      imgCtx.fillStyle = rgba(COLOR_NOSE, 0.95);
      circle2D(tip[0], tip[1], 3);
    }
  }
}
function faceTint(i){
  const base = COLOR_MESH_2D.slice();
  const delta = ((i*40)%80) - 40;
  base[0] = clamp(base[0] + delta, 60, 255);
  base[1] = clamp(base[1] + delta/2, 60, 255);
  return base;
}
function line2D(a,b){ imgCtx.beginPath(); imgCtx.moveTo(a[0],a[1]); imgCtx.lineTo(b[0],b[1]); imgCtx.stroke(); }
function circle2D(x,y,r){ imgCtx.beginPath(); imgCtx.arc(x, y, r, 0, Math.PI*2); imgCtx.fill(); }
function drawPolyline2D(points, color=[255,255,255], weight=2){
  if (!points?.length) return;
  imgCtx.lineWidth = weight; imgCtx.strokeStyle = rgba(color, 0.9);
  imgCtx.beginPath();
  const p0 = scalePt(points[0]); imgCtx.moveTo(p0[0], p0[1]);
  for (let i=1;i<points.length;i++){ const p = scalePt(points[i]); imgCtx.lineTo(p[0],p[1]); }
  imgCtx.stroke(); imgCtx.lineWidth = 1;
}
function drawClosedRegion2D(upper, lower, color=[255,255,255], fillAlpha=0.2){
  if (!upper?.length || !lower?.length) return;
  imgCtx.lineWidth = 2; imgCtx.strokeStyle = rgba(color, 0.9); imgCtx.fillStyle = rgba(color, fillAlpha);
  imgCtx.beginPath();
  let p = scalePt(upper[0]); imgCtx.moveTo(p[0], p[1]);
  for (let i=1;i<upper.length;i++){ p=scalePt(upper[i]); imgCtx.lineTo(p[0],p[1]); }
  for (let i=lower.length-1;i>=0;i--){ p=scalePt(lower[i]); imgCtx.lineTo(p[0],p[1]); }
  imgCtx.closePath(); imgCtx.fill(); imgCtx.stroke(); imgCtx.lineWidth = 1;
}

/* ---- Taille / échelle ---- */
function resizeImageCanvasToWrap(imgSize){
  const wrap = imgWrap; const dpr = window.devicePixelRatio || 1;
  const cssW = Math.min(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--maxCanvasW')) || 880, wrap.clientWidth || 640);
  let cssH = Math.round(cssW * 3/4);
  if (imgSize?.w && imgSize?.h) cssH = Math.round(cssW * (imgSize.h / imgSize.w));
  imgCanvas.width  = Math.floor(cssW * dpr);
  imgCanvas.height = Math.floor(cssH * dpr);
  imgCanvas.style.width  = cssW + 'px';
  imgCanvas.style.height = cssH + 'px';
  const sx = imgCanvas.width  / (imgSize?.w || imgCanvas.width);
  const sy = imgCanvas.height / (imgSize?.h || imgCanvas.height);
  imgScale = { sx, sy };
}
function scalePt(pt){ return [ pt[0]*imgScale.sx, pt[1]*imgScale.sy ]; }
function clearCanvas(){ imgCtx.clearRect(0,0,imgCanvas.width,imgCanvas.height); }
function setImgStatus(t){ if (imgStatusEl) imgStatusEl.textContent = t; if (!currentImg) dropzone.classList.remove('hidden'); }
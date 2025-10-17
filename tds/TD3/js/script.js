let scene, camera, renderer, earth, earthGroup, controls;
let userPosition = { lat: 0, lon: 0 };
let countries = [];
let directionalLight, nightLight; 
let lightAngle = 0;
let countryMarkers = [];

let isAutoLightRotation = true; 
let lightToggleBtn;
let isBillboardActive = true; 
let billboardToggleBtn;
let isSphericalGeometry = true;
let geometryToggleBtn;
let isEarthRotationActive = false;
let earthRotationToggleBtn;

let leafletMap;
let mapContainer;
let isMapExpanded = true;
let selectedCountry = null;
let raycaster, mouse;
let leafletCountryMarkers = [];
let leafletUserMarker = null;

let baseRotationY = 0;

let coordinateMapping = new Map();
let countryPositions = [];

const __tmpVecA = new THREE.Vector3();
const __tmpVecB = new THREE.Vector3();
const __tmpQuatA = new THREE.Quaternion();
const __tmpQuatB = new THREE.Quaternion();
const __up = new THREE.Vector3(0, 1, 0);

function init() {
    scene = new THREE.Scene();
    
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 3);
    
    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas3d'), antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000011);
    
    setupCameraControls();
    setupLights();
    setupLightControls(); 
    setupBillboardControls(); 
    setupGeometryControls();
    setupEarthRotationControls();
    setupRaycasting();
    setupLeafletMap();
    setupMapControls();
    createEarth();
    getUserLocation();
    fetchCountries();
    animate();
    
    window.addEventListener('resize', onWindowResize);
}

function setupRaycasting() {
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    raycaster.params.Points = { threshold: 0.1 };
    renderer.domElement.addEventListener('click', onThreeJSClick, false);
    console.log('Raycasting configurado para detección de clics en países');
}

function setupLeafletMap() {
    leafletMap = L.map('leafletMap', {
        center: [43.7102, 7.2620],
        zoom: 3,
        zoomControl: true,
        attributionControl: false,
        minZoom: 2,
        maxZoom: 10
    });
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        opacity: 0.7
    }).addTo(leafletMap);
    
    leafletMap.on('click', onLeafletClick);
    console.log('Mapa Leaflet configurado');
}

function setupMapControls() {
    mapContainer = document.getElementById('mapContainer');
    const mapToggle = document.getElementById('mapToggle');
    
    mapToggle.addEventListener('click', () => {
        toggleMapSize();
    });
    
    console.log('Controles del mapa configurados');
}

function setupEarthRotationControls() {
    earthRotationToggleBtn = document.getElementById('earthRotationToggle');
    
    if (!earthRotationToggleBtn) {
        console.error('Botón earthRotationToggle no encontrado');
        return;
    }
    
    earthRotationToggleBtn.addEventListener('click', () => {
        toggleEarthRotation();
    });
    
    updateEarthRotationButtonText();
    console.log('Controles de rotación de la Tierra configurados');
}

function toggleEarthRotation() {
    isEarthRotationActive = !isEarthRotationActive;
    updateEarthRotationButtonText();
    console.log(`Rotación automática de la Tierra: ${isEarthRotationActive ? 'Activada' : 'Desactivada'}`);
}

function updateEarthRotationButtonText() {
    if (isEarthRotationActive) {
        earthRotationToggleBtn.textContent = 'Rotation Auto Activée';
        earthRotationToggleBtn.className = 'control-btn rotation-active';
    } else {
        earthRotationToggleBtn.textContent = 'Rotation Auto Arrêtée';
        earthRotationToggleBtn.className = 'control-btn rotation-inactive';
    }
}

function degToRad(degrees) {
    return degrees * (Math.PI / 180);
}

function radToDeg(radians) {
    return radians * (180 / Math.PI);
}

function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
}

function shortestAngleDifference(from, to) {
    const diff = normalizeAngle(to - from);
    return diff;
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = degToRad(lat2 - lat1);
    const dLon = degToRad(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) * 
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function createCoordinateMapping() {
    coordinateMapping.clear();
    countryPositions = [];
    
    countries.forEach(country => {
        const lat = country.latlng[0];
        const lon = country.latlng[1];
        
        const position3D = latLonToCartesian(lat, lon, 1.12);
        
        const countryId = country.name.common;
        const mapping = {
            id: countryId,
            lat: lat,
            lon: lon,
            position3D: position3D,
            country: country
        };
        
        coordinateMapping.set(countryId, mapping);
        countryPositions.push(mapping);
    });
    
    console.log(`Mapeo de coordenadas creado para ${coordinateMapping.size} países`);
}

function findNearestCountryToCoordinate(targetLat, targetLon, maxDistance = 500) {
    let nearestCountry = null;
    let minDistance = Infinity;
    
    countryPositions.forEach(mapping => {
        const distance = calculateHaversineDistance(targetLat, targetLon, mapping.lat, mapping.lon);
        
        if (distance < minDistance && distance <= maxDistance) {
            minDistance = distance;
            nearestCountry = mapping;
        }
    });
    
    return {
        country: nearestCountry,
        distance: minDistance
    };
}

function calculatePrecisePositionForCoordinates(targetLat, targetLon) {
    const nearestResult = findNearestCountryToCoordinate(targetLat, targetLon);
    
    if (nearestResult.country && nearestResult.distance < 100) {
        console.log(`País cercano encontrado: ${nearestResult.country.country.name.common} a ${nearestResult.distance.toFixed(2)}km`);
        
        const weight = Math.max(0, 1 - (nearestResult.distance / 100));
        const interpolatedLat = targetLat + (nearestResult.country.lat - targetLat) * weight * 0.3;
        const interpolatedLon = targetLon + (nearestResult.country.lon - targetLon) * weight * 0.3;
        
        return {
            lat: interpolatedLat,
            lon: interpolatedLon,
            nearestCountry: nearestResult.country.country,
            distance: nearestResult.distance,
            useInterpolation: true
        };
    } else {
        return {
            lat: targetLat,
            lon: targetLon,
            nearestCountry: null,
            distance: nearestResult.distance,
            useInterpolation: false
        };
    }
}

function calculateExactCenterRotation(lat, lon) {
    const latRad = degToRad(lat);
    const lonRad = degToRad(lon);
    
    const targetRotationY = -lonRad;
    const targetRotationX = -latRad;  
    return {
        targetRotationX: targetRotationX,
        targetRotationY: targetRotationY
    };
}

function animateEarthToExactPosition(targetX, targetY, duration = 2500, callback = null) {
    const startRotationX = earthGroup.rotation.x;
    const startRotationY = earthGroup.rotation.y;
    
    const deltaY = shortestAngleDifference(startRotationY, targetY);
    const endRotationY = startRotationY + deltaY;
    
    const deltaX = targetX - startRotationX;
    
    const startTime = Date.now();
    
    console.log(`Animando rotación desde (${radToDeg(startRotationX).toFixed(1)}°, ${radToDeg(startRotationY).toFixed(1)}°) hacia (${radToDeg(targetX).toFixed(1)}°, ${radToDeg(targetRotationY).toFixed(1)}°)`);
    
    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const easeProgress = progress < 0.5 
            ? 4 * progress * progress * progress 
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        
        earthGroup.rotation.x = startRotationX + deltaX * easeProgress;
        earthGroup.rotation.y = startRotationY + deltaY * easeProgress;
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            earthGroup.rotation.x = targetX;
            earthGroup.rotation.y = targetY;
            if (callback) callback();
        }
    }
    animate();
}

/* ============================
   Centrados relativos a cámara (quaternions)
   ============================ */

// calcula la rotación que alinea (lat, lon) con la dirección centro->cámara
function getTargetQuaternionFacingCamera(lat, lon) {
    const p = latLonToCartesian(lat, lon, 1);
    const from = new THREE.Vector3(p.x, p.y, p.z).normalize();
    const to = camera.position.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(from, to);
    return q;
}

// animación suave hacia un quaternion objetivo
function animateEarthToQuaternion(targetQ, duration = 1500, callback = null) {
    const startQ = earthGroup.quaternion.clone();
    const endQ = targetQ.clone();
    const startTime = performance.now();

    function easeInOutCubic(t) {
        return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
    }

    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const k = easeInOutCubic(t);
        THREE.Quaternion.slerp(startQ, endQ, earthGroup.quaternion, k);
        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            earthGroup.quaternion.copy(endQ);
            if (callback) callback();
        }
    }
    requestAnimationFrame(step);
}

/* ============================
   SUSTITUIDO: centerGlobeOnCoordinates
   ============================ */

function centerGlobeOnCoordinates(lat, lon, animate = true, callback = null) {
    console.log(`\n=== CENTRANDO GLOBO EN COORDENADAS ===`);
    console.log(`Coordenadas objetivo: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    
    if (isEarthRotationActive) {
        isEarthRotationActive = false;
        updateEarthRotationButtonText();
        console.log('Rotación automática desactivada por clic en mapa');
    }
    
    const precisePosition = calculatePrecisePositionForCoordinates(lat, lon);
    const latTarget = precisePosition.lat;
    const lonTarget = precisePosition.lon;

    const targetQ = getTargetQuaternionFacingCamera(latTarget, lonTarget);

    if (!animate) {
        earthGroup.quaternion.copy(targetQ);
        baseRotationY = earthGroup.rotation.y;
        if (callback) callback();
        return;
    }

    animateEarthToQuaternion(targetQ, 1500, () => {
        baseRotationY = earthGroup.rotation.y;
        if (callback) callback();
    });
}

function centerGlobeOnCountry(country, animate = true, callback = null) {
    const lat = country.latlng[0];
    const lon = country.latlng[1];
    console.log(`\n=== CENTRANDO GLOBO EN PAÍS ===`);
    console.log(`País: ${country.name.common} (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
    centerGlobeOnCoordinates(lat, lon, animate, callback);
}

function onThreeJSClick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(countryMarkers, true);
    
    if (intersects.length > 0) {
        const clickedObject = intersects[0].object;
        if (clickedObject.userData && clickedObject.userData.country) {
            const country = clickedObject.userData.country;
            console.log(`\n=== PAÍS CLICKEADO EN 3D ===`);
            console.log(`País: ${country.name.common}`);
            centerLeafletOnCountry(country);
            updateSelectedCountryInfo(country);
            highlightCountryInLeaflet(country);
            // centerGlobeOnCountry(country, true);
        }
    }
}

function onLeafletClick(event) {
    const { lat, lng } = event.latlng;
    console.log(`\n=== CLIC EN MAPA 2D ===`);
    console.log(`Coordenadas: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    centerGlobeOnCoordinates(lat, lng, true);
}

function centerLeafletOnCountry(country) {
    const lat = country.latlng[0];
    const lon = country.latlng[1];
    leafletMap.setView([lat, lon], 6, {
        animate: true,
        duration: 1.0
    });
    highlightCountryInLeaflet(country);
    selectedCountry = country;
    console.log(`Mapa 2D centrado en: ${country.name.common} (${lat}, ${lon})`);
}

function highlightCountryInLeaflet(country) {
    leafletCountryMarkers.forEach(marker => {
        const element = marker.getElement();
        if (element) {
            element.style.background = 'rgba(100, 200, 255, 0.8)';
            element.style.transform = 'scale(1)';
            element.style.zIndex = '1000';
            element.style.boxShadow = 'none';
        }
    });
    
    const targetMarker = leafletCountryMarkers.find(marker => 
        marker.options.country && marker.options.country.name.common === country.name.common
    );
    
    if (targetMarker) {
        const element = targetMarker.getElement();
        if (element) {
            element.style.background = 'rgba(255, 100, 100, 0.9)';
            element.style.transform = 'scale(1.5)';
            element.style.zIndex = '2000';
            element.style.boxShadow = '0 4px 15px rgba(255, 100, 100, 0.6)';
        }
    }
}

function toggleMapSize() {
    if (isMapExpanded) {
        mapContainer.classList.add('minimized');
        isMapExpanded = false;
        document.getElementById('mapToggle').textContent = '🔍';
    } else {
        mapContainer.classList.remove('minimized');
        isMapExpanded = true;
        document.getElementById('mapToggle').textContent = '📐';
    }
    setTimeout(() => leafletMap.invalidateSize(), 400);
    console.log(`Mapa ${isMapExpanded ? 'expandido' : 'minimizado'}`);
}

function updateSelectedCountryInfo(country) {
    const infoElement = document.getElementById('selectedCountryName');
    infoElement.textContent = `${country.name.common}`;
    selectedCountry = country;
}

function createLeafletCountryMarkers() {
    leafletCountryMarkers.forEach(marker => {
        leafletMap.removeLayer(marker);
    });
    leafletCountryMarkers = [];
    
    countries.forEach(country => {
        const lat = country.latlng[0];
        const lon = country.latlng[1];
        
        const countryIcon = L.divIcon({
            className: 'country-marker',
            html: '🏴',
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });
        
        const marker = L.marker([lat, lon], {
            icon: countryIcon,
            country: country
        }).addTo(leafletMap);
        
        marker.bindPopup(`
            <div style="text-align: center; min-width: 150px;">
                <img src="${country.flags.png}" style="width: 80px; height: auto; margin-bottom: 8px; border-radius: 4px;"><br>
                <strong style="font-size: 14px;">${country.name.common}</strong><br>
                <small style="color: #ccc;">${lat.toFixed(4)}, ${lon.toFixed(4)}</small><br>
                <small style="color: #999;">Cliquez pour centrer la Terre 3D</small>
            </div>
        `);
        
        marker.on('click', () => {
            console.log(`\n=== PAÍS CLICKEADO EN MAPA 2D ===`);
            console.log(`País: ${country.name.common}`);
            centerGlobeOnCountry(country, true);
            updateSelectedCountryInfo(country);
        });
        
        leafletCountryMarkers.push(marker);
    });
    console.log(`${leafletCountryMarkers.length} marcadores de países creados en Leaflet`);
}

function createLeafletUserMarker() {
    if (leafletUserMarker) {
        leafletMap.removeLayer(leafletUserMarker);
    }
    const userIcon = L.divIcon({
        className: 'user-marker',
        html: '📍',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
    leafletUserMarker = L.marker([userPosition.lat, userPosition.lon], {
        icon: userIcon
    }).addTo(leafletMap);
    
    leafletUserMarker.bindPopup(`
        <div style="text-align: center;">
            <strong>Votre position</strong><br>
            <small>${userPosition.lat.toFixed(4)}, ${userPosition.lon.toFixed(4)}</small>
        </div>
    `);
    console.log('Marcador de usuario creado en Leaflet');
}

function setupCameraControls() {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 1.5;
    controls.maxDistance = 10;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 1.0;
    controls.panSpeed = 0.8;
}

function setupLightControls() {
    lightToggleBtn = document.getElementById('lightToggle');
    if (!lightToggleBtn) {
        console.error('Botón lightToggle no encontrado');
        return;
    }
    lightToggleBtn.addEventListener('click', () => {
        toggleLightMode();
    });
    updateLightButtonText();
    console.log('Controles de luz configurados');
}

function setupBillboardControls() {
    billboardToggleBtn = document.getElementById('billboardToggle');
    if (!billboardToggleBtn) {
        console.error('Botón billboardToggle no encontrado');
        return;
    }
    billboardToggleBtn.addEventListener('click', () => {
        toggleBillboardMode();
    });
    updateBillboardButtonText();
    console.log('Controles de billboard configurados');
}

function setupGeometryControls() {
    geometryToggleBtn = document.getElementById('geometryToggle');
    if (!geometryToggleBtn) {
        console.error('Botón geometryToggle no encontrado');
        return;
    }
    geometryToggleBtn.addEventListener('click', () => {
        toggleGeometryMode();
    });
    updateGeometryButtonText();
    console.log('Controles de geometría configurados');
}

function toggleLightMode() {
    isAutoLightRotation = !isAutoLightRotation;
    updateLightButtonText();
    console.log(`Modo de luz cambiado a: ${isAutoLightRotation ? 'Automático' : 'Seguir cámara'}`);
}

function toggleBillboardMode() {
    isBillboardActive = !isBillboardActive;
    updateBillboardButtonText();
    forceResetBillboardOrientation(); // 🆕 asegura orientación inmediata
    console.log(`Seguimiento de banderas: ${isBillboardActive ? 'Activado' : 'Desactivado'}`);
}

function toggleGeometryMode() {
    isSphericalGeometry = !isSphericalGeometry;
    updateGeometryButtonText();
    regenerateCountryMarkers();
    console.log(`Geometría cambiada a: ${isSphericalGeometry ? 'Esferas 3D' : 'Planos 2D'}`);
}

function updateLightButtonText() {
    if (isAutoLightRotation) {
        lightToggleBtn.textContent = 'Jour/Nuit Automatique';
        lightToggleBtn.className = 'control-btn active';
    } else {
        lightToggleBtn.textContent = 'Lumière depuis Caméra';
        lightToggleBtn.className = 'control-btn inactive';
    }
}

function updateBillboardButtonText() {
    if (isBillboardActive) {
        billboardToggleBtn.textContent = 'Suivi Drapeaux Activé';
        billboardToggleBtn.className = 'control-btn active';
    } else {
        billboardToggleBtn.textContent = 'Drapeaux Radiaux';
        billboardToggleBtn.className = 'control-btn inactive';
    }
}

function updateGeometryButtonText() {
    if (isSphericalGeometry) {
        geometryToggleBtn.textContent = 'Mode Sphères 3D';
        geometryToggleBtn.className = 'control-btn geometry-spheres';
    } else {
        geometryToggleBtn.textContent = 'Mode Planes 2D';
        geometryToggleBtn.className = 'control-btn geometry-planes';
    }
}

function getLocalLookAtQuaternion(obj, targetWorld, up = __up) {
    obj.getWorldPosition(__tmpVecA);
    const m = new THREE.Matrix4().lookAt(__tmpVecA, targetWorld, up);
    const qWorld = __tmpQuatA.setFromRotationMatrix(m);
    const parent = obj.parent || scene;
    parent.getWorldQuaternion(__tmpQuatB);
    __tmpQuatB.invert();        
    return __tmpQuatB.multiply(qWorld);
}

// Orienta el marcador hacia la cámara (con o sin interpolación)
function orientMarkerTowardsCamera(obj, immediate = false) {
    const qTarget = getLocalLookAtQuaternion(obj, camera.position);
    if (immediate) {
        obj.quaternion.copy(qTarget);
    } else {
        obj.quaternion.slerp(qTarget, 0.15);
    }
}

// Orienta el marcador radialmente (cara hacia fuera del globo)
function orientMarkerRadial(obj, immediate = false) {
    // Dirección radial: desde el centro (0,0,0) a la posición *en mundo*
    obj.getWorldPosition(__tmpVecA);
    __tmpVecB.copy(__tmpVecA).normalize().add(__tmpVecA); // punto un poco más afuera
    const qTarget = getLocalLookAtQuaternion(obj, __tmpVecB);
    if (immediate) {
        obj.quaternion.copy(qTarget);
    } else {
        obj.quaternion.slerp(qTarget, 0.08);
    }
}



function forceResetBillboardOrientation() {
    earthGroup.children.forEach(child => {
        if (child.userData && child.userData.isBillboard) {
            if (isBillboardActive) {
                orientMarkerTowardsCamera(child, true);
            } else {
                orientMarkerRadial(child, true);
            }
        }
    });
    console.log(`Orientación de banderas reseteada para modo: ${isBillboardActive ? 'Seguimiento' : 'Radial'}`);
}

function setupLights() {
    const ambientLight = new THREE.AmbientLight(0x111144, 0.4);
    scene.add(ambientLight);
    
    directionalLight = new THREE.DirectionalLight(0xffffcc, 1.0);
    directionalLight.position.set(2, 0.5, 1);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    
    nightLight = new THREE.DirectionalLight(0x4444ff, 0.25);
    nightLight.position.set(-2, -0.5, -1);
    scene.add(nightLight);
    
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(0, 2, 2);
    scene.add(fillLight);
}

function createEarth() {
    earthGroup = new THREE.Group();
    const earthGeometry = new THREE.SphereGeometry(1, 64, 32);
    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load(
        'assets/world-map-4k-natural-colors_resized.jpg',
        () => console.log('Textura de la Tierra cargada'),
        undefined,
        (error) => console.error('Error cargando textura de la Tierra:', error)
    );
    const earthMaterial = new THREE.MeshLambertMaterial({ map: earthTexture });
    earth = new THREE.Mesh(earthGeometry, earthMaterial);
    earthGroup.add(earth);
    scene.add(earthGroup);
}

function latLonToCartesian(lat, lon, radius = 1) {
    const phi = (90 - lat) * (Math.PI / 180); 
    const theta = (lon + 180) * (Math.PI / 180); 
    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = (radius * Math.sin(phi) * Math.sin(theta));
    const y = (radius * Math.cos(phi));
    return { x, y, z };
}

function getUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            position => {
                userPosition.lat = position.coords.latitude;
                userPosition.lon = position.coords.longitude;
                document.getElementById('position').textContent = 
                    `${userPosition.lat.toFixed(4)}, ${userPosition.lon.toFixed(4)}`;
                createUserMarker();
                createLeafletUserMarker();
                leafletMap.setView([userPosition.lat, userPosition.lon], 5);
            },
            error => {
                console.error('Error obteniendo geolocalización:', error);
                userPosition.lat = 43.7102;
                userPosition.lon = 7.2620;
                document.getElementById('position').textContent = 'Nice, France (Par défaut)';
                createUserMarker();
                createLeafletUserMarker();
            }
        );
    } else {
        userPosition.lat = 43.7102;
        userPosition.lon = 7.2620;
        document.getElementById('position').textContent = 'Nice, France (par défaut)';
        createUserMarker();
        createLeafletUserMarker();
    }
}

function createUserMarker() {
    const position = latLonToCartesian(userPosition.lat, userPosition.lon, 1.08);
    const markerGeometry = new THREE.SphereGeometry(0.04, 16, 16);
    const markerMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xff0000,
        transparent: true,
        opacity: 0.9,
        emissive: 0x440000
    });
    const userMarker = new THREE.Mesh(markerGeometry, markerMaterial);
    userMarker.position.set(position.x, position.y, position.z);
    userMarker.userData = { isUserMarker: true };
    earthGroup.add(userMarker);
    console.log('Marcador del usuario creado en:', position);
}

async function fetchCountries() {
    try {
        const response = await fetch('https://restcountries.com/v3.1/all?fields=name,latlng,flags,cca2,population');
        const countriesData = await response.json();
        
        countries = countriesData
            .filter(country => {
                return country.latlng && 
                       country.latlng.length === 2 && 
                       country.flags && 
                       (country.flags.png || country.flags.svg) &&
                       country.name &&
                       country.name.common;
            });
        
        console.log(`${countries.length} países encontrados (sin límites)`);
        createCountrySpheresWithAdaptiveSize();
        
        setTimeout(() => {
            createCoordinateMapping();
            createLeafletCountryMarkers();
            forceResetBillboardOrientation();
        }, 1000);
    } catch (error) {
        console.error('Error cargando países:', error);
        createFallbackCountries();
    }
}

function regenerateCountryMarkers() {
    console.log('Regenerando marcadores con nueva geometría...');
    const markersToRemove = [];
    earthGroup.children.forEach(child => {
        if (child.userData && (child.userData.type === 'flagBillboard' || 
                                child.userData.type === 'flagSphere3D' || 
                                child.userData.type === 'simpleSphere')) {
            markersToRemove.push(child);
        }
    });
    markersToRemove.forEach(marker => {
        earthGroup.remove(marker);
        marker.geometry?.dispose?.();
        marker.material?.dispose?.();
    });
    countryMarkers = [];
    createCountrySpheresWithAdaptiveSize();
    
    setTimeout(() => {
        createCoordinateMapping();
        createLeafletCountryMarkers();
        forceResetBillboardOrientation();
    }, 1000);
}

function createCountrySpheresWithAdaptiveSize() {
    let successCount = 0;
    let errorCount = 0;
    
    const countryPositions = countries.map(country => ({
        country,
        position: latLonToCartesian(country.latlng[0], country.latlng[1], 1.12),
        neighbors: []
    }));
    
    countryPositions.forEach((countryA, indexA) => {
        countryPositions.forEach((countryB, indexB) => {
            if (indexA !== indexB) {
                const distance = new THREE.Vector3(
                    countryA.position.x - countryB.position.x,
                    countryA.position.y - countryB.position.y,
                    countryA.position.z - countryB.position.z
                ).length();
                if (distance < 0.3) {
                    countryA.neighbors.push(countryB);
                }
            }
        });
    });
    
    countryPositions.forEach((countryData) => {
        const { country, position, neighbors } = countryData;
        let sphereRadius;
        if (neighbors.length === 0) {
            sphereRadius = 0.035;
        } else if (neighbors.length <= 2) {
            sphereRadius = 0.025;
        } else if (neighbors.length <= 5) {
            sphereRadius = 0.018;
        } else {
            sphereRadius = 0.012;
        }
        
        const flagUrl = country.flags.png || country.flags.svg;
        if (!flagUrl) {
            const m = createSimpleCountrySphere(position, country, 0x888888, sphereRadius);
            // simpleSphere no es billboard
            return;
        }
        
        const textureLoader = new THREE.TextureLoader();
        textureLoader.setCrossOrigin('anonymous');
        
        const flagTexture = textureLoader.load(
            flagUrl,
            () => {
                const geometryType = isSphericalGeometry ? 'Esfera 3D' : 'Plano 2D';
                console.log(`${geometryType} creada: ${country.name.common} (${neighbors.length} vecinos, radio: ${sphereRadius.toFixed(3)})`);
                successCount++;
                const countrySphere = createBillboardFlagSphere(position, flagTexture, sphereRadius, country);
                countryMarkers.push(countrySphere);
                earthGroup.add(countrySphere);
                if (isBillboardActive) {
                    orientMarkerTowardsCamera(countrySphere, true);
                } else {
                    orientMarkerRadial(countrySphere, true);
                }
            },
            undefined,
            () => {
                console.log(`Error con bandera de ${country.name.common}, creando esfera simple`);
                errorCount++;
                const m = createSimpleCountrySphere(position, country, 0xffaa00, sphereRadius);
            }
        );
        setTimeout(() => {
            if (!flagTexture.image || !flagTexture.image.complete) {
                const m = createSimpleCountrySphere(position, country, 0xff4444, sphereRadius);
            }
        }, 5000);
    });
    
    setTimeout(() => {
        const geometryType = isSphericalGeometry ? 'esferas 3D' : 'planos 2D';
        console.log(`Resultados finales: ${successCount} ${geometryType} con banderas, ${errorCount} errores`);
        console.log(`Total de marcadores creados: ${countryMarkers.length}`);
    }, 6000);
}

function createBillboardFlagSphere(position, texture, radius, country) {
    let flagGeometry, flagMaterial, flagMesh;
    
    if (isSphericalGeometry) {
        flagGeometry = new THREE.SphereGeometry(radius, 64, 32);
        flagMaterial = new THREE.MeshPhongMaterial({ 
            map: texture,
            transparent: true,
            opacity: 0.95,
            shininess: 15,
            specular: 0x111111,
            alphaTest: 0.1
        });
        flagMesh = new THREE.Mesh(flagGeometry, flagMaterial);
        flagMesh.userData = { 
            country: country,
            type: 'flagSphere3D',
            originalRadius: radius,
            isBillboard: true,
            originalPosition: new THREE.Vector3(position.x, position.y, position.z)
        };
    } else {
        flagGeometry = new THREE.PlaneGeometry(radius * 2.5, radius * 1.6);
        flagMaterial = new THREE.MeshLambertMaterial({ 
            map: texture,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
            alphaTest: 0.1
        });
        flagMesh = new THREE.Mesh(flagGeometry, flagMaterial);
        flagMesh.userData = { 
            country: country,
            type: 'flagBillboard',
            originalRadius: radius,
            isBillboard: true,
            originalPosition: new THREE.Vector3(position.x, position.y, position.z)
        };
    }
    flagMesh.position.set(position.x, position.y, position.z);
    return flagMesh;
}

function createSimpleCountrySphere(position, country, color, radius) {
    const sphereGeometry = new THREE.SphereGeometry(radius, 16, 16);
    const sphereMaterial = new THREE.MeshLambertMaterial({ 
        color: color,
        transparent: true,
        opacity: 0.8,
        emissive: new THREE.Color(color).multiplyScalar(0.1)
    });
    const simpleSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    simpleSphere.position.set(position.x, position.y, position.z);
    simpleSphere.userData = { 
        country: country,
        type: 'simpleSphere',
        originalRadius: radius,
        isBillboard: false
    };
    countryMarkers.push(simpleSphere);
    earthGroup.add(simpleSphere);
    console.log(`Esfera simple creada: ${country.name.common} (radio: ${radius.toFixed(3)})`);
    return simpleSphere;
}

function createFallbackCountries() {
    const fallbackCountries = [
        { name: { common: 'France' }, latlng: [46.227638, 2.213749] },
        { name: { common: 'Spain' }, latlng: [40.463667, -3.74922] },
        { name: { common: 'Italy' }, latlng: [41.871940, 12.567380] },
        { name: { common: 'Germany' }, latlng: [51.165691, 10.451526] },
        { name: { common: 'USA' }, latlng: [37.09024, -95.712891] },
        { name: { common: 'Brazil' }, latlng: [-14.235004, -51.92528] },
        { name: { common: 'Japan' }, latlng: [36.204824, 138.252924] },
        { name: { common: 'Australia' }, latlng: [-25.274398, 133.775136] },
        { name: { common: 'China' }, latlng: [35.86166, 104.195397] },
        { name: { common: 'India' }, latlng: [20.593684, 78.96288] }
    ];
    fallbackCountries.forEach(country => {
        const position = latLonToCartesian(country.latlng[0], country.latlng[1], 1.12);
        createSimpleCountrySphere(position, country, 0x00ffff, 0.03);
    });
    console.log('Países de fallback creados');
}

function updateBillboards() {
    earthGroup.children.forEach(child => {
        if (child.userData && child.userData.isBillboard) {
            if (isBillboardActive) {
                orientMarkerTowardsCamera(child, false);
            } else {
                orientMarkerRadial(child, false);
            }
        }
    });
}

function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    updateBillboards();
    
    // Luz
    if (isAutoLightRotation) {
        lightAngle += 0.008;
        if (directionalLight) {
            directionalLight.position.x = Math.cos(lightAngle) * 3;
            directionalLight.position.z = Math.sin(lightAngle) * 3;
            directionalLight.position.y = Math.sin(lightAngle * 0.5) * 1;
        }
        if (nightLight) {
            nightLight.position.x = -directionalLight.position.x * 0.5;
            nightLight.position.z = -directionalLight.position.z * 0.5;
            nightLight.position.y = -directionalLight.position.y * 0.5;
        }
    } else {
        if (directionalLight) {
            directionalLight.position.copy(camera.position).multiplyScalar(1.2); 
        }
        if (nightLight) {
            nightLight.position.copy(camera.position).multiplyScalar(-0.3);
        }
    }
    
    // Rotación automática (solo si está activa)
    if (isEarthRotationActive && earthGroup) {
        const rotationSpeed = 0.0005;
        earthGroup.rotation.y += rotationSpeed;
        baseRotationY = earthGroup.rotation.y;
    }
    
    const time = Date.now() * 0.003;
    earthGroup.children.forEach(child => {
        if (child.userData) {
            if (child.userData.isUserMarker) {
                child.scale.setScalar(1 + Math.sin(time) * 0.2);
            }
            if (child.userData.type === 'simpleSphere') {
                const breathingEffect = 1 + Math.sin(time * 0.7 + child.position.x * 10) * 0.05;
                child.scale.setScalar(breathingEffect);
            }
            if (child.userData.type === 'flagSphere3D') {
                const subtleEffect = 1 + Math.sin(time * 0.4 + child.position.y * 8) * 0.03;
                child.scale.setScalar(subtleEffect);
            } else if (child.userData.type === 'flagBillboard') {
                const subtleEffect = 1 + Math.sin(time * 0.5 + child.position.y * 5) * 0.02;
                child.scale.setScalar(subtleEffect);
            }
        }
    });
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (leafletMap) {
        setTimeout(() => leafletMap.invalidateSize(), 100);
    }
}

function logProximityStats() {
    console.log('Estadísticas de proximidad:');
    const stats = {};
    countryMarkers.forEach(marker => {
        const neighbors = marker.userData.neighbors || 0;
        stats[neighbors] = (stats[neighbors] || 0) + 1;
    });
    console.table(stats);
}

window.addEventListener('load', init);

/* main.js - robust app
   - renders markers for current floor (no reliance on svg element ids)
   - supports SVG floor files OR raster images named the same way
   - search-based typeahead (excludes corridors by default)
   - floor switching redraws markers
   - A* pathfinding unchanged
*/

const FLOOR_ORDER = ['G','1','2','3'];
const FLOOR_FILES = {
  'G': 'school-nav-data/svg/ground-level-nodes.svg',
  '1': 'school-nav-data/svg/first-level-nodes.svg',
  '2': 'school-nav-data/svg/second-level-nodes.svg',
  '3': 'school-nav-data/svg/third-level-nodes.svg'
};
const NODES_CSV = 'school-nav-data/nodes_all.csv';
const EDGES_CSV = 'school-nav-data/edges_all.csv';
const CORRIDOR_PATH_TYPES = new Set(['corridor','stair','lift','entrance']);

let nodes = []; // loaded nodes_all
let edges = [];
let graph = {};
let nodeDegree = {};
let currentFloor = 'G';
let lastPath = null;
let mapBaseIsSvg = false; // computed at load
let mapNaturalSize = {width:1000, height:800}; // fallback, updated if image/svg viewbox known

// helpers
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------------- CSV loading ---------------- */
async function loadCSV(url){
  return new Promise((resolve,reject) => {
    Papa.parse(url, { download:true, header:true, skipEmptyLines:true,
      complete: res => resolve(res.data),
      error: err => reject(err)
    });
  });
}

/* ---------------- graph ---------------- */
function buildGraph(){
  graph = {};
  nodeDegree = {};
  nodes.forEach(n => graph[n.id] = []);
  edges.forEach(e => {
    if (!graph[e.from]) graph[e.from] = [];
    if (!graph[e.to]) graph[e.to] = [];
    const raw = parseFloat(e.distance);
    const w = (isFinite(raw) && raw > 0) ? raw : euclidDist(e.from, e.to);
    const acc = String(e.accessible || 'true').toLowerCase() === 'true';
    graph[e.from].push({ to: e.to, weight: w, accessible: acc });
    graph[e.to].push({ to: e.from, weight: w, accessible: acc });
    nodeDegree[e.from] = (nodeDegree[e.from] || 0) + 1;
    nodeDegree[e.to] = (nodeDegree[e.to] || 0) + 1;
  });
}

function getNode(id){ return nodes.find(n => n.id === id); }
function euclidDist(aId,bId){
  const a = getNode(aId), b = getNode(bId);
  if (!a || !b) return 1e6;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/* ---------------- A* ---------------- */
function heuristic(a,b){ return euclidDist(a,b); }
function aStar(start, goal, opts = {}){
  const avoidStairs = !!opts.avoidStairs;
  const allowedTypes = opts.allowedTypes || null;
  const graphData = opts.graphData || graph;
  if (!graphData[start] || !graphData[goal]) return [];
  const open = new Set([start]);
  const came = {};
  const gScore = {}, fScore = {};
  Object.keys(graphData).forEach(k => { gScore[k]=Infinity; fScore[k]=Infinity; });
  gScore[start]=0; fScore[start] = heuristic(start, goal);
  const pq = [{id:start, f:fScore[start]}];

  while(pq.length){
    pq.sort((a,b)=>a.f-b.f);
    const current = pq.shift().id;
    if (current === goal){
      const path = [];
      let cur = current;
      while(cur){ path.push(cur); cur = came[cur]; }
      return path.reverse();
    }
    for(const e of graphData[current] || []){
      if (avoidStairs && e.accessible === false) continue;
      const neighborNode = getNode(e.to);
      if (allowedTypes && neighborNode){
        const nodeAllowed = allowedTypes.has(neighborNode.type) || e.to === goal || current === start;
        if (!nodeAllowed) continue;
      }
      const tentative = gScore[current] + e.weight;
      if (tentative < gScore[e.to]){
        came[e.to] = current;
        gScore[e.to] = tentative;
        fScore[e.to] = tentative + heuristic(e.to, goal);
        if (!pq.some(x=>x.id===e.to)) pq.push({id:e.to, f:fScore[e.to]});
      }
    }
  }
  return [];
}

/* ---------------- Map base load (svg or image) ---------------- */
async function loadMapBase(floorKey){
  const url = FLOOR_FILES[floorKey];
  const container = $('#mapBase');
  container.innerHTML = '';
  mapBaseIsSvg = false;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('not found');
    const text = await res.text();

    // Heuristic: if it starts with <svg treat as svg, else try image
    if (text.trim().startsWith('<svg')) {
      mapBaseIsSvg = true;
      container.innerHTML = text;
      // try to read viewBox to scale coordinates correctly
      const svg = container.querySelector('svg');
      if (svg) {
        svg.setAttribute('preserveAspectRatio','xMidYMid meet');
        const vb = svg.getAttribute('viewBox');
        if (vb) {
          const parts = vb.split(/\s+/).map(Number);
          if (parts.length === 4) mapNaturalSize = { width: parts[2], height: parts[3] };
        } else {
          // fallback to width/height attributes
          const w = parseFloat(svg.getAttribute('width')) || mapNaturalSize.width;
          const h = parseFloat(svg.getAttribute('height')) || mapNaturalSize.height;
          mapNaturalSize = { width: w, height: h };
        }
      }
    } else {
      // treat as image binary: create an <img> and set src to url
      const img = document.createElement('img');
      img.src = url;
      img.alt = `Floor ${floorKey}`;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'contain';
      img.onload = () => {
        mapNaturalSize = { width: img.naturalWidth || 1000, height: img.naturalHeight || 800 };
        // after we know natural size, redraw markers
        drawMarkersForCurrentFloor();
      };
      container.appendChild(img);
    }
    // after base loaded, draw markers
    setTimeout(()=> drawMarkersForCurrentFloor(), 150);
  } catch (err) {
    console.warn('Map base not found:', url);
    container.innerHTML = `<div class="text-sm text-red-500 p-4">Map not found: ${url}</div>`;
  }
}

/* ------------- Overlay drawing (markers & route) ------------- */
function clearOverlay(){ const o = $('#overlay'); while(o.firstChild) o.removeChild(o.firstChild); }

function scaleXYToOverlay(x,y){
  // nodes.csv coordinates are assumed to be in same coordinate space as the map file (SVG viewBox or image pixels)
  // overlay svg has width/height in CSS; mapNaturalSize stores source pixel space.
  const overlay = $('#overlay');
  const rect = overlay.getBoundingClientRect();
  const scaleX = rect.width / mapNaturalSize.width;
  const scaleY = rect.height / mapNaturalSize.height;
  return { cx: x * scaleX, cy: y * scaleY };
}

function drawMarkersForCurrentFloor(){
  const overlay = $('#overlay');
  overlay.innerHTML = '';

  const minimalMode = $('#minimalToggle') ? $('#minimalToggle').checked : false;
  const floorNodes = nodes.filter(n => String(n.floor) === String(currentFloor));
  floorNodes.forEach(n => {
    const isConnector = ['stair','lift','entrance'].includes(n.type);
    const onPath = lastPath && lastPath.includes(n.id);
    const isSelected = n.id === $('#startSearch').dataset.nodeId || n.id === $('#endSearch').dataset.nodeId;
    if (minimalMode && !isConnector && !onPath && !isSelected) return;
    const showHoverLabel = isConnector || isSelected || !minimalMode;
    // by default exclude corridor from being prominent; still drawn but not in search (config)
    const {cx, cy} = scaleXYToOverlay(n.x, n.y);
    // group for nice hit area
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('transform', `translate(${cx},${cy})`);
    g.style.cursor = 'pointer';

    // circle
    const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
    const radius = isConnector ? 8 : onPath || isSelected ? 6 : 5;
    circle.setAttribute('r', radius);
    const fill = isConnector
      ? (n.type==='lift' || n.type==='entrance' ? 'var(--gold)' : 'var(--navy)')
      : onPath || isSelected ? 'var(--cyan)' : 'var(--navy-muted)';
    circle.setAttribute('fill', fill);
    circle.setAttribute('class', `marker ${onPath ? 'marker-path' : isConnector ? 'marker-connector' : 'marker-muted'}`);
    g.appendChild(circle);

    // small label (hidden, shown on hover)
    const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
    txt.setAttribute('y', -12);
    txt.setAttribute('text-anchor','middle');
    txt.setAttribute('class','marker-label');
    txt.textContent = n.name || n.id;
    txt.style.display = 'none';
    g.appendChild(txt);

    // hover handlers
    g.addEventListener('mouseenter', ()=> { if (showHoverLabel) txt.style.display = 'block'; });
    g.addEventListener('mouseleave', ()=> { if (showHoverLabel) txt.style.display = 'none'; });

    // click handler: set start or end depending on last interaction
    g.addEventListener('click', (ev) => {
      // if startSearch has focus or empty -> set start, else set end
      const startFocused = document.activeElement === $('#startSearch');
      const endFocused = document.activeElement === $('#endSearch');
      if (startFocused || !$('#startSearch').value) {
        $('#startSearch').value = n.name || n.id;
        $('#startSearch').dataset.nodeId = n.id;
        renderSearchResults('start', [n]);
      } else {
        $('#endSearch').value = n.name || n.id;
        $('#endSearch').dataset.nodeId = n.id;
        renderSearchResults('end', [n]);
      }
    });

    overlay.appendChild(g);
  });

  // if lastPath exists, draw it on top
  if (lastPath && lastPath.length) drawRoute(lastPath);
}

function drawRoute(path){
  // draw full route scaled to overlay
  const overlay = $('#overlay');
  // remove existing route lines first
  [...overlay.querySelectorAll('.route-line, .route-shadow')].forEach(n=>n.remove());

  if (!path || path.length === 0) return;

  // compute scaled points
  const pts = path.map(id => {
    const n = getNode(id);
    const {cx, cy} = scaleXYToOverlay(n.x, n.y);
    return `${cx},${cy}`;
  }).join(' ');

  // shadow
  const shadow = document.createElementNS('http://www.w3.org/2000/svg','polyline');
  shadow.setAttribute('points', pts);
  shadow.setAttribute('class','route-shadow');
  overlay.appendChild(shadow);

  const line = document.createElementNS('http://www.w3.org/2000/svg','polyline');
  line.setAttribute('points', pts);
  line.setAttribute('class','route-line');
  overlay.appendChild(line);

  // markers for start and end (drawn at actual node positions)
  const s = getNode(path[0]), e = getNode(path[path.length-1]);
  if (s){
    const p = scaleXYToOverlay(s.x, s.y);
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx', p.cx); c.setAttribute('cy', p.cy); c.setAttribute('r', 9);
    c.setAttribute('fill','var(--navy)'); c.setAttribute('stroke','white'); c.setAttribute('stroke-width',2);
    overlay.appendChild(c);
  }
  if (e){
    const p = scaleXYToOverlay(e.x, e.y);
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx', p.cx); c.setAttribute('cy', p.cy); c.setAttribute('r', 10);
    c.setAttribute('fill','#ef4444'); c.setAttribute('stroke','white'); c.setAttribute('stroke-width',2);
    overlay.appendChild(c);
  }
}

/* ---------------- Directions generation (same logic as before) ---------------- */
function angleBetween(a,b,c){
  const v1x=a.x-b.x, v1y=a.y-b.y;
  const v2x=c.x-b.x, v2y=c.y-b.y;
  const dot=v1x*v2x+v1y*v2y;
  const mag = Math.hypot(v1x,v1y)*Math.hypot(v2x,v2y);
  if (!mag) return 0;
  const cos = Math.max(-1, Math.min(1, dot/mag));
  return Math.acos(cos)*(180/Math.PI);
}
function floorLabel(k){ return { 'G':'Ground','1':'First','2':'Second','3':'Third' }[k] || k; }

function generateDirections(path){
  const steps=[];
  if (!path || path.length===0) return steps;
  for (let i=0;i<path.length;i++){
    const id = path[i];
    const node = getNode(id);
    const prev = i>0 ? getNode(path[i-1]) : null;
    const nxt = i<path.length-1 ? getNode(path[i+1]) : null;

    if (!prev && nxt) { steps.push(`Start at ${node.name || node.id}.`); continue; }
    if (prev && node.floor !== prev.floor) {
      const transport = (node.type==='lift' || prev.type==='lift') ? 'Take the lift' : 'Take the stairs';
      steps.push(`${transport} from ${floorLabel(prev.floor)} to ${floorLabel(node.floor)}.`);
      continue;
    }
    if (prev && nxt){
      if (node.type==='stair' || node.type==='lift'){ steps.push(`At ${node.name || node.id}, ${node.type==='lift' ? 'use the lift' : 'use the stairs'}.`); continue; }
      const a = angleBetween(prev,node,nxt);
      if (a < 20) {
        const last = steps[steps.length-1] || '';
        if (!last.includes('Continue straight') && !last.startsWith('Start')) steps.push('Continue straight.');
      } else {
        const v1x = prev.x - node.x, v1y = prev.y - node.y;
        const v2x = nxt.x - node.x, v2y = nxt.y - node.y;
        const cross = v1x * v2y - v1y * v2x;
        const dir = cross > 0 ? 'Turn left' : 'Turn right';
        steps.push(`${dir} at ${node.name || node.id}.`);
      }
    }
  }
  steps.push(`You have arrived at ${getNode(path[path.length-1]).name || path[path.length-1]}.`);
  // collapse consecutive continues
  const out=[];
  for(const s of steps){ if (s==='Continue straight.' && out[out.length-1]==='Continue straight.') continue; out.push(s); }
  return out;
}

function findRoute(startId, endId, opts = {}){
  // Prefer corridor/stair/lift/entrance traversal for cleaner wayfinding,
  // but fall back to the full graph if needed.
  const corridorFirst = aStar(startId, endId, { ...opts, allowedTypes: CORRIDOR_PATH_TYPES });
  if (corridorFirst && corridorFirst.length) return corridorFirst;
  return aStar(startId, endId, opts);
}

/* --------------- Search (typeahead) --------------- */
function filterNodesForSearch(query, role){ // role = 'start'|'end'
  query = (query||'').trim().toLowerCase();
  const includeCorridors = !!$('#includeCorridors').checked;
  return nodes.filter(n => {
    if (String(n.floor) !== String(currentFloor)) return false; // only show same-floor matches first
    if ((nodeDegree[n.id] || 0) === 0) return false; // exclude isolated/unroutable
    if (!includeCorridors && (n.type||'').toLowerCase() === 'corridor') return false;
    const label = (n.name || n.id || '').toLowerCase();
    return label.includes(query);
  }).slice(0, 25);
}

function renderSearchResults(role, list){
  const container = role === 'start' ? $('#startResults') : $('#endResults');
  container.innerHTML = '';
  if (!list || !list.length) return;
  list.forEach(n => {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.innerHTML = `<div class="result-name">${n.name || n.id}</div><div class="result-meta">${n.floor} • ${n.type}</div>`;
    div.addEventListener('click', ()=> {
      if (role==='start') {
        $('#startSearch').value = n.name || n.id;
        $('#startSearch').dataset.nodeId = n.id;
      } else {
        $('#endSearch').value = n.name || n.id;
        $('#endSearch').dataset.nodeId = n.id;
      }
      container.innerHTML = '';
    });
    container.appendChild(div);
  });
}

/* --------------- UI wiring & actions --------------- */
$('#startSearch').addEventListener('input', (e)=> {
  const q = e.target.value;
  const results = filterNodesForSearch(q, 'start');
  renderSearchResults('start', results);
});
$('#endSearch').addEventListener('input', (e)=> {
  const q = e.target.value;
  const results = filterNodesForSearch(q, 'end');
  renderSearchResults('end', results);
});

$('#routeBtn').addEventListener('click', () => {
  const startId = $('#startSearch').dataset.nodeId || nodes.find(n=> (n.name||'').toLowerCase() === ($('#startSearch').value||'').toLowerCase())?.id;
  const endId = $('#endSearch').dataset.nodeId || nodes.find(n=> (n.name||'').toLowerCase() === ($('#endSearch').value||'').toLowerCase())?.id;
  const avoid = $('#accessibleToggle').checked;
  if (!startId || !endId) { alert('Please pick both start and destination from suggestions (click the result).'); return; }
  if (startId === endId) { alert('You are already there!'); return; }
  if ((nodeDegree[startId] || 0) === 0 || (nodeDegree[endId] || 0) === 0) { alert('Selected point is not connected to the map data. Please choose another nearby point.'); return; }

  const path = findRoute(startId, endId, { avoidStairs: avoid });
  if (!path || path.length===0){ alert('No route found — check edges.'); return; }
  lastPath = path;
  // if path includes nodes on other floors, keep current floor as floor of start
  drawMarkersForCurrentFloor();
  const directions = generateDirections(path);
  $('#directionsList').innerHTML = directions.map(s=>`<li>${s}</li>`).join('');
  $('#summaryText').textContent = `${path.length} nodes • ${path.map(id=>getNode(id).floor).filter((v,i,a)=>a.indexOf(v)===i).join(' → ')}`;
  // update URL params
  const params = new URLSearchParams();
  params.set('start', startId); params.set('end', endId); params.set('floor', getNode(startId).floor || currentFloor);
  history.replaceState(null,'','?'+params.toString());
});

$('#clearBtn').addEventListener('click', ()=> {
  $('#startSearch').value = ''; delete $('#startSearch').dataset.nodeId;
  $('#endSearch').value = ''; delete $('#endSearch').dataset.nodeId;
  $('#directionsList').innerHTML = ''; $('#summaryText').textContent = 'No route selected';
  lastPath = null; clearOverlay(); drawMarkersForCurrentFloor();
  history.replaceState(null,'','/');
});

$('#copyLink').addEventListener('click', async ()=>{ 
  try { await navigator.clipboard.writeText(location.href); $('#shareSuccess').classList.remove('hidden'); setTimeout(()=>$('#shareSuccess').classList.add('hidden'),1300); } catch(e){ alert('Copy failed'); }
});
$('#printBtn').addEventListener('click', ()=> window.print());
if ($('#minimalToggle')){
  $('#minimalToggle').addEventListener('change', ()=> drawMarkersForCurrentFloor());
}

$('#prevFloor').addEventListener('click', ()=> {
  const idx = FLOOR_ORDER.indexOf(currentFloor);
  if (idx>0) setFloor(FLOOR_ORDER[idx-1]);
});
$('#nextFloor').addEventListener('click', ()=> {
  const idx = FLOOR_ORDER.indexOf(currentFloor);
  if (idx < FLOOR_ORDER.length-1) setFloor(FLOOR_ORDER[idx+1]);
});

/* --------------- Floor set --------------- */
async function setFloor(f){
  if (!FLOOR_FILES[f]) return;
  currentFloor = f;
  $('#floorName').textContent = `${floorLabel(f)} (${f})`;
  await loadMapBase(f);
}

/* --------------- Startup --------------- */
async function init(){
  try {
    const rawNodes = await loadCSV(NODES_CSV);
    nodes = rawNodes.map(r => ({
      id: String(r.id).trim(),
      floor: String(r.floor).trim(),
      x: Number(r.x),
      y: Number(r.y),
      name: String(r.name || r.label || r.id || '').trim(),
      type: String((r.type||'')).trim().toLowerCase()
    }));

    const rawEdges = await loadCSV(EDGES_CSV);
    edges = rawEdges.map(r => ({ from: String(r.from).trim(), to: String(r.to).trim(), distance: r.distance ? Number(r.distance) : 0, accessible: String(r.accessible || 'true') }));

    // auto-fix common type mistakes (corridor -> corridor etc.)
    nodes.forEach(n => {
      if (!n.type) n.type = 'room';
      n.type = n.type.toLowerCase().trim();
      if (n.type === 'corridor' || n.type === 'hall') n.type = 'corridor';
      if (n.type === 'stairs' || n.type === 'staircase') n.type = 'stair';
      if (n.type === 'elevator') n.type = 'lift';
    });

    buildGraph();

    // populate quick picks
    const quick = $('#quickList'); quick.innerHTML = '';
    nodes.filter(n=> n.type==='reception' || n.type==='room').slice(0,6).forEach(n=>{
      const b = document.createElement('button'); b.className='px-3 py-1 rounded-full border text-sm';
      b.textContent = n.name || n.id; b.onclick = ()=> { $('#endSearch').value = n.name || n.id; $('#endSearch').dataset.nodeId = n.id; };
      quick.appendChild(b);
    });

    // initial floor from URL or default
    const params = new URLSearchParams(location.search);
    const s = params.get('start'), e = params.get('end'), f = params.get('floor');
    const initFloor = f || (s ? (nodes.find(n=>n.id===s)||{}).floor : 'G') || 'G';
    await setFloor(initFloor);

    // auto-fill start/end if present in url
    if (s && getNode(s)) { $('#startSearch').value = getNode(s).name || s; $('#startSearch').dataset.nodeId = s; }
    if (e && getNode(e)) { $('#endSearch').value = getNode(e).name || e; $('#endSearch').dataset.nodeId = e; if (s) setTimeout(()=>$('#routeBtn').click(), 300); }

    // redraw markers on window resize (keeps scale correct)
    window.addEventListener('resize', ()=> { drawMarkersForCurrentFloor(); });

  } catch (err){
    console.error('Init error', err);
    alert('Failed to initialize app — check console for details.');
  }
}

init();

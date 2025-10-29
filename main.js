/* main.js
   Expects:
     school-nav-data/nodes_all.csv
     school-nav-data/edges_all.csv
     school-nav-data/svg/ground-level-nodes.svg
     school-nav-data/svg/first-level-nodes.svg
     school-nav-data/svg/second-level-nodes.svg
     school-nav-data/svg/third-level-nodes.svg
*/

/* -------------- Config -------------- */
const FLOOR_ORDER = ['G','1','2','3'];
const FLOOR_FILES = {
  'G': 'school-nav-data/svg/ground-level-nodes.svg',
  '1': 'school-nav-data/svg/first-level-nodes.svg',
  '2': 'school-nav-data/svg/second-level-nodes.svg',
  '3': 'school-nav-data/svg/third-level-nodes.svg'
};
const NODES_CSV = 'school-nav-data/nodes_all.csv';
const EDGES_CSV = 'school-nav-data/edges_all.csv';

/* -------------- State -------------- */
let nodes = [];   // array of {id,floor,x,y,name,type}
let edges = [];   // array of {from,to,distance,accessible}
let graph = {};   // adjacency list
let currentFloor = 'G';
let lastPath = null;

/* -------------- Helpers -------------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

async function loadCSV(url){
  return new Promise((resolve,reject) => {
    Papa.parse(url, { download:true, header:true, skipEmptyLines:true,
      complete: (res) => resolve(res.data),
      error: err => reject(err)
    });
  });
}

function getNode(id){ return nodes.find(n=>n.id===id); }
function euclidDist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }

/* -------------- Graph & Pathfinding -------------- */
function buildGraph(){
  graph = {};
  nodes.forEach(n => graph[n.id] = []);
  edges.forEach(e => {
    if (!graph[e.from]) graph[e.from] = [];
    if (!graph[e.to]) graph[e.to] = [];
    const w = (e.distance && !isNaN(parseFloat(e.distance))) ? parseFloat(e.distance) : euclidDist(getNode(e.from), getNode(e.to));
    const acc = String(e.accessible || 'true').toLowerCase() === 'true';
    graph[e.from].push({ to: e.to, weight: w, accessible: acc });
    graph[e.to].push({ to: e.from, weight: w, accessible: acc });
  });
}

// A* (simple array-based PQ, fine for small maps)
function heuristic(a,b){ return euclidDist(getNode(a), getNode(b)); }
function aStar(start, goal, opts = {}){
  const avoidStairs = !!opts.avoidStairs;
  if (!graph[start] || !graph[goal]) return [];
  const open = new Set([start]);
  const gScore = {}, fScore = {}, cameFrom = {};
  Object.keys(graph).forEach(k => { gScore[k]=Infinity; fScore[k]=Infinity; });
  gScore[start]=0; fScore[start]=heuristic(start,goal);
  const pq = [{id:start, f:fScore[start]}];

  while(pq.length){
    pq.sort((a,b)=>a.f-b.f);
    const current = pq.shift().id;
    if (current === goal){
      const path = []; let cur = current;
      while(cur){ path.push(cur); cur = cameFrom[cur]; }
      return path.reverse();
    }
    for(const edge of graph[current] || []){
      if (avoidStairs && edge.accessible === false) continue;
      const tentative = gScore[current] + edge.weight;
      if (tentative < gScore[edge.to]){
        cameFrom[edge.to] = current;
        gScore[edge.to] = tentative;
        fScore[edge.to] = tentative + heuristic(edge.to, goal);
        if (!pq.some(x=>x.id===edge.to)) pq.push({id: edge.to, f: fScore[edge.to]});
      }
    }
  }
  return [];
}

/* -------------- SVG load & overlay drawing -------------- */
async function loadFloorSVG(floorKey){
  currentFloor = floorKey;
  $('#floorName').textContent = `${floorLabel(floorKey)} (${floorKey})`;
  const container = $('#svgContainer'); container.innerHTML = '';
  try {
    const res = await fetch(FLOOR_FILES[floorKey]);
    if (!res.ok) throw new Error('SVG not found');
    const text = await res.text();
    container.innerHTML = text;
    const svg = container.querySelector('svg');
    if (svg) svg.setAttribute('preserveAspectRatio','xMidYMid meet');
    wireMapClicks(); // make nodes clickable
    if (lastPath) drawRoute(lastPath);
  } catch(e){
    container.innerHTML = `<div class="w-full h-full flex items-center justify-center text-sm text-red-500">Could not load SVG for floor ${floorKey}</div>`;
  }
}

function clearOverlay(){
  const overlay = $('#overlay');
  while(overlay.firstChild) overlay.removeChild(overlay.firstChild);
}

function drawRoute(path){
  const overlay = $('#overlay');
  overlay.innerHTML = '';
  if (!path || path.length === 0) return;

  // Draw whole polyline but it will only visually match if coordinates align to svg
  const pts = path.map(id => {
    const n = getNode(id);
    return `${n.x},${n.y}`;
  }).join(' ');

  // Shadow
  const shadow = document.createElementNS('http://www.w3.org/2000/svg','polyline');
  shadow.setAttribute('points', pts);
  shadow.setAttribute('fill', 'none');
  shadow.setAttribute('stroke', 'rgba(2,6,23,0.06)');
  shadow.setAttribute('stroke-width', '12');
  shadow.setAttribute('stroke-linecap','round');
  overlay.appendChild(shadow);

  // Main route
  const poly = document.createElementNS('http://www.w3.org/2000/svg','polyline');
  poly.setAttribute('points', pts);
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', 'var(--gold)');
  poly.setAttribute('stroke-width', '6');
  poly.setAttribute('stroke-linecap','round');
  overlay.appendChild(poly);

  // Start & End markers
  const s = getNode(path[0]), e = getNode(path[path.length-1]);
  if (s){
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx', s.x); c.setAttribute('cy', s.y); c.setAttribute('r', 7);
    c.setAttribute('fill','var(--navy)'); c.setAttribute('stroke','white'); c.setAttribute('stroke-width',2);
    overlay.appendChild(c);
  }
  if (e){
    const c2 = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c2.setAttribute('cx', e.x); c2.setAttribute('cy', e.y); c2.setAttribute('r', 8);
    c2.setAttribute('fill','#ef4444'); c2.setAttribute('stroke','white'); c2.setAttribute('stroke-width',2);
    overlay.appendChild(c2);
  }

  // Ensure overlay redraw when user changes floor (we redraw whole overlay but it will rest above map)
  lastPath = path;
}

/* -------------- Directions (human-friendly) -------------- */
function floorLabel(k){
  return { 'G':'Ground','1':'First','2':'Second','3':'Third' }[k] || k;
}

function angle(a,b,c){
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const dot = v1x*v2x + v1y*v2y;
  const mag = Math.hypot(v1x,v1y)*Math.hypot(v2x,v2y);
  if (!mag) return 0;
  const cos = Math.max(-1, Math.min(1, dot/mag));
  return Math.acos(cos) * (180/Math.PI);
}

function generateDirections(path){
  const steps = [];
  if (!path || path.length === 0) return steps;
  for (let i=0;i<path.length;i++){
    const id = path[i];
    const node = getNode(id);
    const prev = i>0 ? getNode(path[i-1]) : null;
    const nxt = i<path.length-1 ? getNode(path[i+1]) : null;

    if (!prev && nxt){
      steps.push(`Start at ${node.name || node.id}.`);
      continue;
    }

    if (prev && node.floor !== prev.floor){
      const transport = (node.type==='lift' || prev.type==='lift') ? 'Take the lift' : 'Take the stairs';
      steps.push(`${transport} from ${floorLabel(prev.floor)} to ${floorLabel(node.floor)}.`);
      continue;
    }

    if (prev && nxt){
      if (node.type === 'stair' || node.type === 'lift'){
        steps.push(`At ${node.name || node.id}, ${node.type === 'lift' ? 'use the lift' : 'use the stairs'}.`);
        continue;
      }
      const a = angle(prev, node, nxt);
      if (a < 20){
        // continue straight
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
  // collapse consecutive "Continue straight."
  const out = [];
  for(const s of steps){ if (s==='Continue straight.' && out[out.length-1]==='Continue straight.') continue; out.push(s); }
  return out;
}

/* -------------- UI wiring -------------- */
function populateSelects(){
  const startSel = $('#startSelect'), endSel = $('#endSelect');
  startSel.innerHTML = ''; endSel.innerHTML = '';

  // entrances first
  const entrances = nodes.filter(n => ['entrance','reception','lift'].includes(n.type));
  if (entrances.length){
    const opt = document.createElement('optgroup'); opt.label = 'Entrances / Reception';
    entrances.forEach(n => opt.appendChild(new Option(`${n.name || n.id} • ${n.floor}`, n.id)));
    startSel.appendChild(opt);
  }

  nodes.forEach(n => {
    const label = `${n.name || n.id} — ${n.floor}`;
    startSel.appendChild(new Option(label, n.id));
    endSel.appendChild(new Option(label, n.id));
  });

  // quick picks
  const quick = $('#quickList'); quick.innerHTML = '';
  nodes.filter(n=>n.type==='reception' || n.type==='room').slice(0,6).forEach(n=>{
    const b = document.createElement('button'); b.className='px-3 py-1 rounded-full border text-sm';
    b.textContent = n.name || n.id; b.onclick = ()=> { $('#endSelect').value = n.id; };
    quick.appendChild(b);
  });
}

function wireMapClicks(){
  const container = $('#svgContainer'); const svg = container.querySelector('svg');
  if (!svg) return;
  nodes.forEach(n => {
    const el = svg.getElementById(n.id);
    if (el){
      el.style.cursor = 'pointer';
      el.addEventListener('click', (ev) => {
        const startSel = $('#startSelect');
        if (!startSel.value || startSel.value === n.id) startSel.value = n.id;
        else $('#endSelect').value = n.id;
      });
    }
  });
}

/* -------------- UI actions -------------- */
$('#routeBtn').addEventListener('click', () => {
  const s = $('#startSelect').value, e = $('#endSelect').value;
  const avoid = $('#accessibleToggle').checked;
  if (!s || !e){ alert('Please select both start and destination.'); return; }
  if (s === e){ alert('You are already there'); return; }
  const path = aStar(s,e,{avoidStairs:avoid});
  if (!path || path.length===0){ alert('No route found. Try different options'); return; }
  lastPath = path;
  drawRoute(path);
  const dirs = generateDirections(path);
  $('#directionsList').innerHTML = dirs.map(d=>`<li>${d}</li>`).join('');
  $('#summaryText').textContent = `${path.length} nodes`;
  // update URL
  const params = new URLSearchParams(); params.set('start', s); params.set('end', e); params.set('floor', getNode(s).floor || currentFloor);
  history.replaceState(null,'','?'+params.toString());
});

$('#clearBtn').addEventListener('click', ()=> {
  clearOverlay(); $('#directionsList').innerHTML=''; $('#summaryText').textContent='No route selected'; $('#startSelect').value=''; $('#endSelect').value=''; lastPath=null; history.replaceState(null,'','/');
});

$('#copyLink').addEventListener('click', async ()=>{
  try { await navigator.clipboard.writeText(location.href); $('#shareSuccess').classList.remove('hidden'); setTimeout(()=>$('#shareSuccess').classList.add('hidden'),1500); } catch(e){ alert('Could not copy link'); }
});
$('#printBtn').addEventListener('click', ()=> window.print());
$('#prevFloor').addEventListener('click', ()=> { const idx = FLOOR_ORDER.indexOf(currentFloor); if (idx>0) setFloor(FLOOR_ORDER[idx-1]); });
$('#nextFloor').addEventListener('click', ()=> { const idx = FLOOR_ORDER.indexOf(currentFloor); if (idx < FLOOR_ORDER.length-1) setFloor(FLOOR_ORDER[idx+1]); });

/* -------------- Floor utils -------------- */
async function setFloor(f){
  if (!FLOOR_FILES[f]) return;
  await loadFloorSVG(f);
  // redraw overlay (route) after svg loads
  if (lastPath) drawRoute(lastPath);
}
function floorLabel(k){ return { 'G':'Ground','1':'First','2':'Second','3':'Third' }[k] || k; }

/* -------------- Startup -------------- */
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
    edges = rawEdges.map(r => ({ from: String(r.from).trim(), to: String(r.to).trim(), distance: r.distance || 0, accessible: r.accessible || 'true' }));

    buildGraph();
    populateSelects();

    // initial floor (from URL or default)
    const params = new URLSearchParams(location.search);
    const s = params.get('start'), e = params.get('end'), f = params.get('floor');
    const initFloor = f || (s ? (nodes.find(n=>n.id===s)||{}).floor : 'G') || 'G';
    await setFloor(initFloor);

    if (s) $('#startSelect').value = s;
    if (e) { $('#endSelect').value = e; setTimeout(()=>$('#routeBtn').click(), 300); }

  } catch(err){
    console.error(err);
    alert('Failed to load data — ensure school-nav-data/nodes_all.csv and edges_all.csv and svg files exist.');
  }
}

init();

const fs = require('fs');
const path = require('path');

let nodes = [];
let edges = [];
let graph = {};

function loadCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        let obj = {};
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = values[j] ? values[j].trim() : '';
        }
        data.push(obj);
    }
    return data;
}

function buildGraph() {
    graph = {};
    nodes.forEach(n => graph[n.id] = []);
    edges.forEach(e => {
        if (!graph[e.from]) graph[e.from] = [];
        if (!graph[e.to]) graph[e.to] = [];
        const w = (e.distance && !isNaN(parseFloat(e.distance))) ? parseFloat(e.distance) : euclidDist(e.from, e.to);
        const acc = String(e.accessible || 'true').toLowerCase() === 'true';
        graph[e.from].push({ to: e.to, weight: w, accessible: acc });
        graph[e.to].push({ to: e.from, weight: w, accessible: acc });
    });
}

function getNode(id) { return nodes.find(n => n.id === id); }
function euclidDist(aId, bId) {
    const a = getNode(aId), b = getNode(bId);
    if (!a || !b) return 1e6;
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}
function heuristic(a, b) { return euclidDist(a, b); }

// New Logic
function isCorridor(node) {
    if (!node) return false;
    const t = (node.type || '').toLowerCase();
    return t === 'corridor' || t === 'stair' || t === 'lift' || t === 'entrance';
}

function validate_path(path) {
    if (!path || path.length < 2) return;
    for (let i = 0; i < path.length - 1; i++) {
        const u = path[i], v = path[i + 1];
        const neighbors = graph[u] || [];
        if (!neighbors.find(e => e.to === v)) {
            throw new Error(`Invalid path: Edge ${u}->${v} missing`);
        }
    }
}

function aStar(start, goal, opts = {}) {
    const avoidStairs = !!opts.avoidStairs;
    const restricted = opts.restricted !== false;

    if (!graph[start] || !graph[goal]) return [];
    const open = new Set([start]);
    const came = {};
    const gScore = {}, fScore = {};
    Object.keys(graph).forEach(k => { gScore[k] = Infinity; fScore[k] = Infinity; });
    gScore[start] = 0; fScore[start] = heuristic(start, goal);
    const pq = [{ id: start, f: fScore[start] }];

    while (pq.length) {
        pq.sort((a, b) => a.f - b.f);
        const current = pq.shift().id;
        if (current === goal) {
            const path = [];
            let cur = current;
            while (cur) { path.push(cur); cur = came[cur]; }
            return path.reverse();
        }
        for (const e of graph[current] || []) {
            if (avoidStairs && e.accessible === false) continue;

            const nodeTo = getNode(e.to);
            if (restricted && !isCorridor(nodeTo) && e.to !== goal) continue;

            const tentative = gScore[current] + e.weight;
            if (tentative < gScore[e.to]) {
                came[e.to] = current;
                gScore[e.to] = tentative;
                fScore[e.to] = tentative + heuristic(e.to, goal);
                if (!pq.some(x => x.id === e.to)) pq.push({ id: e.to, f: fScore[e.to] });
            }
        }
    }
    return [];
}

function route(start, end, opts = {}) {
    const waypoints = opts.waypoints || [];
    const points = [start, ...waypoints, end];
    let fullPath = [];

    for (let i = 0; i < points.length - 1; i++) {
        const s = points[i];
        const e = points[i + 1];
        const seg = aStar(s, e, opts);
        if (!seg || seg.length === 0) {
            throw new Error(`No path between ${s} and ${e}`);
        }
        if (fullPath.length > 0) fullPath.pop();
        fullPath = fullPath.concat(seg);
    }
    validate_path(fullPath);
    return fullPath;
}

// Execution
try {
    const nodesPath = path.join(__dirname, 'school-nav-data/nodes_all.csv');
    const edgesPath = path.join(__dirname, 'school-nav-data/edges_all.csv');

    const rawNodes = loadCSV(nodesPath);
    nodes = rawNodes.map(r => ({
        id: String(r.id).trim(),
        floor: String(r.floor).trim(),
        x: Number(r.x),
        y: Number(r.y),
        name: String(r.name || r.label || r.id || '').trim(),
        type: String((r.type || '')).trim().toLowerCase()
    }));
    nodes.forEach(n => {
        if (!n.type) n.type = 'room';
        n.type = n.type.toLowerCase().trim();
        if (n.type === 'corridor' || n.type === 'hall') n.type = 'corridor';
        if (n.type === 'stairs' || n.type === 'staircase') n.type = 'stair';
        if (n.type === 'elevator') n.type = 'lift';
    });

    const rawEdges = loadCSV(edgesPath);
    edges = rawEdges.map(r => ({
        from: String(r.from).trim(),
        to: String(r.to).trim(),
        distance: r.distance ? Number(r.distance) : 0,
        accessible: String(r.accessible || 'true')
    }));

    buildGraph();

    const startId = 'room_gf_65';
    const endId = 'room_gf_16';
    // Waypoints from prompt mapped to 'corridor_gf_X'
    const waypoints = [16, 63, 15, 64, 65, 66, 17, 21, 22, 24, 45, 44, 43, 25, 27, 3, 34, 100].map(id => `corridor_gf_${id}`);

    console.log(`Calculating route from ${startId} to ${endId} with waypoints...`);
    const pathIds = route(startId, endId, { waypoints });

    console.log('Path found length:', pathIds.length);

    const roomsInMiddle = pathIds.slice(1, -1).filter(id => {
        const n = getNode(id);
        return !isCorridor(n);
    });

    if (roomsInMiddle.length > 0) {
        console.log('\n[FAIL] Path cuts through non-corridor nodes:', roomsInMiddle.map(id => `${id}(${getNode(id).type})`).join(', '));
    } else {
        console.log('\n[PASS] Path strictly follows corridor logic.');
    }

    // Check waypoints presence
    let wpFail = false;
    for (const wp of waypoints) {
        if (pathIds.indexOf(wp) === -1) {
            console.log(`[FAIL] Missing waypoint ${wp}`);
            wpFail = true;
        }
    }
    if (!wpFail) console.log('[PASS] All waypoints visited.');

} catch (err) {
    console.error(err);
}

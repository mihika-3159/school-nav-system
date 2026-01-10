#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const NODES_CSV = path.join(__dirname, '..', 'school-nav-data', 'nodes_all.csv');
const EDGES_CSV = path.join(__dirname, '..', 'school-nav-data', 'edges_all.csv');

function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/);
  const headers = raw.shift().split(',');
  return raw.map(line => {
    const cols = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i]; });
    return row;
  });
}

const nodesArr = parseCSV(NODES_CSV);
const edgesArr = parseCSV(EDGES_CSV);
const nodes = {};
nodesArr.forEach(n => { nodes[n.id] = n; });

const graph = {};
const edgeSet = new Set();
Object.keys(nodes).forEach(id => { graph[id] = []; });

function euclid(a, b) {
  const A = nodes[a], B = nodes[b];
  return Math.hypot(parseFloat(A.x) - parseFloat(B.x), parseFloat(A.y) - parseFloat(B.y));
}

edgesArr.forEach(e => {
  const w = e.distance ? parseFloat(e.distance) : euclid(e.from, e.to);
  graph[e.from].push({ to: e.to, weight: w, accessible: (e.accessible || 'true') === 'true' });
  edgeSet.add(`${e.from}|${e.to}`);
});

function isCorridorNode(node) {
  return ['corridor', 'stair', 'lift', 'entrance'].includes(node.type);
}

function buildAllowedNodes(startId, endId, waypoints = []) {
  const allowed = new Set();
  Object.values(nodes).forEach(n => { if (isCorridorNode(n)) allowed.add(n.id); });
  allowed.add(startId);
  allowed.add(endId);
  waypoints.forEach(w => allowed.add(w));
  return allowed;
}

function validatePath(path) {
  for (let i = 0; i < path.length - 1; i += 1) {
    if (!edgeSet.has(`${path[i]}|${path[i + 1]}`)) {
      throw new Error(`Missing edge: ${path[i]} -> ${path[i + 1]}`);
    }
  }
}

function findFirstPath(start, goal, allowed) {
  const prev = {};
  const visited = new Set();
  const queue = [start];
  visited.add(start);
  while (queue.length) {
    const current = queue.shift();
    if (current === goal) break;
    for (const e of graph[current] || []) {
      if (!allowed.has(e.to) && e.to !== goal) continue;
      if (visited.has(e.to)) continue;
      visited.add(e.to);
      prev[e.to] = current;
      queue.push(e.to);
    }
  }

  if (!prev[goal] && start !== goal) return [];
  const path = [];
  let cur = goal;
  while (cur) {
    path.push(cur);
    cur = prev[cur];
    if (cur === start) { path.push(cur); break; }
  }
  return path.reverse();
}

function route(start, end, waypoints = []) {
  const allowed = buildAllowedNodes(start, end, waypoints);
  const anchors = [start, ...waypoints, end];
  let full = [];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const segment = findFirstPath(anchors[i], anchors[i + 1], allowed);
    if (!segment.length) throw new Error(`No route for segment ${anchors[i]} -> ${anchors[i + 1]}`);
    full = full.length ? full.concat(segment.slice(1)) : segment;
  }
  validatePath(full);
  return full;
}

function containsSubsequence(path, subseq) {
  let idx = 0;
  for (const node of path) {
    if (node === subseq[idx]) idx += 1;
    if (idx === subseq.length) return true;
  }
  return false;
}

const reception = 'room_gf_65';
const seniorLibrary = 'room_gf_16';
const waypointNumbers = [16,63,15,64,65,66,17,21,22,24,45,44,43,25,27,3,34,100];
const waypoints = waypointNumbers.map(n => `corridor_gf_${n}`);

const pathResult = route(reception, seniorLibrary, waypoints);
if (!containsSubsequence(pathResult, waypoints)) {
  throw new Error('Waypoint sequence not found in path.');
}
const corridorCount = pathResult.filter(id => isCorridorNode(nodes[id])).length;
console.log('Acceptance test passed. Path length:', pathResult.length, 'corridor nodes:', corridorCount);

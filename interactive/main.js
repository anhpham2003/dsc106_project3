let storyMode = false;
let sliderLocked = false;
let activeZoomTransition = null;
let hoveredRegionName = null;
let compareMode = false;

window.lastMouseX = null;
window.lastMouseY = null;

const months = [];
for (let y = 2000; y <= 2025; y++) {
  for (let m = 1; m <= 12; m++) {
    if (y == 2000 && (m == 1 || m == 2)) continue;
    if (y == 2025 && m == 4) continue;
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
}

const slider = d3.select("#slider");
slider.attr("max", months.length - 1);

const app = d3.select("#app");
const title  = d3.select("#title");
const hover  = d3.select("#hover");
const toggleCompare = d3.select("#toggle-compare");

const canvas = d3.select("#heatmap").node();
const ctx    = canvas.getContext("2d");
const compareLeftCanvas = d3.select("#compare-left").node();
const compareRightCanvas = d3.select("#compare-right").node();
const compareLeftCtx = compareLeftCanvas.getContext("2d");
const compareRightCtx = compareRightCanvas.getContext("2d");
const compareRightSelect = d3.select("#compare-right-select");
const compareLeftHover = d3.select("#compare-left-hover");
const compareRightHover = d3.select("#compare-right-hover");
const mainRegionList = d3.select("#main-region-list");
const compareLeftRegions = d3.select("#compare-left-regions");
const compareRightRegions = d3.select("#compare-right-regions");

const CANVAS_WIDTH  = canvas.width;
const CANVAS_HEIGHT = canvas.height;
const LON_MIN = -170;
const LON_MAX = -30;
const LAT_MIN = -60;
const LAT_MAX = 75;

function cssToCanvas(cssX, cssY) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = CANVAS_WIDTH  / rect.width;
  const scaleY = CANVAS_HEIGHT / rect.height;
  return [cssX * scaleX, cssY * scaleY];
}

// ── Zoom ──────────────────────────────────────────────────────────────────────

let currentTransform = d3.zoomIdentity;

const zoom = d3.zoom()
  .scaleExtent([1, 20])
  .filter((event) => {
    // Disable all zoom/pan interaction while in selection mode
    if (selectionMode) return false;
    // Default D3 zoom filter: allow wheel zoom, ignore right-click
    return (!event.ctrlKey || event.type === 'wheel') && !event.button;
  })
  .on("zoom", (event) => {
    currentTransform = event.transform;
    redraw();
  });

d3.select(canvas).call(zoom);

// ── Coordinate helpers ────────────────────────────────────────────────────────

function lonToX(lon) {
  return (lon - LON_MIN) / (LON_MAX - LON_MIN) * CANVAS_WIDTH;
}

function latToY(lat) {
  return (LAT_MAX - lat) / (LAT_MAX - LAT_MIN) * CANVAS_HEIGHT;
}

function canvasToData(cssX, cssY) {
  const [px, py] = cssToCanvas(cssX, cssY);
  return currentTransform.invert([px, py]);
}

// ── Offscreen canvas ──────────────────────────────────────────────────────────

const offscreen = document.createElement("canvas");
offscreen.width  = CANVAS_WIDTH;
offscreen.height = CANVAS_HEIGHT;
const offCtx = offscreen.getContext("2d");

// ── Draw ──────────────────────────────────────────────────────────────────────

function drawNDVI(grid) {
  const rows = grid.length;
  const cols = grid[0].length;

  const img   = offCtx.createImageData(cols, rows);
  const color = d3.scaleSequential(d3.interpolateYlGn).domain([0, 1]);

  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v   = grid[r][c];
      const rgb = v === null ? d3.rgb("#e0e0e0") : d3.rgb(color(v));
      img.data[i++] = rgb.r;
      img.data[i++] = rgb.g;
      img.data[i++] = rgb.b;
      img.data[i++] = 255;
    }
  }

  const tmp = offCtx.createImageData(cols, rows);
  tmp.data.set(img.data);
  offCtx.putImageData(tmp, 0, 0);
  offCtx.drawImage(offscreen, 0, 0, cols, rows, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

function drawGridToCanvas(grid, targetCanvas, targetCtx) {
  targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

  if (!grid) {
    targetCtx.fillStyle = "#ddd";
    targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    targetCtx.fillStyle = "#555";
    targetCtx.font = "18px Arial";
    targetCtx.fillText("No data available", 24, 36);
    return;
  }

  const rows = grid.length;
  const cols = grid[0].length;
  const color = d3.scaleSequential(d3.interpolateYlGn).domain([0, 1]);
  const imageData = targetCtx.createImageData(cols, rows);

  let i = 0;
  let hasData = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const value = grid[r][c];
      const rgb = value === null ? d3.rgb("#e0e0e0") : d3.rgb(color(value));
      if (value !== null) hasData = true;

      imageData.data[i++] = rgb.r;
      imageData.data[i++] = rgb.g;
      imageData.data[i++] = rgb.b;
      imageData.data[i++] = 255;
    }
  }

  if (!hasData) {
    targetCtx.fillStyle = "#ddd";
    targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    targetCtx.fillStyle = "#555";
    targetCtx.font = "18px Arial";
    targetCtx.fillText("No data available", 24, 36);
    return;
  }

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = cols;
  tempCanvas.height = rows;
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.putImageData(imageData, 0, 0);

  targetCtx.drawImage(tempCanvas, 0, 0, cols, rows, 0, 0, targetCanvas.width, targetCanvas.height);
  drawRegionsOnCompareCanvas(targetCtx, targetCanvas);
}

function drawRegionsOnCompareCanvas(targetCtx, targetCanvas) {
  const scaleX = targetCanvas.width / CANVAS_WIDTH;
  const scaleY = targetCanvas.height / CANVAS_HEIGHT;

  targetCtx.save();
  targetCtx.lineWidth = 1.5;
  targetCtx.strokeStyle = "rgba(255,255,255,0.9)";
  targetCtx.fillStyle = "rgba(255,255,255,0.95)";
  targetCtx.font = "12px Arial";

  for (const [name, r] of Object.entries(REGIONS)) {
    const x1 = lonToX(r.lon_min) * scaleX;
    const x2 = lonToX(r.lon_max) * scaleX;
    const y1 = latToY(r.lat_max) * scaleY;
    const y2 = latToY(r.lat_min) * scaleY;

    targetCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    targetCtx.fillText(name, x1 + 4, y1 + 14);
  }

  targetCtx.restore();
}

function compareCanvasToGrid(event, targetCanvas, grid) {
  if (!grid) return null;

  const rect = targetCanvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * targetCanvas.width / rect.width;
  const y = (event.clientY - rect.top) * targetCanvas.height / rect.height;

  const rows = grid.length;
  const cols = grid[0].length;
  const col = Math.floor(x * cols / targetCanvas.width);
  const row = Math.floor(y * rows / targetCanvas.height);

  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;

  return {
    row,
    col,
    value: grid[row][col],
    dataX: x / targetCanvas.width * CANVAS_WIDTH,
    dataY: y / targetCanvas.height * CANVAS_HEIGHT,
  };
}

function meanForRegion(grid, regionBox) {
  if (!grid) return null;

  const rows = grid.length;
  const cols = grid[0].length;
  const x1 = Math.max(0, Math.floor((regionBox.lon_min - LON_MIN) / (LON_MAX - LON_MIN) * cols));
  const x2 = Math.min(cols, Math.ceil((regionBox.lon_max - LON_MIN) / (LON_MAX - LON_MIN) * cols));
  const y1 = Math.max(0, Math.floor((LAT_MAX - regionBox.lat_max) / (LAT_MAX - LAT_MIN) * rows));
  const y2 = Math.min(rows, Math.ceil((LAT_MAX - regionBox.lat_min) / (LAT_MAX - LAT_MIN) * rows));

  let sum = 0;
  let count = 0;
  for (let row = y1; row < y2; row++) {
    for (let col = x1; col < x2; col++) {
      const value = grid[row][col];
      if (value !== null) {
        sum += value;
        count++;
      }
    }
  }

  return count ? sum / count : null;
}

function updateRegionList(grid, listSelection) {
  const rows = Object.entries(REGIONS).map(([name, box]) => ({
    name,
    value: meanForRegion(grid, box),
  }));

  listSelection.selectAll("li")
    .data(rows)
    .join("li")
    .html(d => `
      <span class="region-name">${d.name}</span>
      <span class="region-value">${d.value === null ? "—" : d.value.toFixed(3)}</span>
    `);
}

function updateCompareHover(event, side) {
  const isLeft = side === "left";
  const month = isLeft ? months[slider.node().value] : compareRightSelect.property("value");
  const grid = gridCache[month];
  const targetCanvas = isLeft ? compareLeftCanvas : compareRightCanvas;
  const targetHover = isLeft ? compareLeftHover : compareRightHover;
  const point = compareCanvasToGrid(event, targetCanvas, grid);

  if (!point) {
    targetHover.text("Hover vegetation proxy: —");
    return;
  }

  const region = regionAt(point.dataX, point.dataY);
  const valueText = point.value === null ? "—" : point.value.toFixed(3);
  targetHover.text(region ? `${region.name} — vegetation proxy: ${valueText}` : `Vegetation proxy: ${valueText}`);
}

function populateCompareSelects() {
  compareRightSelect.selectAll("option")
    .data(months)
    .join("option")
    .attr("value", d => d)
    .text(d => d);

  compareRightSelect.property("value", months.includes("2024-07") ? "2024-07" : months[months.length - 1]);
}

function updateCompareView() {
  if (!cacheReady) return;

  const leftMonth = months[slider.node().value];
  const rightMonth = compareRightSelect.property("value");
  const leftGrid = gridCache[leftMonth];
  const rightGrid = gridCache[rightMonth];

  d3.select("#compare-left-title").text(leftMonth);
  d3.select("#compare-right-title").text(rightMonth);

  drawGridToCanvas(leftGrid, compareLeftCanvas, compareLeftCtx);
  drawGridToCanvas(rightGrid, compareRightCanvas, compareRightCtx);
  updateRegionList(leftGrid, compareLeftRegions);
  updateRegionList(rightGrid, compareRightRegions);
  compareLeftHover.text("Hover vegetation proxy: —");
  compareRightHover.text("Hover vegetation proxy: —");
}

function setCompareMode(enabled) {
  compareMode = enabled;
  app.classed("compare-mode", compareMode);
  toggleCompare.text(compareMode ? "Back to single map" : "Compare Two Different Times");

  if (compareMode) {
    if (selectionMode) {
      selectionMode = false;
      d3.select("#toggle-select")
        .text("⬚ Highlight region")
        .classed("active", false);
      canvas.style.cursor = "default";
      selStartPx = null;
      selCurPx = null;
      selDataRect = null;
      document.getElementById("ndvi-avg").style.display = "none";
    }

    storyMode = false;
    sliderLocked = false;
    updateCompareView();
  } else {
    redraw();
    updateHoverFromMouse();
  }
}

// ── Highlight / selection state ───────────────────────────────────────────────

let selectionMode = false;
let isDrawing     = false;
let selStartPx    = null;  // { x, y } in internal canvas pixels
let selCurPx      = null;  // { x, y } in internal canvas pixels — live drag end
let selDataRect   = null;  // { x1, y1, x2, y2 } in data space — committed on mouseup

// drawSelection draws the dashed box in SCREEN space.
// It runs after ctx.restore() so the zoom transform is no longer active,
// meaning we can draw directly in internal-pixel screen coordinates.
function drawSelection() {
  if (!selStartPx || !selCurPx) return;

  // Convert the two drag corners from internal-px data space → zoomed screen px
  const [sx1, sy1] = currentTransform.apply([selStartPx.x, selStartPx.y]);
  const [sx2, sy2] = currentTransform.apply([selCurPx.x,   selCurPx.y]);

  const x = Math.min(sx1, sx2);
  const y = Math.min(sy1, sy2);
  const w = Math.abs(sx2 - sx1);
  const h = Math.abs(sy2 - sy1);

  ctx.save();
  ctx.setLineDash([6, 3]);
  ctx.strokeStyle = "rgba(255, 220, 50, 0.95)";
  ctx.lineWidth   = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "rgba(255, 220, 50, 0.08)";
  ctx.fillRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}

function redraw() {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Zoomed layer: heatmap + region boxes
  ctx.save();
  ctx.setTransform(
    currentTransform.k, 0,
    0, currentTransform.k,
    currentTransform.x, currentTransform.y
  );
  ctx.drawImage(offscreen, 0, 0);
  drawRegions();
  ctx.restore();

  // Screen-space overlay: selection rectangle (no transform active here)
  drawSelection();
}

// ── Regions ───────────────────────────────────────────────────────────────────

const REGIONS = {
  "Amazon":          { lon_min: -75,  lon_max: -45,  lat_min: -20, lat_max:  5 },
  "Western US":      { lon_min: -125, lon_max: -105, lat_min:  30, lat_max: 50 },
  "Midwest":         { lon_min: -105, lon_max: -80,  lat_min:  36, lat_max: 50 },
  "Central America": { lon_min: -95,  lon_max: -75,  lat_min:   7, lat_max: 22 },
  "Andes":           { lon_min: -80,  lon_max: -65,  lat_min: -45, lat_max: 10 },
  "Canada/Arctic":   { lon_min: -140, lon_max: -60,  lat_min:  55, lat_max: 75 },
};

function drawRegions() {
  ctx.font        = `${12 / currentTransform.k}px Arial`;

  for (const [name, r] of Object.entries(REGIONS)) {
    const x1 = lonToX(r.lon_min);
    const x2 = lonToX(r.lon_max);
    const y1 = latToY(r.lat_max);
    const y2 = latToY(r.lat_min);

    const isHovered = name === hoveredRegionName;
    ctx.lineWidth   = (isHovered ? 4 : 2) / currentTransform.k;
    ctx.strokeStyle = isHovered ? "rgba(255, 220, 40, 0.98)" : "rgba(255,255,255,0.8)";
    ctx.fillStyle   = isHovered ? "rgba(255, 220, 40, 0.16)" : "rgba(255,255,255,0.9)";

    if (isHovered) {
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    }

    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

    const labelX = x1 + 4 / currentTransform.k;
    const labelY = y1 + 14 / currentTransform.k;
    if (isHovered) {
      const padding = 4 / currentTransform.k;
      const labelWidth = ctx.measureText(name).width;
      const labelHeight = 16 / currentTransform.k;

      ctx.fillStyle = "rgba(255, 245, 160, 0.95)";
      ctx.fillRect(
        labelX - padding,
        labelY - labelHeight + 2 / currentTransform.k,
        labelWidth + padding * 2,
        labelHeight + padding
      );

      ctx.fillStyle = "rgba(35, 35, 20, 1)";
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
    }
    ctx.fillText(name, labelX, labelY);
  }
}

function regionAt(dataX, dataY) {
  for (const [name, r] of Object.entries(REGIONS)) {
    const x1 = lonToX(r.lon_min);
    const x2 = lonToX(r.lon_max);
    const y1 = latToY(r.lat_max);
    const y2 = latToY(r.lat_min);
    if (dataX >= x1 && dataX <= x2 && dataY >= y1 && dataY <= y2) {
      return { name, x1, x2, y1, y2 };
    }
  }
  return null;
}

// ── Highlight mouse events ────────────────────────────────────────────────────
// We store drag points in DATA space (unzoomed internal pixels) so the box
// stays anchored correctly if the user zooms/pans after drawing.

canvas.addEventListener("mousedown", (e) => {
  if (!selectionMode) return;
  e.stopPropagation();   // prevent D3 zoom from stealing the drag

  const rect = canvas.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;

  // Convert CSS px → data space
  const [dx, dy] = canvasToData(cssX, cssY);
  selStartPx = { x: dx, y: dy };
  selCurPx   = { x: dx, y: dy };
  isDrawing  = true;

  selDataRect = null;
  document.getElementById("ndvi-avg").style.display = "none";
});

canvas.addEventListener("mousemove", (e) => {
  if (!selectionMode || !isDrawing) return;

  const rect = canvas.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;

  const [dx, dy] = canvasToData(cssX, cssY);
  selCurPx = { x: dx, y: dy };

  redraw();
});

canvas.addEventListener("mouseup", (e) => {
  if (!selectionMode || !isDrawing) return;
  isDrawing = false;

  if (!selStartPx || !selCurPx) return;

  const minSize = 4 / currentTransform.k;  // minimum drag size in data px
  if (Math.abs(selCurPx.x - selStartPx.x) < minSize ||
      Math.abs(selCurPx.y - selStartPx.y) < minSize) {
    selStartPx = null;
    selCurPx   = null;
    redraw();
    return;
  }

  selDataRect = {
    x1: Math.min(selStartPx.x, selCurPx.x),
    y1: Math.min(selStartPx.y, selCurPx.y),
    x2: Math.max(selStartPx.x, selCurPx.x),
    y2: Math.max(selStartPx.y, selCurPx.y),
  };

  computeAndShowAverage();
  redraw();
});

// ── Average NDVI computation ──────────────────────────────────────────────────

function computeAndShowAverage() {
  if (!window.currentGrid || !selDataRect) return;

  const grid = window.currentGrid;
  const rows = grid.length;
  const cols = grid[0].length;

  const c1 = Math.max(0,    Math.floor(selDataRect.x1 * cols / CANVAS_WIDTH));
  const c2 = Math.min(cols, Math.ceil( selDataRect.x2 * cols / CANVAS_WIDTH));
  const r1 = Math.max(0,    Math.floor(selDataRect.y1 * rows / CANVAS_HEIGHT));
  const r2 = Math.min(rows, Math.ceil( selDataRect.y2 * rows / CANVAS_HEIGHT));

  let sum = 0, count = 0;
  for (let r = r1; r < r2; r++) {
    for (let c = c1; c < c2; c++) {
      const v = grid[r][c];
      if (v !== null) { sum += v; count++; }
    }
  }

  const avgEl = document.getElementById("ndvi-avg");
  const valEl = document.getElementById("ndvi-avg-value");

  if (count === 0) {
    valEl.textContent = "No data in selection";
  } else {
    const avg = sum / count;
    valEl.textContent = `Avg vegetation proxy: ${avg.toFixed(4)}  (${count.toLocaleString()} cells)`;
  }

  avgEl.style.display = "block";
}

// ── Toggle button ─────────────────────────────────────────────────────────────

document.getElementById("toggle-select").addEventListener("click", () => {
  selectionMode = !selectionMode;

  const btn = document.getElementById("toggle-select");
  btn.textContent = selectionMode ? "✕ Cancel selection" : "⬚ Highlight region";
  btn.classList.toggle("active", selectionMode);

  canvas.style.cursor = selectionMode ? "crosshair" : "default";

  if (!selectionMode) {
    selStartPx  = null;
    selCurPx    = null;
    selDataRect = null;
    document.getElementById("ndvi-avg").style.display = "none";
    redraw();
  }
});

// ── Click-to-zoom ─────────────────────────────────────────────────────────────

canvas.addEventListener("click", (e) => {
  if (selectionMode) return;  // don't zoom while in selection mode

  if (storyMode) {
    storyMode    = false;
    sliderLocked = false;
  }

  const rect   = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const [dataX, dataY] = canvasToData(mouseX, mouseY);
  const hit = regionAt(dataX, dataY);

  if (!hit) {
    storyMode    = false;
    sliderLocked = false;
    if (activeZoomTransition) activeZoomTransition.end();

    activeZoomTransition = d3.select(canvas)
      .transition()
      .duration(600)
      .call(zoom.transform, d3.zoomIdentity);
    return;
  }

  if (activeZoomTransition) activeZoomTransition.end();

  const regionW = hit.x2 - hit.x1;
  const regionH = hit.y2 - hit.y1;
  const scale   = 0.8 * Math.min(CANVAS_WIDTH / regionW, CANVAS_HEIGHT / regionH);

  const centerX = (hit.x1 + hit.x2) / 2;
  const centerY = (hit.y1 + hit.y2) / 2;

  const tx = CANVAS_WIDTH  / 2 - scale * centerX;
  const ty = CANVAS_HEIGHT / 2 - scale * centerY;

  activeZoomTransition = d3.select(canvas)
    .transition()
    .duration(600)
    .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale))
    .on("end", () => {
      activeZoomTransition = null;
      playTimeline(hit.name);
    });
});

// ── Hover ─────────────────────────────────────────────────────────────────────

canvas.addEventListener("mousemove", (e) => {
  window.lastMouseX = e.clientX;
  window.lastMouseY = e.clientY;
  if (!isDrawing) updateHoverFromMouse();
});

function updateHoverFromMouse() {
  if (!window.currentGrid) return;
  if (window.lastMouseX === null || window.lastMouseY === null) return;

  const rect   = canvas.getBoundingClientRect();
  const mouseX = window.lastMouseX - rect.left;
  const mouseY = window.lastMouseY - rect.top;

  const [dataX, dataY] = canvasToData(mouseX, mouseY);

  const rows = window.currentGrid.length;
  const cols = window.currentGrid[0].length;

  const col = Math.floor(dataX * cols / CANVAS_WIDTH);
  const row = Math.floor(dataY * rows / CANVAS_HEIGHT);

  if (col < 0 || col >= cols || row < 0 || row >= rows) {
    hover.text("Vegetation proxy: —");
    return;
  }

  const value    = window.currentGrid[row][col];
  const proxyText = value === null ? "Vegetation proxy: —" : `Vegetation proxy: ${value.toFixed(3)}`;
  const region   = regionAt(dataX, dataY);
  const nextHoveredRegionName = region ? region.name : null;

  if (nextHoveredRegionName !== hoveredRegionName) {
    hoveredRegionName = nextHoveredRegionName;
    redraw();
  }

  hover.text(region ? `${region.name} — ${proxyText}` : proxyText);
}

canvas.addEventListener("mouseleave", () => {
  window.lastMouseX = null;
  window.lastMouseY = null;
  hover.text("Vegetation proxy: —");

  if (hoveredRegionName !== null) {
    hoveredRegionName = null;
    redraw();
  }
});

// ── Preload ───────────────────────────────────────────────────────────────────

const gridCache = {};
let cacheReady  = false;

async function preloadAll() {
  title.text("Loading data…");

  await Promise.all(
    months.map(async (ym) => {
      try {
        gridCache[ym] = await d3.json(`../ndvi_json/${ym}.json`);
      } catch {
        gridCache[ym] = null;
      }
    })
  );

  cacheReady = true;
  title.text(`NDVI — ${months[0]}`);
  populateCompareSelects();
  update();
  updateCompareView();
}

// ── Update ────────────────────────────────────────────────────────────────────

function update() {
  if (!cacheReady) return;
  const ym   = months[slider.node().value];
  const grid = gridCache[ym];
  title.text(`NDVI — ${ym}`);

  if (!grid) return;

  const isEmpty = grid.every(row => row.every(v => v === null));
  if (isEmpty) return;

  window.currentGrid = grid;
  drawNDVI(grid);
  redraw();
  updateRegionList(grid, mainRegionList);
  updateCompareView();

  updateHoverFromMouse();

  // Refresh the average readout if a selection is active
  if (selDataRect) computeAndShowAverage();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Region intro cards ────────────────────────────────────────────────────────

const REGION_INFO = {
  "Midwest": "The Midwest is the region that experiences the most fluctuation on average in a year!",
  "Andes":   "The Andes has the smallest fluctuation in vegetation score on average.",
};

async function playTimeline(regionName) {
  storyMode    = true;
  sliderLocked = true;

  if (REGION_INFO[regionName]) {
    showPopup(REGION_INFO[regionName], regionName, true);
  }

  for (let i = 0; i < months.length; i++) {
    if (!storyMode) break;

    slider.node().value = i;
    update();

    const event = isInteresting(regionName, months[i]);
    if (event) {
      showPopup(event.msg, regionName, false);
      await sleep(3000);
    } else {
      await sleep(100);
    }
  }

  storyMode    = false;
  sliderLocked = false;
}

function isInteresting(regionName, ym) {
  const [year, month] = ym.split("-").map(Number);

  const interesting = {
    "Midwest": [
      { y: 2014, m: 3, msg: "This is the lowest vegetation score recorded for the Midwest between 2000-2025" },
      { y: 2025, m: 8, msg: "The Midwest has the greatest outlier month, with a vegetation score of 0.376235 above the mean for this area!" }
    ],
    "Amazon": [
      { y: 2024, m: 9, msg: "This time marks the lowest vegetation score recorded in the Amazon region" }
    ],
    "Western US": [
      { y: 2008, m: 1, msg: "This month is the lowest vegetation score recorded in the Western US region" }
    ],
    "Central America": [
      { y: 2024, m: 10, msg: "This is the highest vegetation score recorded for any region!" },
      { y: 2009, m:  4, msg: "This is the lowest vegetation score recorded for Central America" }
    ],
    "Andes": [
      { y: 2003, m: 2, msg: "This is the lowest vegetation score recorded in the Andes" }
    ],
    "Canada/Arctic": [
      { y: 2012, m: 12, msg: "This is the lowest vegetation score recorded for any region throughout the past 25 years!" },
      { y: 2021, m: 11, msg: "This month showed the greatest increase in vegetation score recorded from a month to month period!" },
      { y: 2011, m:  4, msg: "This month showed the greatest decrease in vegetation score recorded from a month to month period!" }
    ],
  };

  const rules = interesting[regionName] || [];
  return rules.find(r => r.y === year && r.m === month) || null;
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function getRegionScreenRect(region) {
  const canvasRect    = canvas.getBoundingClientRect();
  const containerRect = document.getElementById("viz-container").getBoundingClientRect();

  const scaleX = CANVAS_WIDTH  / canvasRect.width;
  const scaleY = CANVAS_HEIGHT / canvasRect.height;

  const [sx1, sy1] = currentTransform.apply([region.x1, region.y1]);
  const [sx2, sy2] = currentTransform.apply([region.x2, region.y2]);

  return {
    left:   sx1 / scaleX + (canvasRect.left - containerRect.left),
    top:    sy1 / scaleY + (canvasRect.top  - containerRect.top),
    width:  (sx2 - sx1) / scaleX,
    height: (sy2 - sy1) / scaleY,
  };
}

function showPopup(text, regionName, isIntro = false) {
  const region = REGIONS[regionName];
  const x1 = lonToX(region.lon_min);
  const x2 = lonToX(region.lon_max);
  const y1 = latToY(region.lat_max);
  const y2 = latToY(region.lat_min);

  const rect   = getRegionScreenRect({ x1, x2, y1, y2 });
  const box    = d3.select("#popup");
  const popupW = Math.min(rect.width - 24, 320);

  const accentColor = isIntro ? "#1a6fa8" : "#92820a";
  const icon        = isIntro ? "ℹ️" : "📍";
  const label       = isIntro ? "Region overview" : regionName;
  const displayMs   = isIntro ? 4000 : 2200;

  box
    .html(`
      <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:${accentColor};
                text-transform:uppercase;letter-spacing:0.06em;">
        ${icon} ${label}
      </p>
      <p style="margin:0;">${text}</p>
    `)
    .style("left",      rect.left + 10 + "px")
    .style("top",       rect.top  + 10 + "px")
    .style("max-width", popupW    + "px")
    .style("transform", "none")
    .style("opacity",   1);

  setTimeout(() => {
    box.transition().duration(800).style("opacity", 0);
  }, displayMs);
}

// ── Slider ────────────────────────────────────────────────────────────────────

slider.on("input", () => {
  if (sliderLocked) return;
  update();
});

toggleCompare.on("click", () => {
  setCompareMode(!compareMode);
});

compareRightSelect.on("change", updateCompareView);

compareLeftCanvas.addEventListener("mousemove", event => updateCompareHover(event, "left"));
compareRightCanvas.addEventListener("mousemove", event => updateCompareHover(event, "right"));
compareLeftCanvas.addEventListener("mouseleave", () => compareLeftHover.text("Hover vegetation proxy: —"));
compareRightCanvas.addEventListener("mouseleave", () => compareRightHover.text("Hover vegetation proxy: —"));

// ── Resize observer ───────────────────────────────────────────────────────────

const resizeObserver = new ResizeObserver(() => { redraw(); });
resizeObserver.observe(document.getElementById("viz-container"));

// ── Boot ──────────────────────────────────────────────────────────────────────

preloadAll();

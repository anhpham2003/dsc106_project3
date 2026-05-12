let storyMode = false;
let sliderLocked = false;
let activeZoomTransition = null;

// list of months to scrub through
const months = [];
for (let y = 2000; y <= 2025; y++) {
  for (let m = 1; m <= 12; m++) {
    if (y == 2000 && (m == 1 || m == 2)) continue;
    if (y == 2025 && m == 4) continue;
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
}

// DOM elements
const slider = d3.select("#slider");
slider.attr("max", months.length - 1);

const title  = d3.select("#title");
const hover  = d3.select("#hover");

const canvas = d3.select("#heatmap").node();
const ctx    = canvas.getContext("2d");

// ── Internal (pixel) resolution – never changes ───────────────────────────────
// We always draw into this fixed pixel grid; the CSS `width:100%` on the canvas
// element makes the browser scale it visually without altering pixel math.
const CANVAS_WIDTH  = canvas.width;   // 1200
const CANVAS_HEIGHT = canvas.height;  // 900

// ── CSS-pixel scale factor ────────────────────────────────────────────────────
// The canvas is rendered as a CSS-fluid element. Mouse events arrive in CSS
// pixels, so we need to convert them to internal canvas pixels before doing
// any coordinate math. We read this from the canvas's current bounding rect.
function cssToCanvas(cssX, cssY) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = CANVAS_WIDTH  / rect.width;
  const scaleY = CANVAS_HEIGHT / rect.height;
  return [cssX * scaleX, cssY * scaleY];
}

// ── Zoom state ────────────────────────────────────────────────────────────────
let currentTransform = d3.zoomIdentity;

const zoom = d3.zoom()
  .scaleExtent([1, 20])
  .on("zoom", (event) => {
    currentTransform = event.transform;
    redraw();
  });

// Apply zoom to the canvas element. D3's zoom uses clientX/Y internally and
// maps them through the element's bounding rect, which works correctly whether
// the canvas is 1200 px wide or 400 px wide – BUT we must also account for the
// pixel-ratio mismatch when translating into data space (see canvasToData).
d3.select(canvas).call(zoom);

// ── Coordinate helpers ────────────────────────────────────────────────────────

function lonToX(lon) {
  return (lon - (-170)) / 140 * CANVAS_WIDTH;
}

function latToY(lat) {
  return (75 - lat) / 135 * CANVAS_HEIGHT;
}

// Convert a CSS-pixel mouse position → internal data-space point,
// accounting for both the CSS→canvas scale and the current zoom transform.
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

function redraw() {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.save();
  ctx.setTransform(
    currentTransform.k, 0,
    0, currentTransform.k,
    currentTransform.x, currentTransform.y
  );
  ctx.drawImage(offscreen, 0, 0);
  drawRegions();
  ctx.restore();
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
  ctx.lineWidth   = 2 / currentTransform.k;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.font        = `${12 / currentTransform.k}px Arial`;
  ctx.fillStyle   = "rgba(255,255,255,0.9)";

  for (const [name, r] of Object.entries(REGIONS)) {
    const x1 = lonToX(r.lon_min);
    const x2 = lonToX(r.lon_max);
    const y1 = latToY(r.lat_max);
    const y2 = latToY(r.lat_min);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.fillText(name, x1 + 4 / currentTransform.k, y1 + 14 / currentTransform.k);
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

// ── Click-to-zoom ─────────────────────────────────────────────────────────────

canvas.addEventListener("click", (e) => {
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
  if (!window.currentGrid) return;

  const rect   = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const [dataX, dataY] = canvasToData(mouseX, mouseY);

  const rows = window.currentGrid.length;
  const cols = window.currentGrid[0].length;

  const col = Math.floor(dataX * cols / CANVAS_WIDTH);
  const row = Math.floor(dataY * rows / CANVAS_HEIGHT);

  if (col < 0 || col >= cols || row < 0 || row >= rows) {
    hover.text("NDVI: —");
    return;
  }

  const value    = window.currentGrid[row][col];
  const ndviText = value === null ? "NDVI: —" : `NDVI: ${value.toFixed(3)}`;
  const region   = regionAt(dataX, dataY);

  hover.text(region ? `${region.name} — ${ndviText}` : ndviText);
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
  update();
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
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function playTimeline(regionName) {
  storyMode    = true;
  sliderLocked = true;

  for (let i = 0; i < months.length; i++) {
    if (!storyMode) break;

    slider.node().value = i;
    update();

    const event = isInteresting(regionName, months[i]);
    if (event) {
      showPopup(event.msg, regionName);
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

  // Scale CSS pixels → internal canvas pixels before applying zoom transform
  const scaleX = CANVAS_WIDTH  / canvasRect.width;
  const scaleY = CANVAS_HEIGHT / canvasRect.height;

  // Transform from internal pixel space → zoomed internal pixel space
  const [sx1, sy1] = currentTransform.apply([region.x1, region.y1]);
  const [sx2, sy2] = currentTransform.apply([region.x2, region.y2]);

  // Convert back to CSS pixels for DOM positioning
  return {
    left:   sx1 / scaleX + (canvasRect.left - containerRect.left),
    top:    sy1 / scaleY + (canvasRect.top  - containerRect.top),
    width:  (sx2 - sx1) / scaleX,
    height: (sy2 - sy1) / scaleY,
  };
}

function showPopup(text, regionName) {
  const region = REGIONS[regionName];
  const x1 = lonToX(region.lon_min);
  const x2 = lonToX(region.lon_max);
  const y1 = latToY(region.lat_max);
  const y2 = latToY(region.lat_min);

  const rect   = getRegionScreenRect({ x1, x2, y1, y2 });
  const box    = d3.select("#popup");
  const popupW = Math.min(rect.width - 24, 320);

  box
    .html(`<p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#92820a;text-transform:uppercase;letter-spacing:0.06em;">📍 ${regionName}</p><p style="margin:0;">${text}</p>`)
    .style("left",      rect.left + 10 + "px")
    .style("top",       rect.top  + 10 + "px")
    .style("max-width", popupW    + "px")
    .style("transform", "none")
    .style("opacity",   1);

  setTimeout(() => {
    box.transition().duration(800).style("opacity", 0);
  }, 2200);
}

// ── Slider ────────────────────────────────────────────────────────────────────

slider.on("input", () => {
  if (sliderLocked) return;
  update();
});

// ── Responsive: redraw on container resize ────────────────────────────────────
// The canvas *pixel* dimensions stay fixed (1200×900). The CSS makes it fluid.
// We only need to redraw so the zoom overlay stays crisp; no coordinate
// recalculation is required because all math is in internal pixel space.
const resizeObserver = new ResizeObserver(() => {
  // Reapply the current zoom transform identity so D3 recalculates its
  // internal viewport correctly, then redraw.
  redraw();
});
resizeObserver.observe(document.getElementById("viz-container"));

// ── Boot ──────────────────────────────────────────────────────────────────────

preloadAll();
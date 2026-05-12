let storyMode = false;
let sliderLocked = false;
let activeZoomTransition = null;

// list of months to scrub through
const months = [];
for (let y = 2000; y <= 2025; y++) {
  for (let m = 1; m <= 12; m++) {
    if (y == 2000) {
      if (m == 1 || m == 2) {
        continue;
      }
    }
    if (y == 2025) {
      if (m == 4) {
        continue;
      }
    }
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
}

// DOM elements
const slider = d3.select("#slider");
slider.attr("max", months.length - 1);

const title = d3.select("#title");
const hover = d3.select("#hover");

const canvas = d3.select("#heatmap").node();
const ctx = canvas.getContext("2d");

const CANVAS_WIDTH = canvas.width;
const CANVAS_HEIGHT = canvas.height;

// ── Zoom state ────────────────────────────────────────────────────────────────
// We track the current D3 zoom transform so every redraw uses it.
let currentTransform = d3.zoomIdentity;

const zoom = d3.zoom()
  .scaleExtent([1, 20])
  .on("zoom", (event) => {
    currentTransform = event.transform;
    redraw();
  });

d3.select(canvas).call(zoom);

// ── Coordinate helpers ────────────────────────────────────────────────────────

function lonToX(lon) {
  return (lon - (-170)) / 140 * CANVAS_WIDTH;
}

function latToY(lat) {
  return (75 - lat) / 135 * CANVAS_HEIGHT;
}

// Convert a canvas-space point (CSS pixels) → data-space point,
// accounting for the current zoom transform.
function canvasToData(cx, cy) {
  return currentTransform.invert([cx, cy]);
}

// ── Load JSON ─────────────────────────────────────────────────────────────────

async function loadNDVI(ym) {
  return await d3.json(`../ndvi_json/${ym}.json`);
}

// ── Draw ──────────────────────────────────────────────────────────────────────

// Offscreen canvas holds the raw pixel grid at native resolution.
// We composite it onto the main canvas with the zoom transform applied.
const offscreen = document.createElement("canvas");
offscreen.width = CANVAS_WIDTH;
offscreen.height = CANVAS_HEIGHT;
const offCtx = offscreen.getContext("2d");

function drawNDVI(grid) {
  const rows = grid.length;
  const cols = grid[0].length;

  const img = offCtx.createImageData(cols, rows);

  const color = d3.scaleSequential(d3.interpolateYlGn).domain([0, 1]);

  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r][c];
      const rgb = v === null ? d3.rgb("#e0e0e0") : d3.rgb(color(v));
      img.data[i++] = rgb.r;
      img.data[i++] = rgb.g;
      img.data[i++] = rgb.b;
      img.data[i++] = 255;
    }
  }

  // Draw raw grid into offscreen at native size, then stretch to canvas size
  const tmp = offCtx.createImageData(cols, rows);
  tmp.data.set(img.data);
  offCtx.putImageData(tmp, 0, 0);
  offCtx.drawImage(offscreen, 0, 0, cols, rows, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

function redraw() {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Apply zoom transform, then draw offscreen bitmap and region overlays
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
  "Amazon": { lon_min: -75, lon_max: -45, lat_min: -20, lat_max: 5 },
  "Western US": { lon_min: -125, lon_max: -105, lat_min: 30, lat_max: 50 },
  "Midwest": { lon_min: -105, lon_max: -80, lat_min: 36, lat_max: 50 },
  "Central America": { lon_min: -95, lon_max: -75, lat_min: 7, lat_max: 22 },
  "Andes": { lon_min: -80, lon_max: -65, lat_min: -45, lat_max: 10 },
  "Canada/Arctic": { lon_min: -140, lon_max: -60, lat_min: 55, lat_max: 75 },
};

function drawRegions() {
  // Scale line width so it stays visually consistent regardless of zoom
  ctx.lineWidth = 2 / currentTransform.k;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.font = `${12 / currentTransform.k}px Arial`;
  ctx.fillStyle = "rgba(255,255,255,0.9)";

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

// ── Click-to-zoom on region ───────────────────────────────────────────────────

canvas.addEventListener("click", (e) => {
  // If a story is running, stop it immediately
  if (storyMode) {
    storyMode = false;
    sliderLocked = false;
  }

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Map mouse position back into data space
  const [dataX, dataY] = canvasToData(mouseX, mouseY);
  const hit = regionAt(dataX, dataY);

  if (!hit) {
    // Stop story mode immediately
    storyMode = false;
    sliderLocked = false;

    if (activeZoomTransition) activeZoomTransition.end();

    if (!storyMode) {
      activeZoomTransition = d3.select(canvas)
        .transition()
        .duration(600)
        .call(zoom.transform, target);
    } else {
      zoom.transform(d3.select(canvas), target); // instant, safe
    }

    return;
  }


  if (activeZoomTransition) activeZoomTransition.end();

  // Compute region zoom
  const regionW = hit.x2 - hit.x1;
  const regionH = hit.y2 - hit.y1;
  const scale = 0.8 * Math.min(CANVAS_WIDTH / regionW, CANVAS_HEIGHT / regionH);

  const centerX = (hit.x1 + hit.x2) / 2;
  const centerY = (hit.y1 + hit.y2) / 2;

  const tx = CANVAS_WIDTH / 2 - scale * centerX;
  const ty = CANVAS_HEIGHT / 2 - scale * centerY;

  // Start new zoom transition
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

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Invert zoom to get data-space coordinates
  const [dataX, dataY] = canvasToData(mouseX, mouseY);

  const rows = window.currentGrid.length;
  const cols = window.currentGrid[0].length;

  const col = Math.floor(dataX * cols / CANVAS_WIDTH);
  const row = Math.floor(dataY * rows / CANVAS_HEIGHT);

  if (col < 0 || col >= cols || row < 0 || row >= rows) {
    hover.text("NDVI: —");
    return;
  }

  const value = window.currentGrid[row][col];
  const ndviText = value === null ? "NDVI: —" : `NDVI: ${value.toFixed(3)}`;
  const region = regionAt(dataX, dataY);

  hover.text(region ? `${region.name} — ${ndviText}` : ndviText);
});

// ── Preload all months into cache ─────────────────────────────────────────────

const gridCache = {};
let cacheReady = false;

async function preloadAll() {
  title.text("Loading data…");

  await Promise.all(
    months.map(async (ym) => {
      try {
        gridCache[ym] = await d3.json(`../ndvi_json/${ym}.json`);
      } catch {
        gridCache[ym] = null; // missing file — skip gracefully
      }
    })
  );

  cacheReady = true;
  title.text(`NDVI — ${months[0]}`);
  update();
}

// ── Update (slider) ───────────────────────────────────────────────────────────

function update() {
  if (!cacheReady) return;
  const ym = months[slider.node().value];
  const grid = gridCache[ym];
  title.text(`NDVI — ${ym}`);

  // Skip if file missing
  if (!grid) return;

  // Skip if grid is full of nulls
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
  storyMode = true;
  sliderLocked = true;

  for (let i = 0; i < months.length; i++) {
    if (!storyMode) break;

    const ym = months[i];
    const ymNext = months[i + 1];
    const ymNext2 = months[i + 2];

    // Always update the frame
    slider.node().value = i;
    update();

    // If interesting → slow down
    const event = isInteresting(regionName, ym);

    if (event) {
      showPopup(event.msg);
      await sleep(3000);
    }
    else {
      await sleep(100);   // fast scrub
    }
  }

  storyMode = false;
  sliderLocked = false;
}

function isInteresting(regionName, ym) {
  const [year, month] = ym.split("-").map(Number);

  const interesting = {
    "Midwest": [
      // As pop-up, display a card with the following information: 
      // "The Midwest is the region that experiences the most fluctuation on avereage in a year!"
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
      { y: 2009, m: 4, msg: "This is the lowest vegetation score recorded for Central America" }
    ],

    "Andes": [
      // As pop-up, display a card with the following information: 
      // "The Andes has the smallest fluctuation in vegetation score on average"
      { y: 2003, m: 2, msg: "This is the lowest vegetation score recorded in the Andes" }
    ],

    "Canada/Arctic": [
      { y: 2012, m: 12, msg: "This is the lowest vegetation score recorded for any region throughout the past 25 years!" },
      { y: 2021, m: 11, msg: "This month showed the greatest increase in vegetation score recorded from a month to month period!" },
      { y: 2011, m: 4, msg: "This month showed the greatest decrease in vegetation score recorded from a month to month period! " }
    ],
  };

  const rules = interesting[regionName] || [];
  return rules.find(r => r.y === year && r.m === month) || null;
}

function showPopup(text) {
  const box = d3.select("#popup");

  box.text(text)
    .style("opacity", 1);

  setTimeout(() => {
    box.transition()
      .duration(800)
      .style("opacity", 0);
  }, 2200);
}

slider.on("input", () => {
  if (sliderLocked) return; // ignore user input during story mode
  update();
});

preloadAll();
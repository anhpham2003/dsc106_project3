// list of months to scrub through
const months = [];
for (let y = 2020; y <= 2025; y++) {
  for (let m = 1; m <= 12; m++) {
    if (y === 2020 && m < 3) continue;
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

// load JSON
async function loadNDVI(ym) {
  return await d3.json(`../ndvi_json/${ym}.json`);
}

// draw maps
function drawNDVI(grid) {
  const rows = grid.length;
  const cols = grid[0].length;

  const img = ctx.createImageData(cols, rows);

  const color = d3.scaleSequential(d3.interpolateYlGn)
    .domain([0, 1]);

  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r][c];

      let rgb;
      if (v === null) {
        rgb = d3.rgb("#e0e0e0");
      } else {
        rgb = d3.rgb(color(v));
      }

      img.data[i++] = rgb.r;
      img.data[i++] = rgb.g;
      img.data[i++] = rgb.b;
      img.data[i++] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  ctx.drawImage(canvas, 0, 0, cols, rows, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

// region boxes -- considering mapping to physical shape
const REGIONS = {
  "Amazon": { lon_min: -75, lon_max: -45, lat_min: -20, lat_max: 5 },
  "Western US": { lon_min: -125, lon_max: -105, lat_min: 30, lat_max: 50 },
  "Midwest": { lon_min: -105, lon_max: -80, lat_min: 36, lat_max: 50 },
  "Central America": { lon_min: -95, lon_max: -75, lat_min: 7, lat_max: 22 },
  "Andes": { lon_min: -80, lon_max: -65, lat_min: -45, lat_max: 10 },
  "Canada/Arctic": { lon_min: -140, lon_max: -60, lat_min: 55, lat_max: 75 }
};

// 6. lon/lat to canvas coordinate conversion
function lonToX(lon) {
  return (lon - (-170)) / 140 * CANVAS_WIDTH;
}

function latToY(lat) {
  return (75 - lat) / 135 * CANVAS_HEIGHT;
}

// draw boundaries
function drawRegions() {
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";

  for (const [name, r] of Object.entries(REGIONS)) {
    const x1 = lonToX(r.lon_min);
    const x2 = lonToX(r.lon_max);
    const y1 = latToY(r.lat_max);
    const y2 = latToY(r.lat_min);

    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }
}

// hover detection
function regionAt(x, y) {
  for (const [name, r] of Object.entries(REGIONS)) {
    const x1 = lonToX(r.lon_min);
    const x2 = lonToX(r.lon_max);
    const y1 = latToY(r.lat_max);
    const y2 = latToY(r.lat_min);

    if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
      return name;
    }
  }
  return null;
}

// hover activity
canvas.addEventListener("mousemove", (e) => {
  if (!window.currentGrid) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const rows = window.currentGrid.length;
  const cols = window.currentGrid[0].length;

  let col = Math.floor(x * cols / CANVAS_WIDTH);
  let row = Math.floor(y * rows / CANVAS_HEIGHT);

  // Prevent out-of-bounds
  if (col < 0 || col >= cols || row < 0 || row >= rows) {
    hover.text("NDVI: —");
    return;
  }

  const value = window.currentGrid[row][col];

  let ndviText = value === null ? "NDVI: —" : `NDVI: ${value.toFixed(3)}`;

  const region = regionAt(x, y);

  if (region) {
    hover.text(`${region} — ${ndviText}`);
  } else {
    hover.text(ndviText);
  }
});

// =====================================================
// 10. Update function
// =====================================================
async function update() {
  const ym = months[slider.node().value];
  title.text(`NDVI — ${ym}`);

  const grid = await loadNDVI(ym);
  window.currentGrid = grid;

  drawNDVI(grid);
  drawRegions(); 
}

slider.on("input", update);

// =====================================================
// 11. Initialize
// =====================================================
update();

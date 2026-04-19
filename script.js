const FIELD_OPTIONS = [
  { value: "", label: "Ignore" },
  { value: "name", label: "Name" },
  { value: "class", label: "Class" },
  { value: "rollNo", label: "Roll No" },
  { value: "title", label: "Title" },
  { value: "assignment", label: "Assignment" },
  { value: "experiment", label: "Experiment" },
  { value: "subject", label: "Subject" },
  { value: "custom", label: "Custom" },
];

const FIELD_ALIASES = {
  name: ["name", "student name", "candidate name"],
  class: ["class", "section", "standard", "grade"],
  rollNo: ["roll no", "roll number", "rollno", "roll"],
  title: ["title", "heading", "document title", "photo name"],
  assignment: ["assignment", "assignment name", "homework", "topic"],
  experiment: ["experiment", "experiment name", "practical"],
  subject: ["subject", "course", "project", "lab"],
};

const fileInput = document.querySelector("#fileInput");
const promptInput = document.querySelector("#promptInput");
const fontPreset = document.querySelector("#fontPreset");
const scanButton = document.querySelector("#scanButton");
const renderButton = document.querySelector("#renderButton");
const downloadButton = document.querySelector("#downloadButton");
const statusCard = document.querySelector("#statusCard");
const promptChanges = document.querySelector("#promptChanges");
const promptCount = document.querySelector("#promptCount");
const lineCount = document.querySelector("#lineCount");
const lineEditor = document.querySelector("#lineEditor");
const previewImage = document.querySelector("#previewImage");
const previewStage = document.querySelector("#previewStage");
const previewPlaceholder = document.querySelector("#previewPlaceholder");
const overlayLayer = document.querySelector("#overlayLayer");
const showOriginal = document.querySelector("#showOriginal");
const ocrText = document.querySelector("#ocrText");
const sourceCanvas = document.querySelector("#sourceCanvas");
const resultCanvas = document.querySelector("#resultCanvas");

const state = {
  originalDataUrl: "",
  editedDataUrl: "",
  originalWidth: 0,
  originalHeight: 0,
  parsedChanges: [],
  lines: [],
  activeLineId: null,
};

function setStatus(message, type = "idle") {
  statusCard.textContent = message;
  statusCard.dataset.state = type;
}

function normalizeText(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function humanizeField(field) {
  return FIELD_OPTIONS.find((option) => option.value === field)?.label || "Custom";
}

function parsePrompt(prompt) {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) {
    return [];
  }

  const allAliases = Object.values(FIELD_ALIASES).flat().map(escapeRegExp).join("|");
  const parsed = [];

  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    aliases.forEach((alias) => {
      const pattern = new RegExp(
        `(?:change|replace|update|set)?\\s*${escapeRegExp(alias)}\\s*(?:to|as|=|:|with)?\\s+(.+?)(?=(?:\\s+(?:and|,|then)\\s+(?:change|replace|update|set)?\\s*(?:${allAliases})\\b)|$)`,
        "i"
      );
      const match = cleanPrompt.match(pattern);
      if (match && !parsed.some((entry) => entry.field === field)) {
        parsed.push({
          field,
          value: match[1].trim().replace(/^["']|["']$/g, ""),
        });
      }
    });
  });

  return parsed;
}

function renderPromptChanges() {
  promptChanges.innerHTML = "";
  promptCount.textContent = `${state.parsedChanges.length} parsed`;

  if (!state.parsedChanges.length) {
    const item = document.createElement("div");
    item.className = "mini-item";
    item.innerHTML =
      "<strong>No parsed changes yet</strong><small>Use words like name, class, roll no, assignment, experiment, or title in the prompt.</small>";
    promptChanges.append(item);
    return;
  }

  state.parsedChanges.forEach((change) => {
    const item = document.createElement("div");
    item.className = "mini-item";
    item.innerHTML = `<strong>${humanizeField(change.field)}</strong><small>${change.value}</small>`;
    promptChanges.append(item);
  });
}

function setPreview(url) {
  previewImage.src = url;
  previewImage.hidden = false;
  previewPlaceholder.hidden = true;
}

function getFontFamily(preset, lineText) {
  if (preset === "mono") {
    return '"IBM Plex Mono", "Courier New", monospace';
  }
  if (preset === "serif") {
    return '"Times New Roman", Georgia, serif';
  }
  if (preset === "sans") {
    return "Arial, Helvetica, sans-serif";
  }

  const text = lineText || "";
  if (/[{}\[\]();=_]/.test(text) || /^\s*>>>/.test(text) || text.includes("Python")) {
    return '"IBM Plex Mono", "Courier New", monospace';
  }

  return '"Times New Roman", Georgia, serif';
}

function averageBackgroundColor(imageData) {
  const counts = new Map();
  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3];
    if (alpha < 10) {
      continue;
    }
    const r = Math.round(imageData.data[index] / 16) * 16;
    const g = Math.round(imageData.data[index + 1] / 16) * 16;
    const b = Math.round(imageData.data[index + 2] / 16) * 16;
    const key = `${r},${g},${b}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  let winner = "255,255,255";
  let max = 0;
  counts.forEach((count, key) => {
    if (count > max) {
      max = count;
      winner = key;
    }
  });
  return `rgb(${winner})`;
}

function detectInkColor(imageData) {
  let best = { brightness: 9999, r: 32, g: 32, b: 32 };
  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3];
    if (alpha < 10) {
      continue;
    }
    const r = imageData.data[index];
    const g = imageData.data[index + 1];
    const b = imageData.data[index + 2];
    const brightness = r + g + b;
    if (brightness < best.brightness) {
      best = { brightness, r, g, b };
    }
  }
  return `rgb(${best.r}, ${best.g}, ${best.b})`;
}

async function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve({
        dataUrl: reader.result,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        image,
      });
      image.onerror = () => reject(new Error("The selected image could not be loaded."));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error("File reading failed."));
    reader.readAsDataURL(file);
  });
}

async function loadPdfFile(file) {
  if (!window.pdfjsLib) {
    throw new Error("PDF support is not available yet. Reload the page and try again.");
  }

  const arrayBuffer = await file.arrayBuffer();
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
  };
}

async function loadSourceFile(file) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return loadPdfFile(file);
  }
  return loadImageFile(file);
}

function scaleBoxToPreview(bbox) {
  const displayedWidth = previewImage.clientWidth || 1;
  const displayedHeight = previewImage.clientHeight || 1;
  const scaleX = displayedWidth / state.originalWidth;
  const scaleY = displayedHeight / state.originalHeight;
  return {
    left: bbox.x0 * scaleX,
    top: bbox.y0 * scaleY,
    width: Math.max(10, (bbox.x1 - bbox.x0) * scaleX),
    height: Math.max(10, (bbox.y1 - bbox.y0) * scaleY),
  };
}

function renderOverlay() {
  overlayLayer.innerHTML = "";
  if (!state.lines.length || previewImage.hidden) {
    return;
  }

  state.lines.forEach((line) => {
    const div = document.createElement("button");
    div.type = "button";
    div.className = `overlay-box${line.id === state.activeLineId ? " active" : ""}`;
    const box = scaleBoxToPreview(line.bbox);
    div.style.left = `${box.left}px`;
    div.style.top = `${box.top}px`;
    div.style.width = `${box.width}px`;
    div.style.height = `${box.height}px`;
    div.title = line.text;
    div.addEventListener("click", () => {
      state.activeLineId = line.id;
      renderLineEditor();
      renderOverlay();
    });
    overlayLayer.append(div);
  });
}

function createSelect(selectedValue) {
  const select = document.createElement("select");
  FIELD_OPTIONS.forEach((option) => {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    element.selected = option.value === selectedValue;
    select.append(element);
  });
  return select;
}

function renderLineEditor() {
  lineEditor.innerHTML = "";
  lineCount.textContent = `${state.lines.length} lines`;

  if (!state.lines.length) {
    const item = document.createElement("div");
    item.className = "line-item";
    item.innerHTML =
      "<strong>No OCR lines yet</strong><small>Click Detect text after uploading a file.</small>";
    lineEditor.append(item);
    return;
  }

  state.lines.forEach((line) => {
    const item = document.createElement("div");
    item.className = `line-item${line.id === state.activeLineId ? " active" : ""}`;
    item.addEventListener("click", () => {
      state.activeLineId = line.id;
      renderLineEditor();
      renderOverlay();
    });

    const title = document.createElement("strong");
    title.textContent = line.text;
    item.append(title);

    const sub = document.createElement("small");
    sub.textContent = `Confidence ${Math.round((line.confidence || 0) * 100)}%`;
    item.append(sub);

    const grid = document.createElement("div");
    grid.className = "line-grid";

    const select = createSelect(line.field);
    select.addEventListener("change", (event) => {
      line.field = event.target.value;
      renderOverlay();
    });

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Replacement value";
    input.value = line.value;
    input.addEventListener("input", (event) => {
      line.value = event.target.value;
    });

    grid.append(select, input);
    item.append(grid);
    lineEditor.append(item);
  });
}

function matchPromptChangesToLines() {
  const normalizedChanges = state.parsedChanges.map((change) => ({
    ...change,
    aliases: FIELD_ALIASES[change.field].map(normalizeText),
  }));

  state.lines.forEach((line) => {
    line.field = "";
    line.value = "";
  });

  normalizedChanges.forEach((change) => {
    const best = state.lines
      .map((line) => {
        const normalizedLine = normalizeText(line.text);
        let score = 0;
        change.aliases.forEach((alias) => {
          if (normalizedLine.includes(alias)) {
            score += alias.length + 25;
          }
        });
        if (change.field === "rollNo" && /\b\d+\b/.test(line.text)) {
          score += 6;
        }
        return { line, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0];

    if (best) {
      best.line.field = change.field;
      best.line.value = change.value;
    }
  });
}

async function runOcr(dataUrl) {
  const result = await Tesseract.recognize(dataUrl, "eng", {
    logger(message) {
      if (message.status === "recognizing text") {
        const progress = Math.round((message.progress || 0) * 100);
        setStatus(`Recognizing text... ${progress}%`, "working");
      }
    },
  });
  return result;
}

function getReplacementPlan(ctx, line) {
  const originalText = line.text.trim();
  const value = line.value.trim();
  const bboxWidth = line.bbox.x1 - line.bbox.x0;
  const bboxHeight = line.bbox.y1 - line.bbox.y0;
  const family = getFontFamily(fontPreset.value, originalText);
  const fontSize = Math.max(12, Math.round(bboxHeight * 0.82));
  ctx.font = `${fontSize}px ${family}`;

  const separatorMatch = originalText.match(/^(.+?[:=-]\s*)(.+)$/);
  if (separatorMatch) {
    const prefix = separatorMatch[1];
    const prefixWidth = ctx.measureText(prefix).width;
    return {
      text: value,
      x: line.bbox.x0 + prefixWidth,
      y: line.bbox.y0,
      width: Math.max(36, bboxWidth - prefixWidth + fontSize * 0.6),
      height: bboxHeight,
      fontSize,
      family,
    };
  }

  return {
    text: value,
    x: line.bbox.x0,
    y: line.bbox.y0,
    width: bboxWidth + fontSize * 0.6,
    height: bboxHeight,
    fontSize,
    family,
  };
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current) {
    lines.push(current);
  }

  return lines;
}

function applyReplacement(ctx, line) {
  const plan = getReplacementPlan(ctx, line);
  const paddingX = Math.max(5, Math.round(plan.fontSize * 0.22));
  const paddingY = Math.max(4, Math.round(plan.fontSize * 0.18));
  const sampleX = Math.max(0, Math.floor(plan.x - paddingX));
  const sampleY = Math.max(0, Math.floor(plan.y - paddingY));
  const sampleWidth = Math.min(ctx.canvas.width - sampleX, Math.ceil(plan.width + paddingX * 2));
  const sampleHeight = Math.min(ctx.canvas.height - sampleY, Math.ceil(plan.height + paddingY * 2));
  const region = ctx.getImageData(sampleX, sampleY, sampleWidth, sampleHeight);
  const bg = averageBackgroundColor(region);
  const ink = detectInkColor(region);

  ctx.fillStyle = bg;
  ctx.fillRect(sampleX, sampleY, sampleWidth, sampleHeight);

  ctx.font = `${plan.fontSize}px ${plan.family}`;
  ctx.fillStyle = ink;
  ctx.textBaseline = "top";
  const lines = wrapText(ctx, plan.text, plan.width);
  lines.forEach((content, index) => {
    ctx.fillText(content, plan.x, plan.y + index * plan.fontSize * 1.08);
  });
}

async function detectText() {
  const file = fileInput.files?.[0];
  state.parsedChanges = parsePrompt(promptInput.value);
  renderPromptChanges();

  if (!file) {
    setStatus("Choose a screenshot, image, or PDF first.", "error");
    return;
  }

  scanButton.disabled = true;
  renderButton.disabled = true;
  downloadButton.disabled = true;

  try {
    setStatus("Loading source file...", "working");
    const source = await loadSourceFile(file);
    state.originalDataUrl = source.dataUrl;
    state.originalWidth = source.width;
    state.originalHeight = source.height;
    state.editedDataUrl = "";

    setPreview(source.dataUrl);
    showOriginal.checked = false;

    const ocr = await runOcr(source.dataUrl);
    ocrText.textContent = ocr.data.text.trim() || "OCR finished, but no text was found.";
    state.lines = (ocr.data.lines || []).map((line, index) => ({
      id: `line-${index}`,
      text: line.text.trim(),
      bbox: line.bbox,
      confidence: (line.confidence || 0) / 100,
      field: "",
      value: "",
    })).filter((line) => line.text);

    matchPromptChangesToLines();
    state.activeLineId = state.lines[0]?.id || null;
    renderLineEditor();
    renderOverlay();
    renderButton.disabled = !state.lines.length;

    setStatus(
      state.lines.length
        ? "Text detected. Review the lines, adjust any field mapping, then click Render result."
        : "No lines were detected. Try a clearer screenshot or a higher-resolution file.",
      state.lines.length ? "success" : "error"
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Text detection failed.", "error");
  } finally {
    scanButton.disabled = false;
  }
}

async function renderResult() {
  if (!state.originalDataUrl) {
    setStatus("Upload and detect text first.", "error");
    return;
  }

  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Preview image could not be prepared."));
    element.src = state.originalDataUrl;
  });

  resultCanvas.width = state.originalWidth;
  resultCanvas.height = state.originalHeight;
  const ctx = resultCanvas.getContext("2d");
  ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
  ctx.drawImage(image, 0, 0, resultCanvas.width, resultCanvas.height);

  const editable = state.lines.filter((line) => line.field && line.value.trim());
  if (!editable.length) {
    setStatus("Assign at least one detected line to a field and enter a replacement value.", "error");
    return;
  }

  editable.forEach((line) => {
    applyReplacement(ctx, line);
  });

  state.editedDataUrl = resultCanvas.toDataURL("image/png");
  downloadButton.disabled = false;
  showOriginal.checked = false;
  setPreview(state.editedDataUrl);
  setStatus("Rendered. Check the preview and download the PNG if it looks right.", "success");
}

function syncPromptPreview() {
  state.parsedChanges = parsePrompt(promptInput.value);
  renderPromptChanges();
}

fileInput?.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    const source = await loadSourceFile(file);
    state.originalDataUrl = source.dataUrl;
    state.originalWidth = source.width;
    state.originalHeight = source.height;
    state.editedDataUrl = "";
    state.lines = [];
    state.activeLineId = null;
    setPreview(source.dataUrl);
    renderLineEditor();
    renderOverlay();
    ocrText.textContent = "No OCR result yet.";
    renderButton.disabled = true;
    downloadButton.disabled = true;
    setStatus("File loaded. Add your prompt if needed, then click Detect text.", "idle");
  } catch (error) {
    setStatus(error.message || "The selected file could not be loaded.", "error");
  }
});

promptInput?.addEventListener("input", syncPromptPreview);

scanButton?.addEventListener("click", detectText);
renderButton?.addEventListener("click", renderResult);

downloadButton?.addEventListener("click", () => {
  if (!state.editedDataUrl) {
    return;
  }
  const link = document.createElement("a");
  link.href = state.editedDataUrl;
  link.download = "inkshift-edited.png";
  link.click();
});

showOriginal?.addEventListener("change", () => {
  if (showOriginal.checked || !state.editedDataUrl) {
    if (state.originalDataUrl) {
      setPreview(state.originalDataUrl);
    }
  } else {
    setPreview(state.editedDataUrl);
  }
});

window.addEventListener("resize", renderOverlay);
previewImage?.addEventListener("load", renderOverlay);

renderPromptChanges();
renderLineEditor();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Ignore service worker errors during local preview.
    });
  });
}

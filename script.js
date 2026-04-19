const FIELD_ALIASES = {
  name: ["name", "student name", "candidate name"],
  class: ["class", "section", "standard", "grade"],
  rollNo: ["roll no", "roll number", "rollno", "roll"],
  assignment: ["assignment", "assignment name", "homework", "topic"],
  experiment: ["experiment", "experiment name", "practical", "experiment title"],
  title: ["title", "photo name", "document title", "sheet title", "heading"],
  subject: ["subject", "course", "lab", "project"],
};

const imageInput = document.querySelector("#imageInput");
const promptInput = document.querySelector("#promptInput");
const runButton = document.querySelector("#runButton");
const downloadButton = document.querySelector("#downloadButton");
const statusCard = document.querySelector("#statusCard");
const changeList = document.querySelector("#changeList");
const changeCount = document.querySelector("#changeCount");
const previewImage = document.querySelector("#previewImage");
const previewPlaceholder = document.querySelector("#previewPlaceholder");
const comparisonToggle = document.querySelector("#comparisonToggle");
const ocrText = document.querySelector("#ocrText");
const canvas = document.querySelector("#editorCanvas");

const state = {
  originalImage: null,
  originalDataUrl: "",
  editedDataUrl: "",
  ocrResult: null,
  changes: [],
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
  if (field === "rollNo") {
    return "Roll No";
  }

  return field.charAt(0).toUpperCase() + field.slice(1);
}

function setPreview(url) {
  previewImage.src = url;
  previewImage.hidden = false;
  previewPlaceholder.hidden = true;
}

function renderChanges(changes) {
  changeList.innerHTML = "";
  changeCount.textContent = `${changes.length} ${changes.length === 1 ? "change" : "changes"}`;

  if (!changes.length) {
    const empty = document.createElement("div");
    empty.className = "change-item";
    empty.innerHTML = "<strong>No parsed changes yet</strong><small>Write a prompt that mentions fields like name, class, roll no, title, assignment, or experiment.</small>";
    changeList.append(empty);
    return;
  }

  changes.forEach((change) => {
    const item = document.createElement("div");
    item.className = "change-item";
    item.innerHTML = `
      <strong>${humanizeField(change.field)}</strong>
      <small>${change.value}</small>
    `;
    changeList.append(item);
  });
}

function parsePrompt(prompt) {
  const cleanPrompt = prompt.trim();

  if (!cleanPrompt) {
    return [];
  }

  const changes = [];

  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    aliases.forEach((alias) => {
      const pattern = new RegExp(
        `(?:change|replace|update|set)?\\s*${escapeRegExp(alias)}\\s*(?:to|as|=|:|with)?\\s+(.+?)(?=(?:\\s+(?:and|,|then)\\s+(?:change|replace|update|set)?\\s*(?:${Object.values(FIELD_ALIASES).flat().map(escapeRegExp).join("|")})\\b)|$)`,
        "i"
      );
      const match = cleanPrompt.match(pattern);

      if (match) {
        const value = match[1].trim().replace(/^["']|["']$/g, "");

        if (value && !changes.some((entry) => entry.field === field)) {
          changes.push({ field, value });
        }
      }
    });
  });

  return changes;
}

function getLabelVariants(field) {
  return FIELD_ALIASES[field] || [];
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
  let maxCount = 0;
  counts.forEach((count, key) => {
    if (count > maxCount) {
      maxCount = count;
      winner = key;
    }
  });

  return `rgb(${winner})`;
}

function detectInkColor(imageData) {
  let best = { brightness: 1000, r: 32, g: 32, b: 32 };

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

function findLineForChange(lines, change) {
  const normalizedAliases = getLabelVariants(change.field).map(normalizeText);

  const scored = lines
    .map((line) => {
      const text = line.text.trim();
      const normalized = normalizeText(text);
      let score = 0;

      normalizedAliases.forEach((alias) => {
        if (normalized.includes(alias)) {
          score += alias.length + 30;
        }
      });

      if (change.field === "rollNo" && /\b\d+\b/.test(text)) {
        score += 8;
      }

      if ((change.field === "assignment" || change.field === "experiment" || change.field === "title") && line.bbox.y0 < 220) {
        score += 6;
      }

      return { line, text, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.line || null;
}

function buildReplacementText(lineText, change) {
  const aliases = getLabelVariants(change.field);

  for (const alias of aliases) {
    const regex = new RegExp(`(${escapeRegExp(alias)}\\s*[:=-]?\\s*)(.+)$`, "i");
    if (regex.test(lineText)) {
      return lineText.replace(regex, `$1${change.value}`);
    }
  }

  return change.value;
}

function clearTextArea(ctx, bbox) {
  const paddingX = Math.max(8, Math.round((bbox.x1 - bbox.x0) * 0.08));
  const paddingY = Math.max(6, Math.round((bbox.y1 - bbox.y0) * 0.2));
  const x = Math.max(0, Math.round(bbox.x0 - paddingX));
  const y = Math.max(0, Math.round(bbox.y0 - paddingY));
  const width = Math.min(ctx.canvas.width - x, Math.round(bbox.x1 - bbox.x0 + paddingX * 2));
  const height = Math.min(ctx.canvas.height - y, Math.round(bbox.y1 - bbox.y0 + paddingY * 2));

  const region = ctx.getImageData(x, y, width, height);
  ctx.fillStyle = averageBackgroundColor(region);
  ctx.fillRect(x, y, width, height);

  return region;
}

function drawReplacementText(ctx, bbox, text, sample) {
  const inkColor = detectInkColor(sample);
  const fontSize = Math.max(16, Math.round((bbox.y1 - bbox.y0) * 0.78));

  ctx.fillStyle = inkColor;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = `600 ${fontSize}px "Times New Roman", Georgia, serif`;

  const maxWidth = Math.max(60, bbox.x1 - bbox.x0 + 50);
  const textX = bbox.x0;
  let textY = bbox.y0;
  const words = text.split(/\s+/);
  let currentLine = "";
  const wrappedLines = [];

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(nextLine).width > maxWidth && currentLine) {
      wrappedLines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  });

  if (currentLine) {
    wrappedLines.push(currentLine);
  }

  wrappedLines.forEach((line, index) => {
    ctx.fillText(line, textX, textY + index * fontSize * 1.12, maxWidth + 24);
  });
}

async function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve({ image, dataUrl: reader.result });
      image.onerror = () => reject(new Error("Could not read the selected image."));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error("File reading failed."));
    reader.readAsDataURL(file);
  });
}

async function runOcr(image) {
  const result = await Tesseract.recognize(image, "eng", {
    logger(message) {
      if (message.status === "recognizing text") {
        const pct = Math.round((message.progress || 0) * 100);
        setStatus(`Reading text from image... ${pct}%`, "working");
      }
    },
  });

  return result;
}

async function processImage() {
  const file = imageInput.files?.[0];
  const prompt = promptInput.value;
  const parsedChanges = parsePrompt(prompt);
  state.changes = parsedChanges;
  renderChanges(parsedChanges);

  if (!file) {
    setStatus("Please choose an image first.", "error");
    return;
  }

  if (!parsedChanges.length) {
    setStatus("I could not understand the requested changes. Mention fields like name, class, roll no, assignment, experiment, or title.", "error");
    return;
  }

  runButton.disabled = true;
  downloadButton.disabled = true;
  setStatus("Loading image...", "working");

  try {
    const { image, dataUrl } = await loadImageFromFile(file);
    state.originalImage = image;
    state.originalDataUrl = dataUrl;
    setPreview(dataUrl);

    setStatus("Starting OCR scan...", "working");
    const result = await runOcr(image);
    state.ocrResult = result;
    ocrText.textContent = result.data.text.trim() || "OCR finished, but no text was recognized.";

    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const lines = result.data.lines || [];
    const applied = [];

    parsedChanges.forEach((change) => {
      const line = findLineForChange(lines, change);

      if (!line) {
        applied.push({
          ...change,
          status: "Not matched in OCR",
        });
        return;
      }

      const replacementText = buildReplacementText(line.text.trim(), change);
      const sample = clearTextArea(ctx, line.bbox);
      drawReplacementText(ctx, line.bbox, replacementText, sample);

      applied.push({
        ...change,
        status: `Updated "${line.text.trim()}"`,
      });
    });

    state.changes = applied;
    renderChanges(
      applied.map((entry) => ({
        field: entry.field,
        value: `${entry.value} • ${entry.status}`,
      }))
    );

    state.editedDataUrl = canvas.toDataURL("image/png");
    comparisonToggle.checked = false;
    setPreview(state.editedDataUrl);
    downloadButton.disabled = false;

    const missed = applied.filter((entry) => entry.status === "Not matched in OCR").length;
    const statusMessage = missed
      ? `Finished with ${missed} unmatched field${missed === 1 ? "" : "s"}. Try a clearer photo or mention the label exactly as it appears in the image.`
      : "Finished. Your edited image is ready to download.";
    setStatus(statusMessage, missed ? "error" : "success");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Something went wrong while editing the image.", "error");
  } finally {
    runButton.disabled = false;
  }
}

imageInput?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  try {
    const { dataUrl } = await loadImageFromFile(file);
    state.originalDataUrl = dataUrl;
    state.editedDataUrl = "";
    previewImage.hidden = false;
    previewPlaceholder.hidden = true;
    previewImage.src = dataUrl;
    downloadButton.disabled = true;
    ocrText.textContent = "No OCR result yet.";
    setStatus("Image loaded. Add your prompt and click Process image.", "idle");
  } catch (error) {
    setStatus("The selected file could not be loaded.", "error");
  }
});

promptInput?.addEventListener("input", () => {
  const parsedChanges = parsePrompt(promptInput.value);
  state.changes = parsedChanges;
  renderChanges(parsedChanges);
});

runButton?.addEventListener("click", () => {
  processImage();
});

downloadButton?.addEventListener("click", () => {
  if (!state.editedDataUrl) {
    return;
  }

  const link = document.createElement("a");
  link.href = state.editedDataUrl;
  link.download = "edited-document.png";
  link.click();
});

comparisonToggle?.addEventListener("change", () => {
  if (!state.originalDataUrl) {
    comparisonToggle.checked = false;
    return;
  }

  if (comparisonToggle.checked || !state.editedDataUrl) {
    setPreview(state.originalDataUrl);
    return;
  }

  setPreview(state.editedDataUrl);
});

renderChanges([]);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Ignore local preview failures.
    });
  });
}

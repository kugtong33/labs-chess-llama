import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PptxGenJS = require("pptxgenjs");
const QRCode = require("qrcode");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const content = JSON.parse(fs.readFileSync(path.join(HERE, "content.json"), "utf8"));
const outputStem = "local-llms-my-8gb-vram-vs-world";
const sourceAsset = (name) => path.join(ROOT, "assets", "source", name);
const ASSET_ASPECTS = Object.freeze({
  "eniac.png": 2448 / 3758,
  "ibm-2030.jpg": 5101 / 3408,
  "kenbak1.jpg": 2332 / 3124,
  "hugging-face.svg": 256 / 963,
  "llama-cpp.svg": 600 / 2793,
  "ollama.svg": 25 / 17,
});

const C = {
  paper: "F3EFE4",
  panel: "FFFDF6",
  ink: "171A16",
  muted: "62695D",
  line: "D4CEBE",
  accent: "D65B35",
  accent2: "E89B45",
  green: "34735B",
  paleGreen: "DCE8DF",
  paleOrange: "F3D8C6",
  dark: "11140F",
  white: "FFFDF7",
  black: "080A08",
};

const QR_CODES = new Map();
for (const slide of content.slides.filter((item) => item.kind === "repositories")) {
  for (const repository of slide.repositories) {
    QR_CODES.set(repository.url, await QRCode.toDataURL(repository.url, {
      errorCorrectionLevel: "H",
      margin: 3,
      width: 900,
      color: { dark: `#${C.dark}`, light: `#${C.white}` },
    }));
  }
}

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Chess Llama project";
pptx.company = "Chess Llama";
pptx.subject = "The potential of local language models";
pptx.title = content.title;
pptx.lang = "en-US";
pptx.theme = {
  headFontFace: "Liberation Sans",
  bodyFontFace: "Liberation Sans",
  lang: "en-US",
};
pptx.defineSlideMaster({
  title: "PAPER",
  background: { color: C.paper },
  objects: [
    { rect: { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: C.accent }, line: { color: C.accent } } },
    { line: { x: 0.55, y: 7.14, w: 12.23, h: 0, line: { color: C.line, width: 0.7 } } },
    { text: { text: "LOCAL LLMs · 8 GB VRAM", options: { x: 0.62, y: 7.2, w: 3.3, h: 0.16, fontFace: "Liberation Mono", fontSize: 8.5, color: C.muted, margin: 0, charSpacing: 1.5 } } },
  ],
  slideNumber: { x: 12.35, y: 7.16, w: 0.35, h: 0.18, fontFace: "Liberation Mono", fontSize: 8.5, color: C.muted, align: "right", margin: 0 },
});

const S = pptx.ShapeType;

function rect(slide, x, y, w, h, fill, radius = 0, line = fill) {
  slide.addShape(radius ? S.roundRect : S.rect, {
    x, y, w, h,
    rectRadius: radius,
    fill: { color: fill },
    line: { color: line, transparency: line === fill ? 100 : 0, width: 1 },
  });
}

function line(slide, x, y, w, h, color = C.line, width = 1.5, dash = "solid") {
  slide.addShape(S.line, { x, y, w, h, line: { color, width, dashType: dash } });
}

function text(slide, value, x, y, w, h, options = {}) {
  slide.addText(value, {
    x, y, w, h,
    fontFace: "Liberation Sans",
    fontSize: 20,
    color: C.ink,
    margin: 0,
    breakLine: false,
    valign: "mid",
    fit: "shrink",
    ...options,
  });
}

function eyebrow(slide, value, x = 0.65, y = 0.42, color = C.accent) {
  text(slide, value, x, y, 8.5, 0.24, {
    fontFace: "Liberation Mono",
    fontSize: 11,
    bold: true,
    color,
    charSpacing: 1.8,
  });
}

function heading(slide, title, eyebrowText, width = 11.8) {
  if (eyebrowText) eyebrow(slide, eyebrowText);
  text(slide, title, 0.62, eyebrowText ? 0.78 : 0.5, width, 0.72, {
    fontSize: 31,
    bold: true,
    color: C.ink,
    breakLine: true,
  });
}

function addNotes(slide, item) {
  const sources = item.sources?.length
    ? `\n\nSources:\n${item.sources.map((source) => `• ${source}`).join("\n")}`
    : "";
  slide.addNotes(`${item.notes}${sources}`);
}

function containImagePlacement(x, y, w, h, aspect) {
  const boxAspect = h / w;
  if (aspect > boxAspect) {
    const imageW = h / aspect;
    return { x: x + (w - imageW) / 2, y, w: imageW, h };
  }
  const imageH = w * aspect;
  return { x, y: y + (h - imageH) / 2, w, h: imageH };
}

function addImage(slide, asset, x, y, w, h, sizing = "cover") {
  const aspect = ASSET_ASPECTS[asset];
  if (!aspect) throw new Error(`Missing intrinsic dimensions for asset: ${asset}`);
  if (sizing === "contain") {
    slide.addImage({ path: sourceAsset(asset), ...containImagePlacement(x, y, w, h, aspect) });
    return;
  }
  slide.addImage({ path: sourceAsset(asset), x, y, w: 1, h: aspect, sizing: { type: sizing, w, h } });
}

function accentTag(slide, label, x, y, w) {
  rect(slide, x, y, w, 0.38, C.ink, 0.07);
  text(slide, label, x + 0.1, y, w - 0.2, 0.38, {
    fontFace: "Liberation Mono",
    fontSize: 10.5,
    bold: true,
    color: C.white,
    align: "center",
  });
}

function caption(slide, value, x, y, w, dark = false) {
  text(slide, value, x, y, w, 0.27, {
    fontSize: 9.5,
    color: dark ? "DBDED6" : C.muted,
    italic: true,
    align: "right",
  });
}

function pill(slide, value, x, y, w, fill = C.paleOrange, color = C.ink) {
  rect(slide, x, y, w, 0.44, fill, 0.12);
  text(slide, value, x, y, w, 0.44, { fontFace: "Liberation Mono", fontSize: 11, bold: true, color, align: "center" });
}

function base(item) {
  const slide = pptx.addSlide("PAPER");
  addNotes(slide, item);
  return slide;
}

function titleSlide(item) {
  const slide = pptx.addSlide();
  slide.background = { color: C.dark };
  rect(slide, 0, 0, 0.16, 7.5, C.accent);
  rect(slide, 8.62, -0.4, 5.2, 8.3, "242922");
  line(slide, 8.63, 0, 0, 7.5, "444A3F", 1);
  text(slide, "LOCAL LLMs", 0.72, 0.65, 3.1, 0.3, { fontFace: "Liberation Mono", fontSize: 12, bold: true, color: C.accent2, charSpacing: 2 });
  text(slide, "My 8GB VRAM\nvs the World", 0.72, 1.15, 7.35, 2.35, { fontSize: 35, bold: true, color: C.white, breakLine: true });
  text(slide, item.subtitle, 0.76, 3.72, 6.7, 0.48, { fontSize: 20, color: "D7DACE" });
  line(slide, 0.75, 4.47, 6.85, 0, "51584B", 1);
  text(slide, content.presenter, 0.76, 4.68, 6.4, 0.35, { fontSize: 13, color: "AEB5A8" });

  rect(slide, 9.62, 1.12, 3.15, 3.15, C.accent, 0.2);
  rect(slide, 9.93, 1.43, 2.53, 2.53, C.dark, 0.15);
  text(slide, "8", 9.88, 1.28, 2.62, 1.72, { fontSize: 75, bold: true, color: C.white, align: "center" });
  text(slide, "GB", 10.05, 2.86, 2.28, 0.45, { fontFace: "Liberation Mono", fontSize: 20, bold: true, color: C.accent2, align: "center", charSpacing: 4 });
  for (let i = 0; i < 7; i += 1) {
    line(slide, 9.34, 1.42 + i * 0.42, 0.28, 0, C.accent2, 2);
    line(slide, 12.77, 1.42 + i * 0.42, 0.28, 0, C.accent2, 2);
  }
  text(slide, "A PRACTICAL STORY OF\nOWNERSHIP, CONSTRAINTS,\nAND CONTROL", 9.2, 5.05, 3.6, 1.04, { fontFace: "Liberation Mono", fontSize: 13, bold: true, color: "CED3C6", charSpacing: 1.4, breakLine: true, align: "center" });
  addNotes(slide, item);
}

function drawChessBoard(slide, x, y, size) {
  const sq = size / 8;
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const light = (rank + file) % 2 === 0;
      rect(slide, x + file * sq, y + rank * sq, sq, sq, light ? "E5DCC8" : "66735F");
    }
  }
  const pieces = [
    ["♜", 0, 0], ["♚", 4, 0], ["♜", 7, 0], ["♟", 3, 1], ["♟", 4, 3],
    ["♙", 3, 4], ["♙", 4, 6], ["♖", 0, 7], ["♔", 4, 7], ["♖", 7, 7],
  ];
  for (const [piece, file, rank] of pieces) {
    text(slide, piece, x + file * sq, y + rank * sq - 0.02, sq, sq, { fontFace: "DejaVu Sans", fontSize: sq * 28, color: rank < 4 ? C.black : C.white, align: "center" });
  }
}

function teaserSlide(item) {
  const slide = base(item);
  heading(slide, item.title, item.eyebrow, 5.55);
  text(slide, item.body, 0.65, 1.8, 5.4, 1.55, { fontSize: 22, color: C.muted, breakLine: true, valign: "top" });
  item.metrics.forEach((metric, i) => pill(slide, metric, 0.65 + (i % 2) * 1.55, 4.25 + Math.floor(i / 2) * 0.58, 1.35, i === 3 ? C.paleGreen : C.paleOrange));
  rect(slide, 6.55, 0.6, 6.08, 5.95, C.dark, 0.15);
  drawChessBoard(slide, 6.9, 1.05, 3.58);
  text(slide, "LOCAL DECISION", 10.77, 1.1, 1.46, 0.24, { fontFace: "Liberation Mono", fontSize: 9.5, bold: true, color: C.accent2 });
  text(slide, "Candidate moves", 10.77, 1.52, 1.55, 0.27, { fontSize: 13, bold: true, color: C.white });
  ["1  e4", "2  Nf3", "3  d4"].forEach((move, i) => {
    rect(slide, 10.75, 1.91 + i * 0.49, 1.37, 0.36, i === 0 ? C.accent : "30362E", 0.06);
    text(slide, move, 10.86, 1.91 + i * 0.49, 1.15, 0.36, { fontFace: "Liberation Mono", fontSize: 12, bold: i === 0, color: C.white });
  });
  text(slide, "“I’ll take space in the center while keeping options open.”", 10.75, 3.72, 1.47, 1.2, { fontSize: 12.5, italic: true, color: "D7DACE", breakLine: true, valign: "top" });
  pill(slide, "LOCALHOST", 10.74, 5.53, 1.44, C.green, C.white);
}

function comparisonSlide(item) {
  const slide = base(item);
  heading(slide, item.title, item.eyebrow);
  const cards = [
    [item.leftTitle, item.leftPoints, C.dark, C.white, "CLOUD"],
    [item.rightTitle, item.rightPoints, C.panel, C.ink, "LOCAL"],
  ];
  cards.forEach(([titleValue, points, fill, color, label], index) => {
    const x = 0.65 + index * 6.15;
    rect(slide, x, 1.75, 5.75, 4.15, fill, 0.13, index ? C.line : fill);
    pill(slide, label, x + 0.3, 2.03, 1.05, index ? C.paleOrange : C.accent, index ? C.ink : C.white);
    text(slide, titleValue, x + 0.3, 2.57, 4.9, 0.48, { fontSize: 24, bold: true, color });
    points.forEach((point, i) => {
      rect(slide, x + 0.34, 3.3 + i * 0.68, 0.17, 0.17, index ? C.accent : C.accent2, 0.04);
      text(slide, point, x + 0.7, 3.16 + i * 0.68, 4.5, 0.48, { fontSize: 17, color, breakLine: true });
    });
  });
  text(slide, item.footer, 0.65, 6.35, 12.0, 0.42, { fontSize: 19, bold: true, color: C.green, align: "center" });
}

function photoSlide(item, network = false) {
  const slide = base(item);
  const photoX = network ? 0.62 : 6.73;
  const copyX = network ? 7.05 : 0.65;
  const photoW = 5.7;
  if (network) {
    eyebrow(slide, item.eyebrow, 7.05, 0.42);
    text(slide, item.title, 7.05, 0.78, 5.55, 0.95, { fontSize: 31, bold: true, breakLine: true });
  } else {
    heading(slide, item.title, item.eyebrow, 5.55);
  }
  rect(slide, photoX - 0.05, 1.04, photoW + 0.1, 5.57, C.ink, 0.09);
  addImage(slide, item.asset, photoX, 1.09, photoW, 5.18, "cover");
  caption(slide, item.credit, photoX, 6.31, photoW);
  text(slide, item.body, copyX, 2.05, 5.25, 1.62, { fontSize: 23, color: C.muted, breakLine: true, valign: "top" });
  if (network) {
    text(slide, "CENTRAL COMPUTER", 7.08, 4.25, 1.82, 0.28, { fontFace: "Liberation Mono", fontSize: 10, bold: true, color: C.accent });
    rect(slide, 9.06, 4.06, 1.4, 0.68, C.ink, 0.07);
    text(slide, "SYSTEM / 360", 9.06, 4.06, 1.4, 0.68, { fontFace: "Liberation Mono", fontSize: 10, bold: true, color: C.white, align: "center" });
    [8.0, 9.45, 10.9].forEach((x, i) => {
      line(slide, 9.76, 4.76, x - 9.35, 0.75, C.accent, 1.4);
      rect(slide, x, 5.5, 1.05, 0.48, C.panel, 0.06, C.line);
      text(slide, `USER ${i + 1}`, x, 5.5, 1.05, 0.48, { fontFace: "Liberation Mono", fontSize: 9, bold: true, color: C.ink, align: "center" });
    });
    text(slide, "Many access points · one shared center", 7.07, 6.27, 5.2, 0.3, { fontSize: 15, color: C.green, bold: true, align: "center" });
  } else {
    accentTag(slide, item.number === 4 ? "ROOM-SCALE" : "DIRECT ACCESS", copyX, 4.42, 1.65);
    line(slide, copyX, 5.21, 4.75, 0, C.line, 1.2);
    text(slide, item.number === 4 ? "Centralized capability came first." : "Personal access changed the pace of learning.", copyX, 5.43, 4.85, 0.72, { fontSize: 18, bold: true, color: C.green, breakLine: true });
  }
}

function timelineSlide(item) {
  const slide = base(item);
  heading(slide, item.title, item.eyebrow);
  const bands = [
    ["COMPUTING", item.computing, 2.1, C.ink, C.accent2],
    ["LANGUAGE MODELS", item.languageModels, 4.48, C.green, C.accent],
  ];
  bands.forEach(([label, entries, y, band, dot]) => {
    text(slide, label, 0.66, y - 0.42, 1.55, 0.25, { fontFace: "Liberation Mono", fontSize: 10.5, bold: true, color: band, charSpacing: 1.2 });
    line(slide, 1.85, y + 0.36, 10.25, 0, band, 5);
    entries.forEach(([year, name], i) => {
      const x = 2.05 + i * 3.1;
      slide.addShape(S.ellipse, { x, y: y + 0.12, w: 0.48, h: 0.48, fill: { color: dot }, line: { color: C.paper, width: 3 } });
      text(slide, year, x - 0.18, y - 0.43, 0.88, 0.31, { fontFace: "Liberation Mono", fontSize: 11, bold: true, color: band, align: "center" });
      text(slide, name, x - 0.65, y + 0.78, 1.75, 0.64, { fontSize: 15, bold: true, color: C.ink, align: "center", breakLine: true, valign: "top" });
    });
  });
  rect(slide, 1.06, 6.35, 11.15, 0.48, C.paleOrange, 0.08);
  text(slide, item.footer, 1.18, 6.35, 10.9, 0.48, { fontSize: 16, bold: true, color: C.ink, align: "center" });
}

function benefitsSlide(item) {
  const slide = base(item);
  heading(slide, item.title, item.eyebrow);
  item.benefits.forEach(([label, detail], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.66 + col * 4.13;
    const y = 1.76 + row * 2.06;
    rect(slide, x, y, 3.75, 1.65, row === 0 ? C.panel : C.paleGreen, 0.12, C.line);
    text(slide, `${String(i + 1).padStart(2, "0")}`, x + 0.25, y + 0.22, 0.5, 0.3, { fontFace: "Liberation Mono", fontSize: 11, bold: true, color: C.accent });
    text(slide, label, x + 0.25, y + 0.58, 1.35, 0.38, { fontSize: 22, bold: true, color: C.ink });
    text(slide, detail, x + 1.55, y + 0.45, 1.92, 0.78, { fontSize: 15.5, color: C.muted, breakLine: true });
  });
  text(slide, item.caveat, 0.67, 6.18, 11.85, 0.45, { fontSize: 15, italic: true, color: C.accent, align: "center" });
}

function quantizationSlide(item) {
  const slide = base(item);
  heading(slide, item.title, item.eyebrow);
  text(slide, item.body, 0.67, 1.58, 5.0, 1.02, { fontSize: 21, color: C.muted, breakLine: true, valign: "top" });
  const levels = [
    [item.levels[0], 5.2, 2.03, 6.65, C.ink],
    [item.levels[1], 3.9, 3.45, 7.3, C.green],
    [item.levels[2], 2.7, 4.87, 7.95, C.accent],
  ];
  levels.forEach(([entry, width, y, x, color]) => {
    const [name, bits, scale] = entry;
    rect(slide, x, y, width, 1.0, color, 0.11);
    text(slide, name, x + 0.25, y + 0.12, 1.1, 0.33, { fontFace: "Liberation Mono", fontSize: 17, bold: true, color: C.white });
    text(slide, bits, x + 0.25, y + 0.51, 1.15, 0.25, { fontSize: 12, color: "E9ECE4" });
    text(slide, scale, x + width - 1.4, y + 0.24, 1.1, 0.4, { fontSize: 14, bold: true, color: C.white, align: "right" });
  });
  text(slide, "fewer bits → smaller model", 0.67, 3.38, 4.65, 0.38, { fontFace: "Liberation Mono", fontSize: 13, bold: true, color: C.green });
  line(slide, 0.7, 4.05, 4.4, 0, C.green, 3);
  slide.addShape(S.chevron, { x: 4.75, y: 3.83, w: 0.55, h: 0.44, fill: { color: C.green }, line: { color: C.green } });
  text(slide, item.footer, 0.67, 5.18, 4.75, 1.02, { fontSize: 16, italic: true, color: C.muted, breakLine: true, valign: "top" });
}

function ecosystemSlide(item) {
  const slide = base(item);
  heading(slide, item.title, item.eyebrow);
  item.steps.forEach(([name, detail, asset], i) => {
    const x = 0.55 + i * 3.15;
    rect(slide, x, 1.88, 2.7, 3.83, i === 2 ? C.dark : C.panel, 0.12, i === 2 ? C.dark : C.line);
    if (asset) {
      addImage(slide, asset, x + 0.55, 2.18, 1.6, 0.75, "contain");
    } else {
      rect(slide, x + 0.74, 2.2, 1.22, 0.68, C.accent, 0.08);
      text(slide, "GGUF", x + 0.74, 2.2, 1.22, 0.68, { fontFace: "Liberation Mono", fontSize: 18, bold: true, color: C.white, align: "center" });
    }
    text(slide, name, x + 0.25, 3.2, 2.2, 0.48, { fontSize: 20, bold: true, color: i === 2 ? C.white : C.ink, align: "center" });
    text(slide, detail, x + 0.34, 4.02, 2.02, 1.0, { fontSize: 15, color: i === 2 ? "D7DACE" : C.muted, align: "center", breakLine: true, valign: "top" });
    text(slide, String(i + 1), x + 1.1, 5.25, 0.5, 0.28, { fontFace: "Liberation Mono", fontSize: 10, bold: true, color: i === 2 ? C.accent2 : C.accent, align: "center" });
    if (i < 3) {
      slide.addShape(S.chevron, { x: x + 2.79, y: 3.45, w: 0.28, h: 0.5, fill: { color: C.accent }, line: { color: C.accent } });
    }
  });
  text(slide, item.footer, 0.66, 6.29, 12.0, 0.4, { fontSize: 16, bold: true, color: C.green, align: "center" });
}

function interfaceSlide(item) {
  const slide = base(item);
  heading(slide, item.title, item.eyebrow);
  rect(slide, 0.66, 1.75, 12.0, 1.1, C.dark, 0.12);
  text(slide, "$", 1.02, 1.75, 0.3, 1.1, { fontFace: "Liberation Mono", fontSize: 20, bold: true, color: C.accent2, align: "center" });
  text(slide, item.command, 1.43, 1.75, 10.6, 1.1, { fontFace: "Liberation Mono", fontSize: 21, bold: true, color: C.white });
  item.flow.forEach((label, i) => {
    const x = 0.66 + i * 3.1;
    rect(slide, x, 3.65, 2.55, 1.45, i === 1 ? C.accent : i === 2 ? C.green : C.panel, 0.11, i === 1 || i === 2 ? C.paper : C.line);
    text(slide, String(i + 1).padStart(2, "0"), x + 0.18, 3.82, 0.45, 0.25, { fontFace: "Liberation Mono", fontSize: 9.5, bold: true, color: i === 1 || i === 2 ? C.white : C.accent });
    text(slide, label, x + 0.25, 4.18, 2.05, 0.48, { fontSize: 18, bold: true, color: i === 1 || i === 2 ? C.white : C.ink, align: "center" });
    if (i < 3) line(slide, x + 2.57, 4.37, 0.5, 0, C.accent, 3);
  });
  text(slide, item.footer, 0.66, 5.87, 12.0, 0.52, { fontSize: 18, bold: true, color: C.green, align: "center" });
}

function pipelineSlide(item) {
  const slide = base(item);
  heading(slide, item.title, item.eyebrow);
  item.steps.forEach(([number, name, detail], i) => {
    const x = 0.55 + i * 3.15;
    const fill = i === 1 ? C.accent : i === 2 ? C.green : C.panel;
    const inverse = i === 1 || i === 2;
    rect(slide, x, 1.83, 2.7, 3.95, fill, 0.12, inverse ? fill : C.line);
    text(slide, number, x + 0.22, 2.06, 0.55, 0.55, { fontFace: "Liberation Mono", fontSize: 26, bold: true, color: inverse ? C.white : C.accent });
    text(slide, name, x + 0.25, 2.87, 2.2, 0.55, { fontSize: 22, bold: true, color: inverse ? C.white : C.ink });
    line(slide, x + 0.25, 3.65, 2.18, 0, inverse ? "EEB19B" : C.line, 1);
    text(slide, detail, x + 0.25, 3.95, 2.15, 1.25, { fontSize: 15.5, color: inverse ? C.white : C.muted, breakLine: true, valign: "top" });
    if (i < 3) slide.addShape(S.chevron, { x: x + 2.78, y: 3.35, w: 0.28, h: 0.55, fill: { color: C.ink }, line: { color: C.ink } });
  });
  text(slide, item.footer, 0.66, 6.29, 12.0, 0.4, { fontSize: 17, bold: true, color: C.green, align: "center" });
}

function demoSlide(item) {
  const slide = base(item);
  heading(slide, item.title, item.eyebrow);
  rect(slide, 0.65, 1.67, 7.2, 4.95, C.dark, 0.14);
  drawChessBoard(slide, 0.97, 1.98, 4.17);
  text(slide, "DECISION TRACE", 5.47, 2.0, 1.9, 0.28, { fontFace: "Liberation Mono", fontSize: 10, bold: true, color: C.accent2, charSpacing: 1.2 });
  ["Stockfish → e4, Nf3, d4", "Qwen3-4B → e4", "Gateway → valid", "Saved → move + evidence"].forEach((value, i) => {
    text(slide, value, 5.47, 2.48 + i * 0.67, 1.98, 0.48, { fontFace: "Liberation Mono", fontSize: 11.2, color: i === 1 ? C.accent2 : C.white, bold: i === 1, breakLine: true });
  });
  pill(slide, "1.8 s · 34 tok/s", 5.43, 5.48, 1.98, C.green, C.white);

  text(slide, "RUNNING LOCALLY", 8.26, 1.76, 2.1, 0.26, { fontFace: "Liberation Mono", fontSize: 10.5, bold: true, color: C.accent });
  item.checklist.forEach((value, i) => {
    rect(slide, 8.27, 2.17 + i * 0.58, 0.2, 0.2, C.green, 0.04);
    text(slide, value, 8.68, 2.03 + i * 0.58, 3.55, 0.48, { fontSize: 16.5, bold: true, color: C.ink });
  });
  text(slide, "WATCH", 8.26, 5.27, 0.7, 0.25, { fontFace: "Liberation Mono", fontSize: 10.5, bold: true, color: C.accent });
  item.watch.forEach((value, i) => pill(slide, value, 8.25 + (i % 2) * 1.72, 5.63 + Math.floor(i / 2) * 0.51, 1.5, i === 1 ? C.paleOrange : C.paleGreen));
}

function closingSlide(item) {
  const slide = pptx.addSlide();
  slide.background = { color: C.dark };
  rect(slide, 0, 0, 0.16, 7.5, C.accent);
  eyebrow(slide, item.eyebrow, 0.74, 0.61, C.accent2);
  text(slide, item.title, 0.72, 1.13, 7.25, 0.85, { fontSize: 36, bold: true, color: C.white });
  item.points.forEach((point, i) => {
    text(slide, String(i + 1).padStart(2, "0"), 0.75, 2.55 + i * 0.91, 0.56, 0.33, { fontFace: "Liberation Mono", fontSize: 12, bold: true, color: C.accent2 });
    text(slide, point, 1.55, 2.39 + i * 0.91, 6.05, 0.62, { fontSize: 18, color: "E1E4DC", breakLine: true });
  });
  rect(slide, 8.72, 0, 4.61, 7.5, "232821");
  text(slide, "8", 9.27, 1.0, 3.0, 2.25, { fontSize: 105, bold: true, color: C.accent, align: "center" });
  text(slide, "GB", 9.45, 2.9, 2.65, 0.6, { fontFace: "Liberation Mono", fontSize: 25, bold: true, color: C.accent2, align: "center", charSpacing: 5 });
  line(slide, 9.38, 3.95, 2.85, 0, "555D50", 1.2);
  text(slide, item.footer, 9.16, 4.45, 3.3, 1.28, { fontSize: 21, bold: true, color: C.white, align: "center", breakLine: true });
  addNotes(slide, item);
}

function sourcesSlide(item) {
  const slide = base(item);
  heading(slide, item.title, "APPENDIX · SOURCES");
  item.sections.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.66 + col * 6.1;
    const y = 1.65 + row * 1.68;
    rect(slide, x, y, 5.72, 1.34, row === 2 ? C.paleGreen : C.panel, 0.1, C.line);
    text(slide, label.toUpperCase(), x + 0.24, y + 0.2, 1.25, 0.24, { fontFace: "Liberation Mono", fontSize: 9, bold: true, color: C.accent, charSpacing: 1 });
    text(slide, value, x + 0.24, y + 0.53, 5.2, 0.58, { fontSize: 15.5, bold: true, color: C.ink, breakLine: true, valign: "top" });
  });
  text(slide, "Full URLs live in slide notes and presentation/README.md.", 0.66, 6.68, 11.8, 0.27, { fontSize: 11.5, italic: true, color: C.muted, align: "center" });
}

function creditsSlide(item) {
  const slide = base(item);
  heading(slide, item.title, "APPENDIX · MEDIA");
  item.items.forEach((value, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.66 + col * 6.12;
    const y = 1.58 + row * 1.24;
    rect(slide, x, y, 5.7, 0.96, i === 6 ? C.paleOrange : C.panel, 0.08, C.line);
    text(slide, String(i + 1).padStart(2, "0"), x + 0.2, y + 0.18, 0.38, 0.25, { fontFace: "Liberation Mono", fontSize: 9.5, bold: true, color: C.accent });
    text(slide, value, x + 0.72, y + 0.12, 4.68, 0.68, { fontSize: 13.5, color: C.ink, breakLine: true });
  });
  text(slide, "Full URLs, licenses, hashes, and modification notes: assets/ATTRIBUTION.md", 0.66, 6.67, 11.8, 0.27, { fontSize: 11.5, italic: true, color: C.muted, align: "center" });
}

function repositoriesSlide(item) {
  const slide = pptx.addSlide();
  slide.background = { color: C.dark };
  rect(slide, 0, 0, 0.16, 7.5, C.accent);
  eyebrow(slide, item.eyebrow, 0.72, 0.48, C.accent2);
  text(slide, item.title, 0.7, 0.87, 8.6, 0.67, { fontSize: 34, bold: true, color: C.white });
  text(slide, "Two practical starting points for building with local models.", 8.55, 0.94, 4.0, 0.42, { fontSize: 15.5, color: "C9CEC3", align: "right" });

  item.repositories.forEach((repository, index) => {
    const x = 0.72 + index * 6.23;
    rect(slide, x, 1.77, 5.66, 4.75, index === 0 ? C.panel : "222720", 0.14, index === 0 ? C.line : "3E463B");
    pill(slide, `REPOSITORY 0${index + 1}`, x + 0.34, 2.07, 1.5, index === 0 ? C.paleOrange : C.green, index === 0 ? C.ink : C.white);
    slide.addImage({
      data: QR_CODES.get(repository.url),
      x: x + 0.34,
      y: 2.68,
      w: 2.65,
      h: 2.65,
      hyperlink: { url: repository.url },
      altText: `QR code for ${repository.name}: ${repository.url}`,
    });
    text(slide, repository.name, x + 3.27, 2.73, 2.0, 0.8, {
      fontSize: 22,
      bold: true,
      color: index === 0 ? C.ink : C.white,
      breakLine: true,
      valign: "top",
    });
    text(slide, repository.description, x + 3.27, 3.73, 1.95, 0.9, {
      fontSize: 15.5,
      color: index === 0 ? C.muted : "C9CEC3",
      breakLine: true,
      valign: "top",
    });
    line(slide, x + 3.27, 4.84, 1.94, 0, index === 0 ? C.line : "4A5246", 1);
    text(slide, repository.url.replace("https://", ""), x + 3.27, 5.05, 1.95, 0.84, {
      fontFace: "Liberation Mono",
      fontSize: 10,
      color: index === 0 ? C.accent : C.accent2,
      breakLine: true,
      valign: "top",
      hyperlink: { url: repository.url },
    });
  });

  text(slide, item.footer.toUpperCase(), 0.72, 6.86, 11.9, 0.28, {
    fontFace: "Liberation Mono",
    fontSize: 11,
    bold: true,
    color: C.accent2,
    align: "center",
    charSpacing: 2,
  });
  addNotes(slide, item);
}

for (const item of content.slides) {
  switch (item.kind) {
    case "title": titleSlide(item); break;
    case "teaser": teaserSlide(item); break;
    case "comparison": comparisonSlide(item); break;
    case "photo": photoSlide(item, false); break;
    case "photo-network": photoSlide(item, true); break;
    case "timeline": timelineSlide(item); break;
    case "benefits": benefitsSlide(item); break;
    case "quantization": quantizationSlide(item); break;
    case "ecosystem": ecosystemSlide(item); break;
    case "interface": interfaceSlide(item); break;
    case "pipeline": pipelineSlide(item); break;
    case "demo": demoSlide(item); break;
    case "closing": closingSlide(item); break;
    case "sources": sourcesSlide(item); break;
    case "credits": creditsSlide(item); break;
    case "repositories": repositoriesSlide(item); break;
    default: throw new Error(`Unknown slide kind: ${item.kind}`);
  }
}

fs.mkdirSync(path.join(ROOT, "deliverables"), { recursive: true });
await pptx.writeFile({ fileName: path.join(ROOT, "deliverables", `${outputStem}.pptx`), compression: true });
console.log(`Wrote ${content.slides.length} slides to deliverables/${outputStem}.pptx`);

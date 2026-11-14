"use strict";
const siyuan = require("siyuan");
// ---- 00-util.js ----
/* ---------- 工具函数 ---------- */
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || "");

function uid() {
  return Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 8);
}

function newNode(text) {
  return { id: uid(), text: text || "", children: [] };
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|[a-z]+)$/i;
function safeColor(c) {
  c = (c || "").trim();
  if (!c || !COLOR_RE.test(c)) return "";
  if (/^(transparent|inherit|initial|unset|currentcolor|black|rgb\(0, 0, 0\))$/i.test(c)) return "";
  return c;
}

const _tpl = document.createElement("template");

/** 只保留：加粗/斜体/下划线/删除线/行内代码/链接/文字颜色/背景色 */
function sanitizeInline(html) {
  if (!html) return "";
  _tpl.innerHTML = html;
  let out = "";
  _tpl.content.childNodes.forEach((n) => (out += _cleanNode(n)));
  return out;
}

function _cleanNode(n) {
  if (n.nodeType === 3) return escapeHtml(n.nodeValue.replace(/[\r\n]+/g, " ").replace(/[\uFFFC\uFFFD]/g, ""));
  if (n.nodeType !== 1) return "";
  const tag = n.tagName;
  if (tag === "BR") return "<br>";
  if (tag === "SCRIPT" || tag === "STYLE") return "";
  let inner = "";
  n.childNodes.forEach((c) => (inner += _cleanNode(c)));
  if (!inner) return "";
  const st = n.style || {};
  const fmt = new Set();
  if (tag === "B" || tag === "STRONG") fmt.add("b");
  if (tag === "I" || tag === "EM") fmt.add("i");
  if (tag === "U" || tag === "INS") fmt.add("u");
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") fmt.add("s");
  if (tag === "CODE") fmt.add("code");
  const fw = st.fontWeight;
  if (fw === "bold" || parseInt(fw, 10) >= 600) fmt.add("b");
  if (st.fontStyle === "italic") fmt.add("i");
  const td = st.textDecorationLine || st.textDecoration || "";
  if (td.includes("underline")) fmt.add("u");
  if (td.includes("line-through")) fmt.add("s");
  const color = safeColor(st.color || (tag === "FONT" ? n.getAttribute("color") : ""));
  let bg = safeColor(st.backgroundColor);
  if (tag === "MARK") bg = bg || "rgba(255,200,0,.35)";
  let s = inner;
  for (const t of ["code", "s", "u", "i", "b"]) if (fmt.has(t)) s = `<${t}>${s}</${t}>`;
  if (color || bg) {
    s = `<span style="${color ? `color:${color};` : ""}${bg ? `background-color:${bg};` : ""}">${s}</span>`;
  }
  if (tag === "A") {
    const href = n.getAttribute("href") || "";
    if (/^(https?:|siyuan:|mailto:|file:|assets\/)/i.test(href)) s = `<a href="${escapeHtml(href)}">${s}</a>`;
  }
  return s;
}

/** 行内文本：<br> 是换行；末尾的一个 <br> 只是浏览器的占位，不计入模型 */
function stripTrailingBr(html) {
  return html.endsWith("<br>") ? html.slice(0, -4) : html;
}
function domToText(el) {
  return stripTrailingBr(sanitizeInline(el.innerHTML));
}
function textToDom(text) {
  return text && text.endsWith("<br>") ? text + "<br>" : text || "";
}

function htmlToText(html) {
  if (!html) return "";
  if (html.indexOf("<") === -1 && html.indexOf("&") === -1) return html;
  _tpl.innerHTML = html.replace(/<br\s*\/?>/gi, "\n");
  return _tpl.content.textContent;
}

/* ---------- 逻辑长度：文字按字符计，<br> 计 1 ---------- */
function _len(node) {
  if (node.nodeType === 3) return node.length;
  if (node.nodeName === "BR") return 1;
  let s = 0;
  node.childNodes.forEach((c) => (s += _len(c)));
  return s;
}
function _lastLeaf(el) {
  let n = el.lastChild;
  while (n) {
    if (n.nodeType === 3 && !n.length) {
      n = n.previousSibling;
      continue;
    }
    if (n.nodeType === 1 && n.nodeName !== "BR" && n.lastChild) {
      n = n.lastChild;
      continue;
    }
    return n;
  }
  return null;
}
function hasTrailingBr(el) {
  const n = _lastLeaf(el);
  return !!n && n.nodeName === "BR";
}
function contentLen(el) {
  return _len(el) - (hasTrailingBr(el) ? 1 : 0);
}
function htmlLen(html) {
  if (!html) return 0;
  _tpl.innerHTML = html;
  return _len(_tpl.content);
}
function _offsetOf(el, container, offset) {
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(container, offset);
  return _len(pre.cloneContents());
}
function offsetToPoint(el, off) {
  let rem = off;
  let result = null;
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (result) return;
      if (c.nodeType === 3) {
        if (rem <= c.length) {
          result = { node: c, offset: rem };
          return;
        }
        rem -= c.length;
      } else if (c.nodeName === "BR") {
        if (rem === 0) {
          result = { node: c.parentNode, offset: Array.prototype.indexOf.call(c.parentNode.childNodes, c) };
          return;
        }
        rem -= 1;
      } else if (c.nodeType === 1) walk(c);
    }
  };
  walk(el);
  if (result) return result;
  const last = _lastLeaf(el);
  if (last && last.nodeName === "BR") {
    return { node: last.parentNode, offset: Array.prototype.indexOf.call(last.parentNode.childNodes, last) };
  }
  return { node: el, offset: el.childNodes.length };
}
function rangeFromOffsets(el, a, b) {
  const r = document.createRange();
  const p1 = offsetToPoint(el, a);
  const p2 = offsetToPoint(el, b);
  r.setStart(p1.node, p1.offset);
  r.setEnd(p2.node, p2.offset);
  return r;
}
function resolveSrc(src) {
  return /^assets\//.test(src || "") ? "/" + src : src || "";
}

/* ---------- 光标 ---------- */
function getSelRange(el) {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!el.contains(r.startContainer)) return null;
  return r;
}

function caretOffset(el) {
  const r = getSelRange(el);
  if (!r) return -1;
  return Math.min(_offsetOf(el, r.startContainer, r.startOffset), contentLen(el));
}

function selectionOffsets(el) {
  const r = getSelRange(el);
  if (!r) return null;
  return { start: _offsetOf(el, r.startContainer, r.startOffset), end: _offsetOf(el, r.endContainer, r.endOffset) };
}

function selectionCoversAll(el) {
  const o = selectionOffsets(el);
  if (!o) return false;
  const len = contentLen(el);
  if (!len) return true;
  return o.start === 0 && o.end >= len;
}

function setCaret(el, offset) {
  const sel = window.getSelection();
  if (offset === "end" || offset == null) offset = Infinity;
  if (offset === "start") offset = 0;
  const p = offsetToPoint(el, offset);
  const r = document.createRange();
  r.setStart(p.node, p.offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function caretRect(el) {
  const r = getSelRange(el);
  if (!r) return null;
  const c = r.cloneRange();
  c.collapse(true);
  const rects = c.getClientRects();
  if (rects.length && (rects[0].height || rects[0].width)) return rects[0];
  if (!_len(el)) return null;
  // 回退：插入临时标记测量
  const off = caretOffset(el);
  const mark = document.createElement("span");
  mark.textContent = "​";
  c.insertNode(mark);
  const rect = mark.getBoundingClientRect();
  mark.remove();
  el.normalize();
  setCaret(el, off);
  return rect;
}

function lineHeightOf(el) {
  const cs = getComputedStyle(el);
  const lh = parseFloat(cs.lineHeight);
  return isNaN(lh) ? parseFloat(cs.fontSize) * 1.6 : lh;
}

function caretOnFirstLine(el) {
  const rect = caretRect(el);
  if (!rect) return true;
  const er = el.getBoundingClientRect();
  return rect.top < er.top + lineHeightOf(el) * 0.8;
}

function caretOnLastLine(el) {
  const rect = caretRect(el);
  if (!rect) return true;
  const er = el.getBoundingClientRect();
  return rect.bottom > er.bottom - lineHeightOf(el) * 0.8;
}

function placeCaretAtX(el, x, which) {
  const er = el.getBoundingClientRect();
  const lh = lineHeightOf(el);
  const half = Math.min(lh / 2, er.height / 2);
  const y = which === "first" ? er.top + half : er.bottom - half;
  const cx = Math.max(er.left + 1, Math.min(x, er.right - 1));
  let r = null;
  if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(cx, y);
  if (r && el.contains(r.startContainer)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    r.collapse(true);
    sel.addRange(r);
  } else {
    setCaret(el, which === "first" ? 0 : "end");
  }
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function cloneNodesWithNewIds(nodes) {
  const walk = (n) => ({
    ...n,
    id: uid(),
    children: (n.children || []).map(walk),
  });
  return nodes.map(walk);
}

function countNodes(nodes) {
  let c = 0;
  const walk = (arr) => arr.forEach((n) => { c++; walk(n.children || []); });
  walk(nodes);
  return c;
}

/* ---------- #标签 ---------- */
const TAG_STOP = "\\s#,，。.;；:：!！?？()（）\\[\\]【】「」<>\"'“”‘’、/";
const TAG_RE = new RegExp(`(^|[\\s\\u3000(（\\[【「])#([^${TAG_STOP}]+)`, "g");

function extractTags(text) {
  const out = [];
  if (!text) return out;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text))) out.push(m[2]);
  return out;
}

function hasTag(text, tag) {
  return extractTags(text).some((t) => t.toLowerCase() === tag.toLowerCase());
}

/** 把内容里的 #标签 包成可点击的 span（只是显示层，sanitize 时会自动去掉） */
function decorateTags(el) {
  if (!el.textContent.includes("#")) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.parentElement.closest("a, code, .ol-tag")) continue;
    if (n.nodeValue.includes("#")) nodes.push(n);
  }
  for (const tn of nodes) {
    const text = tn.nodeValue;
    TAG_RE.lastIndex = 0;
    let m;
    let last = 0;
    const frag = document.createDocumentFragment();
    while ((m = TAG_RE.exec(text))) {
      const start = m.index + m[1].length;
      if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
      const span = document.createElement("span");
      span.className = "ol-tag";
      span.dataset.tag = m[2];
      span.textContent = "#" + m[2];
      frag.appendChild(span);
      last = start + 1 + m[2].length;
    }
    if (!last) continue;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    tn.parentNode.replaceChild(frag, tn);
  }
}

// ---- 05-keys.js ----
/* ---------- 可自定义快捷键 ----------
 * 组合键写法："Mod+Shift+ArrowUp"（Mod = Windows/Linux 的 Ctrl、Mac 的 ⌘）
 * 字母、数字、符号按物理键位识别，不受输入法和 Alt 组合字符影响。
 */
const KEY_COMMANDS = [
  { id: "lineMode", name: "进入 / 退出换行模式", def: "Shift+Enter" },
  { id: "note", name: "添加 / 编辑描述", def: "Alt+Enter" },
  { id: "done", name: "完成 / 取消完成", def: "Mod+Enter" },
  { id: "collapse", name: "折叠", def: "Mod+ArrowUp" },
  { id: "expand", name: "展开", def: "Mod+ArrowDown" },
  { id: "toggleFold", name: "切换折叠", def: "Mod+." },
  { id: "moveUp", name: "上移主题", def: "Mod+Shift+ArrowUp" },
  { id: "moveDown", name: "下移主题", def: "Mod+Shift+ArrowDown" },
  { id: "zoomIn", name: "进入主题", def: "Alt+ArrowRight" },
  { id: "zoomOut", name: "返回上一级", def: "Alt+ArrowLeft" },
  { id: "h1", name: "一级标题", def: "Mod+Alt+1" },
  { id: "h2", name: "二级标题", def: "Mod+Alt+2" },
  { id: "h3", name: "三级标题", def: "Mod+Alt+3" },
  { id: "h0", name: "取消标题（正文）", def: "Mod+Alt+0" },
  { id: "strike", name: "删除线", def: "Mod+Shift+X" },
  { id: "link", name: "插入 / 编辑链接", def: "Mod+K" },
  { id: "search", name: "搜索当前大纲", def: "Mod+F" },
  { id: "help", name: "快捷键列表", def: "Mod+/" },
];

/** 不允许占用的组合（编辑基础操作） */
const RESERVED_COMBOS = new Set([
  "Enter", "Tab", "Shift+Tab", "Backspace", "Delete", "Escape", "Space",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Shift+ArrowUp", "Shift+ArrowDown",
  "Shift+ArrowLeft", "Shift+ArrowRight", "Home", "End",
  "Mod+Z", "Mod+Shift+Z", "Mod+Y", "Mod+C", "Mod+X", "Mod+V", "Mod+A", "Mod+B", "Mod+I", "Mod+U",
]);

const _CODE_KEYS = {
  Period: ".", Slash: "/", Comma: ",", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]",
  Backquote: "`", Minus: "-", Equal: "=", Backslash: "\\",
};

function keyNameOf(e) {
  const c = e.code || "";
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return c.slice(6);
  if (_CODE_KEYS[c]) return _CODE_KEYS[c];
  if (e.key === " ") return "Space";
  if (e.key && e.key.length === 1) return e.key.toUpperCase();
  return e.key || "";
}

function comboOf(e) {
  const k = keyNameOf(e);
  if (!k || ["Control", "Meta", "Alt", "Shift", "Process", "Unidentified"].includes(k)) return "";
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(k);
  return parts.join("+");
}

function formatCombo(combo) {
  if (!combo) return "未设置";
  const map = IS_MAC
    ? { Mod: "⌘", Alt: "⌥", Shift: "⇧", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Enter: "↩" }
    : { Mod: "Ctrl", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  return combo
    .split("+")
    .map((p) => map[p] || p)
    .join(IS_MAC ? "" : " + ");
}

/** 返回错误说明；合法时返回空串 */
function validateCombo(combo) {
  if (!combo) return "请按下一个组合键";
  if (RESERVED_COMBOS.has(combo)) return "这个按键是编辑的基础操作，不能占用";
  const parts = combo.split("+");
  const key = parts[parts.length - 1];
  const hasMod = parts.some((p) => p === "Mod" || p === "Alt");
  const fn = /^F\d{1,2}$/.test(key);
  if (!hasMod && !fn && !(parts.includes("Shift") && key === "Enter")) return "需要包含 Ctrl / ⌘ 或 Alt";
  return "";
}

// ---- 10-markdown.js ----
/* ---------- Markdown 互转 ---------- */

function escapeMd(s) {
  return s.replace(/([\\`*_~\[\]<])/g, "\\$1");
}

function _wrapMd(mark, inner, close) {
  close = close == null ? mark : close;
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m[2]) return inner;
  return `${m[1]}${mark}${m[2]}${close}${m[3]}`;
}

function inlineHtmlToMd(html) {
  if (!html) return "";
  _tpl.innerHTML = html;
  const walk = (n) => {
    if (n.nodeType === 3) return escapeMd(n.nodeValue);
    if (n.nodeName === "BR") return "\n";
    if (n.nodeType !== 1 && n.nodeType !== 11) return "";
    let inner = "";
    n.childNodes.forEach((c) => (inner += walk(c)));
    switch (n.tagName) {
      case "B": return _wrapMd("**", inner);
      case "I": return _wrapMd("*", inner);
      case "S": return _wrapMd("~~", inner);
      case "U": return _wrapMd("<u>", inner, "</u>");
      case "CODE": return "`" + n.textContent + "`";
      case "A": return `[${inner}](${n.getAttribute("href")})`;
      case "SPAN":
        if (n.style && n.style.backgroundColor) return _wrapMd("==", inner);
        return inner;
      default: return inner;
    }
  };
  return walk(_tpl.content);
}

function _cellMd(s) {
  return String(s || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>") || " ";
}

function blockToMdLines(b, opts) {
  switch (b.type) {
    case "table": {
      const rows = b.rows && b.rows.length ? b.rows : [[""]];
      const cols = Math.max(...rows.map((r) => r.length));
      const line = (r) => "| " + Array.from({ length: cols }, (_, i) => _cellMd(r[i])).join(" | ") + " |";
      return [line(rows[0]), "| " + Array(cols).fill("---").join(" | ") + " |", ...rows.slice(1).map(line)];
    }
    case "code":
      return ["```" + (b.lang || ""), ...String(b.code || "").split("\n"), "```"];
    case "math":
      return ["$$", ...String(b.tex || "").split("\n"), "$$"];
    case "mermaid":
      return ["```mermaid", ...String(b.code || "").split("\n"), "```"];
    case "image":
      return [`![${(b.alt || "").replace(/[\[\]]/g, "")}](${opts && opts.mapSrc ? opts.mapSrc(b.src) : b.src})`];
  }
  return [];
}

function nodesToMarkdown(nodes, opts) {
  opts = opts || {};
  const lines = [];
  const walk = (arr, depth) => {
    for (const n of arr) {
      if (opts.skipDone && n.done) continue;
      const pad = "  ".repeat(depth);
      const sub = pad + "  ";
      const task = n.done ? "[x] " : "";
      const textLines = inlineHtmlToMd(n.text).split("\n");
      lines.push(`${pad}- ${task}${textLines[0] || " "}`);
      for (const l of textLines.slice(1)) lines.push(sub + (l || "<br>"));
      if (n.note) for (const l of n.note.split("\n")) lines.push(`${sub}> ${escapeMd(l)}`);
      for (const b of n.blocks || []) {
        lines.push("");
        for (const l of blockToMdLines(b, opts)) lines.push(l ? sub + l : sub);
        lines.push("");
      }
      walk(n.children || [], depth + 1);
    }
  };
  walk(nodes, 0);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function nodesToPlainText(nodes) {
  const lines = [];
  const walk = (arr, depth) => {
    for (const n of arr) {
      lines.push("\t".repeat(depth) + htmlToText(n.text).replace(/\n/g, " "));
      walk(n.children || [], depth + 1);
    }
  };
  walk(nodes, 0);
  return lines.join("\n");
}

function blockText(b) {
  if (b.type === "table") return (b.rows || []).map((r) => r.join(" ")).join(" ");
  if (b.type === "code" || b.type === "mermaid") return b.code || "";
  if (b.type === "math") return b.tex || "";
  return "";
}

function mdInlineToHtml(s) {
  if (!s) return "";
  const escs = [];
  s = s.replace(/\\([\\`*_{}\[\]()#+\-.!~<>|=])/g, (_, c) => {
    escs.push(c);
    return `\u0000${escs.length - 1}\u0000`;
  });
  const parts = s.split(/(`[^`]+`)/);
  let html = parts
    .map((p) => {
      if (/^`[^`]+`$/.test(p)) return `<code>${escapeHtml(p.slice(1, -1))}</code>`;
      let h = escapeHtml(p);
      h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
      h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
      h = h.replace(/__(.+?)__/g, "<b>$1</b>");
      h = h.replace(/~~(.+?)~~/g, "<s>$1</s>");
      h = h.replace(/==(.+?)==/g, '<span style="background-color:rgba(255,200,0,.35);">$1</span>');
      h = h.replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1<i>$2</i>");
      h = h.replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, "<u>$1</u>");
      h = h.replace(/&lt;br\s*\/?&gt;/g, "<br>");
      h = h.replace(/\{:\s[^}]*\}/g, "");
      return h;
    })
    .join("");
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => escapeHtml(escs[+i]));
  return sanitizeInline(html.trim());
}

function _splitCells(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|").replace(/<br\s*\/?>/gi, "\n"));
}

const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const IAL_LINE = /^\s*\{:[^}]*\}\s*$/;

/** Markdown / 缩进文本 → 节点数组。支持标题、列表、任务、续行（行内换行）、引用（描述）、表格、代码块、公式、图片。 */
function parseOutlineText(text) {
  text = String(text || "").replace(/\r\n?/g, "\n");
  text = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = text.split("\n").map((l) => l.replace(/\t/g, "    "));
  const root = { children: [] };
  const stack = [{ key: -Infinity, node: root }];
  let last = null;

  const place = (key, node, meta) => {
    while (stack.length > 1 && stack[stack.length - 1].key >= key) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ key, node });
    last = { node, ...meta };
  };
  const attach = (block, indent) => {
    if (last && last.isItem && indent > last.indent) {
      (last.node.blocks = last.node.blocks || []).push(block);
    } else {
      const node = newNode("");
      node.blocks = [block];
      place(indent, node, { isItem: false, indent });
    }
  };
  const dedent = (l, n) => l.replace(new RegExp(`^ {0,${n}}`), "");
  const takeImages = (s, out) => s.replace(IMG_RE, (_, alt, src) => {
    out.push({ type: "image", src, alt });
    return "";
  });

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || IAL_LINE.test(raw)) continue;
    const indent = raw.match(/^ */)[0].length;
    let s = raw.slice(indent).replace(/\{:\s[^}]*\}/g, "");
    if (!s.trim()) continue;

    // 代码块
    let m = s.match(/^(`{3,}|~{3,})\s*([^`\s]*)/);
    if (m) {
      const fence = m[1];
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) code.push(dedent(lines[i++], indent));
      if ((m[2] || "").toLowerCase() === "mermaid") attach({ type: "mermaid", code: code.join("\n") }, indent);
      else attach({ type: "code", lang: m[2] || "", code: code.join("\n") }, indent);
      continue;
    }
    // 公式块
    if (s.trim().startsWith("$$")) {
      const one = s.trim().match(/^\$\$(.+)\$\$$/);
      if (one) attach({ type: "math", tex: one[1].trim() }, indent);
      else {
        const tex = [];
        const first = s.trim().slice(2);
        if (first) tex.push(first);
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("$$")) tex.push(dedent(lines[i++], indent));
        attach({ type: "math", tex: tex.join("\n").trim() }, indent);
      }
      continue;
    }
    // 表格
    if (s.startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows = [_splitCells(s)];
      i += 2;
      while (i < lines.length && (lines[i].trim().startsWith("|") || IAL_LINE.test(lines[i]))) {
        if (!IAL_LINE.test(lines[i])) rows.push(_splitCells(lines[i]));
        i++;
      }
      i--;
      const cols = rows[0].length;
      rows.forEach((r) => {
        while (r.length < cols) r.push("");
        r.length = cols;
      });
      attach({ type: "table", rows }, indent);
      continue;
    }

    let key;
    let isItem = false;
    let heading = 0;
    let done = false;
    if ((m = s.match(/^(#{1,6})\s+(.*)$/))) {
      heading = m[1].length;
      s = m[2];
      key = heading - 10;
    } else if ((m = s.match(/^([-*+]|\d+[.)])\s+(.*)$/)) || /^[-*+]$/.test(s)) {
      isItem = true;
      s = m ? m[2] : "";
      key = indent;
      const t = s.match(/^\[([ xX])\]\s*(.*)$/);
      if (t) {
        done = t[1] !== " ";
        s = t[2];
      }
    } else if (last && last.isItem && indent > last.indent) {
      if (/^>\s?/.test(s)) {
        const noteLine = s.replace(/^>\s?/, "").replace(/\\([\\`*_{}\[\]()#+\-.!~<>|=])/g, "$1");
        last.node.note = last.node.note ? last.node.note + "\n" + noteLine : noteLine;
      } else {
        const imgs = [];
        s = takeImages(s, imgs);
        const h = mdInlineToHtml(s);
        if (h === "<br>") last.node.text += "<br>"; // 主题内的空行
        else if (h) last.node.text = last.node.text ? last.node.text + "<br>" + h : h;
        imgs.forEach((b) => attach(b, indent));
      }
      continue;
    } else {
      if (s.startsWith("> ")) s = s.slice(2);
      key = indent;
    }
    const imgs = [];
    s = takeImages(s, imgs);
    const node = newNode(mdInlineToHtml(s));
    if (done) node.done = true;
    if (heading && heading <= 3) node.heading = heading;
    place(key, node, { isItem, indent });
    if (imgs.length) node.blocks = imgs;
    if (!isItem) last.isItem = false;
  }
  return root.children;
}

// ---- 20-store.js ----
/* ---------- 存储：data/storage/petal/<插件名>/ 下的 JSON ----------
 * 多窗口 / 多设备安全：
 *  - 列表（index.json）保存前先读磁盘版本合并：条目按 mtime 取新，删除用墓碑记录
 *  - 每篇大纲带 rev：保存时发现磁盘版本更新（别的窗口写过），先把对方版本另存为副本，再写入本窗口的修改
 *  - 写入失败会提示并自动重试
 *  - 删除进回收站（30 天后自动清理）；每篇大纲自动保留历史版本
 */
const TRASH_DAYS = 30;
const SNAP_GAP = 3600e3; // 历史版本：至少间隔 1 小时
const RETRY_STEPS = [2000, 5000, 10000, 30000];

function _strip(obj) {
  return JSON.stringify(obj, (k, v) => (k.startsWith("__") ? undefined : v));
}

class Store {
  constructor(plugin) {
    this.plugin = plugin;
    this.index = { docs: [], settings: {}, deleted: {} };
    this.docs = new Map();
    this.timers = new Map();
    this.pending = new Map();
    this.retries = new Map();
    this.saveError = null;
    this._idxWaiters = [];
    this.retrySteps = RETRY_STEPS.slice();
  }

  get base() {
    return `/data/storage/petal/${this.plugin.name}/`;
  }

  async init() {
    const idx = await this._load("index.json");
    if (idx && Array.isArray(idx.docs)) this.index = idx;
    if (!this.index.settings) this.index.settings = {};
    if (!this.index.deleted) this.index.deleted = {};
    // 旧版本没有层级：按更新时间排好顺序，全部放在根目录
    if (this.index.docs.some((d) => typeof d.order !== "number")) {
      this.index.docs
        .slice()
        .sort((a, b) => (b.updated || 0) - (a.updated || 0))
        .forEach((d, i) => {
          if (typeof d.order !== "number") d.order = i;
        });
    }
    const ids = new Set(this.index.docs.map((d) => d.id));
    this.index.docs.forEach((d) => {
      if (d.parent && !ids.has(d.parent)) d.parent = null;
    });
    this.purgeOldTrash();
  }

  /* ---------- 底层读写 ---------- */
  async _load(name) {
    try {
      let d = await this.plugin.loadData(name);
      if (typeof d === "string") {
        if (!d.trim()) return null;
        d = JSON.parse(d);
      }
      if (!d || (typeof d.code === "number" && d.code !== 0 && !d.root && !d.docs)) return null;
      return d;
    } catch (e) {
      console.warn("[outliner] load failed", name, e);
      return null;
    }
  }

  async _write(name, obj) {
    let r;
    try {
      r = await this.plugin.saveData(name, _strip(obj));
    } catch (e) {
      this._setSaveError(e.message || String(e));
      throw e;
    }
    if (r && typeof r.code === "number" && r.code !== 0) {
      this._setSaveError(r.msg || "写入失败");
      throw new Error(r.msg || "写入失败");
    }
    return r;
  }

  _setSaveError(msg) {
    const was = this.saveError;
    this.saveError = msg ? { msg, at: Date.now() } : null;
    if (!!was !== !!this.saveError || msg) this.plugin.onSaveStateChanged && this.plugin.onSaveStateChanged(this.saveError, !!was);
  }

  _retry(key, fn) {
    const n = this.retries.get(key) || 0;
    this.retries.set(key, n + 1);
    setTimeout(fn, this.retrySteps[Math.min(n, this.retrySteps.length - 1)]);
  }

  _ok(key) {
    this.retries.delete(key);
    if (!this.retries.size && this.saveError) this._setSaveError(null);
  }

  /* ---------- 条目 ---------- */
  _bump(it) {
    if (it) it.mtime = Date.now();
  }

  item(id) {
    return this.index.docs.find((d) => d.id === id);
  }

  meta(id) {
    return this.item(id);
  }

  live(it) {
    return it && !it.trashed;
  }

  childrenOf(parentId) {
    return this.index.docs.filter((d) => !d.trashed && (d.parent || null) === (parentId || null)).sort((a, b) => a.order - b.order);
  }

  /** 祖先（从顶层到父级） */
  pathOf(id) {
    const out = [];
    let it = this.item(id);
    const seen = new Set();
    while (it && it.parent && !seen.has(it.parent)) {
      seen.add(it.parent);
      it = this.item(it.parent);
      if (it) out.unshift(it);
    }
    return out;
  }

  descendantsOf(id) {
    const out = [];
    const walk = (pid) => this.childrenOf(pid).forEach((c) => {
      out.push(c);
      walk(c.id);
    });
    walk(id);
    return out;
  }

  isDescendant(id, ancestorId) {
    return this.pathOf(id).some((a) => a.id === ancestorId);
  }

  docsInTreeOrder() {
    const out = [];
    const walk = (pid) => this.childrenOf(pid).forEach((c) => {
      if (c.type !== "folder") out.push(c);
      walk(c.id);
    });
    walk(null);
    return out;
  }

  list() {
    return this.docsInTreeOrder();
  }

  _topOrder(parentId) {
    const sib = this.childrenOf(parentId);
    return sib.length ? sib[0].order - 1 : 0;
  }

  setExpanded(id, v) {
    const it = this.item(id);
    if (!it || !!it.expanded === !!v) return;
    it.expanded = !!v;
    this._bump(it);
    this.saveIndex();
  }

  expandTo(id) {
    this.pathOf(id).forEach((a) => {
      if (!a.expanded) {
        a.expanded = true;
        this._bump(a);
      }
    });
  }

  async createFolder(title, parentId) {
    const id = uid();
    const now = Date.now();
    this.index.docs.push({ id, type: "folder", title: title || "新建文件夹", parent: parentId || null, order: this._topOrder(parentId), expanded: true, created: now, updated: now, mtime: now });
    this.expandTo(id);
    this.saveIndex();
    return id;
  }

  /** pos: "inside" | "before" | "after" | "end" */
  moveItem(id, targetId, pos) {
    const it = this.item(id);
    if (!it || id === targetId) return false;
    if (targetId && this.isDescendant(targetId, id)) return false;
    let parent;
    let siblings;
    if (!targetId) {
      parent = null;
      siblings = this.childrenOf(null).filter((d) => d.id !== id);
      siblings.push(it);
    } else if (pos === "inside") {
      parent = targetId;
      siblings = this.childrenOf(targetId).filter((d) => d.id !== id);
      siblings.unshift(it);
      const t = this.item(targetId);
      t.expanded = true;
      this._bump(t);
    } else {
      const target = this.item(targetId);
      parent = target.parent || null;
      siblings = this.childrenOf(parent).filter((d) => d.id !== id);
      const i = siblings.indexOf(target);
      siblings.splice(pos === "before" ? i : i + 1, 0, it);
    }
    it.parent = parent;
    siblings.forEach((d, i) => {
      if (d.order !== i || d === it) {
        d.order = i;
        this._bump(d);
      }
    });
    this.saveIndex();
    return true;
  }

  async renameItem(id, title) {
    const it = this.item(id);
    if (!it) return;
    it.title = title;
    this._bump(it);
    if (it.type !== "folder") {
      const doc = await this.getDoc(id);
      if (doc) {
        doc.title = title;
        this.touch(doc);
      }
    }
    this.saveIndex();
  }

  setSetting(key, value) {
    this.index.settings[key] = value;
    this.index.settingsMtime = Date.now();
    this.saveIndex();
  }

  /* ---------- 大纲文件 ---------- */
  async getDoc(id) {
    if (this.docs.has(id)) return this.docs.get(id);
    let doc = await this._load(`doc-${id}.json`);
    const m = this.meta(id);
    if (!doc || !doc.root) {
      if (!m) return null;
      doc = { id, title: m.title || "", root: { id: "root", children: [] } };
    }
    this._normalize(doc);
    doc.__baseRev = doc.rev || 0;
    this.docs.set(id, doc);
    return doc;
  }

  /** 全文搜索用：把所有大纲读进缓存 */
  async loadAllDocs() {
    const ids = this.index.docs.filter((d) => d.type !== "folder" && !d.trashed).map((d) => d.id);
    const missing = ids.filter((id) => !this.docs.has(id));
    for (let i = 0; i < missing.length; i += 8) await Promise.all(missing.slice(i, i + 8).map((id) => this.getDoc(id)));
    return ids.map((id) => this.docs.get(id)).filter(Boolean);
  }

  _normalize(doc) {
    const seen = new Set();
    const walk = (n) => {
      if (!n.id || seen.has(n.id)) n.id = uid();
      seen.add(n.id);
      if (typeof n.text !== "string") n.text = "";
      if (/[￼�]/.test(n.text)) n.text = n.text.replace(/[￼�]/g, "");
      if (!Array.isArray(n.children)) n.children = [];
      n.children.forEach(walk);
    };
    if (!doc.root) doc.root = { id: "root", children: [] };
    doc.root.id = "root";
    if (!Array.isArray(doc.root.children)) doc.root.children = [];
    doc.root.children.forEach(walk);
  }

  async createDoc(title, children, parentId, opts) {
    opts = opts || {};
    const id = uid();
    const now = Date.now();
    const doc = {
      id,
      title: title || "",
      root: { id: "root", children: children && children.length ? children : [newNode("")] },
      created: now,
      updated: now,
      rev: 1,
    };
    doc.__baseRev = 1;
    this.docs.set(id, doc);
    const meta = { id, title: doc.title, parent: parentId || null, order: this._topOrder(parentId), created: now, updated: now, mtime: now };
    if (opts.after) {
      const a = this.item(opts.after);
      if (a) {
        meta.parent = a.parent || null;
        meta.order = a.order + 0.5;
      }
    }
    this.index.docs.push(meta);
    if (meta.parent) {
      const p = this.item(meta.parent);
      if (p && !p.expanded) {
        p.expanded = true;
        this._bump(p);
      }
      this.expandTo(id);
    }
    this.saveIndex();
    // 文件写入放到后台；失败会进入重试队列
    this._write(`doc-${id}.json`, doc).catch(() => this.saveDocSoon(doc, 2000));
    return doc;
  }

  touch(doc) {
    doc.updated = Date.now();
    const m = this.meta(doc.id);
    if (m) {
      m.title = doc.title;
      m.updated = doc.updated;
      this._bump(m);
    }
    this.saveDocSoon(doc);
  }

  saveDocSoon(doc, delay) {
    this.pending.set(doc.id, doc);
    clearTimeout(this.timers.get(doc.id));
    this.timers.set(doc.id, setTimeout(() => this._flushDoc(doc.id), delay == null ? 400 : delay));
  }

  async _flushDoc(id) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const doc = this.pending.get(id);
    if (!doc) return;
    this.pending.delete(id);
    try {
      const disk = await this._load(`doc-${id}.json`);
      const diskRev = (disk && disk.rev) || 0;
      const base = doc.__baseRev || 0;
      if (disk && disk.root && diskRev > base && _strip(disk.root) !== _strip(doc.root)) {
        // 别的窗口 / 设备在这之后改过同一篇：对方版本另存为副本，两边的内容都不丢
        await this._saveConflictCopy(doc, disk);
      }
      await this._maybeSnapshot(doc, disk);
      doc.rev = Math.max(diskRev, base) + 1;
      await this._write(`doc-${id}.json`, doc);
      doc.__baseRev = doc.rev;
      this._ok("doc:" + id);
      this.saveIndex();
    } catch (e) {
      if (!this.pending.has(id)) this.pending.set(id, doc);
      this._retry("doc:" + id, () => this._flushDoc(id));
    }
  }

  async _saveConflictCopy(doc, disk) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const title = `${disk.title || doc.title || "无标题"}（另一窗口的版本 ${p(d.getHours())}:${p(d.getMinutes())}）`;
    const copy = await this.createDoc(title, disk.root.children, null, { after: doc.id });
    this.plugin.onConflict && this.plugin.onConflict(doc, copy);
  }

  saveIndex() {
    return new Promise((resolve) => {
      this._idxWaiters.push(resolve);
      clearTimeout(this._idxTimer);
      this._idxTimer = setTimeout(() => this._flushIndex(), 200);
    });
  }

  async _flushIndex() {
    if (this._idxBusy) {
      clearTimeout(this._idxTimer);
      this._idxTimer = setTimeout(() => this._flushIndex(), 150);
      return;
    }
    this._idxBusy = true;
    const waiters = this._idxWaiters;
    this._idxWaiters = [];
    try {
      const disk = await this._load("index.json");
      if (disk && Array.isArray(disk.docs)) this._mergeIndex(disk);
      await this._write("index.json", this.index);
      this._ok("index");
    } catch (e) {
      this._retry("index", () => this.saveIndex());
    } finally {
      this._idxBusy = false;
      waiters.forEach((r) => r());
    }
  }

  /** 把磁盘上的列表合并进内存：按条目 mtime 取新；墓碑表示已彻底删除 */
  _mergeIndex(disk) {
    let changed = false;
    const deleted = Object.assign({}, this.index.deleted || {});
    for (const [k, v] of Object.entries(disk.deleted || {})) if (!deleted[k] || deleted[k] < v) deleted[k] = v;
    const cutoff = Date.now() - 90 * 864e5;
    for (const k of Object.keys(deleted)) if (deleted[k] < cutoff) delete deleted[k];
    const mine = new Map(this.index.docs.map((d) => [d.id, d]));
    for (const d of disk.docs) {
      if (deleted[d.id]) continue;
      const m = mine.get(d.id);
      if (!m) {
        this.index.docs.push(d);
        changed = true;
      } else if ((d.mtime || 0) > (m.mtime || 0)) {
        Object.assign(m, d);
        changed = true;
      }
    }
    const before = this.index.docs.length;
    this.index.docs = this.index.docs.filter((d) => !deleted[d.id]);
    if (this.index.docs.length !== before) changed = true;
    this.index.deleted = deleted;
    if ((disk.settingsMtime || 0) > (this.index.settingsMtime || 0)) {
      this.index.settings = disk.settings || {};
      this.index.settingsMtime = disk.settingsMtime;
      changed = true;
      this.__settingsChanged = true;
    }
    return changed;
  }

  /** 别处（其他窗口 / 同步）改了数据：重新读取列表和已打开的大纲 */
  async reloadFromDisk() {
    const disk = await this._load("index.json");
    let indexChanged = false;
    if (disk && Array.isArray(disk.docs)) indexChanged = this._mergeIndex(disk);
    const changed = [];
    for (const [id, doc] of [...this.docs]) {
      if (this.pending.has(id)) continue; // 本窗口有未保存的修改：保存时处理
      const m = this.item(id);
      if (!m) {
        this.docs.delete(id);
        continue;
      }
      if ((m.updated || 0) <= (doc.updated || 0) && !indexChanged) continue;
      const d = await this._load(`doc-${id}.json`);
      if (!d || !d.root) continue;
      if ((d.rev || 0) > (doc.__baseRev || 0)) {
        this._normalize(d);
        d.__baseRev = d.rev || 0;
        this.docs.set(id, d);
        changed.push(d);
      }
    }
    const settingsChanged = !!this.__settingsChanged;
    this.__settingsChanged = false;
    return { indexChanged, changed, settingsChanged };
  }

  async flushAll() {
    const ids = [...this.pending.keys()];
    for (const id of ids) await this._flushDoc(id);
    if (this._idxWaiters.length) {
      clearTimeout(this._idxTimer);
      await this._flushIndex();
    }
  }

  /* ---------- 回收站 ---------- */
  /** 移到回收站（连同子项） */
  async trashItem(id) {
    const it = this.item(id);
    if (!it) return new Set();
    const now = Date.now();
    const all = [it, ...this.descendantsOf(id)];
    all.forEach((d) => {
      d.trashed = now;
      d.trashRoot = id;
      this._bump(d);
    });
    if (all.some((d) => d.id === this.index.lastOpen)) this.index.lastOpen = null;
    await this.saveIndex();
    return new Set(all.map((d) => d.id));
  }

  trashList() {
    return this.index.docs
      .filter((d) => d.trashed && d.trashRoot === d.id)
      .sort((a, b) => b.trashed - a.trashed)
      .map((d) => ({ item: d, count: this.index.docs.filter((x) => x.trashRoot === d.id && x.id !== d.id).length }));
  }

  async restoreItem(id) {
    const group = this.index.docs.filter((d) => d.trashRoot === id);
    const root = this.item(id);
    if (!root) return;
    group.forEach((d) => {
      delete d.trashed;
      delete d.trashRoot;
      this._bump(d);
    });
    const p = root.parent && this.item(root.parent);
    if (!p || p.trashed) root.parent = null;
    root.order = this._topOrder(root.parent) - 1;
    this.expandTo(id);
    await this.saveIndex();
  }

  /** 彻底删除 */
  async purgeItem(id) {
    const group = this.index.docs.filter((d) => d.trashRoot === id || d.id === id);
    const gone = new Set(group.map((d) => d.id));
    const now = Date.now();
    this.index.docs = this.index.docs.filter((d) => !gone.has(d.id));
    for (const d of group) {
      this.index.deleted[d.id] = now;
      clearTimeout(this.timers.get(d.id));
      this.pending.delete(d.id);
      this.docs.delete(d.id);
      if (d.type !== "folder") {
        try {
          await this.plugin.removeData(`doc-${d.id}.json`);
        } catch (e) { /* ignore */ }
        api("/api/file/removeFile", { path: `${this.base}history/${d.id}` });
      }
    }
    await this.saveIndex();
    return gone;
  }

  purgeOldTrash() {
    const cutoff = Date.now() - TRASH_DAYS * 864e5;
    this.trashList()
      .filter((t) => t.item.trashed < cutoff)
      .forEach((t) => this.purgeItem(t.item.id));
  }

  /* ---------- 历史版本 ---------- */
  async _maybeSnapshot(doc, disk, force) {
    const now = Date.now();
    const last = doc.lastSnapAt != null ? doc.lastSnapAt : (disk && disk.lastSnapAt) || 0;
    if (!force && now - last < SNAP_GAP) return;
    const src = force ? doc : disk;
    if (!src || !src.root || !src.root.children.length) return;
    try {
      // 历史版本写失败不算"保存失败"，不提示
      const r = await this.plugin.saveData(`history/${doc.id}/${now}.json`, _strip({ id: doc.id, title: src.title, root: src.root, at: now }));
      if (r && typeof r.code === "number" && r.code !== 0) return;
      doc.lastSnapAt = now;
      this.pruneHistory(doc.id);
    } catch (e) { /* 历史版本失败不影响正常保存 */ }
  }

  async snapshotNow(doc) {
    await this._maybeSnapshot(doc, null, true);
    this.saveDocSoon(doc, 0);
  }

  async listHistory(id) {
    const r = await api("/api/file/readDir", { path: `${this.base}history/${id}` });
    if (!r || r.code !== 0 || !Array.isArray(r.data)) return [];
    return r.data
      .filter((f) => !f.isDir && /^\d+\.json$/.test(f.name))
      .map((f) => +f.name.replace(".json", ""))
      .sort((a, b) => b - a);
  }

  loadHistory(id, ts) {
    return this._load(`history/${id}/${ts}.json`);
  }

  /** 24 小时内全保留；更早的每天保留一份，最多 30 天 */
  async pruneHistory(id) {
    const list = await this.listHistory(id);
    const now = Date.now();
    const keepDays = new Set();
    for (const ts of list) {
      let keep = false;
      if (now - ts < 864e5) keep = true;
      else if (now - ts < TRASH_DAYS * 864e5) {
        const day = new Date(ts).toDateString();
        if (!keepDays.has(day)) {
          keepDays.add(day);
          keep = true;
        }
      }
      if (!keep) api("/api/file/removeFile", { path: `${this.base}history/${id}/${ts}.json` });
    }
  }

  /* ---------- 图片（存放在插件目录，不会被思源「清理未引用资源」误删） ---------- */
  async putImage(file) {
    const ext = ((file.name || "").match(/\.(png|jpe?g|gif|webp|svg|bmp)$/i) || [, (file.type.split("/")[1] || "png").replace("jpeg", "jpg")])[1].toLowerCase();
    const name = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const fd = new FormData();
    fd.append("path", `${this.base}assets/${name}`);
    fd.append("file", file, name);
    fd.append("isDir", "false");
    const r = await api("/api/file/putFile", fd);
    if (!r || r.code !== 0) throw new Error((r && r.msg) || "保存图片失败");
    return "olimg:" + name;
  }

  async listImages() {
    const r = await api("/api/file/readDir", { path: `${this.base}assets` });
    if (!r || r.code !== 0 || !Array.isArray(r.data)) return [];
    return r.data.filter((f) => !f.isDir);
  }

  removeImage(name) {
    return api("/api/file/removeFile", { path: `${this.base}assets/${name}` });
  }
}

// ---- 30-editor.js ----
/* ---------- 树索引 ---------- */
class Tree {
  constructor(doc) {
    this.doc = doc;
    this.reindex();
  }
  reindex() {
    this.map = new Map();
    const walk = (n, p) => {
      this.map.set(n.id, { node: n, parent: p });
      for (const c of n.children) walk(c, n);
    };
    walk(this.doc.root, null);
  }
  node(id) {
    const e = this.map.get(id);
    return e ? e.node : null;
  }
  parent(id) {
    const e = this.map.get(id);
    return e ? e.parent : null;
  }
  /** 从顶层到父节点（不含 root） */
  ancestors(id) {
    const out = [];
    let p = this.parent(id);
    while (p && p.id !== "root") {
      out.unshift(p);
      p = this.parent(p.id);
    }
    return out;
  }
  isAncestor(aId, bId) {
    let p = this.parent(bId);
    while (p) {
      if (p.id === aId) return true;
      p = this.parent(p.id);
    }
    return false;
  }
}

const ICONS = {
  side: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="M4 6h16M8 12h12M12 18h8"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.2a1.5 1.5 0 0 0 1.5 1.3h6a1.5 1.5 0 0 0 1.5-1.3l1-12.2M10 11v5.5M14 11v5.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  window: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9h17"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
  fold: '<svg viewBox="0 0 24 24"><path d="M8 10l4 4 4-4"/></svg>',
};
const icon = (n) => `<span class="ol-ico">${ICONS[n]}</span>`;

const FMT_COLORS = ["#e5484d", "#f76b15", "#30a46c", "#0090ff", "#8e4ec6", "#8b8d98"];
const FMT_BGS = ["rgba(255, 200, 0, 0.35)", "rgba(48, 164, 108, 0.25)", "rgba(0, 144, 255, 0.2)", "rgba(229, 72, 77, 0.22)"];

/* ---------- 编辑器 ---------- */
class OutlineEditor {
  constructor(container, plugin, tab) {
    this.plugin = plugin;
    this.store = plugin.store;
    this.tab = tab;
    this.container = container;
    this.doc = null;
    this.tree = null;
    this.zoomId = null;
    this.filter = "";
    this.matchSet = null;
    this.hitSet = null;
    this.forceShow = new Set();
    this.sel = null;
    this.editing = null;
    this.noteEditing = null;
    this.elCache = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.lastTyping = null;
    this.hideDone = !!this.store.index.settings.hideDone;
    this.standalone = !!(tab && tab.data && tab.data.standalone);
    this.buildUI();
    this.bindEvents();
    if (this.standalone) this.root.classList.add("side-hidden", "is-standalone");
    this.plugin.applyLook(this);
  }

  buildUI() {
    const root = document.createElement("div");
    root.className = "ol-root";
    if (this.store.index.settings.sideHidden) root.classList.add("side-hidden");
    root.innerHTML = `
<aside class="ol-side">
  <div class="ol-side-head">
    <span class="ol-side-title">我的大纲</span>
    <span class="ol-side-btns">
      <button class="ol-btn" data-act="newfolder" title="新建文件夹"><span class="ol-ico">${SIDE_ICONS.folderPlus}</span></button>
      <button class="ol-btn" data-act="new" title="新建大纲">${icon("plus")}</button>
    </span>
  </div>
  <div class="ol-side-search">${icon("search")}<input placeholder="搜索大纲标题" spellcheck="false"></div>
  <div class="ol-doclist"></div>
  <div class="ol-side-foot">
    <button class="ol-btn ol-foot-btn" data-act="trash" title="回收站">${icon("trash")}<span>回收站</span><span class="ol-trash-count"></span></button>
    <button class="ol-btn ol-foot-btn" data-act="settings" title="设置">${icon("gear")}<span>设置</span></button>
  </div>
</aside>
<main class="ol-main">
  <div class="ol-bar">
    <button class="ol-btn" data-act="side" title="显示/隐藏大纲列表">${icon("side")}</button>
    <div class="ol-crumbs"></div>
    <div class="ol-spacer"></div>
    <label class="ol-filter">${icon("search")}<input placeholder="搜索当前大纲 / #标签" spellcheck="false"><div class="ol-tagdrop"></div></label>
    <button class="ol-btn" data-act="expand" data-menu="true" title="展开 / 折叠">${icon("layers")}</button>
    <button class="ol-btn" data-act="hidedone" title="隐藏已完成">${icon("check")}</button>
    <span class="ol-savestate"></span>
    <span class="ol-syncstate"></span>
    <button class="ol-btn ol-btn-text" data-act="sync" title="把当前大纲生成或更新为一篇思源文档">${icon("sync")}<span>同步到思源</span></button>
    <button class="ol-btn" data-act="opensy" title="打开对应的思源文档">${icon("open")}</button>
    <button class="ol-btn" data-act="more" data-menu="true" title="更多">${icon("more")}</button>
  </div>
  <div class="ol-scroll">
    <div class="ol-page">
      <div class="ol-title" data-ph="无标题" spellcheck="false"></div>
      <div class="ol-tree" tabindex="-1"></div>
      <div class="ol-tail"></div>
      <div class="ol-drop"></div>
    </div>
  </div>
</main>
<div class="ol-slash"></div>
<div class="ol-pop"></div>
<div class="ol-fmt">
  <button data-fmt="bold" title="加粗 Ctrl+B"><b>B</b></button>
  <button data-fmt="italic" title="斜体 Ctrl+I"><i>I</i></button>
  <button data-fmt="underline" title="下划线 Ctrl+U"><u>U</u></button>
  <button data-fmt="strikeThrough" title="删除线"><s>S</s></button>
  <span class="ol-fmt-sep ol-fmt-headsep"></span>
  <button data-head="1" class="ol-fmt-head" title="一级标题 Ctrl+Alt+1（再点一次取消）">H1</button>
  <button data-head="2" class="ol-fmt-head" title="二级标题 Ctrl+Alt+2（再点一次取消）">H2</button>
  <button data-head="3" class="ol-fmt-head" title="三级标题 Ctrl+Alt+3（再点一次取消）">H3</button>
  <span class="ol-fmt-sep"></span>
  ${FMT_COLORS.map((c) => `<button data-color="${c}" title="文字颜色"><span class="ol-swatch-t" style="color:${c}">A</span></button>`).join("")}
  <span class="ol-fmt-sep"></span>
  ${FMT_BGS.map((c) => `<button data-bg="${c}" title="高亮"><span class="ol-swatch-b" style="background:${c}"></span></button>`).join("")}
  <span class="ol-fmt-sep"></span>
  <button data-fmt="removeFormat" title="清除格式">⌫</button>
</div>`;
    this.container.innerHTML = "";
    this.container.appendChild(root);
    this.root = root;
    this.sideEl = root.querySelector(".ol-side");
    this.docListEl = root.querySelector(".ol-doclist");
    this.sideSearch = root.querySelector(".ol-side-search input");
    this.crumbsEl = root.querySelector(".ol-crumbs");
    this.filterInput = root.querySelector(".ol-filter input");
    this.scrollEl = root.querySelector(".ol-scroll");
    this.pageEl = root.querySelector(".ol-page");
    this.titleEl = root.querySelector(".ol-title");
    this.treeEl = root.querySelector(".ol-tree");
    this.tailEl = root.querySelector(".ol-tail");
    this.dropEl = root.querySelector(".ol-drop");
    this.fmtEl = root.querySelector(".ol-fmt");
    this.syncStateEl = root.querySelector(".ol-syncstate");
    this.saveStateEl = root.querySelector(".ol-savestate");
    this.tagDropEl = root.querySelector(".ol-tagdrop");
    this.trashCountEl = root.querySelector(".ol-trash-count");
    this.slashEl = root.querySelector(".ol-slash");
    this.popEl = root.querySelector(".ol-pop");
  }

  /* ---------- 可见性 ---------- */
  zoomNode() {
    return this.zoomId ? this.tree.node(this.zoomId) : this.doc.root;
  }
  isShown(c) {
    if (this.forceShow.has(c.id)) return true;
    if (this.hideDone && c.done) return false;
    if (this.matchSet) return this.matchSet.has(c.id);
    return true;
  }
  isOpen(n) {
    return this.matchSet ? true : !n.collapsed;
  }
  shownChildren(n) {
    return n.children.filter((c) => this.isShown(c));
  }
  visibleNodes() {
    const out = [];
    const walk = (n) => {
      for (const c of this.shownChildren(n)) {
        out.push(c);
        if (this.isOpen(c)) walk(c);
      }
    };
    walk(this.zoomNode());
    return out;
  }
  computeMatches() {
    const raw = this.filter.trim();
    const q = raw.toLowerCase();
    const tagQ = /^#[^\s#]+$/.test(raw) ? raw.slice(1) : null;
    if (!q) {
      this.matchSet = null;
      this.hitSet = null;
      return;
    }
    const ms = new Set();
    const hs = new Set();
    const walk = (n) => {
      let any = false;
      for (const c of n.children) {
        const extra = (c.blocks || []).map(blockText).join("\n");
        const full = htmlToText(c.text) + "\n" + (c.note || "") + "\n" + extra;
        const self = tagQ ? hasTag(full, tagQ) : full.toLowerCase().includes(q);
        const sub = walk(c);
        if (self) hs.add(c.id);
        if (self || sub) {
          ms.add(c.id);
          any = true;
        }
      }
      return any;
    };
    walk(this.zoomNode());
    this.matchSet = ms;
    this.hitSet = hs;
  }

  /* ---------- 渲染 ---------- */
  render() {
    if (!this.doc) return;
    if (this.zoomId && !this.tree.node(this.zoomId)) this.zoomId = null;
    if (!this.zoomId && !this.doc.root.children.length) {
      this.doc.root.children.push(newNode(""));
      this.tree.reindex();
    }
    this.computeMatches();
    this.renderCrumbs();
    this.renderTitle();
    const zn = this.zoomNode();
    const kids = this.shownChildren(zn);
    this.syncChildren(this.treeEl, kids);
    this.root.classList.toggle("is-zoomed", !!this.zoomId);
    this.root.classList.toggle("is-filtering", !!this.matchSet);
    this.tailEl.textContent = kids.length ? "" : this.matchSet ? "没有匹配的内容" : "按回车添加子主题";
    this.renderSel();
    this.updateBarState();
  }

  syncChildren(container, nodes) {
    // 先递归更新（可能把元素从别处移走），再统一排序
    const els = nodes.map((n) => this.nodeEl(n));
    let ref = container.firstChild;
    for (const el of els) {
      if (el !== ref) container.insertBefore(el, ref);
      else ref = ref.nextSibling;
    }
    while (ref) {
      const next = ref.nextSibling;
      container.removeChild(ref);
      ref = next;
    }
  }

  nodeEl(n) {
    let el = this.elCache.get(n.id);
    if (!el) {
      el = this.createNodeEl(n);
      this.elCache.set(n.id, el);
    }
    this.updateNodeEl(el, n);
    return el;
  }

  createNodeEl(n) {
    const el = document.createElement("div");
    el.className = "ol-node";
    el.dataset.id = n.id;
    const row = document.createElement("div");
    const fold = document.createElement("span");
    fold.className = "ol-fold";
    fold.innerHTML = ICONS.fold;
    const bullet = document.createElement("span");
    bullet.className = "ol-bullet";
    bullet.draggable = true;
    bullet.innerHTML = '<span class="ol-dot"></span>';
    const body = document.createElement("div");
    body.className = "ol-body";
    const content = document.createElement("div");
    content.className = "ol-content";
    content.contentEditable = "true";
    content.spellcheck = false;
    content.__id = n.id;
    body.appendChild(content);
    row.append(fold, bullet, body);
    const kids = document.createElement("div");
    kids.className = "ol-kids";
    el.append(row, kids);
    el.__row = row;
    el.__content = content;
    el.__body = body;
    el.__kids = kids;
    el.__note = null;
    return el;
  }

  updateNodeEl(el, n) {
    const kids = this.shownChildren(n);
    const open = this.isOpen(n);
    const hasKids = n.children.length > 0;
    let cls = "ol-row";
    if (n.done) cls += " is-done";
    if (n.heading) cls += " is-h" + n.heading;
    if (hasKids) cls += " has-kids";
    if (hasKids && n.collapsed && !this.matchSet) cls += " is-collapsed";
    if (this.hitSet && this.hitSet.has(n.id)) cls += " is-hit";
    if (this.lineMode === n.id) cls += " is-linemode";
    if (el.__row.className !== cls) el.__row.className = cls;
    const c = el.__content;
    if (c.__val !== n.text) {
      c.innerHTML = textToDom(n.text);
      c.__val = n.text;
      decorateTags(c);
    }
    this.renderBlocks(el, n);
    const showNote = !!n.note || this.noteEditing === n.id;
    if (showNote) {
      if (!el.__note) {
        const note = document.createElement("div");
        note.className = "ol-note";
        note.contentEditable = "plaintext-only";
        note.spellcheck = false;
        note.__id = n.id;
        el.__body.appendChild(note);
        el.__note = note;
      }
      const v = n.note || "";
      if (el.__note.__val !== v) {
        el.__note.textContent = v;
        el.__note.__val = v;
      }
    } else if (el.__note) {
      el.__note.remove();
      el.__note = null;
    }
    if (open && kids.length) this.syncChildren(el.__kids, kids);
    else if (el.__kids.firstChild) el.__kids.replaceChildren();
  }

  renderCrumbs() {
    const parts = this.store.pathOf(this.doc.id).map((a) =>
      a.type === "folder"
        ? `<span class="ol-crumb is-dir">${escapeHtml(_itemTitle(a))}</span>`
        : `<span class="ol-crumb" data-open="${a.id}">${escapeHtml(_itemTitle(a))}</span>`
    );
    parts.push(`<span class="ol-crumb" data-zoom="">${escapeHtml(this.doc.title || "无标题")}</span>`);
    if (this.zoomId) {
      for (const a of this.tree.ancestors(this.zoomId)) {
        parts.push(`<span class="ol-crumb" data-zoom="${a.id}">${escapeHtml(htmlToText(a.text).replace(/\n/g, " ") || "（空）")}</span>`);
      }
      const z = this.tree.node(this.zoomId);
      parts.push(`<span class="ol-crumb is-cur">${escapeHtml(htmlToText(z.text).replace(/\n/g, " ") || "（空）")}</span>`);
    }
    this.crumbsEl.innerHTML = parts.join('<span class="ol-crumb-sep">›</span>');
  }

  renderTitle() {
    const t = this.titleEl;
    if (this.zoomId) {
      const n = this.tree.node(this.zoomId);
      if (t.contentEditable !== "true") t.contentEditable = "true";
      t.classList.add("is-zoom");
      const key = "z:" + n.id + ":" + n.text;
      if (t.__val !== key) {
        t.innerHTML = textToDom(n.text);
        t.__val = key;
      }
    } else {
      if (t.contentEditable !== "plaintext-only") t.contentEditable = "plaintext-only";
      t.classList.remove("is-zoom");
      const key = "d:" + this.doc.title;
      if (t.__val !== key) {
        t.textContent = this.doc.title;
        t.__val = key;
      }
    }
  }

  renderSel() {
    this.treeEl.querySelectorAll(".ol-node.is-sel").forEach((e) => e.classList.remove("is-sel"));
    if (!this.sel) return;
    for (const id of this.sel.ids) {
      const el = this.elCache.get(id);
      if (el && el.isConnected) el.classList.add("is-sel");
    }
  }

  updateBarState() {
    const q = (s) => this.root.querySelector(s);
    q('[data-act="hidedone"]').classList.toggle("is-on", this.hideDone);
    q('[data-act="opensy"]').style.display = this.doc && this.doc.syncDocId ? "" : "none";
    this.updateSyncState();
  }

  updateSyncState() {
    const el = this.syncStateEl;
    const d = this.doc;
    let s = "";
    let tip = "";
    if (d && d.syncDocId) {
      const auto = this.plugin.autoSyncOn();
      if (this.plugin._syncingId === d.id) s = "同步中…";
      else if (d.__dirty) {
        s = auto ? "等待自动同步" : "有未同步的修改";
        tip = auto ? "停止编辑约 30 秒后自动同步（同一篇至少间隔 1 分钟）" : "自动同步已关闭，点「同步到思源」手动同步";
      } else if (d.lastSyncAt) {
        s = `${auto ? "已自动同步" : "已同步"} ${fmtTime(d.lastSyncAt)}`;
        tip = auto ? "修改会自动同步到对应的思源文档" : "";
      }
    }
    if (el.textContent !== s) el.textContent = s;
    el.title = tip;
    el.classList.toggle("is-pending", !!(d && d.__dirty));
  }

  /* ---------- 焦点 ---------- */
  contentEl(id) {
    const el = this.elCache.get(id);
    return el && el.isConnected ? el.__content : null;
  }

  focusNode(id, pos) {
    const c = this.contentEl(id);
    if (!c) return false;
    c.focus({ preventScroll: true });
    this.scrollIntoView(c);
    if (pos && typeof pos === "object") placeCaretAtX(c, pos.x, pos.which);
    else setCaret(c, pos == null ? "end" : pos);
    this.editing = id;
    return true;
  }

  focusTitle(pos) {
    this.titleEl.focus({ preventScroll: true });
    setCaret(this.titleEl, pos == null ? "end" : pos);
    this.scrollIntoView(this.titleEl);
  }

  scrollIntoView(el) {
    const sr = this.scrollEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < sr.top + 8) this.scrollEl.scrollTop -= sr.top + 8 - r.top + 40;
    else if (r.bottom > sr.bottom - 8) this.scrollEl.scrollTop += r.bottom - sr.bottom + 8 + 40;
  }

  captureFocus() {
    if (this.sel) return { sel: true };
    const a = document.activeElement;
    if (a && this.root.contains(a)) {
      if (a.__blk) return { id: a.__blk.id, blk: a.__blk.bi, kind: a.__blk.kind, r: a.__blk.r, c: a.__blk.c, offset: caretOffset(a) };
      if (a.classList.contains("ol-content")) return { id: a.__id, offset: caretOffset(a) };
      if (a.classList.contains("ol-note")) return { id: a.__id, offset: "end" };
      if (a === this.titleEl) return { title: true, offset: caretOffset(a) };
    }
    return this.editing ? { id: this.editing, offset: "end" } : null;
  }

  restoreFocus(f) {
    if (!f) return;
    if (f.sel) {
      this.treeEl.focus({ preventScroll: true });
      const first = this.sel && this.elCache.get(this.sel.ids[0]);
      if (first && first.isConnected) this.scrollIntoView(first.__row);
      return;
    }
    if (f.title) return this.focusTitle(f.offset);
    if (f.blk != null && this.focusBlockAt(f)) return;
    if (f.id && !this.focusNode(f.id, f.offset)) {
      const v = this.visibleNodes();
      if (v.length) this.focusNode(v[0].id, "end");
    }
  }

  /* ---------- 撤销 ---------- */
  snapshot() {
    return {
      data: JSON.stringify({ title: this.doc.title, root: this.doc.root }),
      focus: this.captureFocus(),
      zoom: this.zoomId,
    };
  }

  pushUndo(kind, key) {
    const now = Date.now();
    if (kind === "typing" && this.lastTyping && this.lastTyping.key === key && now - this.lastTyping.t < 1500) {
      this.lastTyping.t = now;
      return;
    }
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
    this.lastTyping = kind === "typing" ? { key, t: now } : null;
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.restoreSnapshot(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.restoreSnapshot(this.redoStack.pop());
  }

  restoreSnapshot(s) {
    const d = JSON.parse(s.data);
    this.doc.title = d.title;
    this.doc.root = d.root;
    this.tree.reindex();
    this.zoomId = s.zoom && this.tree.node(s.zoom) ? s.zoom : null;
    this.sel = null;
    this.lastTyping = null;
    this.noteEditing = null;
    this.changed();
    this.render();
    this.renderDocList();
    const f = s.focus && s.focus.sel ? null : s.focus;
    if (f) this.restoreFocus(f);
    else {
      const v = this.visibleNodes();
      if (v.length) this.focusNode(v[0].id, "end");
    }
  }

  /* ---------- 变更 ---------- */
  changed() {
    if (!this.doc) return;
    this.store.touch(this.doc);
    this._hitsStale = true;
    if (this.doc.syncDocId) {
      this.plugin.markDirty(this.doc);
      this.updateSyncState();
    }
    clearTimeout(this._sideTimer);
    this._sideTimer = setTimeout(() => this.renderDocList(), 300);
  }

  afterStruct(focus) {
    this.tree.reindex();
    this.changed();
    this.render();
    this.restoreFocus(focus);
  }

  structOp(op, ids) {
    const focus = this.captureFocus();
    this.pushUndo("struct");
    const ok = this[op](ids);
    if (!ok) {
      this.undoStack.pop();
      return false;
    }
    this.afterStruct(focus);
    return true;
  }
}

// ---- 31-events.js ----
/* ---------- 事件 ---------- */
Object.assign(OutlineEditor.prototype, {
  bindEvents() {
    const r = this.root;
    const on = (el, type, fn) => el.addEventListener(type, fn.bind(this));
    on(r, "keydown", this.onKeyDown);
    on(r, "beforeinput", this.onBeforeInput);
    on(r, "input", this.onInput);
    on(r, "paste", this.onPaste);
    on(r, "copy", this.onCopy);
    on(r, "cut", this.onCopy);
    on(r, "click", this.onClick);
    on(r, "mousedown", this.onMouseDown);
    on(r, "contextmenu", this.onContextMenu);
    on(r, "focusin", this.onFocusIn);
    on(r, "focusout", this.onFocusOut);
    on(this.treeEl, "dragstart", this.onDragStart);
    on(this.treeEl, "dragover", this.onDragOver);
    on(this.treeEl, "drop", this.onDrop);
    on(this.treeEl, "dragend", this.onDragEnd);
    on(this.treeEl, "dragleave", (e) => {
      if (!this.treeEl.contains(e.relatedTarget)) this.dropEl.style.display = "none";
    });
    on(this.fmtEl, "mousedown", this.onFmtMouseDown);
    on(this.filterInput, "input", () => {
      this.filter = this.filterInput.value;
      this.forceShow.clear();
      this.sel = null;
      this.render();
      this.showTagDrop();
    });
    on(this.filterInput, "focus", () => this.showTagDrop());
    on(this.filterInput, "blur", () => setTimeout(() => this.hideTagDrop(), 150));
    on(this.tagDropEl, "mousedown", (e) => {
      e.preventDefault();
      const it = e.target.closest(".ol-tagdrop-item");
      if (it) this.filterByTag(it.dataset.tag);
    });
    on(this.sideSearch, "input", () => this.renderDocList());

    this._docSelChange = () => this.onSelChange();
    this._docMouseMove = (e) => this.onDocMouseMove(e);
    this._docMouseUp = (e) => this.onDocMouseUp(e);
    document.addEventListener("selectionchange", this._docSelChange);
    document.addEventListener("mousemove", this._docMouseMove);
    document.addEventListener("mouseup", this._docMouseUp);
    this.bindRichEvents();
    this.bindSideEvents();
  },

  unbindDocEvents() {
    document.removeEventListener("selectionchange", this._docSelChange);
    document.removeEventListener("mousemove", this._docMouseMove);
    document.removeEventListener("mouseup", this._docMouseUp);
    document.removeEventListener("mousedown", this._docMouseDownPop, true);
  },

  /** 当前按键对应的可自定义命令 id */
  cmdFor(e) {
    const combo = comboOf(e);
    if (!combo) return null;
    return this.plugin.keymapIndex()[combo] || null;
  },

  onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229 || !this.doc) return;
    const t = e.target;
    const mod = e.ctrlKey || e.metaKey;
    const cmd = this.cmdFor(e);
    let handled = false;
    if (cmd === "search") {
      this.filterInput.focus();
      this.filterInput.select();
      handled = true;
    } else if (cmd === "help") {
      this.showHelp();
      handled = true;
    } else if (t.classList.contains("ol-content")) handled = this.keyContent(e, t, cmd);
    else if (t.classList.contains("ol-note")) handled = this.keyNote(e, t, cmd);
    else if (t === this.titleEl) handled = this.keyTitle(e, cmd);
    else if (t === this.treeEl) handled = this.keySel(e, cmd);
    else if (t.__blk) handled = this.keyBlock(e, t);
    else if (t.classList.contains("ol-code-lang")) handled = this.keyCodeLang(e, t);
    else if (t === this.filterInput) handled = this.keyFilter(e);
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    } else if (t.isContentEditable || t.tagName === "INPUT") {
      // 普通输入按键不交给思源处理
      if (!mod && !e.altKey) e.stopPropagation();
    }
  },

  /** 撤销 / 重做 + 标题（各种焦点位置都可用） */
  keyCommon(e, ids, cmd) {
    const mod = e.ctrlKey || e.metaKey;
    const k = keyNameOf(e);
    if (mod && !e.altKey && k === "Z") {
      e.shiftKey ? this.redo() : this.undo();
      return true;
    }
    if (mod && !e.altKey && !e.shiftKey && k === "Y") {
      this.redo();
      return true;
    }
    if (cmd === undefined) cmd = this.cmdFor(e);
    if (cmd && /^h[0-3]$/.test(cmd) && ids.length) {
      this.setHeading(ids, +cmd.slice(1));
      return true;
    }
    return false;
  },

  keyContent(e, el, cmd) {
    const id = el.__id;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (this.slash && this.keySlash(e)) return true;
    if (this.keyCommon(e, [id], cmd)) return true;
    switch (cmd) {
      case "lineMode": this.toggleLineMode(id, el); return true;
      case "note": this.editNote(id); return true;
      case "done": this.toggleDone([id]); return true;
      case "collapse": this.collapseCmd(id); return true;
      case "expand": this.expandCmd(id); return true;
      case "toggleFold": this.toggleCollapse(id); return true;
      case "moveUp": this.structOp("moveUp", [id]); return true;
      case "moveDown": this.structOp("moveDown", [id]); return true;
      case "zoomIn": this.zoomIn(id); return true;
      case "zoomOut": this.zoomOut(); return true;
      case "strike": this.format("strikeThrough"); return true;
      case "link": this.openLinkPop(el); return true;
    }
    if (k === "Enter") {
      if (!mod && !e.altKey && !e.shiftKey) {
        if (this.lineMode === id) this.insertLineBreak(el);
        else this.handleEnter(id, el);
      }
      return true;
    }
    if (k === "Tab") {
      if (!mod && !e.altKey) this.structOp(e.shiftKey ? "outdent" : "indent", [id]);
      return true;
    }
    if (k === "Backspace" && !mod && !e.altKey) {
      const r = getSelRange(el);
      if (r && r.collapsed && caretOffset(el) === 0) {
        this.handleBackspace(id, el);
        return true;
      }
      return false;
    }
    if (k === "Delete" && !mod && !e.altKey) {
      const r = getSelRange(el);
      if (r && r.collapsed && caretOffset(el) === contentLen(el)) {
        this.handleDelete(id, el);
        return true;
      }
      return false;
    }
    if ((k === "ArrowUp" || k === "ArrowDown") && !mod && !e.altKey) {
      const up = k === "ArrowUp";
      const r = getSelRange(el);
      if (e.shiftKey) {
        if ((r && r.collapsed && (up ? caretOnFirstLine(el) : caretOnLastLine(el))) || (r && !r.collapsed && selectionCoversAll(el))) {
          this.startSel(id);
          return true;
        }
        return false;
      }
      if (r && !r.collapsed) return false;
      if (up ? caretOnFirstLine(el) : caretOnLastLine(el)) {
        const cr = caretRect(el);
        const x = cr ? cr.left : el.getBoundingClientRect().left;
        if (!up) {
          const bi = this.focusableBlocks(this.tree.node(id))[0];
          if (bi != null && this.focusBlock(id, bi, "start", x)) return true;
        }
        this.moveFocus(id, up ? -1 : 1, x);
        return true;
      }
      return false;
    }
    if (mod && !e.altKey && !e.shiftKey) {
      const lk = keyNameOf(e);
      if (lk === "B" || lk === "I" || lk === "U") {
        this.format({ B: "bold", I: "italic", U: "underline" }[lk]);
        return true;
      }
      if (lk === "A" && selectionCoversAll(el)) {
        this.selectAll();
        return true;
      }
    }
    if (k === "Escape") {
      if (this.lineMode === id) this.setLineMode(null);
      else this.startSel(id);
      return true;
    }
    return false;
  },

  moveFocus(id, dir, x) {
    const vis = this.visibleNodes();
    const i = vis.findIndex((n) => n.id === id);
    const target = vis[i + dir];
    if (!target) {
      if (dir < 0) this.focusTitle("end");
      else {
        const c = this.contentEl(id);
        if (c) setCaret(c, "end");
      }
      return;
    }
    if (dir < 0) {
      const fb = this.focusableBlocks(target);
      if (fb.length && this.focusBlock(target.id, fb[fb.length - 1], "end", x)) return;
    }
    this.focusNode(target.id, { x, which: dir < 0 ? "last" : "first" });
  },

  keyNote(e, el, cmd) {
    const id = el.__id;
    const k = e.key;
    if (this.keyCommon(e, [id], cmd)) return true;
    if (cmd === "note" || k === "Escape") {
      this.focusNode(id, "end");
      return true;
    }
    if (k === "Tab") return true;
    if (k === "Backspace" && !el.textContent) {
      this.removeNote(id);
      return true;
    }
    if (k === "ArrowUp" && !e.shiftKey && caretOnFirstLine(el)) {
      this.focusNode(id, "end");
      return true;
    }
    if (k === "ArrowDown" && !e.shiftKey && caretOnLastLine(el)) {
      const cr = caretRect(el);
      this.moveFocus(id, 1, cr ? cr.left : el.getBoundingClientRect().left);
      return true;
    }
    return false;
  },

  keyTitle(e, cmd) {
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (this.keyCommon(e, this.zoomId ? [this.zoomId] : [], cmd)) return true;
    if (cmd === "lineMode") {
      if (this.zoomId) this.toggleLineMode("title", this.titleEl);
      return true;
    }
    if (cmd === "zoomOut") {
      this.zoomOut();
      return true;
    }
    if (cmd === "link" && this.zoomId) {
      this.openLinkPop(this.titleEl);
      return true;
    }
    if (k === "Enter") {
      if (!mod && !e.altKey && this.lineMode === "title") this.insertLineBreak(this.titleEl);
      else if (!e.shiftKey && !mod && !e.altKey) this.addFirstChild();
      return true;
    }
    if (k === "Escape" && this.lineMode === "title") {
      this.setLineMode(null);
      return true;
    }
    if (k === "Tab") return true;
    if (k === "ArrowDown" && !e.shiftKey && !mod && caretOnLastLine(this.titleEl)) {
      const v = this.visibleNodes();
      if (v.length) this.focusNode(v[0].id, 0);
      return true;
    }
    if (mod && !e.altKey && !e.shiftKey && this.zoomId && ["B", "I", "U"].includes(keyNameOf(e))) {
      this.format({ B: "bold", I: "italic", U: "underline" }[keyNameOf(e)]);
      return true;
    }
    return false;
  },

  keyFilter(e) {
    if (e.key === "Escape") {
      this.filterInput.value = "";
      this.filter = "";
      this.forceShow.clear();
      this.hideTagDrop();
      this.render();
      const v = this.visibleNodes();
      if (v.length) this.focusNode(v[0].id, "end");
      return true;
    }
    if (e.key === "Enter" || e.key === "ArrowDown") {
      this.hideTagDrop();
      const v = this.visibleNodes();
      const first = v.find((n) => this.hitSet && this.hitSet.has(n.id)) || v[0];
      if (first) this.focusNode(first.id, "end");
      return true;
    }
    return false;
  },

  keySel(e, cmd) {
    if (!this.sel) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") {
        const v = this.visibleNodes();
        if (v.length) this.focusNode((e.key === "ArrowUp" ? v[v.length - 1] : v[0]).id, "end");
        return true;
      }
      return false;
    }
    const ids = this.sel.ids.slice();
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (this.keyCommon(e, ids, cmd)) return true;
    switch (cmd) {
      case "done": this.toggleDone(ids); return true;
      case "moveUp": this.structOp("moveUp", ids); return true;
      case "moveDown": this.structOp("moveDown", ids); return true;
      case "collapse":
      case "expand":
        ids.forEach((id) => {
          const n = this.tree.node(id);
          if (n.children.length) n.collapsed = cmd === "collapse";
        });
        this.changed();
        this.render();
        return true;
      case "zoomIn": this.zoomIn(ids[0]); return true;
      case "zoomOut": this.zoomOut(); return true;
    }
    switch (k) {
      case "Escape": {
        const back = this.sel.focus;
        this.clearSel();
        this.focusNode(back, "end");
        return true;
      }
      case "ArrowUp":
      case "ArrowDown": {
        if (mod || e.altKey) return true;
        const up = k === "ArrowUp";
        if (e.shiftKey) this.extendSel(up ? -1 : 1);
        else {
          const target = up ? ids[0] : ids[ids.length - 1];
          this.clearSel();
          this.focusNode(target, up ? 0 : "end");
        }
        return true;
      }
      case "Tab":
        this.structOp(e.shiftKey ? "outdent" : "indent", ids);
        return true;
      case "Backspace":
      case "Delete":
        this.deleteNodes(ids);
        return true;
      case "Enter":
        if (!mod && !e.altKey && !e.shiftKey) {
          this.clearSel();
          this.focusNode(ids[0], "end");
        }
        return true;
    }
    if (mod && keyNameOf(e) === "A") {
      this.selectAll();
      return true;
    }
    return false;
  },

  onBeforeInput(e) {
    const t = e.target;
    if (e.inputType === "historyUndo") {
      e.preventDefault();
      this.undo();
      return;
    }
    if (e.inputType === "historyRedo") {
      e.preventDefault();
      this.redo();
      return;
    }
    if (!t.classList) return;
    const isContent = t.classList.contains("ol-content");
    if ((isContent || t === this.titleEl) && (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak")) {
      e.preventDefault();
      return;
    }
    if (t.__blk) {
      const b = t.__blk;
      this.pushUndo("typing", `b:${b.id}:${b.bi}:${b.r || 0}:${b.c || 0}`);
      return;
    }
    if (t.classList.contains("ol-code-lang")) {
      this.pushUndo("typing", "lang");
      return;
    }
    if (isContent) this.pushUndo("typing", "c:" + t.__id);
    else if (t.classList.contains("ol-note")) this.pushUndo("typing", "n:" + t.__id);
    else if (t === this.titleEl) this.pushUndo("typing", "t");
  },

  onInput(e) {
    const t = e.target;
    if (!t.classList || !this.doc) return;
    if (t.classList.contains("ol-content")) {
      const n = this.tree.node(t.__id);
      if (!n) return;
      if (!t.textContent && t.innerHTML && t.querySelectorAll("br").length <= 1) {
        t.innerHTML = "";
        setCaret(t, 0);
      }
      n.text = domToText(t);
      t.__val = n.text;
      this.changed();
      this.slashOnInput(e, t);
      if (this.zoomId && this.tree.isAncestor(n.id, this.zoomId)) this.renderCrumbs();
    } else if (t.__blk) {
      this.updateBlockFromEl(t);
    } else if (t.classList.contains("ol-code-lang")) {
      this.updateCodeLang(t);
    } else if (t.classList.contains("ol-note")) {
      const n = this.tree.node(t.__id);
      if (!n) return;
      n.note = t.innerText.replace(/\n$/, "");
      t.__val = n.note;
      this.changed();
    } else if (t === this.titleEl) {
      if (this.zoomId) {
        const n = this.tree.node(this.zoomId);
        n.text = domToText(t);
        t.__val = "z:" + n.id + ":" + n.text;
      } else {
        this.doc.title = t.textContent.replace(/\n/g, " ");
        t.__val = "d:" + this.doc.title;
        this.updateTabTitle();
      }
      this.changed();
      this.renderCrumbs();
    }
  },

  onPaste(e) {
    const t = e.target;
    const cd = e.clipboardData;
    if (!cd || !this.doc) return;
    const text = cd.getData("text/plain").replace(/[\uFFFC\uFFFD]/g, "");
    if (t.__blk || (t.classList && t.classList.contains("ol-code-lang"))) {
      e.stopPropagation();
      return;
    }
    const imgs = [...(cd.files || [])].filter((f) => /^image\//.test(f.type));
    if (imgs.length && t.classList && t.classList.contains("ol-content")) {
      e.preventDefault();
      e.stopPropagation();
      this.insertImageFiles(t.__id, imgs);
      return;
    }
    if (t.classList && t.classList.contains("ol-content") && /^https?:\/\/\S+$/.test(text.trim())) {
      const r = getSelRange(t);
      if (r && !r.collapsed) {
        e.preventDefault();
        e.stopPropagation();
        this.pushUndo("struct");
        document.execCommand("insertHTML", false, `<a href="${escapeHtml(text.trim())}">${escapeHtml(r.toString())}</a>`);
        return;
      }
    }
    const inEditable = t.classList && (t.classList.contains("ol-content") || t.classList.contains("ol-note") || t === this.titleEl);
    if (inEditable) {
      e.preventDefault();
      e.stopPropagation();
      if (t.classList.contains("ol-content")) {
        const nodes = this.clipboardNodes(text);
        if (nodes) return this.pasteNodes(t.__id, nodes);
        document.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " "));
      } else if (t === this.titleEl) {
        document.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " "));
      } else {
        document.execCommand("insertText", false, text);
      }
      return;
    }
    if (this.sel && this.root.contains(document.activeElement)) {
      e.preventDefault();
      e.stopPropagation();
      let nodes = this.clipboardNodes(text);
      if (!nodes && text.trim()) nodes = [newNode(mdInlineToHtml(text.trim()))];
      if (nodes) this.pasteNodes(this.sel.ids[this.sel.ids.length - 1], nodes);
    }
  },

  onCopy(e) {
    if (!this.sel || document.activeElement !== this.treeEl) return;
    e.preventDefault();
    e.stopPropagation();
    const text = this.copyNodes(this.sel.ids);
    e.clipboardData.setData("text/plain", text);
    if (e.type === "cut") this.deleteNodes(this.sel.ids.slice());
  },

  onFocusIn(e) {
    const t = e.target;
    if (!t.classList) return;
    if (this.lineMode) {
      const cur = t === this.titleEl ? "title" : t.classList.contains("ol-content") ? t.__id : null;
      if (cur !== this.lineMode) this.setLineMode(null);
    }
    if (t.__blk) {
      this.editing = t.__blk.id;
      if (t.__blk.kind === "cell") this.lastCell = t.__blk;
      if (t.__blk.kind === "math" || t.__blk.kind === "mermaid") t.closest(".ol-blk").classList.add("is-editing");
      if (this.sel) this.clearSel();
    } else if (t.classList.contains("ol-content")) {
      this.editing = t.__id;
      if (this.sel) this.clearSel();
    } else if (t.classList.contains("ol-note")) {
      this.noteEditing = t.__id;
      this.editing = t.__id;
      if (this.sel) this.clearSel();
    } else if (t === this.titleEl && this.sel) this.clearSel();
  },

  onFocusOut(e) {
    const t = e.target;
    if (t.__blk && (t.__blk.kind === "math" || t.__blk.kind === "mermaid")) {
      setTimeout(() => {
        if (document.activeElement !== t) {
          const blk = t.closest(".ol-blk");
          if (blk) blk.classList.remove("is-editing");
        }
      }, 0);
    }
    if (t.classList && t.classList.contains("ol-content")) setTimeout(() => {
      if (document.activeElement !== t) this.refreshTags(t);
    }, 0);
    if (t.classList && t.classList.contains("ol-content") && this.slash) setTimeout(() => {
      if (!this.slash || document.activeElement !== this.slash.el) this.closeSlash();
    }, 0);
    if (t.classList && t.classList.contains("ol-note")) {
      const id = t.__id;
      setTimeout(() => {
        if (document.activeElement === t) return;
        const n = this.tree && this.tree.node(id);
        if (this.noteEditing === id) this.noteEditing = null;
        if (n && !n.note) {
          delete n.note;
          this.render();
        }
      }, 0);
    }
    if (t === this.treeEl && this.sel) {
      setTimeout(() => {
        const a = document.activeElement;
        if (a !== this.treeEl && !(a && a.closest && a.closest(".b3-menu"))) this.clearSel();
      }, 0);
    }
  },

  /* ---------- 鼠标 ---------- */
  onMouseDown(e) {
    if (e.button !== 0) return;
    const t = e.target;
    const fold = t.closest(".ol-fold");
    if (fold) {
      e.preventDefault();
      const id = fold.closest(".ol-node").dataset.id;
      this._foldDown = id;
      this.toggleCollapse(id);
      return;
    }
    const bdown = t.closest(".ol-bullet");
    if (bdown) {
      this._bulletDown = { id: bdown.closest(".ol-node").dataset.id, x: e.clientX, y: e.clientY };
      return;
    }
    const tool = t.closest(".ol-blk-tools button");
    if (tool) {
      e.preventDefault();
      this.blockAction(tool.dataset.bact, tool.closest(".ol-blk"));
      return;
    }
    const mview = t.closest(".ol-math-view, .ol-mm-view");
    if (mview) {
      e.preventDefault();
      const blk = mview.closest(".ol-blk");
      this.focusBlock(blk.__blkRef.id, blk.__blkRef.bi, "end");
      return;
    }
    if (this.sel && t.closest(".ol-blocks")) this.clearSel();
    const tagEl = t.closest(".ol-tag");
    if (tagEl && tagEl.closest(".ol-content") && (e.ctrlKey || e.metaKey || document.activeElement !== tagEl.closest(".ol-content"))) {
      e.preventDefault();
      this.filterByTag(tagEl.dataset.tag);
      return;
    }
    const content = t.closest(".ol-content");
    if (content) {
      if (e.shiftKey && (this.sel || this.editing) && this.tree.node(this.sel ? this.sel.anchor : this.editing)) {
        e.preventDefault();
        this.setSelRange(this.sel ? this.sel.anchor : this.editing, content.__id);
        return;
      }
      if (this.sel) this.clearSel();
      this.mouseAnchor = content.__id;
      this.mouseSelecting = false;
      return;
    }
    if (t === this.tailEl) {
      e.preventDefault();
      if (!this.shownChildren(this.zoomNode()).length) this.addFirstChild();
      else {
        const v = this.visibleNodes();
        this.focusNode(v[v.length - 1].id, "end");
      }
      return;
    }
    if (this.sel && t.closest(".ol-page") && !t.closest(".ol-row")) this.clearSel();
  },

  onDocMouseMove(e) {
    if (!this.mouseAnchor || !(e.buttons & 1)) return;
    const nodeEl = e.target && e.target.closest ? e.target.closest(".ol-node") : null;
    if (!nodeEl || !this.treeEl.contains(nodeEl)) return;
    const id = nodeEl.dataset.id;
    if (id === this.mouseAnchor && !this.mouseSelecting) return;
    if (!this.mouseSelecting) {
      this.mouseSelecting = true;
      this.root.classList.add("is-mselect");
    }
    if (!this.sel || this.sel.focus !== id) this.setSelRange(this.mouseAnchor, id);
  },

  onDocMouseUp(e) {
    const bd = this._bulletDown;
    this._bulletDown = null;
    if (bd && e && e.button === 0 && Math.abs(e.clientX - bd.x) < 5 && Math.abs(e.clientY - bd.y) < 5) {
      const b = e.target && e.target.closest ? e.target.closest(".ol-bullet") : null;
      if (b && b.closest(".ol-node").dataset.id === bd.id) {
        this._bulletZoomAt = Date.now();
        this.zoomIn(bd.id);
      }
    }
    this.mouseAnchor = null;
    if (this.mouseSelecting) {
      this.mouseSelecting = false;
      this.root.classList.remove("is-mselect");
    }
  },

  onClick(e) {
    const t = e.target;
    const fold = t.closest(".ol-fold");
    if (fold) {
      // 兜底：若 mousedown 没送达（被宿主拦截），用 click 完成折叠
      const id = fold.closest(".ol-node").dataset.id;
      if (this._foldDown !== id) this.toggleCollapse(id);
      this._foldDown = null;
      return;
    }
    const bullet = t.closest(".ol-bullet");
    if (bullet) {
      // 兜底：mouseup 已经处理过就不重复
      if (Date.now() - (this._bulletZoomAt || 0) > 600) this.zoomIn(bullet.closest(".ol-node").dataset.id);
      return;
    }
    const crumb = t.closest(".ol-crumb");
    if (crumb) {
      if (crumb.dataset.open) this.openDoc(crumb.dataset.open);
      else if (!crumb.classList.contains("is-cur") && !crumb.classList.contains("is-dir")) this.zoomTo(crumb.dataset.zoom || null, this.zoomId);
      return;
    }
    const a = t.closest(".ol-content a, .ol-title a");
    if (a && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      this.openHref(a.getAttribute("href"));
      return;
    }
    const btn = t.closest("[data-act]");
    if (btn) this.onAction(btn.dataset.act, btn, e);
  },

  onContextMenu(e) {
    const t = e.target;
    const bullet = t.closest(".ol-bullet, .ol-fold");
    if (bullet) {
      e.preventDefault();
      e.stopPropagation();
      const id = bullet.closest(".ol-node").dataset.id;
      const ids = this.sel && this.sel.ids.includes(id) ? this.sel.ids.slice() : [id];
      this.nodeMenu(ids, e);
      return;
    }
    if (this.sel && t.closest(".ol-node.is-sel")) {
      e.preventDefault();
      this.nodeMenu(this.sel.ids.slice(), e);
    }
  },

  /* ---------- 拖拽 ---------- */
  onDragStart(e) {
    const bullet = e.target.closest && e.target.closest(".ol-bullet");
    if (!bullet) return;
    const nodeEl = bullet.closest(".ol-node");
    const id = nodeEl.dataset.id;
    this.dragIds = this.sel && this.sel.ids.includes(id) ? this.sel.ids.slice() : [id];
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", nodesToMarkdown(this._nodes(this.dragIds)));
    try {
      e.dataTransfer.setDragImage(nodeEl.__row, 10, 12);
    } catch (err) { /* ignore */ }
    this.root.classList.add("is-dragging");
  },

  _dropTarget(e) {
    const row = e.target.closest && e.target.closest(".ol-row");
    if (!row || !this.treeEl.contains(row)) return null;
    const nodeEl = row.parentElement;
    const id = nodeEl.dataset.id;
    if (this.dragIds.some((d) => d === id || this.tree.isAncestor(d, id))) return null;
    const n = this.tree.node(id);
    const rect = row.getBoundingClientRect();
    const crect = nodeEl.__content.getBoundingClientRect();
    let pos;
    if (e.clientY < rect.top + rect.height / 2) pos = "before";
    else if (this.isOpen(n) && this.shownChildren(n).length) pos = "child";
    else pos = e.clientX > crect.left + 36 ? "child" : "after";
    return { id, pos, row, crect };
  },

  onDragOver(e) {
    if (!this.dragIds) return;
    e.preventDefault();
    const tg = this._dropTarget(e);
    this._drop = tg;
    if (!tg) {
      this.dropEl.style.display = "none";
      e.dataTransfer.dropEffect = "none";
      return;
    }
    e.dataTransfer.dropEffect = "move";
    const pr = this.pageEl.getBoundingClientRect();
    const rr = tg.row.getBoundingClientRect();
    const y = tg.pos === "before" ? rr.top : rr.bottom;
    const x = tg.crect.left + (tg.pos === "child" ? 26 : 0);
    Object.assign(this.dropEl.style, {
      display: "block",
      top: y - pr.top - 1 + "px",
      left: x - pr.left + "px",
      width: Math.max(60, pr.right - x - 24) + "px",
    });
  },

  onDrop(e) {
    if (!this.dragIds) return;
    e.preventDefault();
    const tg = this._drop;
    const ids = this.dragIds;
    this.onDragEnd();
    if (!tg) return;
    const focus = this.sel ? { sel: true } : null;
    this.pushUndo("struct");
    if (!this.moveNodesTo(ids, tg.id, tg.pos)) {
      this.undoStack.pop();
      return;
    }
    this.tree.reindex();
    this.changed();
    this.render();
    if (focus) this.restoreFocus(focus);
  },

  onDragEnd() {
    this.dragIds = null;
    this._drop = null;
    this.dropEl.style.display = "none";
    this.root.classList.remove("is-dragging");
  },

  /* ---------- 文字格式工具条 ---------- */
  onSelChange() {
    if (this.slash) this.updateSlash();
    if (this.mouseSelecting) return;
    const s = window.getSelection();
    if (!s || !s.rangeCount || s.isCollapsed) return this.hideFmt();
    const r = s.getRangeAt(0);
    let host = r.commonAncestorContainer;
    if (host.nodeType !== 1) host = host.parentElement;
    host = host && host.closest(".ol-content, .ol-title.is-zoom");
    if (!host || !this.root.contains(host) || !r.toString().trim()) return this.hideFmt();
    const rect = r.getBoundingClientRect();
    const f = this.fmtEl;
    const isTitle = !host.classList.contains("ol-content");
    f.classList.toggle("no-head", isTitle);
    const hn = isTitle ? null : this.tree.node(host.__id);
    f.querySelectorAll("[data-head]").forEach((b) => b.classList.toggle("is-on", !!hn && hn.heading === +b.dataset.head));
    f.style.display = "flex";
    const w = f.offsetWidth;
    const h = f.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = rect.top - h - 8;
    if (top < 8) top = rect.bottom + 8;
    f.style.left = left + "px";
    f.style.top = top + "px";
  },

  hideFmt() {
    if (this.fmtEl.style.display !== "none") this.fmtEl.style.display = "none";
  },

  onFmtMouseDown(e) {
    e.preventDefault();
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.head) this.headingFromSelection(+b.dataset.head);
    else if (b.dataset.fmt) this.format(b.dataset.fmt);
    else if (b.dataset.color) this.format("foreColor", b.dataset.color);
    else if (b.dataset.bg) this.format("hiliteColor", b.dataset.bg);
  },

  headingFromSelection(level) {
    const a = document.activeElement;
    if (!a || !a.classList.contains("ol-content") || !this.root.contains(a)) return;
    const id = a.__id;
    const o = selectionOffsets(a);
    this.setHeading([id], level);
    const c = this.contentEl(id);
    if (c && o) {
      c.focus({ preventScroll: true });
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(rangeFromOffsets(c, o.start, o.end));
    }
  },

  format(cmd, val) {
    const a = document.activeElement;
    if (!a || !this.root.contains(a)) return;
    if (!(a.classList.contains("ol-content") || (a === this.titleEl && this.zoomId))) return;
    this.pushUndo("format");
    const css = cmd === "foreColor" || cmd === "hiliteColor";
    document.execCommand("styleWithCSS", false, css);
    document.execCommand(cmd, false, val);
    document.execCommand("styleWithCSS", false, false);
  },
});

// ---- 32-ops.js ----
/* ---------- 结构操作 ---------- */
Object.assign(OutlineEditor.prototype, {
  _nodes(ids) {
    return ids.map((id) => this.tree.node(id)).filter(Boolean);
  },

  _prevShownSibling(p, idx) {
    for (let i = idx - 1; i >= 0; i--) if (this.isShown(p.children[i])) return i;
    return -1;
  },

  _nextShownSibling(p, idx) {
    for (let i = idx + 1; i < p.children.length; i++) if (this.isShown(p.children[i])) return i;
    return -1;
  },

  _detach(nodes) {
    for (const n of nodes) {
      const p = this.tree.parent(n.id);
      const i = p.children.indexOf(n);
      if (i >= 0) p.children.splice(i, 1);
    }
  },

  indent(ids) {
    const nodes = this._nodes(ids);
    if (!nodes.length) return false;
    const p = this.tree.parent(nodes[0].id);
    const pi = this._prevShownSibling(p, p.children.indexOf(nodes[0]));
    if (pi < 0) return false;
    const prev = p.children[pi];
    this._detach(nodes);
    prev.children.push(...nodes);
    prev.collapsed = false;
    return true;
  },

  outdent(ids) {
    const nodes = this._nodes(ids);
    if (!nodes.length) return false;
    const p = this.tree.parent(nodes[0].id);
    if (p === this.zoomNode() || p.id === "root") return false;
    const gp = this.tree.parent(p.id);
    this._detach(nodes);
    gp.children.splice(gp.children.indexOf(p) + 1, 0, ...nodes);
    return true;
  },

  moveUp(ids) {
    const nodes = this._nodes(ids);
    if (!nodes.length) return false;
    const p = this.tree.parent(nodes[0].id);
    const pi = this._prevShownSibling(p, p.children.indexOf(nodes[0]));
    if (pi >= 0) {
      this._detach(nodes);
      p.children.splice(pi, 0, ...nodes);
      return true;
    }
    // 已是第一个：移到上一个"叔叔"节点的末尾
    if (p === this.zoomNode() || p.id === "root") return false;
    const gp = this.tree.parent(p.id);
    const ui = this._prevShownSibling(gp, gp.children.indexOf(p));
    if (ui < 0) return false;
    const uncle = gp.children[ui];
    this._detach(nodes);
    uncle.children.push(...nodes);
    uncle.collapsed = false;
    return true;
  },

  moveDown(ids) {
    const nodes = this._nodes(ids);
    if (!nodes.length) return false;
    const last = nodes[nodes.length - 1];
    const p = this.tree.parent(last.id);
    const ni = this._nextShownSibling(p, p.children.indexOf(last));
    if (ni >= 0) {
      const next = p.children[ni];
      this._detach(nodes);
      p.children.splice(p.children.indexOf(next) + 1, 0, ...nodes);
      return true;
    }
    if (p === this.zoomNode() || p.id === "root") return false;
    const gp = this.tree.parent(p.id);
    const ui = this._nextShownSibling(gp, gp.children.indexOf(p));
    if (ui < 0) return false;
    const uncle = gp.children[ui];
    this._detach(nodes);
    uncle.children.unshift(...nodes);
    uncle.collapsed = false;
    return true;
  },

  toggleDone(ids) {
    const nodes = this._nodes(ids);
    if (!nodes.length) return;
    const focus = this.captureFocus();
    this.pushUndo("struct");
    const val = !nodes.every((n) => n.done);
    nodes.forEach((n) => {
      if (val) n.done = true;
      else delete n.done;
      if (this.hideDone && val) this.forceShow.add(n.id);
    });
    this.afterStruct(focus);
  },

  setHeading(ids, level) {
    const nodes = this._nodes(ids);
    if (!nodes.length) return;
    const focus = this.captureFocus();
    this.pushUndo("struct");
    const same = nodes.every((n) => (n.heading || 0) === level);
    nodes.forEach((n) => {
      if (!level || same) delete n.heading;
      else n.heading = level;
    });
    this.afterStruct(focus);
  },

  /* ---------- 回车 / 退格 / 删除 ---------- */
  handleEnter(id, el) {
    const node = this.tree.node(id);
    if (!node) return;
    const r = getSelRange(el);
    if (r && !r.collapsed) r.deleteContents();
    const off = caretOffset(el);
    const len = contentLen(el);
    this.pushUndo("struct");
    const p = this.tree.parent(id);
    const idx = p.children.indexOf(node);
    if (off <= 0 && len > 0) {
      // 行首回车：在上方插入空主题，光标留在原处
      node.text = domToText(el);
      el.__val = node.text;
      const nn = newNode("");
      p.children.splice(idx, 0, nn);
      if (this.matchSet) this.forceShow.add(nn.id);
      this.afterStruct({ id, offset: 0 });
      return;
    }
    let tail = "";
    if (off < len) {
      const sr = getSelRange(el);
      const tr = document.createRange();
      tr.setStart(sr.startContainer, sr.startOffset);
      tr.setEnd(el, el.childNodes.length);
      const box = document.createElement("div");
      box.appendChild(tr.extractContents());
      tail = stripTrailingBr(sanitizeInline(box.innerHTML)).replace(/^<br>/, "");
    }
    node.text = domToText(el);
    el.__val = null; // 强制按模型重绘
    const nn = newNode(tail);
    const openKids = this.isOpen(node) && this.shownChildren(node).length > 0;
    if (openKids) node.children.unshift(nn);
    else p.children.splice(idx + 1, 0, nn);
    if (this.matchSet || this.hideDone) this.forceShow.add(nn.id);
    this.afterStruct({ id: nn.id, offset: 0 });
  },

  mergeInto(target, src) {
    target.text = sanitizeInline(target.text + src.text);
    if (src.blocks && src.blocks.length) target.blocks = (target.blocks || []).concat(src.blocks);
    if (src.note) target.note = target.note ? target.note + "\n" + src.note : src.note;
    const p = this.tree.parent(src.id);
    const idx = p.children.indexOf(src);
    p.children.splice(idx, 1);
    if (src.children.length) {
      if (p === target) target.children.splice(idx, 0, ...src.children);
      else target.children.push(...src.children);
    }
  },

  handleBackspace(id, el) {
    const node = this.tree.node(id);
    const vis = this.visibleNodes();
    const i = vis.indexOf(node);
    const prev = vis[i - 1];
    node.text = domToText(el);
    if (!prev) {
      // 第一个主题：空且无子节点时删除
      const zn = this.zoomNode();
      if (!contentLen(el) && !node.children.length && !(node.blocks && node.blocks.length) && this.shownChildren(zn).length > 1) {
        const next = vis[i + 1];
        this.pushUndo("struct");
        this._detach([node]);
        this.afterStruct({ id: next.id, offset: 0 });
      }
      return;
    }
    this.pushUndo("struct");
    const offset = htmlLen(prev.text);
    this.mergeInto(prev, node);
    this.afterStruct({ id: prev.id, offset });
  },

  handleDelete(id, el) {
    const node = this.tree.node(id);
    const vis = this.visibleNodes();
    const next = vis[vis.indexOf(node) + 1];
    if (!next) return;
    this.pushUndo("struct");
    node.text = domToText(el);
    const offset = htmlLen(node.text);
    this.mergeInto(node, next);
    this.afterStruct({ id, offset });
  },

  /* ---------- 折叠 ---------- */
  collapseCmd(id) {
    const n = this.tree.node(id);
    if (n.children.length && !n.collapsed) {
      n.collapsed = true;
      this.changed();
      this.render();
      this.focusNode(id, this.captureOffset(id));
      return;
    }
    const p = this.tree.parent(id);
    if (p && p !== this.zoomNode() && p.id !== "root") {
      p.collapsed = true;
      this.changed();
      this.render();
      this.focusNode(p.id, "end");
    }
  },

  expandCmd(id) {
    const n = this.tree.node(id);
    if (!n.collapsed) return;
    const off = this.captureOffset(id);
    n.collapsed = false;
    this.changed();
    this.render();
    this.focusNode(id, off);
  },

  captureOffset(id) {
    const c = this.contentEl(id);
    if (c && document.activeElement === c) return caretOffset(c);
    return "end";
  },

  toggleCollapse(id) {
    const n = this.tree.node(id);
    if (!n || !n.children.length) return;
    const focus = this.captureFocus();
    n.collapsed = !n.collapsed;
    this.changed();
    this.render();
    if (focus && focus.id && !this.contentEl(focus.id)) this.focusNode(id, "end");
    else this.restoreFocus(focus);
  },

  setCollapseDepth(depth) {
    // depth: Infinity=全部展开, 0=全部折叠(只看一级)
    const walk = (n, d) => {
      for (const c of n.children) {
        if (c.children.length) {
          if (d + 1 > depth) c.collapsed = true;
          else delete c.collapsed;
        }
        walk(c, d + 1);
      }
    };
    walk(this.zoomNode(), 0);
    this.changed();
    this.render();
  },

  /* ---------- 缩放（进入主题） ---------- */
  zoomIn(id) {
    if (!this.tree.node(id)) return;
    this.zoomTo(id);
  },

  zoomOut() {
    if (!this.zoomId) return;
    const prev = this.zoomId;
    const p = this.tree.parent(prev);
    this.zoomTo(p && p.id !== "root" ? p.id : null, prev);
  },

  zoomTo(id, focusId) {
    this.zoomId = id || null;
    this.sel = null;
    this.forceShow.clear();
    this.render();
    if (focusId && this.focusNode(focusId, "end")) return;
    const kids = this.shownChildren(this.zoomNode());
    if (kids.length) this.focusNode(kids[0].id, "end");
    else this.focusTitle("end");
  },

  /* ---------- 描述 ---------- */
  editNote(id) {
    this.noteEditing = id;
    this.render();
    const el = this.elCache.get(id);
    if (el && el.__note) {
      el.__note.focus({ preventScroll: true });
      setCaret(el.__note, "end");
      this.scrollIntoView(el.__note);
    }
  },

  removeNote(id) {
    const n = this.tree.node(id);
    if (!n) return;
    this.pushUndo("struct");
    delete n.note;
    this.noteEditing = null;
    this.afterStruct({ id, offset: "end" });
  },

  /* ---------- 新建子主题（标题处回车） ---------- */
  addFirstChild() {
    const zn = this.zoomNode();
    const kids = this.shownChildren(zn);
    if (kids.length && !htmlToText(kids[0].text) && !kids[0].children.length) {
      this.focusNode(kids[0].id, 0);
      return;
    }
    this.pushUndo("struct");
    const nn = newNode("");
    zn.children.unshift(nn);
    if (this.matchSet) this.forceShow.add(nn.id);
    this.afterStruct({ id: nn.id, offset: 0 });
  },

  /* ---------- 多选 ---------- */
  chainTo(id) {
    const chain = [];
    const z = this.zoomNode().id;
    let cur = id;
    while (cur && cur !== z) {
      chain.unshift(cur);
      const p = this.tree.parent(cur);
      cur = p ? p.id : null;
    }
    return chain;
  },

  setSelRange(aId, fId) {
    const ca = this.chainTo(aId);
    const cf = this.chainTo(fId);
    if (!ca.length || !cf.length) return;
    let i = 0;
    while (i < ca.length && i < cf.length && ca[i] === cf[i]) i++;
    let a, f;
    if (i === ca.length || i === cf.length) {
      a = f = ca.length <= cf.length ? ca[ca.length - 1] : cf[cf.length - 1];
    } else {
      a = ca[i];
      f = cf[i];
    }
    const parent = this.tree.parent(a);
    const sib = this.shownChildren(parent);
    const ia = sib.indexOf(this.tree.node(a));
    const jf = sib.indexOf(this.tree.node(f));
    const lo = Math.min(ia, jf);
    const hi = Math.max(ia, jf);
    this.sel = { ids: sib.slice(lo, hi + 1).map((n) => n.id), anchor: a, focus: f };
    this.editing = null;
    if (document.activeElement !== this.treeEl) this.treeEl.focus({ preventScroll: true });
    const s = window.getSelection();
    if (s) s.removeAllRanges();
    this.hideFmt();
    this.renderSel();
    const fe = this.elCache.get(f);
    if (fe && fe.isConnected) this.scrollIntoView(fe.__row);
  },

  startSel(id) {
    this.setSelRange(id, id);
  },

  extendSel(dir) {
    const f = this.sel.focus;
    const p = this.tree.parent(f);
    const sib = this.shownChildren(p);
    const j = sib.indexOf(this.tree.node(f)) + dir;
    if (j >= 0 && j < sib.length) this.setSelRange(this.sel.anchor, sib[j].id);
    else if (p !== this.zoomNode() && p.id !== "root") this.setSelRange(p.id, p.id);
  },

  selectAll() {
    const kids = this.shownChildren(this.zoomNode());
    if (kids.length) this.setSelRange(kids[0].id, kids[kids.length - 1].id);
  },

  clearSel() {
    if (!this.sel) return;
    this.sel = null;
    this.renderSel();
  },

  deleteNodes(ids) {
    const nodes = this._nodes(ids);
    if (!nodes.length) return;
    const vis = this.visibleNodes();
    const first = vis.indexOf(nodes[0]);
    this.pushUndo("struct");
    this._detach(nodes);
    this.tree.reindex();
    let target = null;
    for (let i = first - 1; i >= 0; i--) if (this.tree.node(vis[i].id)) { target = vis[i].id; break; }
    let atStart = false;
    if (!target) {
      for (let i = first + 1; i < vis.length; i++) if (this.tree.node(vis[i].id)) { target = vis[i].id; atStart = true; break; }
    }
    this.sel = null;
    if (this.zoomId && !this.zoomNode().children.length) {
      this.afterStruct(null);
      this.focusTitle("end");
      return;
    }
    this.afterStruct(target ? { id: target, offset: atStart ? 0 : "end" } : null);
    if (!target) {
      const v = this.visibleNodes();
      if (v.length) this.focusNode(v[0].id, 0);
    }
  },

  /* ---------- 粘贴 ---------- */
  clipboardNodes(text) {
    const norm = (s) => String(s || "").replace(/\r\n?/g, "\n").trim();
    const clip = this.plugin.clip;
    if (clip && norm(clip.text) === norm(text)) return cloneNodesWithNewIds(clip.nodes);
    if (/\n/.test(norm(text))) {
      const ns = parseOutlineText(text);
      return ns.length ? ns : null;
    }
    return null;
  },

  pasteNodes(afterId, nodes) {
    const n = this.tree.node(afterId);
    if (!n) return;
    this.pushUndo("struct");
    const p = this.tree.parent(afterId);
    const idx = p.children.indexOf(n);
    if (!htmlToText(n.text).trim() && !n.children.length && !n.note) p.children.splice(idx, 1, ...nodes);
    else p.children.splice(idx + 1, 0, ...nodes);
    if (this.matchSet || this.hideDone) nodes.forEach((x) => this.forceShow.add(x.id));
    this.sel = null;
    this.afterStruct({ id: nodes[nodes.length - 1].id, offset: "end" });
  },

  copyNodes(ids) {
    const nodes = this._nodes(ids);
    const text = nodesToMarkdown(nodes);
    this.plugin.clip = { text, nodes: JSON.parse(JSON.stringify(nodes)) };
    return text;
  },

  /* ---------- 拖拽移动 ---------- */
  moveNodesTo(ids, targetId, pos) {
    const nodes = this._nodes(ids);
    const target = this.tree.node(targetId);
    if (!nodes.length || !target) return false;
    if (nodes.some((n) => n.id === targetId || this.tree.isAncestor(n.id, targetId))) return false;
    this._detach(nodes);
    if (pos === "child") {
      target.children.unshift(...nodes);
      target.collapsed = false;
    } else {
      const p = this.tree.parent(targetId);
      const i = p.children.indexOf(target);
      p.children.splice(pos === "before" ? i : i + 1, 0, ...nodes);
    }
    return true;
  },
});

// ---- 33-ui.js ----
/* ---------- 文档管理、菜单、帮助 ---------- */
/** 固定按键（不可自定义）；可自定义的命令见 KEY_COMMANDS，帮助里显示当前设置 */
const FIXED_HELP_ROWS = [
  ["Enter", "新建主题（光标在中间时拆分）"],
  ["Tab / Shift + Tab", "缩进 / 反缩进"],
  ["Backspace（行首）", "与上一个主题合并；空主题直接删除"],
  ["Shift + ↑ / ↓", "多选主题（也可用鼠标跨行拖选）"],
  ["Esc", "选中当前主题 / 退出换行模式"],
  ["Ctrl + A（两次）", "选中全部主题"],
  ["Ctrl + C / X / V", "复制 / 剪切 / 粘贴主题（多行文本自动分层）"],
  ["Ctrl + B / I / U", "加粗 / 斜体 / 下划线"],
  ["Ctrl + Z / Ctrl + Shift + Z", "撤销 / 重做"],
  ["/", "插入表格、代码块、公式、Mermaid 图、图片、链接"],
  ["#标签", "点击标签筛选；在搜索框输入 # 可选择标签"],
  ["拖动圆点", "调整位置和层级"],
  ["右键圆点", "更多操作（复制主题链接等）"],
];

const WELCOME_MD = `- 欢迎使用大纲 👋 这是一份示例，可以随意修改或删除
  - 回车新建主题，Tab 缩进，Shift+Tab 反缩进
  - 点击左侧圆点进入主题，顶部面包屑返回
    - 圆点外有一圈，表示里面有折叠的内容
      - 折叠起来的内容在这里
  - Shift+Enter 进入换行模式，回车只换行，再按 Shift+Enter 退出
    这是同一个主题里的第二行
  - Alt+Enter 给主题添加描述
    > 这是一段描述，适合写补充说明
  - 输入 / 可以插入表格、代码块、公式、图片、链接

    | 快捷键 | 作用 |
    | --- | --- |
    | Tab | 在单元格间跳转 |
    | Enter | 跳到下一行 |
  - Ctrl+Enter 标记完成
  - [x] 这是一条已完成的主题
- 整理思路的常用操作
  - Ctrl+Shift+↑/↓ 上下移动主题
  - Ctrl+↑ 折叠、Ctrl+↓ 展开
  - Shift+↑/↓ 或鼠标拖选，可以一次操作多个主题
  - 选中文字会出现工具条：**加粗**、==高亮==、改颜色
- 整理大纲列表
  - 左侧可以新建文件夹，也可以在一篇大纲下面新建子大纲
  - 拖动左侧的条目，可以排序或放进另一个文件夹 / 大纲里
- 标签和链接
  - 在主题里写 #标签，点击标签就能筛选出相关主题
  - 右键圆点「复制主题链接」，贴到思源笔记里，点击即可跳回这里
- 和思源配合
  - 点右上角「同步到思源」，把大纲生成一篇思源文档
  - 在思源文档标题或列表块的菜单里，可以「转为大纲」
  - Ctrl+/ 查看全部快捷键`;

Object.assign(OutlineEditor.prototype, {
  async start(docId) {
    const list = this.store.list();
    let id = docId || this.store.index.lastOpen;
    if (!id || !this.store.meta(id)) id = list.length ? list[0].id : null;
    if (!id) {
      const doc = await this.store.createDoc("快速上手", parseOutlineText(WELCOME_MD));
      id = doc.id;
    }
    await this.openDoc(id);
  },

  async openDoc(id) {
    if (this.doc && this.doc.id === id) return;
    if (this.doc) this.plugin.flushAutoSync(this.doc);
    await this.store.flushAll();
    const doc = await this.store.getDoc(id);
    if (!doc) return;
    this.doc = doc;
    this.tree = new Tree(doc);
    this.zoomId = null;
    this.sel = null;
    this.editing = null;
    this.noteEditing = null;
    this.undoStack = [];
    this.redoStack = [];
    this.lastTyping = null;
    this.forceShow.clear();
    this.filter = "";
    this.filterInput.value = "";
    this.elCache.clear();
    this.treeEl.replaceChildren();
    this.titleEl.__val = null;
    this.store.index.lastOpen = id;
    this.store.expandTo(id);
    this._revealActive = true;
    this.store.saveIndex();
    this.render();
    this.renderDocList();
    this.updateTabTitle();
    this.updateTrashCount();
    this.updateSaveState();
    this.plugin.migrateImages(doc, this);
    this.scrollEl.scrollTop = 0;
    if (!doc.title) this.focusTitle("end");
    else {
      const v = this.visibleNodes();
      if (v.length) this.focusNode(v[0].id, "end");
    }
  },

  updateTabTitle() {
    const title = (this.doc && this.doc.title) || "无标题";
    try {
      if (this.tab && this.tab.tab && this.tab.tab.updateTitle) this.tab.tab.updateTitle(title);
    } catch (e) { /* ignore */ }
  },

  onAction(act, btn, e) {
    if (act === "expand" || act === "more") e.stopPropagation();
    switch (act) {
      case "new":
        this.createDoc(null);
        break;
      case "newfolder":
        this.createFolder(null);
        break;
      case "side": {
        const hidden = this.root.classList.toggle("side-hidden");
        if (!this.standalone) this.store.setSetting("sideHidden", hidden);
        break;
      }
      case "hidedone":
        this.hideDone = !this.hideDone;
        this.store.setSetting("hideDone", this.hideDone);
        this.forceShow.clear();
        this.render();
        siyuan.showMessage(this.hideDone ? "已隐藏完成的主题" : "已显示完成的主题", 1500);
        break;
      case "expand":
        this.expandMenu(btn);
        break;
      case "sync":
        this.plugin.syncDoc(this.doc, this);
        break;
      case "trash":
        this.showTrash();
        break;
      case "settings":
        this.plugin.openSetting();
        break;
      case "opensy":
        if (this.doc.syncDocId) this.plugin.openSiyuanDoc(this.doc.syncDocId);
        break;
      case "more":
        this.moreMenu(btn);
        break;
    }
  },

  _menuAt(menu, elOrEvent) {
    if (elOrEvent && elOrEvent.clientX != null) menu.open({ x: elOrEvent.clientX, y: elOrEvent.clientY });
    else {
      const r = elOrEvent.getBoundingClientRect();
      menu.open({ x: r.right, y: r.bottom + 4, isLeft: true });
    }
  },

  expandMenu(btn) {
    const menu = new siyuan.Menu();
    menu.addItem({ label: "全部展开", click: () => this.setCollapseDepth(Infinity) });
    menu.addItem({ label: "全部折叠", click: () => this.setCollapseDepth(0) });
    menu.addSeparator();
    [1, 2, 3].forEach((d) => menu.addItem({ label: `展开到第 ${d + 1} 级`, click: () => this.setCollapseDepth(d) }));
    this._menuAt(menu, btn);
  },

  moreMenu(btn) {
    const menu = new siyuan.Menu();
    menu.addItem({ icon: "iconOpenWindow", label: "在独立新窗口打开", click: () => this.plugin.openInNewWindow(this.doc.id) });
    menu.addItem({ icon: "iconHistory", label: "历史版本", click: () => this.showHistory() });
    menu.addItem({ icon: "iconLink", label: "复制大纲链接", click: () => this.copyDocLink(this.doc.id) });
    menu.addSeparator();
    menu.addItem({ icon: "iconCopy", label: "复制为 Markdown", click: () => this.copyText(nodesToMarkdown(this.zoomNode().children)) });
    menu.addItem({ icon: "iconCopy", label: "复制为纯文本（缩进）", click: () => this.copyText(nodesToPlainText(this.zoomNode().children)) });
    menu.addItem({ icon: "iconDownload", label: "导出 Markdown 文件", click: () => this.downloadMd() });
    menu.addSeparator();
    const auto = this.plugin.autoSyncOn();
    menu.addItem({
      icon: auto ? "iconSelect" : "iconRefresh",
      label: auto ? "自动同步到思源：已开启（点击关闭）" : "自动同步到思源：已关闭（点击开启）",
      click: () => {
        this.store.setSetting("autoSync", !auto);
        if (!auto && this.doc && this.doc.__dirty) this.plugin.scheduleAutoSync(this.doc);
        this.updateSyncState();
        siyuan.showMessage(
          !auto ? "已开启自动同步：手动同步过一次的大纲，修改后会自动同步到思源" : "已关闭自动同步",
          3000
        );
      },
    });
    menu.addSeparator();
    menu.addItem({ icon: "iconKeymap", label: "快捷键", accelerator: formatCombo(this.plugin.keymap().help), click: () => this.showHelp() });
    menu.addItem({ icon: "iconSettings", label: "设置", click: () => this.plugin.openSetting() });
    menu.addSeparator();
    menu.addItem({ icon: "iconTrashcan", label: "删除此大纲（移到回收站）", click: () => this.deleteDoc(this.doc.id) });
    this._menuAt(menu, btn);
  },

  nodeMenu(ids, e) {
    const nodes = this._nodes(ids);
    if (!nodes.length) return;
    const n = nodes[0];
    const menu = new siyuan.Menu();
    if (n.children.length) {
      menu.addItem({ label: n.collapsed ? "展开" : "折叠", accelerator: n.collapsed ? "Ctrl+↓" : "Ctrl+↑", click: () => this.toggleCollapse(n.id) });
    }
    menu.addItem({ label: "进入主题", accelerator: "Alt+→", click: () => this.zoomIn(n.id) });
    menu.addItem({ label: n.done ? "取消完成" : "完成", accelerator: "Ctrl+Enter", click: () => this.toggleDone(ids) });
    menu.addItem({ label: n.note ? "编辑描述" : "添加描述", accelerator: "Alt+Enter", click: () => this.editNote(n.id) });
    menu.addItem({
      label: "标题",
      submenu: [
        { label: "一级标题", accelerator: "Ctrl+Alt+1", click: () => this.setHeading(ids, 1) },
        { label: "二级标题", accelerator: "Ctrl+Alt+2", click: () => this.setHeading(ids, 2) },
        { label: "三级标题", accelerator: "Ctrl+Alt+3", click: () => this.setHeading(ids, 3) },
        { label: "正文", accelerator: "Ctrl+Alt+0", click: () => this.setHeading(ids, 0) },
      ],
    });
    if (n.children.length) {
      menu.addItem({
        label: "展开 / 折叠",
        submenu: [
          { label: "展开所有子主题", click: () => this._setSubtreeCollapsed(n, false) },
          { label: "折叠所有子主题", click: () => this._setSubtreeCollapsed(n, true) },
        ],
      });
    }
    menu.addSeparator();
    menu.addItem({ icon: "iconLink", label: "复制主题链接", click: () => this.copyNodeLink(n.id) });
    menu.addItem({ icon: "iconCopy", label: "复制为 Markdown", click: () => this.copyText(this.copyNodes(ids)) });
    menu.addItem({ icon: "iconTrashcan", label: "删除", click: () => this.deleteNodes(ids) });
    this._menuAt(menu, e);
  },

  _setSubtreeCollapsed(n, collapsed) {
    const walk = (x) => x.children.forEach((c) => {
      if (c.children.length) c.collapsed = collapsed;
      walk(c);
    });
    if (!collapsed) n.collapsed = false;
    walk(n);
    this.changed();
    this.render();
  },

  async copyText(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    siyuan.showMessage(msg || "已复制", msg ? 3000 : 1500);
  },

  downloadMd() {
    const md = `# ${this.doc.title || "无标题"}\n\n${nodesToMarkdown(this.doc.root.children)}\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `${(this.doc.title || "大纲").replace(/[\\/:*?"<>|]/g, "_")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  showHelp() {
    const keyFix = (s) => (IS_MAC ? s.replace(/Ctrl/g, "⌘").replace(/Alt/g, "⌥") : s);
    const km = this.plugin.keymap();
    const rows = [
      ...KEY_COMMANDS.map((c) => [formatCombo(km[c.id]), c.name]),
      ...FIXED_HELP_ROWS.map(([k, v]) => [keyFix(k), v]),
    ];
    const dialog = new siyuan.Dialog({
      title: `大纲快捷键 · v${PLUGIN_VERSION}`,
      width: "580px",
      content: `<div class="ol-help">${rows
        .map(([k, v]) => `<div class="ol-help-row"><kbd>${escapeHtml(k)}</kbd><span>${escapeHtml(v)}</span></div>`)
        .join("")}<div class="ol-help-foot"><button class="b3-button b3-button--outline">自定义快捷键</button></div></div>`,
    });
    dialog.element.querySelector(".ol-help-foot button").addEventListener("click", () => {
      dialog.destroy();
      this.plugin.openSetting("keys");
    });
  },

  async flush() {
    await this.store.flushAll();
  },

  destroy() {
    this.unbindDocEvents();
    this.store.flushAll();
  },
});

// ---- 34-rich.js ----
/* ---------- 行内换行、富内容块、/ 菜单、链接与图片 ---------- */
const SLASH_ITEMS = [
  { key: "table", name: "表格", hint: "table", kw: "table biaoge bg 表格", ico: "▦" },
  { key: "code", name: "代码块", hint: "code", kw: "code daimakuai dmk daima dm 代码块", ico: "{ }" },
  { key: "math", name: "公式", hint: "math", kw: "math gongshi gs latex 公式 数学", ico: "∑" },
  { key: "mermaid", name: "Mermaid 图", hint: "mermaid", kw: "mermaid liuchengtu lct 流程图 图表 diagram graph", ico: "◇" },
  { key: "image", name: "图片", hint: "image", kw: "image img tupian tp picture 图片", ico: "◩" },
  { key: "link", name: "链接", hint: "link", kw: "link lianjie lj url 链接", ico: "🔗" },
];
const FOCUSABLE_BLOCKS = { table: 1, code: 1, math: 1, mermaid: 1 };
const MERMAID_TEMPLATE = "graph TD\n  A[开始] --> B{判断}\n  B -->|是| C[执行]\n  B -->|否| D[结束]";

let _mermaidP = null;
let _mmSeq = 0;
function ensureMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (_mermaidP) return _mermaidP;
  _mermaidP = new Promise((resolve) => {
    const sc = document.createElement("script");
    sc.id = "olMermaidScript";
    sc.src = "/stage/protyle/js/mermaid/mermaid.min.js";
    sc.onload = () => {
      const m = window.mermaid;
      if (m) {
        try {
          const dark = document.documentElement.getAttribute("data-theme-mode") === "dark";
          m.initialize({ startOnLoad: false, securityLevel: "loose", theme: dark ? "dark" : "default" });
        } catch (e) { /* ignore */ }
      }
      resolve(m || null);
    };
    sc.onerror = () => resolve(null);
    document.head.appendChild(sc);
  });
  return _mermaidP;
}

let _katexP = null;
function ensureKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (_katexP) return _katexP;
  _katexP = new Promise((resolve) => {
    if (!document.getElementById("olKatexStyle")) {
      const l = document.createElement("link");
      l.id = "olKatexStyle";
      l.rel = "stylesheet";
      l.href = "/stage/protyle/js/katex/katex.min.css";
      document.head.appendChild(l);
    }
    const sc = document.createElement("script");
    sc.id = "olKatexScript";
    sc.src = "/stage/protyle/js/katex/katex.min.js";
    sc.onload = () => resolve(window.katex || null);
    sc.onerror = () => resolve(null);
    document.head.appendChild(sc);
  });
  return _katexP;
}

function _caretX(el) {
  const r = caretRect(el);
  return r ? r.left : el.getBoundingClientRect().left;
}

Object.assign(OutlineEditor.prototype, {
  bindRichEvents() {
    this.slashEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const it = e.target.closest("[data-slash]");
      if (it) this.chooseSlash(it.dataset.slash);
    });
    this.popEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        this.popConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.closePop(true);
      } else e.stopPropagation();
    });
    this.popEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pop]");
      if (!b) return;
      const act = b.dataset.pop;
      if (act === "ok") this.popConfirm();
      else if (act === "cancel") this.closePop(true);
      else if (act === "unlink") this.popUnlink();
      else if (act === "pick") this.popEl.querySelector(".ol-pop-file").click();
    });
    this.popEl.addEventListener("change", (e) => {
      if (!e.target.classList.contains("ol-pop-file")) return;
      const files = [...e.target.files];
      const id = this.pop && this.pop.id;
      this.closePop(false);
      if (id && files.length) this.insertImageFiles(id, files);
    });
    this._docMouseDownPop = (e) => {
      if (this.pop && !this.popEl.contains(e.target)) this.closePop(false);
    };
    document.addEventListener("mousedown", this._docMouseDownPop, true);
  },

  /* ---------- 行内换行 ---------- */
  insertLineBreak(el) {
    const r = getSelRange(el);
    if (!r) return;
    this.pushUndo("typing", el === this.titleEl ? "t" : "c:" + el.__id);
    r.deleteContents();
    const br = document.createElement("br");
    r.insertNode(br);
    if (!this._hasContentAfter(br, el)) br.parentNode.insertBefore(document.createElement("br"), br.nextSibling);
    const nr = document.createRange();
    nr.setStartAfter(br);
    nr.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(nr);
    this.onInput({ target: el });
    const cr = caretRect(el);
    if (cr) {
      const sr = this.scrollEl.getBoundingClientRect();
      if (cr.bottom > sr.bottom - 20) this.scrollEl.scrollTop += cr.bottom - sr.bottom + 60;
    }
  },

  /* ---------- 换行模式：Shift+Enter 进入 / 退出，期间回车只换行 ---------- */
  toggleLineMode(id, el) {
    if (this.lineMode === id) {
      this.setLineMode(null);
      return;
    }
    this.insertLineBreak(el);
    this.setLineMode(id);
  },

  setLineMode(id) {
    const prev = this.lineMode;
    this.lineMode = id || null;
    for (const x of [prev, this.lineMode]) {
      if (!x) continue;
      if (x === "title") this.titleEl.classList.toggle("is-linemode", this.lineMode === "title");
      else {
        const el = this.elCache.get(x);
        if (el) el.__row.classList.toggle("is-linemode", this.lineMode === x);
      }
    }
  },

  _hasContentAfter(node, root) {
    let n = node;
    while (n && n !== root) {
      let s = n.nextSibling;
      while (s) {
        if (s.nodeType === 1 || (s.nodeType === 3 && s.length)) return true;
        s = s.nextSibling;
      }
      n = n.parentNode;
    }
    return false;
  },

  /* ---------- 块渲染 ---------- */
  renderBlocks(el, n) {
    const has = n.blocks && n.blocks.length;
    const key = has ? JSON.stringify(n.blocks) : "";
    if (el.__blkKey === key) return;
    el.__blkKey = key;
    if (!has) {
      if (el.__blocksEl) {
        el.__blocksEl.remove();
        el.__blocksEl = null;
      }
      return;
    }
    if (!el.__blocksEl) {
      const d = document.createElement("div");
      d.className = "ol-blocks";
      el.__body.insertBefore(d, el.__content.nextSibling);
      el.__blocksEl = d;
    }
    el.__blocksEl.replaceChildren(...n.blocks.map((b, i) => this.createBlockEl(n.id, b, i)));
  },

  createBlockEl(id, b, bi) {
    const w = document.createElement("div");
    w.className = "ol-blk ol-blk-" + b.type;
    w.__blkRef = { id, bi };
    const tools = document.createElement("div");
    tools.className = "ol-blk-tools";
    const btn = (act, label, title) => `<button data-bact="${act}" title="${title || label}">${label}</button>`;
    const editable = (tag, cls, kind, extra) => {
      const e = document.createElement(tag);
      e.className = cls;
      e.contentEditable = "plaintext-only";
      e.spellcheck = false;
      e.__blk = Object.assign({ id, bi, kind }, extra || {});
      return e;
    };
    if (b.type === "table") {
      tools.innerHTML =
        btn("row-add", "+ 行", "在当前行下方插入一行") +
        btn("col-add", "+ 列", "在当前列右侧插入一列") +
        btn("row-del", "− 行", "删除当前行") +
        btn("col-del", "− 列", "删除当前列") +
        btn("del", "删除", "删除表格");
      const wrap = document.createElement("div");
      wrap.className = "ol-table-wrap";
      const table = document.createElement("table");
      table.className = "ol-table";
      (b.rows || [[""]]).forEach((row, r) => {
        const tr = document.createElement("tr");
        row.forEach((cell, c) => {
          const td = editable(r === 0 ? "th" : "td", "ol-cell", "cell", { r, c });
          td.textContent = cell;
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
      wrap.appendChild(table);
      w.append(wrap, tools);
    } else if (b.type === "code") {
      tools.innerHTML = btn("del", "删除", "删除代码块");
      const head = document.createElement("div");
      head.className = "ol-code-head";
      head.innerHTML = `<input class="ol-code-lang" placeholder="语言" spellcheck="false" value="${escapeHtml(b.lang || "")}">`;
      const pre = editable("pre", "ol-code-edit", "code");
      pre.textContent = b.code || "";
      w.append(head, pre, tools);
    } else if (b.type === "math") {
      tools.innerHTML = btn("del", "删除", "删除公式");
      const view = document.createElement("div");
      view.className = "ol-math-view";
      const ed = editable("div", "ol-math-edit", "math");
      ed.textContent = b.tex || "";
      ed.dataset.ph = "输入 LaTeX，例如 E = mc^2";
      w.append(view, ed, tools);
      this.renderMath(view, b.tex || "");
    } else if (b.type === "mermaid") {
      tools.innerHTML = btn("del", "删除", "删除图表");
      const view = document.createElement("div");
      view.className = "ol-mm-view";
      const ed = editable("pre", "ol-mm-edit", "mermaid");
      ed.textContent = b.code || "";
      w.append(view, ed, tools);
      this.renderMermaid(view, b.code || "");
    } else if (b.type === "image") {
      tools.innerHTML = btn("del", "删除", "删除图片");
      const img = document.createElement("img");
      this.plugin.imageURL(b.src).then((u) => {
        if (u) img.src = u;
        else w.classList.add("is-broken");
      });
      img.alt = b.alt || "";
      img.draggable = false;
      img.onerror = () => w.classList.add("is-broken");
      w.append(img, tools);
    }
    return w;
  },

  renderMath(view, tex) {
    view.__tex = tex;
    if (!tex || !tex.trim()) {
      view.innerHTML = '<span class="ol-math-ph">点击输入公式</span>';
      view.classList.remove("is-raw");
      return;
    }
    const k = window.katex;
    if (k) {
      try {
        k.render(tex, view, { displayMode: true, throwOnError: false });
        view.classList.remove("is-raw");
        return;
      } catch (e) { /* 回退为原文 */ }
    }
    view.textContent = tex;
    view.classList.add("is-raw");
    if (!k) ensureKatex().then((kk) => {
      if (kk && view.isConnected) this.renderMath(view, view.__tex);
    });
  },

  async renderMermaid(view, code) {
    view.__code = code;
    if (!code.trim()) {
      view.innerHTML = '<span class="ol-math-ph">点击编辑 Mermaid 图</span>';
      view.classList.remove("is-raw", "is-error");
      return;
    }
    if (!window.mermaid && !view.innerHTML) view.innerHTML = '<span class="ol-math-ph">图表加载中…</span>';
    const m = await ensureMermaid();
    if (view.__code !== code) return;
    if (!m) {
      view.textContent = code;
      view.classList.add("is-raw");
      return;
    }
    const id = "olmm" + ++_mmSeq;
    try {
      let r = m.render(id, code);
      if (r && typeof r.then === "function") r = await r;
      const svg = typeof r === "string" ? r : r && r.svg;
      if (view.__code !== code) return;
      view.innerHTML = svg || "";
      view.classList.remove("is-raw", "is-error");
    } catch (e) {
      const junk = document.getElementById("d" + id);
      if (junk) junk.remove();
      if (view.__code !== code) return;
      view.innerHTML = `<div class="ol-mm-err">图表语法有误：${escapeHtml(String((e && e.message) || e).split("\n")[0])}</div>`;
      view.classList.add("is-error");
    }
  },

  focusableBlocks(n) {
    const out = [];
    (n && n.blocks ? n.blocks : []).forEach((b, i) => {
      if (FOCUSABLE_BLOCKS[b.type]) out.push(i);
    });
    return out;
  },

  _blockEl(id, bi) {
    const el = this.elCache.get(id);
    if (!el || !el.isConnected || !el.__blocksEl) return null;
    return el.__blocksEl.children[bi] || null;
  },

  focusBlock(id, bi, where, x) {
    const blk = this._blockEl(id, bi);
    if (!blk) return false;
    let target;
    if (blk.classList.contains("ol-blk-table")) {
      const rows = blk.querySelectorAll("tr");
      const tr = where === "end" ? rows[rows.length - 1] : rows[0];
      const cells = [...tr.children];
      target = cells[0];
      if (x != null) for (const c of cells) {
        const r = c.getBoundingClientRect();
        if (x >= r.left && x < r.right) {
          target = c;
          break;
        }
      }
      target.focus({ preventScroll: true });
      setCaret(target, "end");
    } else {
      if (blk.classList.contains("ol-blk-math") || blk.classList.contains("ol-blk-mermaid")) blk.classList.add("is-editing");
      target = blk.querySelector(".ol-code-edit, .ol-math-edit, .ol-mm-edit");
      if (!target) return false;
      target.focus({ preventScroll: true });
      if (x != null) placeCaretAtX(target, x, where === "end" ? "last" : "first");
      else setCaret(target, where === "end" ? "end" : 0);
    }
    this.scrollIntoView(target);
    this.editing = id;
    return true;
  },

  focusCell(id, bi, r, c, offset) {
    const blk = this._blockEl(id, bi);
    if (!blk) return false;
    const rows = blk.querySelectorAll("tr");
    const tr = rows[Math.max(0, Math.min(r, rows.length - 1))];
    if (!tr) return false;
    const cell = tr.children[Math.max(0, Math.min(c, tr.children.length - 1))];
    cell.focus({ preventScroll: true });
    setCaret(cell, offset == null ? "end" : offset);
    this.scrollIntoView(cell);
    return true;
  },

  focusBlockAt(f) {
    if (f.kind === "cell") return this.focusCell(f.id, f.blk, f.r, f.c, f.offset);
    const blk = this._blockEl(f.id, f.blk);
    if (!blk) return false;
    if (f.kind === "math" || f.kind === "mermaid") blk.classList.add("is-editing");
    const t = blk.querySelector(f.kind === "math" ? ".ol-math-edit" : f.kind === "mermaid" ? ".ol-mm-edit" : ".ol-code-edit");
    if (!t) return false;
    t.focus({ preventScroll: true });
    setCaret(t, f.offset == null ? "end" : f.offset);
    this.scrollIntoView(t);
    return true;
  },

  /* ---------- 块内编辑 ---------- */
  updateBlockFromEl(t) {
    const { id, bi, kind, r, c } = t.__blk;
    const n = this.tree.node(id);
    if (!n || !n.blocks || !n.blocks[bi]) return;
    const b = n.blocks[bi];
    let v = t.innerText;
    if (v.endsWith("\n")) v = v.slice(0, -1);
    if (kind === "cell") b.rows[r][c] = v;
    else if (kind === "code") b.code = v;
    else if (kind === "math") {
      b.tex = v;
      const view = t.parentElement.querySelector(".ol-math-view");
      if (view) this.renderMath(view, v);
    } else if (kind === "mermaid") {
      b.code = v;
      const view = t.parentElement.querySelector(".ol-mm-view");
      if (view) {
        clearTimeout(view.__t);
        view.__t = setTimeout(() => this.renderMermaid(view, v), 400);
      }
    }
    const el = this.elCache.get(id);
    if (el) el.__blkKey = JSON.stringify(n.blocks);
    this.changed();
  },

  updateCodeLang(input) {
    const blk = input.closest(".ol-blk");
    const { id, bi } = blk.__blkRef;
    const n = this.tree.node(id);
    if (!n || !n.blocks || !n.blocks[bi]) return;
    n.blocks[bi].lang = input.value.trim();
    const el = this.elCache.get(id);
    if (el) el.__blkKey = JSON.stringify(n.blocks);
    this.changed();
  },

  keyCodeLang(e, t) {
    const blk = t.closest(".ol-blk");
    if (e.key === "Enter" || e.key === "ArrowDown") {
      const ed = blk.querySelector(".ol-code-edit");
      ed.focus();
      setCaret(ed, 0);
      return true;
    }
    if (e.key === "Escape") {
      this.focusNode(blk.__blkRef.id, "end");
      return true;
    }
    return this.keyCommon(e, [blk.__blkRef.id]);
  },

  keyBlock(e, t) {
    const b = t.__blk;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const plain = !mod && !e.altKey && !e.shiftKey;
    if (this.keyCommon(e, [b.id])) return true;
    if (k === "Escape") {
      this.focusNode(b.id, "end");
      return true;
    }
    if (b.kind === "cell") {
      const tb = this.tree.node(b.id).blocks[b.bi];
      const R = tb.rows.length;
      const C = tb.rows[0].length;
      if (k === "Tab" && !mod && !e.altKey) {
        const idx = b.r * C + b.c + (e.shiftKey ? -1 : 1);
        if (idx < 0) return true;
        if (idx >= R * C) this.tableOp(b.id, b.bi, "row-add", { r: R - 1, c: 0 }, { r: R, c: 0 });
        else this.focusCell(b.id, b.bi, Math.floor(idx / C), idx % C, "end");
        return true;
      }
      if (k === "Enter" && plain) {
        if (b.r < R - 1) this.focusCell(b.id, b.bi, b.r + 1, b.c, "end");
        else this.tableOp(b.id, b.bi, "row-add", { r: b.r, c: b.c });
        return true;
      }
      if (k === "Enter" && mod) {
        this.exitBlock(b, 1);
        return true;
      }
      if (k === "ArrowUp" && plain && caretOnFirstLine(t)) {
        if (b.r > 0) this.focusCell(b.id, b.bi, b.r - 1, b.c, "end");
        else this.exitBlock(b, -1, _caretX(t));
        return true;
      }
      if (k === "ArrowDown" && plain && caretOnLastLine(t)) {
        if (b.r < R - 1) this.focusCell(b.id, b.bi, b.r + 1, b.c, "end");
        else this.exitBlock(b, 1, _caretX(t));
        return true;
      }
      const r = getSelRange(t);
      if (k === "ArrowLeft" && plain && r && r.collapsed && caretOffset(t) === 0) {
        const idx = b.r * C + b.c - 1;
        if (idx >= 0) {
          this.focusCell(b.id, b.bi, Math.floor(idx / C), idx % C, "end");
          return true;
        }
      }
      if (k === "ArrowRight" && plain && r && r.collapsed && caretOffset(t) === contentLen(t)) {
        const idx = b.r * C + b.c + 1;
        if (idx < R * C) {
          this.focusCell(b.id, b.bi, Math.floor(idx / C), idx % C, 0);
          return true;
        }
      }
      return false;
    }
    // 代码块 / 公式
    if (k === "Tab") {
      if (!e.shiftKey) document.execCommand("insertText", false, "  ");
      return true;
    }
    if (k === "Enter" && mod) {
      this.exitBlock(b, 1);
      return true;
    }
    if (k === "Backspace" && !t.textContent) {
      this.removeBlock(b.id, b.bi);
      return true;
    }
    if (k === "ArrowUp" && plain && caretOnFirstLine(t)) {
      this.exitBlock(b, -1, _caretX(t));
      return true;
    }
    if (k === "ArrowDown" && plain && caretOnLastLine(t)) {
      this.exitBlock(b, 1, _caretX(t));
      return true;
    }
    return false;
  },

  exitBlock(b, dir, x) {
    const n = this.tree.node(b.id);
    const fb = this.focusableBlocks(n);
    const nb = fb[fb.indexOf(b.bi) + dir];
    if (nb != null && this.focusBlock(b.id, nb, dir < 0 ? "end" : "start", x)) return;
    if (dir < 0) this.focusNode(b.id, x != null ? { x, which: "last" } : "end");
    else this.moveFocus(b.id, 1, x == null ? 0 : x);
  },

  /* ---------- 块操作 ---------- */
  addBlock(id, block) {
    const n = this.tree.node(id);
    if (!n) return;
    this.pushUndo("struct");
    n.blocks = (n.blocks || []).concat([block]);
    const bi = n.blocks.length - 1;
    let f = { id, offset: "end" };
    if (block.type === "table") f = { id, blk: bi, kind: "cell", r: 0, c: 0, offset: 0 };
    else if (block.type === "code") f = { id, blk: bi, kind: "code", offset: 0 };
    else if (block.type === "math") f = { id, blk: bi, kind: "math", offset: 0 };
    else if (block.type === "mermaid") f = { id, blk: bi, kind: "mermaid", offset: "end" };
    this.afterStruct(f);
  },

  removeBlock(id, bi) {
    const n = this.tree.node(id);
    if (!n || !n.blocks) return;
    this.pushUndo("struct");
    n.blocks.splice(bi, 1);
    if (!n.blocks.length) delete n.blocks;
    this.afterStruct({ id, offset: "end" });
  },

  blockAction(act, blkEl) {
    const { id, bi } = blkEl.__blkRef;
    if (act === "del") return this.removeBlock(id, bi);
    const n = this.tree.node(id);
    const tb = n && n.blocks && n.blocks[bi];
    if (!tb || tb.type !== "table") return;
    const lc = this.lastCell;
    const at = lc && lc.id === id && lc.bi === bi ? { r: lc.r, c: lc.c } : { r: tb.rows.length - 1, c: tb.rows[0].length - 1 };
    this.tableOp(id, bi, act, at);
  },

  tableOp(id, bi, act, at, focusAt) {
    const n = this.tree.node(id);
    const tb = n.blocks[bi];
    const R = tb.rows.length;
    const C = tb.rows[0].length;
    if ((act === "row-del" && R <= 1) || (act === "col-del" && C <= 1)) return this.removeBlock(id, bi);
    this.pushUndo("struct");
    let f = { r: at.r, c: at.c };
    if (act === "row-add") {
      tb.rows.splice(at.r + 1, 0, Array(C).fill(""));
      f = { r: at.r + 1, c: at.c };
    } else if (act === "col-add") {
      tb.rows.forEach((row) => row.splice(at.c + 1, 0, ""));
      f = { r: at.r, c: at.c + 1 };
    } else if (act === "row-del") {
      tb.rows.splice(at.r, 1);
      f = { r: Math.min(at.r, R - 2), c: at.c };
    } else if (act === "col-del") {
      tb.rows.forEach((row) => row.splice(at.c, 1));
      f = { r: at.r, c: Math.min(at.c, C - 2) };
    }
    if (focusAt) f = focusAt;
    this.lastCell = { id, bi, r: f.r, c: f.c };
    this.afterStruct({ id, blk: bi, kind: "cell", r: f.r, c: f.c, offset: "end" });
  },

  /* ---------- / 菜单 ---------- */
  slashOnInput(e, t) {
    if (this.slash) {
      this.updateSlash();
      return;
    }
    if (e && (e.data === "/" || e.data === "、")) {
      const off = caretOffset(t);
      this.slash = { el: t, id: t.__id, start: off - 1, idx: 0, items: SLASH_ITEMS };
      this.updateSlash();
    }
  },

  updateSlash() {
    const s = this.slash;
    if (!s) return;
    const el = s.el;
    if (!el.isConnected || document.activeElement !== el) return this.closeSlash();
    const off = caretOffset(el);
    if (off <= s.start) return this.closeSlash();
    const trigger = rangeFromOffsets(el, s.start, s.start + 1).toString();
    if (trigger !== "/" && trigger !== "、") return this.closeSlash();
    const q = rangeFromOffsets(el, s.start + 1, off).toString();
    if (/\s/.test(q) || q.length > 12) return this.closeSlash();
    const ql = q.toLowerCase();
    s.items = SLASH_ITEMS.filter((it) => !ql || it.kw.includes(ql) || it.name.includes(q));
    if (!s.items.length) {
      this.slashEl.style.display = "none";
      return;
    }
    s.idx = Math.min(s.idx, s.items.length - 1);
    this.slashEl.innerHTML = s.items
      .map(
        (it, i) => `<div class="ol-slash-item${i === s.idx ? " is-active" : ""}" data-slash="${it.key}">
  <span class="ol-slash-ico">${it.ico}</span><span class="ol-slash-name">${it.name}</span><span class="ol-slash-hint">${it.hint}</span>
</div>`
      )
      .join("");
    const st = this.slashEl.style;
    st.display = "block";
    const rect = caretRect(el) || el.getBoundingClientRect();
    const h = this.slashEl.offsetHeight;
    const w = this.slashEl.offsetWidth;
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = rect.top - h - 6;
    st.top = top + "px";
    st.left = Math.min(rect.left, window.innerWidth - w - 8) + "px";
  },

  keySlash(e) {
    const s = this.slash;
    if (!s || this.slashEl.style.display === "none") return false;
    const n = s.items.length;
    switch (e.key) {
      case "ArrowDown":
        s.idx = (s.idx + 1) % n;
        this.updateSlash();
        return true;
      case "ArrowUp":
        s.idx = (s.idx - 1 + n) % n;
        this.updateSlash();
        return true;
      case "Enter":
      case "Tab":
        this.chooseSlash(s.items[s.idx].key);
        return true;
      case "Escape":
        this.closeSlash();
        return true;
    }
    return false;
  },

  closeSlash() {
    this.slash = null;
    this.slashEl.style.display = "none";
  },

  chooseSlash(key) {
    const s = this.slash;
    if (!s) return;
    this.closeSlash();
    const el = s.el;
    const off = Math.max(caretOffset(el), s.start + 1);
    rangeFromOffsets(el, s.start, off).deleteContents();
    setCaret(el, s.start);
    const n = this.tree.node(s.id);
    if (!n) return;
    n.text = domToText(el);
    el.__val = n.text;
    this.changed();
    if (key === "table") this.addBlock(s.id, { type: "table", rows: [["", "", ""], ["", "", ""], ["", "", ""]] });
    else if (key === "code") this.addBlock(s.id, { type: "code", lang: "", code: "" });
    else if (key === "math") this.addBlock(s.id, { type: "math", tex: "" });
    else if (key === "mermaid") this.addBlock(s.id, { type: "mermaid", code: MERMAID_TEMPLATE });
    else if (key === "image") this.openImagePop(el);
    else if (key === "link") this.openLinkPop(el);
  },

  /* ---------- 链接 / 图片弹层 ---------- */
  _showPop(rect) {
    const st = this.popEl.style;
    st.display = "grid";
    const h = this.popEl.offsetHeight;
    const w = this.popEl.offsetWidth;
    let top = rect.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8);
    st.top = top + "px";
    st.left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)) + "px";
  },

  openLinkPop(el) {
    const len = contentLen(el);
    let o = selectionOffsets(el) || { start: len, end: len };
    const r = getSelRange(el);
    let a = null;
    if (r) {
      const c = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
      a = c && c.closest("a");
      if (a && !el.contains(a)) a = null;
    }
    if (a) {
      const ar = document.createRange();
      ar.selectNodeContents(a);
      o = { start: _offsetOf(el, ar.startContainer, ar.startOffset), end: _offsetOf(el, ar.endContainer, ar.endOffset) };
    }
    const selText = a ? a.textContent : o.end > o.start ? rangeFromOffsets(el, o.start, o.end).toString() : "";
    const rect = (r && caretRect(el)) || el.getBoundingClientRect();
    this.pop = { kind: "link", el, id: el.__id, start: o.start, end: o.end, hasLink: !!a };
    this.popEl.innerHTML = `<div class="ol-pop-title">${a ? "编辑链接" : "插入链接"}</div>
<input class="ol-pop-text" placeholder="链接文字（可留空）" value="${escapeHtml(selText)}">
<input class="ol-pop-url" placeholder="https://" value="${escapeHtml(a ? a.getAttribute("href") : "")}">
<div class="ol-pop-actions">${a ? '<button data-pop="unlink" class="is-plain">移除链接</button>' : ""}<span class="ol-spacer"></span><button data-pop="cancel" class="is-plain">取消</button><button data-pop="ok">确定</button></div>`;
    this._showPop(rect);
    this.popEl.querySelector(selText ? ".ol-pop-url" : ".ol-pop-text").focus();
  },

  openImagePop(el) {
    const rect = caretRect(el) || el.getBoundingClientRect();
    this.pop = { kind: "image", el, id: el.__id, start: caretOffset(el), end: caretOffset(el) };
    this.popEl.innerHTML = `<div class="ol-pop-title">插入图片</div>
<button data-pop="pick" class="ol-pop-pick">选择本地图片…</button>
<div class="ol-pop-or">或者输入图片链接</div>
<input class="ol-pop-url" placeholder="https://…">
<div class="ol-pop-actions"><span class="ol-spacer"></span><button data-pop="cancel" class="is-plain">取消</button><button data-pop="ok">插入</button></div>
<input type="file" accept="image/*" multiple class="ol-pop-file" hidden>`;
    this._showPop(rect);
    this.popEl.querySelector(".ol-pop-url").focus();
  },

  popConfirm() {
    const p = this.pop;
    if (!p) return;
    const urlRaw = (this.popEl.querySelector(".ol-pop-url").value || "").trim();
    if (p.kind === "image") {
      if (!urlRaw) return;
      this.closePop(false);
      if (p.id) this.addBlock(p.id, { type: "image", src: urlRaw });
      return;
    }
    if (!urlRaw) return this.closePop(true);
    let url = urlRaw;
    if (!/^(https?:|mailto:|siyuan:|file:|assets\/)/i.test(url)) url = "https://" + url;
    const text = this.popEl.querySelector(".ol-pop-text").value || urlRaw;
    this.closePop(false);
    this._selectSaved(p);
    this.pushUndo("struct");
    document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`);
  },

  popUnlink() {
    const p = this.pop;
    this.closePop(false);
    this._selectSaved(p);
    this.pushUndo("struct");
    document.execCommand("unlink");
    setCaret(p.el, p.end);
  },

  _selectSaved(p) {
    p.el.focus({ preventScroll: true });
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(rangeFromOffsets(p.el, p.start, p.end));
  },

  closePop(refocus) {
    const p = this.pop;
    this.pop = null;
    this.popEl.style.display = "none";
    this.popEl.innerHTML = "";
    if (refocus && p && p.el.isConnected) {
      p.el.focus({ preventScroll: true });
      setCaret(p.el, p.end);
    }
  },

  async insertImageFiles(id, files) {
    siyuan.showMessage("正在上传图片…", 1500);
    const srcs = [];
    for (const f of files) {
      try {
        srcs.push(await this.plugin.uploadImage(f));
      } catch (e) {
        siyuan.showMessage("图片上传失败：" + escapeHtml(e.message || String(e)), 4000, "error");
      }
    }
    const n = this.tree && this.tree.node(id);
    if (!srcs.length || !n) return;
    this.pushUndo("struct");
    n.blocks = (n.blocks || []).concat(srcs.map((src) => ({ type: "image", src })));
    this.afterStruct({ id, offset: "end" });
  },
});

// ---- 35-sidebar.js ----
/* ---------- 左侧大纲列表：文件夹 + 子大纲，可拖拽 ---------- */
const SIDE_ICONS = {
  folder: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  folderPlus: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M7 3.5h6.5l4.5 4.5v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M9 12h6M9 15.5h4"/></svg>',
};

function _itemTitle(it) {
  return it.title || (it.type === "folder" ? "新建文件夹" : "无标题");
}

Object.assign(OutlineEditor.prototype, {
  bindSideEvents() {
    const L = this.docListEl;
    L.addEventListener("click", (e) => {
      if (e.target.closest(".ol-drename")) return;
      const hit = e.target.closest(".ol-hit");
      if (hit) return this.openHit(hit.dataset.doc, hit.dataset.node, hit.dataset.q);
      const row = e.target.closest(".ol-ditem");
      if (!row) return;
      const id = row.dataset.id;
      const it = this.store.item(id);
      if (!it) return;
      const act = (e.target.closest("[data-dact]") || {}).dataset;
      const a = act && act.dact;
      if (a === "toggle") return this.toggleSideItem(id);
      if (a === "add") return this.createDoc(id);
      if (a === "more") {
        e.stopPropagation(); // 不让思源的全局点击把刚弹出的菜单关掉
        return this.itemMenu(id, e.target.closest("[data-dact]"));
      }
      if (it.type === "folder") this.toggleSideItem(id);
      else this.openDoc(id);
    });
    L.addEventListener("dblclick", (e) => {
      const row = e.target.closest(".ol-ditem");
      if (row && e.target.closest(".ol-dtitle")) this.startRename(row.dataset.id);
    });
    L.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".ol-ditem");
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      this.itemMenu(row.dataset.id, e);
    });
    L.addEventListener("dragstart", (e) => {
      const row = e.target.closest(".ol-ditem");
      if (!row) return;
      this.sideDrag = row.dataset.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", _itemTitle(this.store.item(this.sideDrag)));
      row.classList.add("is-dragging");
    });
    L.addEventListener("dragover", (e) => {
      if (!this.sideDrag) return;
      e.preventDefault();
      const tg = this._sideDropTarget(e);
      this._clearSideDrop();
      this._sideDrop = tg;
      if (!tg) {
        e.dataTransfer.dropEffect = "none";
        return;
      }
      e.dataTransfer.dropEffect = "move";
      if (tg.row) tg.row.classList.add("is-drop-" + tg.pos);
      else L.classList.add("is-drop-end");
    });
    L.addEventListener("dragleave", (e) => {
      if (!L.contains(e.relatedTarget)) this._clearSideDrop();
    });
    L.addEventListener("drop", (e) => {
      if (!this.sideDrag) return;
      e.preventDefault();
      const tg = this._sideDrop;
      const id = this.sideDrag;
      this._endSideDrag();
      if (!tg) return;
      if (this.store.moveItem(id, tg.id, tg.pos)) {
        this.renderDocList();
        this.renderCrumbs();
      }
    });
    L.addEventListener("dragend", () => this._endSideDrag());
  },

  _sideDropTarget(e) {
    const row = e.target.closest(".ol-ditem");
    const drag = this.sideDrag;
    if (!row) return { id: null, pos: "end", row: null };
    const id = row.dataset.id;
    if (id === drag || this.store.isDescendant(id, drag)) return null;
    const r = row.getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    const pos = f < 0.28 ? "before" : f > 0.72 ? "after" : "inside";
    return { id, pos, row };
  },

  _clearSideDrop() {
    this.docListEl.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-inside").forEach((r) => r.classList.remove("is-drop-before", "is-drop-after", "is-drop-inside"));
    this.docListEl.classList.remove("is-drop-end");
  },

  _endSideDrag() {
    this.sideDrag = null;
    this._sideDrop = null;
    this._clearSideDrop();
    this.docListEl.querySelectorAll(".is-dragging").forEach((r) => r.classList.remove("is-dragging"));
  },

  renderDocList() {
    const q = this.sideSearch.value.trim().toLowerCase();
    const cur = this.doc && this.doc.id;
    let show = null;
    if (q) {
      show = new Set();
      for (const d of this.store.index.docs) {
        if (_itemTitle(d).toLowerCase().includes(q)) {
          show.add(d.id);
          this.store.pathOf(d.id).forEach((a) => show.add(a.id));
        }
      }
    }
    const hl = (t) => {
      const s = escapeHtml(t);
      if (!q) return s;
      const i = t.toLowerCase().indexOf(q);
      if (i < 0) return s;
      return escapeHtml(t.slice(0, i)) + "<mark>" + escapeHtml(t.slice(i, i + q.length)) + "</mark>" + escapeHtml(t.slice(i + q.length));
    };
    const rows = [];
    const walk = (pid, depth) => {
      for (const it of this.store.childrenOf(pid)) {
        if (show && !show.has(it.id)) continue;
        const kids = this.store.childrenOf(it.id);
        const open = show ? true : !!it.expanded;
        const folder = it.type === "folder";
        const title = _itemTitle(it);
        rows.push(`<div class="ol-ditem${it.id === cur ? " is-active" : ""}${folder ? " is-folder" : ""}" data-id="${it.id}" draggable="true" style="padding-left:${4 + depth * 16}px" title="${escapeHtml(title)}${folder ? "" : " · " + fmtTime(it.updated)}">
  <span class="ol-dtoggle${kids.length ? "" : " is-empty"}${open ? " is-open" : ""}" data-dact="toggle">${ICONS.fold}</span>
  <span class="ol-dicon">${folder ? SIDE_ICONS.folder : SIDE_ICONS.doc}</span>
  <span class="ol-dtitle">${hl(title)}</span>
  <span class="ol-dacts"><button data-dact="add" title="${folder ? "在此文件夹中新建大纲" : "新建子大纲"}">${ICONS.plus}</button><button data-dact="more" data-menu="true" title="更多">${ICONS.more}</button></span>
</div>`);
        if (kids.length && open) walk(it.id, depth + 1);
      }
    };
    walk(null, 0);
    let html = rows.length ? rows.join("") : `<div class="ol-doclist-empty">${q ? "标题中没有找到" : "还没有大纲"}</div>`;
    if (q) {
      html += `<div class="ol-hits">${this.contentHitsHtml(q)}</div>`;
      if (!this._hits || this._hits.q !== q || this._hitsStale) {
        this._hitsStale = false;
        this.scheduleContentSearch(q);
      }
    } else this._hits = null;
    this.docListEl.innerHTML = html;
    const act = this.docListEl.querySelector(".ol-ditem.is-active");
    if (act && this._revealActive) {
      this._revealActive = false;
      act.scrollIntoView({ block: "nearest" });
    }
  },

  toggleSideItem(id) {
    const it = this.store.item(id);
    if (!it || !this.store.childrenOf(id).length) return;
    this.store.setExpanded(id, !it.expanded);
    this.renderDocList();
  },

  showSide() {
    if (this.root.classList.contains("side-hidden")) {
      this.root.classList.remove("side-hidden");
      if (!this.standalone) this.store.setSetting("sideHidden", false);
    }
  },

  async createDoc(parentId) {
    const doc = await this.store.createDoc("", null, parentId || null);
    this.showSide();
    await this.openDoc(doc.id);
    this.focusTitle("end");
  },

  async createFolder(parentId) {
    const id = await this.store.createFolder("新建文件夹", parentId || null);
    this.showSide();
    this.renderDocList();
    this.startRename(id);
  },

  startRename(id) {
    const row = this.docListEl.querySelector(`.ol-ditem[data-id="${id}"]`);
    const it = this.store.item(id);
    if (!row || !it) return;
    const t = row.querySelector(".ol-dtitle");
    const input = document.createElement("input");
    input.className = "ol-drename";
    input.value = it.title || "";
    input.placeholder = it.type === "folder" ? "文件夹名称" : "大纲标题";
    input.spellcheck = false;
    t.replaceWith(input);
    row.draggable = false;
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v !== (it.title || "")) {
        await this.store.renameItem(id, v);
        if (this.doc && this.doc.id === id) {
          this.titleEl.__val = null;
          this.render();
          this.updateTabTitle();
        }
      }
      this.renderDocList();
      this.renderCrumbs();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  },

  itemMenu(id, anchor) {
    const it = this.store.item(id);
    if (!it) return;
    const folder = it.type === "folder";
    const menu = new siyuan.Menu();
    if (!folder) {
      menu.addItem({ icon: "iconOpenWindow", label: "在独立新窗口打开", click: () => this.plugin.openInNewWindow(id) });
      menu.addItem({ icon: "iconLink", label: "复制大纲链接", click: () => this.copyDocLink(id) });
      menu.addSeparator();
    }
    menu.addItem({ icon: "iconAdd", label: folder ? "新建大纲" : "新建子大纲", click: () => this.createDoc(id) });
    menu.addItem({ icon: "iconFolder", label: "新建子文件夹", click: () => this.createFolder(id) });
    menu.addSeparator();
    menu.addItem({ icon: "iconEdit", label: "重命名", click: () => this.startRename(id) });
    menu.addItem({ icon: "iconMove", label: "移动到…", click: () => this.moveDialog(id) });
    if (!folder) {
      menu.addItem({
        icon: "iconRefresh",
        label: "同步到思源",
        click: async () => {
          const d = await this.store.getDoc(id);
          if (d) this.plugin.syncDoc(d, this.doc && this.doc.id === id ? this : null);
        },
      });
    }
    menu.addSeparator();
    menu.addItem({ icon: "iconTrashcan", label: "删除（移到回收站）", click: () => this.deleteDoc(id) });
    this._menuAt(menu, anchor);
  },

  moveDialog(id) {
    const it = this.store.item(id);
    if (!it) return;
    const banned = new Set([id, ...this.store.descendantsOf(id).map((d) => d.id)]);
    const rows = [`<div class="ol-mv-item" data-target=""><span class="ol-dicon">${SIDE_ICONS.folder}</span>根目录</div>`];
    const walk = (pid, depth) => {
      for (const c of this.store.childrenOf(pid)) {
        if (banned.has(c.id)) continue;
        rows.push(`<div class="ol-mv-item" data-target="${c.id}" style="padding-left:${12 + (depth + 1) * 16}px"><span class="ol-dicon">${c.type === "folder" ? SIDE_ICONS.folder : SIDE_ICONS.doc}</span>${escapeHtml(_itemTitle(c))}</div>`);
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    const dialog = new siyuan.Dialog({
      title: `把「${escapeHtml(_itemTitle(it))}」移动到…`,
      width: "420px",
      content: `<div class="ol-mv">${rows.join("")}</div>`,
    });
    dialog.element.querySelector(".ol-mv").addEventListener("click", (e) => {
      const row = e.target.closest(".ol-mv-item");
      if (!row) return;
      const target = row.dataset.target || null;
      this.store.moveItem(id, target, target ? "inside" : "end");
      dialog.destroy();
      this.store.expandTo(id);
      this.renderDocList();
      this.renderCrumbs();
    });
  },

  async deleteDoc(id) {
    const it = this.store.item(id);
    if (!it) return;
    const desc = this.store.descendantsOf(id);
    const gone = await this.store.trashItem(id);
    siyuan.showMessage(`已把「${escapeHtml(_itemTitle(it))}」${desc.length ? `及其 ${desc.length} 个子项` : ""}移到回收站，可在左下角「回收站」恢复`, 3500);
    this.updateTrashCount();
    if (this.doc && gone.has(this.doc.id)) {
      this.doc = null;
      const list = this.store.list();
      if (list.length) await this.openDoc(list[0].id);
      else await this.createDoc(null);
    } else this.renderDocList();
  },
});

// ---- 36-features.js ----
/* ---------- 保存状态、跨窗口刷新、回收站、历史版本、链接、标签、全文搜索 ---------- */
Object.assign(OutlineEditor.prototype, {
  /* ---------- 保存状态 ---------- */
  updateSaveState() {
    const err = this.store.saveError;
    const el = this.saveStateEl;
    el.textContent = err ? "保存失败，正在重试…" : "";
    el.title = err ? `原因：${err.msg}。数据仍在内存中，恢复后会自动写入。` : "";
    el.classList.toggle("is-error", !!err);
  },

  updateTrashCount() {
    const n = this.store.trashList().length;
    this.trashCountEl.textContent = n ? String(n) : "";
  },

  /* ---------- 其他窗口 / 设备改了数据 ---------- */
  async onExternalChange(res) {
    if (res.settingsChanged) this.plugin.applyLook(this);
    this.renderDocList();
    this.updateTrashCount();
    if (!this.doc) return;
    const m = this.store.item(this.doc.id);
    if (!m || m.trashed) {
      siyuan.showMessage("当前大纲已在其他窗口被删除，已切换到其他大纲", 4000);
      this.doc = null;
      const list = this.store.list();
      if (list.length) await this.openDoc(list[0].id);
      else await this.createDoc(null);
      return;
    }
    const fresh = res.changed.find((d) => d.id === this.doc.id);
    if (fresh && fresh !== this.doc) this.adoptDoc(fresh);
    else {
      this.renderCrumbs();
      this.updateTabTitle();
    }
  },

  /** 换成磁盘上更新的版本，尽量保持光标位置 */
  adoptDoc(fresh) {
    const f = this.captureFocus();
    const zoom = this.zoomId;
    this.doc = fresh;
    this.tree = new Tree(fresh);
    this.zoomId = zoom && this.tree.node(zoom) ? zoom : null;
    this.sel = null;
    this.undoStack = [];
    this.redoStack = [];
    this.lastTyping = null;
    this.elCache.clear();
    this.treeEl.replaceChildren();
    this.titleEl.__val = null;
    this.render();
    this.updateTabTitle();
    if (f && !f.sel) this.restoreFocus(f);
  },

  /* ---------- 回收站 ---------- */
  showTrash() {
    const dialog = new siyuan.Dialog({ title: "回收站", width: "520px", content: `<div class="ol-trash"></div>` });
    const box = dialog.element.querySelector(".ol-trash");
    const draw = () => {
      const list = this.store.trashList();
      if (!list.length) {
        box.innerHTML = `<div class="ol-trash-empty">回收站是空的。删除的大纲和文件夹会在这里保留 ${TRASH_DAYS} 天。</div>`;
        return;
      }
      box.innerHTML =
        list
          .map(({ item, count }) => {
            const left = Math.max(0, Math.ceil((item.trashed + TRASH_DAYS * 864e5 - Date.now()) / 864e5));
            return `<div class="ol-trash-item" data-id="${item.id}">
  <span class="ol-dicon">${item.type === "folder" ? SIDE_ICONS.folder : SIDE_ICONS.doc}</span>
  <div class="ol-trash-main"><div class="ol-trash-title">${escapeHtml(_itemTitle(item))}</div>
  <div class="ol-trash-meta">删除于 ${fmtTime(item.trashed)}${count ? ` · 含 ${count} 个子项` : ""} · ${left} 天后自动清除</div></div>
  <button class="b3-button b3-button--outline" data-tact="restore">恢复</button>
  <button class="b3-button b3-button--cancel" data-tact="purge">彻底删除</button>
</div>`;
          })
          .join("") + `<div class="ol-trash-foot"><button class="b3-button b3-button--cancel" data-tact="empty">清空回收站</button></div>`;
    };
    draw();
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-tact]");
      if (!b) return;
      const act = b.dataset.tact;
      if (act === "empty") {
        siyuan.confirm("清空回收站", "回收站里的所有内容都会被彻底删除，无法恢复。确定吗？", async () => {
          for (const t of this.store.trashList()) await this.store.purgeItem(t.item.id);
          draw();
          this.updateTrashCount();
        });
        return;
      }
      const id = b.closest(".ol-trash-item").dataset.id;
      if (act === "restore") {
        await this.store.restoreItem(id);
        siyuan.showMessage(`已恢复「${escapeHtml(_itemTitle(this.store.item(id)))}」`, 2000);
        this.renderDocList();
      } else if (act === "purge") {
        const it = this.store.item(id);
        siyuan.confirm("彻底删除", `「${escapeHtml(_itemTitle(it))}」会被彻底删除，无法恢复。确定吗？`, async () => {
          await this.store.purgeItem(id);
          draw();
          this.updateTrashCount();
        });
        return;
      }
      draw();
      this.updateTrashCount();
    });
  },

  /* ---------- 历史版本 ---------- */
  async showHistory() {
    if (!this.doc) return;
    await this.store.flushAll();
    const doc = this.doc;
    const dialog = new siyuan.Dialog({
      title: `历史版本 · ${escapeHtml(doc.title || "无标题")}`,
      width: "820px",
      height: "70vh",
      content: `<div class="ol-hist">
  <div class="ol-hist-side">
    <button class="b3-button b3-button--outline ol-hist-snap">立即保存一个版本</button>
    <div class="ol-hist-list"><div class="ol-hist-empty">加载中…</div></div>
  </div>
  <div class="ol-hist-main">
    <div class="ol-hist-bar"><span class="ol-hist-cur">选择左侧的版本查看内容</span><button class="b3-button ol-hist-restore" disabled>恢复到这个版本</button></div>
    <pre class="ol-hist-preview"></pre>
  </div>
</div>`,
    });
    const el = dialog.element;
    const listEl = el.querySelector(".ol-hist-list");
    const pre = el.querySelector(".ol-hist-preview");
    const cur = el.querySelector(".ol-hist-cur");
    const btn = el.querySelector(".ol-hist-restore");
    let chosen = null;
    const fmtFull = (ts) => {
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const drawList = async () => {
      const list = await this.store.listHistory(doc.id);
      listEl.innerHTML = list.length
        ? list.map((ts) => `<div class="ol-hist-item" data-ts="${ts}">${fmtFull(ts)}</div>`).join("")
        : `<div class="ol-hist-empty">还没有历史版本。编辑时每隔一小时会自动保存一份，也可以点上面的按钮立即保存。</div>`;
    };
    await drawList();
    el.querySelector(".ol-hist-snap").addEventListener("click", async () => {
      await this.store.snapshotNow(doc);
      await drawList();
      siyuan.showMessage("已保存当前版本", 1500);
    });
    listEl.addEventListener("click", async (e) => {
      const it = e.target.closest(".ol-hist-item");
      if (!it) return;
      listEl.querySelectorAll(".is-active").forEach((x) => x.classList.remove("is-active"));
      it.classList.add("is-active");
      const v = await this.store.loadHistory(doc.id, +it.dataset.ts);
      if (!v || !v.root) {
        pre.textContent = "这个版本无法读取。";
        return;
      }
      chosen = v;
      cur.textContent = `${fmtFull(+it.dataset.ts)} · ${countNodes(v.root.children)} 个主题`;
      pre.textContent = nodesToMarkdown(v.root.children);
      btn.disabled = false;
    });
    btn.addEventListener("click", () => {
      if (!chosen || this.doc !== doc) return;
      this.pushUndo("struct");
      doc.root = JSON.parse(JSON.stringify(chosen.root));
      if (chosen.title) doc.title = chosen.title;
      this.tree.reindex();
      this.zoomId = null;
      this.titleEl.__val = null;
      this.afterStruct(null);
      this.renderDocList();
      dialog.destroy();
      siyuan.showMessage("已恢复到所选版本，按 Ctrl+Z 可以撤销", 3000);
    });
  },

  /* ---------- 主题链接 ---------- */
  copyNodeLink(id) {
    const n = this.tree.node(id);
    if (!n) return;
    const text = htmlToText(n.text).split("\n")[0].trim() || "主题";
    this.copyText(`[${text.replace(/[\[\]]/g, "")}](${this.plugin.nodeLink(this.doc.id, id)})`, "已复制主题链接，粘贴到思源文档里即可点击跳转");
  },

  copyDocLink(docId) {
    const it = this.store.item(docId);
    this.copyText(`[${_itemTitle(it).replace(/[\[\]]/g, "")}](${this.plugin.nodeLink(docId)})`, "已复制大纲链接，粘贴到思源文档里即可点击跳转");
  },

  /** 打开到某个主题：展开上级、必要时退出缩放和搜索，并短暂高亮 */
  revealNode(nodeId) {
    const n = this.tree && this.tree.node(nodeId);
    if (!n) return false;
    let p = this.tree.parent(nodeId);
    while (p && p.id !== "root") {
      if (p.collapsed) delete p.collapsed;
      p = this.tree.parent(p.id);
    }
    if (this.zoomId && this.zoomId !== nodeId && !this.tree.isAncestor(this.zoomId, nodeId)) this.zoomId = null;
    if (this.zoomId === nodeId) this.zoomId = null;
    if (n.done && this.hideDone) this.forceShow.add(nodeId);
    if (this.filter && this.matchSet && !this.matchSet.has(nodeId)) {
      this.filter = "";
      this.filterInput.value = "";
    }
    this.changed();
    this.render();
    this.focusNode(nodeId, "end");
    const el = this.elCache.get(nodeId);
    if (el) {
      el.__row.classList.add("is-flash");
      setTimeout(() => el.__row.classList.remove("is-flash"), 1600);
    }
    return true;
  },

  /** Ctrl/⌘ + 点击链接 */
  openHref(href) {
    if (!href) return;
    const own = `siyuan://plugins/${this.plugin.name}`;
    if (href.startsWith(own)) return this.plugin.openUrl(href);
    const m = href.match(/^siyuan:\/\/blocks\/([0-9]{14}-[0-9a-z]{7})/);
    if (m) return this.plugin.openSiyuanDoc(m[1]);
    window.open(href);
  },

  /* ---------- 标签 ---------- */
  refreshTags(el) {
    const n = this.tree && this.tree.node(el.__id);
    if (!n || !n.text.includes("#")) return;
    el.__val = null;
    const node = this.elCache.get(n.id);
    if (node) this.updateNodeEl(node, n);
  },

  filterByTag(tag) {
    this.filterInput.value = "#" + tag;
    this.filter = this.filterInput.value;
    this.forceShow.clear();
    this.sel = null;
    this.hideTagDrop();
    this.render();
  },

  docTags() {
    const counts = new Map();
    const walk = (arr) => arr.forEach((n) => {
      for (const t of extractTags(htmlToText(n.text) + "\n" + (n.note || ""))) counts.set(t, (counts.get(t) || 0) + 1);
      walk(n.children);
    });
    walk(this.doc.root.children);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  },

  showTagDrop() {
    if (!this.doc) return;
    const v = this.filterInput.value.trim();
    if (v && !/^#[^\s#]*$/.test(v)) return this.hideTagDrop();
    const q = v.slice(1).toLowerCase();
    const tags = this.docTags().filter(([t]) => !q || t.toLowerCase().includes(q));
    if (!tags.length) return this.hideTagDrop();
    this.tagDropEl.innerHTML =
      `<div class="ol-tagdrop-title">本大纲的标签</div>` +
      tags
        .slice(0, 30)
        .map(([t, c]) => `<div class="ol-tagdrop-item" data-tag="${escapeHtml(t)}"><span class="ol-tag">#${escapeHtml(t)}</span><span class="ol-tagdrop-n">${c}</span></div>`)
        .join("");
    this.tagDropEl.style.display = "block";
  },

  hideTagDrop() {
    this.tagDropEl.style.display = "none";
  },

  /* ---------- 跨大纲全文搜索（侧栏） ---------- */
  scheduleContentSearch(q) {
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => this.runContentSearch(q), 250);
  },

  async runContentSearch(q) {
    const docs = await this.store.loadAllDocs();
    if (this.sideSearch.value.trim().toLowerCase() !== q) return;
    const tagQ = /^#[^\s#]+$/.test(q) ? q.slice(1) : null;
    const groups = [];
    let total = 0;
    for (const doc of docs) {
      const it = this.store.item(doc.id);
      if (!it || it.trashed) continue;
      const hits = [];
      const walk = (arr) => arr.forEach((n) => {
        const text = htmlToText(n.text);
        const full = text + "\n" + (n.note || "") + "\n" + (n.blocks || []).map(blockText).join("\n");
        const ok = tagQ ? hasTag(full, tagQ) : full.toLowerCase().includes(q);
        if (ok) hits.push({ id: n.id, text: full });
        walk(n.children);
      });
      walk(doc.root.children);
      if (hits.length) {
        groups.push({ doc, hits });
        total += hits.length;
      }
    }
    this._hits = { q, groups, total };
    this.renderDocList();
  },

  contentHitsHtml(q) {
    const h = this._hits;
    if (!h || h.q !== q) return `<div class="ol-hits-title">正在搜索内容…</div>`;
    if (!h.total) return `<div class="ol-hits-title">内容中没有找到</div>`;
    const snip = (text) => {
      const flat = text.replace(/\s+/g, " ").trim();
      const i = flat.toLowerCase().indexOf(q.startsWith("#") ? q : q);
      const start = Math.max(0, i - 14);
      const part = flat.slice(start, start + 60);
      const j = part.toLowerCase().indexOf(q);
      const pre = (start > 0 ? "…" : "") + escapeHtml(j >= 0 ? part.slice(0, j) : part);
      return j >= 0 ? pre + "<mark>" + escapeHtml(part.slice(j, j + q.length)) + "</mark>" + escapeHtml(part.slice(j + q.length)) : pre;
    };
    return (
      `<div class="ol-hits-title">内容匹配 · ${h.total} 处</div>` +
      h.groups
        .slice(0, 30)
        .map(
          (g) =>
            `<div class="ol-hits-doc">${escapeHtml(g.doc.title || "无标题")}</div>` +
            g.hits
              .slice(0, 4)
              .map((x) => `<div class="ol-hit" data-doc="${g.doc.id}" data-node="${x.id}">${snip(x.text)}</div>`)
              .join("") +
            (g.hits.length > 4 ? `<div class="ol-hit ol-hit-more" data-doc="${g.doc.id}" data-q="${escapeHtml(q)}">还有 ${g.hits.length - 4} 处，在大纲中查看</div>` : "")
        )
        .join("")
    );
  },

  async openHit(docId, nodeId, q) {
    await this.openDoc(docId);
    if (nodeId) this.revealNode(nodeId);
    else if (q) {
      this.filterInput.value = q;
      this.filter = q;
      this.render();
    }
  },
});

// ---- 40-plugin.js ----
/* ---------- 插件入口 ---------- */
const TAB_TYPE = "outliner_tab";
const PLUGIN_VERSION = "0.6.0";
const ICON_ID = "iconOutlinerPlugin";
const ICON_SYMBOL = `<symbol id="${ICON_ID}" viewBox="0 0 32 32">
<circle cx="6" cy="7" r="2.6"/><rect x="11" y="5.6" width="17" height="2.8" rx="1.4"/>
<circle cx="12" cy="16" r="2.6"/><rect x="17" y="14.6" width="11" height="2.8" rx="1.4"/>
<circle cx="12" cy="25" r="2.6"/><rect x="17" y="23.6" width="11" height="2.8" rx="1.4"/>
</symbol>`;

function _hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ":" + s.length;
}

function api(url, data) {
  return new Promise((resolve) => {
    try {
      siyuan.fetchPost(url, data, (res) => resolve(res || { code: -1 }));
    } catch (e) {
      resolve({ code: -1, msg: String(e) });
    }
  });
}

class OutlinerPlugin extends siyuan.Plugin {
  async onload() {
    this.addIcons(ICON_SYMBOL);
    this.store = new Store(this);
    await this.store.init();
    this.editors = new Set();
    this.clip = null;
    this.autoTimers = new Map();
    this.syncTiming = { IDLE: 30000, GAP: 60000, MAX_WAIT: 120000 };
    const plugin = this;

    this.addTab({
      type: TAB_TYPE,
      init() {
        this.element.classList.add("ol-tab-host");
        const ed = new OutlineEditor(this.element, plugin, this);
        this.__ed = ed;
        plugin.editors.add(ed);
        const docId = plugin.pendingDocId || (this.data && this.data.docId);
        const nodeId = plugin.pendingNodeId || (this.data && this.data.nodeId);
        plugin.pendingDocId = null;
        plugin.pendingNodeId = null;
        ed.start(docId).then(() => {
          if (nodeId) ed.revealNode(nodeId);
        });
      },
      beforeDestroy() {
        if (this.__ed) {
          plugin.flushAutoSync(this.__ed.doc);
          this.__ed.flush();
        }
      },
      destroy() {
        if (this.__ed) {
          this.__ed.destroy();
          plugin.editors.delete(this.__ed);
          this.__ed = null;
        }
      },
    });

    this.addTopBar({
      icon: ICON_ID,
      title: "大纲",
      position: "left",
      callback: () => this.openOutliner(),
    });

    this.addCommand({
      langKey: "openOutliner",
      langText: "打开大纲",
      hotkey: "⌥⌘O",
      callback: () => this.openOutliner(),
    });

    this._onTitleMenu = this.onTitleMenu.bind(this);
    this._onBlockMenu = this.onBlockMenu.bind(this);
    this._onOpenUrl = ({ detail }) => detail && detail.url && this.openUrl(detail.url);
    this.eventBus.on("click-editortitleicon", this._onTitleMenu);
    this.eventBus.on("click-blockicon", this._onBlockMenu);
    this.eventBus.on("open-siyuan-url-plugin", this._onOpenUrl);

    // 旧版思源没有 onDataChanged：窗口重新获得焦点时也检查一次
    this._onWinFocus = () => {
      if (Date.now() - (this._lastFocusReload || 0) < 1500) return;
      this._lastFocusReload = Date.now();
      this.scheduleReload();
    };
    window.addEventListener("focus", this._onWinFocus);
    this._onBeforeUnload = () => {
      this.flushAutoSync();
      this.store.flushAll();
    };
    window.addEventListener("beforeunload", this._onBeforeUnload);
    this.applySyncTiming();
  }

  /* ---------- 跨窗口 / 跨设备 ---------- */
  /** 思源在插件数据被其他窗口或同步改动时调用 */
  onDataChanged() {
    this.scheduleReload();
  }

  scheduleReload() {
    clearTimeout(this._reloadTimer);
    this._reloadTimer = setTimeout(() => this.reloadExternal(), 300);
  }

  async reloadExternal() {
    if (this._reloading) return this.scheduleReload();
    this._reloading = true;
    try {
      const res = await this.store.reloadFromDisk();
      if (res.settingsChanged) this.applySyncTiming();
      for (const ed of this.editors) await ed.onExternalChange(res);
    } catch (e) {
      console.warn("[outliner] reload failed", e);
    } finally {
      this._reloading = false;
    }
  }

  onSaveStateChanged(err, wasErr) {
    for (const ed of this.editors) ed.updateSaveState();
    if (err && !wasErr) siyuan.showMessage(`大纲保存失败（${escapeHtml(err.msg)}），正在自动重试，请暂时不要关闭思源`, 6000, "error");
    if (!err && wasErr) siyuan.showMessage("大纲已恢复保存", 2000);
  }

  onConflict(doc, copy) {
    siyuan.showMessage(`「${escapeHtml(doc.title || "无标题")}」在另一个窗口也被修改了。那边的版本已另存为「${escapeHtml(copy.title)}」，两边的内容都保留了`, 8000);
    for (const ed of this.editors) ed.renderDocList();
  }

  /* ---------- 快捷键与外观 ---------- */
  keymap() {
    const over = this.store.index.settings.keymap || {};
    const m = {};
    KEY_COMMANDS.forEach((c) => (m[c.id] = over[c.id] != null ? over[c.id] : c.def));
    return m;
  }

  keymapIndex() {
    const key = JSON.stringify(this.store.index.settings.keymap || {});
    if (this._kmKey !== key || !this._kmIdx) {
      this._kmKey = key;
      const idx = {};
      for (const [id, combo] of Object.entries(this.keymap())) if (combo && !idx[combo]) idx[combo] = id;
      this._kmIdx = idx;
    }
    return this._kmIdx;
  }

  applySyncTiming() {
    const idle = +this.store.index.settings.syncIdle || 30;
    this.syncTiming.IDLE = idle * 1000;
    this.syncTiming.GAP = Math.max(60000, idle * 1000);
    this.syncTiming.MAX_WAIT = Math.max(120000, idle * 4000);
  }

  applyLook(ed) {
    const s = this.store.index.settings;
    const fs = +s.fontSize || 15;
    const ratio = { compact: 1.5, normal: 1.73, loose: 2.0 }[s.lineSpacing || "normal"] || 1.73;
    const width = { narrow: "680px", normal: "860px", wide: "1120px", full: "100%" }[s.pageWidth || "normal"] || "860px";
    const st = ed.root.style;
    st.setProperty("--ol-fs", fs + "px");
    st.setProperty("--ol-lh", Math.round(fs * ratio) + "px");
    st.setProperty("--ol-page-w", width);
    ed.root.classList.toggle("no-guides", s.showGuides === false);
  }

  applyLookAll() {
    this.applySyncTiming();
    for (const ed of this.editors) {
      this.applyLook(ed);
      ed.updateSyncState();
    }
  }

  /* ---------- 链接 ---------- */
  nodeLink(docId, nodeId) {
    return `siyuan://plugins/${this.name}/open?doc=${docId}${nodeId ? `&node=${nodeId}` : ""}`;
  }

  openUrl(url) {
    let doc = null;
    let node = null;
    try {
      const q = url.split("?")[1] || "";
      const params = new URLSearchParams(q);
      doc = params.get("doc");
      node = params.get("node");
    } catch (e) { /* ignore */ }
    if (!doc) return;
    if (!this.store.item(doc) || this.store.item(doc).trashed) {
      siyuan.showMessage("这篇大纲不存在或已被删除", 3000, "error");
      return;
    }
    this.openOutliner(doc, node);
  }

  /* ---------- 新窗口 ---------- */
  async openInNewWindow(docId) {
    if (typeof siyuan.openWindow !== "function") {
      siyuan.showMessage("当前思源版本不支持插件打开新窗口，请升级思源后再试", 4000, "error");
      return;
    }
    await this.store.flushAll();
    const it = this.store.item(docId);
    const tab = await siyuan.openTab({
      app: this.app,
      keepCursor: true,
      custom: { icon: ICON_ID, title: _itemTitle(it || {}), data: { docId, standalone: true }, id: this.name + TAB_TYPE },
    });
    siyuan.openWindow({ tab, width: 1000, height: 760 });
  }

  /* ---------- 图片 ---------- */
  imageURL(src) {
    if (!/^olimg:/.test(src || "")) return Promise.resolve(resolveSrc(src));
    if (!this._imgCache) this._imgCache = new Map();
    if (this._imgCache.has(src)) return this._imgCache.get(src);
    const p = this._fetchImage(src.slice(6))
      .then((blob) => URL.createObjectURL(blob))
      .catch(() => {
        this._imgCache.delete(src);
        return "";
      });
    this._imgCache.set(src, p);
    return p;
  }

  async _fetchImage(name) {
    const r = await fetch("/api/file/getFile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: this.store.base + "assets/" + name }),
    });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || ct.includes("application/json")) throw new Error("图片不存在");
    return r.blob();
  }

  /** 旧版本把图片放在思源 assets 里：搬到插件目录，并记住原路径（同步时继续引用它） */
  async migrateImages(doc, editor) {
    const imgs = [];
    const walk = (arr) => arr.forEach((n) => {
      (n.blocks || []).forEach((b) => b.type === "image" && /^assets\//.test(b.src) && imgs.push(b));
      walk(n.children);
    });
    walk(doc.root.children);
    if (!imgs.length) return;
    const map = Object.assign({}, this.store.index.settings.assetMap || {});
    let changed = false;
    for (const b of imgs) {
      try {
        const r = await fetch("/" + b.src);
        if (!r.ok) continue;
        const blob = await r.blob();
        const file = new File([blob], b.src.split("/").pop(), { type: blob.type || "image/png" });
        const src = await this.store.putImage(file);
        map[src.slice(6)] = b.src;
        b.src = src;
        changed = true;
      } catch (e) { /* 留在原处 */ }
    }
    if (!changed) return;
    this.store.setSetting("assetMap", map);
    this.store.saveDocSoon(doc);
    if (editor && editor.doc === doc) editor.render();
  }

  /** 同步前：把插件目录里的图片复制一份到思源 assets，返回 src 映射 */
  async _prepareSyncImages(doc) {
    const map = Object.assign({}, this.store.index.settings.assetMap || {});
    let changed = false;
    const names = [];
    const walk = (arr) => arr.forEach((n) => {
      (n.blocks || []).forEach((b) => b.type === "image" && /^olimg:/.test(b.src) && names.push(b.src.slice(6)));
      walk(n.children);
    });
    walk(doc.root.children);
    for (const name of names) {
      if (map[name]) continue;
      try {
        const blob = await this._fetchImage(name);
        const fd = new FormData();
        fd.append("assetsDirPath", "/assets/");
        fd.append("file[]", new File([blob], name, { type: blob.type }), name);
        const r = await api("/api/asset/upload", fd);
        const path = r && r.code === 0 && Object.values((r.data && r.data.succMap) || {})[0];
        if (path) {
          map[name] = path;
          changed = true;
        }
      } catch (e) { /* 这张图同步不过去，保留占位 */ }
    }
    if (changed) this.store.setSetting("assetMap", map);
    return (src) => (/^olimg:/.test(src) ? map[src.slice(6)] || src : src);
  }

  /** 清理插件目录里没人用的图片（30 天内的不删，给历史版本留余地） */
  async cleanupImages() {
    const used = new Set();
    for (const it of this.store.index.docs) {
      if (it.type === "folder") continue;
      const d = await this.store.getDoc(it.id);
      if (!d) continue;
      const walk = (arr) => arr.forEach((n) => {
        (n.blocks || []).forEach((b) => b.type === "image" && /^olimg:/.test(b.src) && used.add(b.src.slice(6)));
        walk(n.children);
      });
      walk(d.root.children);
    }
    const files = await this.store.listImages();
    const cutoff = Date.now() / 1000 - 30 * 86400;
    let n = 0;
    for (const f of files) {
      if (used.has(f.name)) continue;
      if (f.updated && f.updated > cutoff) continue;
      await this.store.removeImage(f.name);
      n++;
    }
    return n;
  }

  async onunload() {
    this.eventBus.off("click-editortitleicon", this._onTitleMenu);
    this.eventBus.off("click-blockicon", this._onBlockMenu);
    this.eventBus.off("open-siyuan-url-plugin", this._onOpenUrl);
    window.removeEventListener("focus", this._onWinFocus);
    window.removeEventListener("beforeunload", this._onBeforeUnload);
    if (this.store) {
      this.flushAutoSync();
      await this.store.flushAll();
    }
  }

  openOutliner(docId, nodeId) {
    const ed = [...this.editors].find((e) => !e.standalone) || [...this.editors][0];
    if (ed && docId) {
      ed.openDoc(docId).then(() => {
        if (nodeId) ed.revealNode(nodeId);
      });
    }
    if (!ed) {
      this.pendingDocId = docId || null;
      this.pendingNodeId = nodeId || null;
    }
    siyuan.openTab({
      app: this.app,
      custom: {
        icon: ICON_ID,
        title: "大纲",
        data: {},
        id: this.name + TAB_TYPE,
      },
    });
  }

  uploadImage(file) {
    return this.store.putImage(file);
  }

  openSiyuanDoc(id) {
    siyuan.openTab({ app: this.app, doc: { id } });
  }

  /* ---------- 同步到思源文档（单向：大纲 → 思源） ---------- */
  /* ---------- 自动同步：停顿 30 秒后同步，同一篇至少间隔 1 分钟，连续编辑最多 2 分钟同步一次 ---------- */
  autoSyncOn() {
    return this.store.index.settings.autoSync !== false;
  }

  markDirty(doc) {
    if (!doc || !doc.syncDocId) return;
    if (!doc.__dirty) {
      doc.__dirty = true;
      doc.__dirtySince = Date.now();
    }
    if (this.autoSyncOn()) this.scheduleAutoSync(doc);
  }

  scheduleAutoSync(doc, delay) {
    if (!this.autoSyncOn() || !doc.syncDocId) return;
    const { IDLE, GAP, MAX_WAIT } = this.syncTiming;
    const now = Date.now();
    let d = delay != null ? delay : IDLE;
    if (doc.__dirtySince) d = Math.min(d, Math.max(0, doc.__dirtySince + MAX_WAIT - now));
    if (doc.lastSyncAt && now - doc.lastSyncAt < GAP) d = Math.max(d, doc.lastSyncAt + GAP - now);
    clearTimeout(this.autoTimers.get(doc.id));
    this.autoTimers.set(doc.id, setTimeout(() => {
      this.autoTimers.delete(doc.id);
      this.runAutoSync(doc);
    }, d));
  }

  runAutoSync(doc) {
    if (!doc.__dirty || !doc.syncDocId) return;
    this.syncDoc(doc, null, { silent: true });
  }

  /** 切换大纲、关闭页签、卸载时：把未同步的修改立刻同步 */
  flushAutoSync(doc) {
    const docs = doc ? [doc] : [...this.store.docs.values()];
    for (const d of docs) {
      if (!d) continue;
      clearTimeout(this.autoTimers.get(d.id));
      this.autoTimers.delete(d.id);
      if (d.__dirty && d.syncDocId && this.autoSyncOn()) this.runAutoSync(d);
    }
  }

  _refreshSyncState(doc) {
    for (const ed of this.editors) if (ed.doc === doc) ed.updateSyncState();
  }

  async syncDoc(doc, editor, opts) {
    opts = opts || {};
    if (!doc) return;
    if (this._syncing) {
      if (opts.silent) this.scheduleAutoSync(doc, 5000);
      return;
    }
    const mapSrc = await this._prepareSyncImages(doc);
    const md = nodesToMarkdown(doc.root.children, { mapSrc }) || "- ";
    const clean = (t) => t.replace(/\//g, "／");
    const title = clean(doc.title || "未命名大纲");
    const key = _hash(title + "\n" + md);
    if (opts.silent && doc.syncDocId && doc.syncedKey === key) {
      doc.__dirty = false;
      doc.__dirtySince = 0;
      this._refreshSyncState(doc);
      return;
    }
    this._syncing = true;
    this._syncingId = doc.id;
    doc.__dirty = false;
    doc.__dirtySince = 0;
    this._refreshSyncState(doc);
    try {
      await this.store.flushAll();
      const hpath = "/" + [...this.store.pathOf(doc.id).map((a) => clean(_itemTitle(a))), title].join("/");
      let target = doc.syncDocId;
      if (target) {
        const r = await api("/api/filetree/getHPathByID", { id: target });
        if (!r || r.code !== 0) target = null;
      }
      if (target) {
        await api("/api/sqlite/flushTransaction", {});
        const kids = await api("/api/block/getChildBlocks", { id: target });
        for (const k of (kids && kids.data) || []) await api("/api/block/deleteBlock", { id: k.id });
        const r = await api("/api/block/appendBlock", { dataType: "markdown", data: md, parentID: target });
        if (!r || r.code !== 0) throw new Error((r && r.msg) || "写入失败");
        await api("/api/filetree/renameDocByID", { id: target, title });
        if (!opts.silent) siyuan.showMessage(`已更新思源文档「${escapeHtml(title)}」`, 3000);
      } else {
        const nb = await this.pickNotebook(opts.silent);
        if (!nb) return;
        const r = await api("/api/filetree/createDocWithMd", { notebook: nb, path: hpath, markdown: md });
        if (!r || r.code !== 0) throw new Error((r && r.msg) || "创建失败");
        doc.syncDocId = r.data;
        if (!opts.silent) {
          siyuan.showMessage(
            `已生成思源文档「${escapeHtml(title)}」。${this.autoSyncOn() ? "之后的修改会自动同步过去" : "以后再同步会直接更新这篇文档"}`,
            4000
          );
        }
      }
      doc.syncedKey = key;
      doc.lastSyncAt = Date.now();
      doc.__syncErr = false;
      this.store.saveDocSoon(doc);
      if (editor) editor.updateBarState();
    } catch (e) {
      // 自动同步失败只提示一次，下次修改后会重试
      if (!opts.silent || !doc.__syncErr) siyuan.showMessage("同步失败：" + escapeHtml(e.message || String(e)), 6000, "error");
      doc.__syncErr = true;
      doc.__dirty = true;
    } finally {
      this._syncing = false;
      this._syncingId = null;
      this._refreshSyncState(doc);
    }
  }

  async pickNotebook(silent) {
    const res = await api("/api/notebook/lsNotebooks", {});
    const nbs = ((res && res.data && res.data.notebooks) || []).filter((n) => !n.closed);
    if (!nbs.length) {
      siyuan.showMessage("没有已打开的笔记本", 3000, "error");
      return null;
    }
    const saved = this.store.index.settings.syncNotebook;
    if (saved && nbs.some((n) => n.id === saved)) return saved;
    if (silent) return null;
    return new Promise((resolve) => {
      let done = false;
      const dialog = new siyuan.Dialog({
        title: "同步到思源：选择笔记本",
        width: "420px",
        content: `<div class="b3-dialog__content ol-pick">
  <div class="ol-pick-tip">大纲会生成为这个笔记本里的一篇文档（嵌套列表），位置和左侧列表的层级一致：文件夹和上级大纲会成为上级文档。</div>
  <select class="b3-select fn__block">${nbs.map((n) => `<option value="${n.id}">${escapeHtml(n.name)}</option>`).join("")}</select>
  <label class="ol-pick-remember"><input type="checkbox" checked> 以后都用这个笔记本</label>
</div>
<div class="b3-dialog__action">
  <button class="b3-button b3-button--cancel">取消</button><div class="fn__space"></div>
  <button class="b3-button b3-button--text">确定</button>
</div>`,
        destroyCallback: () => {
          if (!done) resolve(null);
        },
      });
      const el = dialog.element;
      el.querySelector(".b3-button--cancel").addEventListener("click", () => dialog.destroy());
      el.querySelector(".b3-button--text").addEventListener("click", () => {
        const id = el.querySelector("select").value;
        if (el.querySelector(".ol-pick-remember input").checked) {
          this.store.setSetting("syncNotebook", id);
        }
        done = true;
        resolve(id);
        dialog.destroy();
      });
    });
  }

  /* ---------- 从思源导入 ---------- */
  onTitleMenu({ detail }) {
    const id = detail && detail.data && detail.data.rootID;
    if (!id) return;
    detail.menu.addItem({
      icon: ICON_ID,
      label: "转为大纲",
      click: () => this.importSiyuanDoc(id),
    });
  }

  onBlockMenu({ detail }) {
    const els = (detail && detail.blockElements) || [];
    if (!els.length) return;
    detail.menu.addItem({
      icon: ICON_ID,
      label: "转为大纲",
      click: () => this.importSiyuanBlocks(els.map((e) => e.dataset.nodeId)),
    });
  }

  async importSiyuanDoc(id) {
    const r = await api("/api/export/exportMdContent", { id });
    if (!r || r.code !== 0) return siyuan.showMessage("读取文档失败", 3000, "error");
    const info = await api("/api/block/getDocInfo", { id });
    let title = (info && info.data && info.data.ial && info.data.ial.title) || "";
    if (!title && r.data.hPath) title = r.data.hPath.split("/").pop();
    let md = r.data.content || "";
    md = md.replace(/^---\n[\s\S]*?\n---\n/, "");
    const first = md.match(/^\s*#\s+(.+)\n/);
    if (first && first[1].trim() === title.trim()) md = md.slice(first[0].length);
    await this._importNodes(title, parseOutlineText(md));
  }

  async importSiyuanBlocks(ids) {
    let md = "";
    for (const id of ids) {
      const r = await api("/api/block/getBlockKramdown", { id });
      if (r && r.code === 0) md += r.data.kramdown + "\n";
    }
    const nodes = parseOutlineText(md);
    const title = nodes.length === 1 ? htmlToText(nodes[0].text) : "";
    await this._importNodes(title, nodes.length === 1 && nodes[0].children.length ? nodes[0].children : nodes);
  }

  async _importNodes(title, nodes) {
    if (!nodes.length) return siyuan.showMessage("没有可以转换的内容", 3000);
    const doc = await this.store.createDoc(title || "", nodes);
    siyuan.showMessage(`已创建大纲「${escapeHtml(title || "无标题")}」，共 ${countNodes(nodes)} 个主题`, 3000);
    const ed = [...this.editors][0];
    if (ed) ed.renderDocList();
    this.openOutliner(doc.id);
  }
}

// ---- 45-settings.js ----
/* ---------- 设置面板（思源「集市 → 已下载 → 设置」也会打开这里） ---------- */
Object.assign(OutlinerPlugin.prototype, {
  openSetting(focus) {
    const s = this.store.index.settings;
    const opt = (v, label, cur) => `<option value="${v}"${String(cur) === String(v) ? " selected" : ""}>${label}</option>`;
    const fontSizes = [13, 14, 15, 16, 17, 18, 20];
    const dialog = new siyuan.Dialog({
      title: "大纲设置",
      width: "640px",
      height: "78vh",
      content: `<div class="ol-set">
  <div class="ol-set-sec">外观</div>
  <label class="ol-set-row"><span>页面宽度</span><select class="b3-select" data-k="pageWidth">
    ${opt("narrow", "窄（680）", s.pageWidth || "normal")}${opt("normal", "标准（860）", s.pageWidth || "normal")}${opt("wide", "宽（1120）", s.pageWidth || "normal")}${opt("full", "铺满", s.pageWidth || "normal")}
  </select></label>
  <label class="ol-set-row"><span>字号</span><select class="b3-select" data-k="fontSize">
    ${fontSizes.map((f) => opt(f, f + " px", s.fontSize || 15)).join("")}
  </select></label>
  <label class="ol-set-row"><span>行距</span><select class="b3-select" data-k="lineSpacing">
    ${opt("compact", "紧凑", s.lineSpacing || "normal")}${opt("normal", "标准", s.lineSpacing || "normal")}${opt("loose", "宽松", s.lineSpacing || "normal")}
  </select></label>
  <label class="ol-set-row"><span>显示层级竖线</span><input type="checkbox" class="b3-switch" data-k="showGuides"${s.showGuides === false ? "" : " checked"}></label>

  <div class="ol-set-sec">同步到思源</div>
  <label class="ol-set-row"><span>自动同步<small>只对手动同步过一次的大纲生效</small></span><input type="checkbox" class="b3-switch" data-k="autoSync"${s.autoSync === false ? "" : " checked"}></label>
  <label class="ol-set-row"><span>停止编辑多久后同步</span><select class="b3-select" data-k="syncIdle">
    ${[10, 30, 60, 120, 300].map((v) => opt(v, v < 60 ? v + " 秒" : v / 60 + " 分钟", s.syncIdle || 30)).join("")}
  </select></label>

  <div class="ol-set-sec ol-set-keys-anchor">快捷键<button class="b3-button b3-button--cancel ol-set-resetkeys">全部恢复默认</button></div>
  <div class="ol-set-tip">点击右侧的按键，再按下新的组合键。需要包含 Ctrl / ⌘ 或 Alt；Esc 取消。</div>
  <div class="ol-set-keys"></div>

  <div class="ol-set-sec">数据</div>
  <div class="ol-set-row"><span>回收站<small>删除的大纲保留 ${TRASH_DAYS} 天</small></span><button class="b3-button b3-button--outline" data-act2="trash">打开回收站</button></div>
  <div class="ol-set-row"><span>清理未使用的图片<small>删除不再被任何大纲使用、且超过 30 天的图片</small></span><button class="b3-button b3-button--outline" data-act2="cleanimg">清理</button></div>
  <div class="ol-set-row"><span>数据位置<small>思源工作空间 / data/storage/petal/${this.name}/，会随思源同步</small></span></div>
</div>`,
    });
    const el = dialog.element;
    const save = (k, v) => {
      this.store.setSetting(k, v);
      this.applyLookAll();
    };
    el.querySelectorAll("[data-k]").forEach((input) => {
      input.addEventListener("change", () => {
        const k = input.dataset.k;
        let v = input.type === "checkbox" ? input.checked : input.value;
        if (k === "fontSize" || k === "syncIdle") v = +v;
        save(k, v);
      });
    });
    el.querySelector('[data-act2="trash"]').addEventListener("click", () => {
      const ed = [...this.editors][0];
      if (ed) ed.showTrash();
    });
    el.querySelector('[data-act2="cleanimg"]').addEventListener("click", async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = "清理中…";
      const n = await this.cleanupImages();
      b.disabled = false;
      b.textContent = "清理";
      siyuan.showMessage(n ? `已清理 ${n} 张未使用的图片` : "没有需要清理的图片", 2500);
    });

    // ---------- 快捷键 ----------
    const keysEl = el.querySelector(".ol-set-keys");
    let recording = null;
    const drawKeys = (err) => {
      const km = this.keymap();
      const over = this.store.index.settings.keymap || {};
      keysEl.innerHTML = KEY_COMMANDS.map(
        (c) => `<div class="ol-key-row${recording === c.id ? " is-rec" : ""}" data-id="${c.id}">
  <span class="ol-key-name">${escapeHtml(c.name)}</span>
  ${recording === c.id && err ? `<span class="ol-key-err">${escapeHtml(err)}</span>` : ""}
  <button class="ol-key-btn">${recording === c.id ? "请按下组合键…" : escapeHtml(formatCombo(km[c.id]))}</button>
  <button class="ol-key-reset" title="恢复默认（${escapeHtml(formatCombo(c.def))}）"${over[c.id] != null ? "" : " disabled"}>↺</button>
</div>`
      ).join("");
      if (recording) {
        const btn = keysEl.querySelector(".ol-key-row.is-rec .ol-key-btn");
        if (btn) btn.focus();
      }
    };
    drawKeys();
    const setKey = (id, combo) => {
      const over = Object.assign({}, this.store.index.settings.keymap || {});
      const def = KEY_COMMANDS.find((c) => c.id === id).def;
      if (combo === def) delete over[id];
      else over[id] = combo;
      this.store.setSetting("keymap", over);
    };
    keysEl.addEventListener("click", (e) => {
      const row = e.target.closest(".ol-key-row");
      if (!row) return;
      if (e.target.closest(".ol-key-reset")) {
        const over = Object.assign({}, this.store.index.settings.keymap || {});
        delete over[row.dataset.id];
        this.store.setSetting("keymap", over);
        recording = null;
        drawKeys();
        return;
      }
      if (e.target.closest(".ol-key-btn")) {
        recording = recording === row.dataset.id ? null : row.dataset.id;
        drawKeys();
      }
    });
    const onKey = (e) => {
        if (!el.isConnected) return window.removeEventListener("keydown", onKey, true);
        if (!recording) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          recording = null;
          return drawKeys();
        }
        const combo = comboOf(e);
        if (!combo) return; // 只按了修饰键
        const err = validateCombo(combo);
        if (err) return drawKeys(err);
        const km = this.keymap();
        const clash = KEY_COMMANDS.find((c) => c.id !== recording && km[c.id] === combo);
        if (clash) return drawKeys(`已被「${clash.name}」使用`);
        setKey(recording, combo);
        recording = null;
        drawKeys();
    };
    // 录制时监听整个窗口（按钮重绘后焦点可能不在面板里）
    window.addEventListener("keydown", onKey, true);
    el.querySelector(".ol-set-resetkeys").addEventListener("click", () => {
      this.store.setSetting("keymap", {});
      recording = null;
      drawKeys();
    });
    if (focus === "keys") setTimeout(() => el.querySelector(".ol-set-keys-anchor").scrollIntoView({ block: "start" }), 50);
  },
});

module.exports = OutlinerPlugin;

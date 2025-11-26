// Sweet JS Compiler runtime
// Provides sandboxed execution with console capture, status updates,
// auto-run debounce, persistence, and user interaction helpers.

// DOM references
const els = {
  code: document.getElementById("codeinput"),
  run: document.getElementById("run"),
  autorun: document.getElementById("autorun"),
  clear: document.getElementById("clear"),
  copy: document.getElementById("copy"),
  theme: document.getElementById("theme"),
  output: document.getElementById("output"),
  status: document.getElementById("status"),
  sandbox: document.getElementById("sandbox"),
  acPanel: document.getElementById("autocomplete"),
  acToggle: document.getElementById("autocomplete-toggle"),
};

const STORAGE_KEY_CODE = "sweetjs_code_v1";
const STORAGE_KEY_THEME = "sweetjs_theme_v1";
const STORAGE_KEY_AC = "sweetjs_ac_v1";
const DEBOUNCE_MS = 600;
let debounceId = null;
let lastRunCode = "";

// Load persisted state
(function initState() {
  const savedCode = localStorage.getItem(STORAGE_KEY_CODE);
  if (savedCode) els.code.value = savedCode;
  const savedTheme = localStorage.getItem(STORAGE_KEY_THEME);
  if (savedTheme === "dark") setTheme("dark");
  const ac = localStorage.getItem(STORAGE_KEY_AC);
  if (ac !== null) els.acToggle.checked = ac === "on";
})();

// Focus editor on load
els.code.focus();

function setTheme(mode) {
  if (mode === "dark") {
    document.body.setAttribute("data-theme", "dark");
    localStorage.setItem(STORAGE_KEY_THEME, "dark");
  } else {
    document.body.removeAttribute("data-theme");
    localStorage.setItem(STORAGE_KEY_THEME, "light");
  }
}

els.theme.addEventListener("click", () => {
  const isDark = document.body.getAttribute("data-theme") === "dark";
  setTheme(isDark ? "light" : "dark");
});

function setStatus(state, text) {
  els.status.textContent = text;
  els.status.className = `status ${state}`; // replaces previous classes
}

function appendLine(type, msg) {
  const line = document.createElement("div");
  line.className = "log-line fade-enter";
  const prefix = document.createElement("span");
  prefix.className = `log-prefix log-${type}`;
  prefix.textContent = type.toUpperCase();
  const body = document.createElement("span");
  body.textContent = msg;
  line.append(prefix, body);
  els.output.appendChild(line);
}

function clearOutput() {
  els.output.textContent = "";
}

function runCode() {
  const code = els.code.value;
  if (!code.trim()) {
    setStatus("idle", "Nothing to run");
    return;
  }
  clearOutput();
  setStatus("running", "Running…");
  lastRunCode = code;
  // Build sandbox srcdoc
  const sandboxDoc =
    `<!DOCTYPE html><html><head><meta charset=\"utf-8\" /></head><body><script>\n` +
    `(function(){\n` +
    ` const send=(type,msg)=>parent.postMessage({type,msg},'*');\n` +
    ` ['log','info','warn','error'].forEach(k=>{\n` +
    `   const orig=console[k];\n` +
    `   console[k]=function(...args){\n` +
    `     try{send(k,args.map(a=>{\n` +
    `       if(typeof a==='object'){try{return JSON.stringify(a,null,2);}catch(e){return '[object]';}}\n` +
    `       return String(a);}).join(' '));}catch(e){}\n` +
    `     orig.apply(console,args);\n` +
    `   };\n` +
    ` });\n` +
    ` try {\n` +
    `   const fn = new Function(${JSON.stringify(code)});\n` +
    `   const result = fn();\n` +
    `   if(result!==undefined) send('result', (typeof result==='object'? JSON.stringify(result,null,2): String(result)));\n` +
    `   send('done','ok');\n` +
    ` } catch(e){\n` +
    `   send('error', e && (e.stack||e.message||String(e)));\n` +
    `   send('done','error');\n` +
    ` }\n` +
    `})();\n` +
    `<\/script></body></html>`;
  els.sandbox.srcdoc = sandboxDoc;
}

// Receive messages from sandbox
window.addEventListener("message", (ev) => {
  if (!ev.data || !ev.data.type) return;
  const { type, msg } = ev.data;
  if (type === "done") {
    if (msg === "ok") setStatus("success", "Completed");
    else setStatus("error", "Error");
    return;
  }
  appendLine(type, msg);
});

// Debounced auto-run
function scheduleAutoRun() {
  if (!els.autorun.checked) return;
  clearTimeout(debounceId);
  debounceId = setTimeout(() => {
    if (els.code.value !== lastRunCode) runCode();
  }, DEBOUNCE_MS);
}

// Event bindings
els.run.addEventListener("click", runCode);
els.clear.addEventListener("click", () => {
  els.code.value = "";
  clearOutput();
  setStatus("idle", "Cleared");
  localStorage.removeItem(STORAGE_KEY_CODE);
});
if (els.copy) {
  els.copy.addEventListener("click", () => {
    const text = Array.from(els.output.querySelectorAll(".log-line"))
      .map((l) => l.textContent)
      .join("\n");
    navigator.clipboard
      .writeText(text || "")
      .then(() => setStatus("success", "Copied"))
      .catch(() => setStatus("error", "Copy failed"));
  });
}
els.code.addEventListener("input", () => {
  localStorage.setItem(STORAGE_KEY_CODE, els.code.value);
  scheduleAutoRun();
});
els.acToggle.addEventListener("change", () => {
  localStorage.setItem(STORAGE_KEY_AC, els.acToggle.checked ? "on" : "off");
  hideAutocomplete();
});

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key === "Enter") {
    e.preventDefault();
    runCode();
  }
  if (e.altKey && e.key.toLowerCase() === "c") {
    e.preventDefault();
    els.clear.click();
  }
});

// Initial status
setStatus("idle", "Idle");

// Optional: run once on load if autorun preset (off by default)
// if (els.autorun.checked) runCode();

// ---------- Autocomplete (lightweight) ----------
const JS_SUGGESTIONS = [
  "console.log",
  "console.info",
  "console.warn",
  "console.error",
  "Math.max",
  "Math.min",
  "Math.round",
  "Math.floor",
  "Math.ceil",
  "Array.prototype.map",
  "Array.prototype.filter",
  "Array.prototype.reduce",
  "JSON.parse",
  "JSON.stringify",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "document.querySelector",
  "document.querySelectorAll",
];

function getCaretPosition(textarea) {
  // Compute approximate position below caret using selectionStart and textarea metrics
  const { selectionStart } = textarea;
  const textUntilCaret = textarea.value.slice(0, selectionStart);
  const lines = textUntilCaret.split("\n");
  const line = lines.length - 1;
  const col = lines[lines.length - 1].length;
  // Rough position: start of textarea + line height * line + character width * col
  const rect = textarea.getBoundingClientRect();
  const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 18;
  const charWidth = 8; // rough average for monospace; good enough
  const top = rect.top + window.scrollY + 8 + line * lineHeight;
  const left = rect.left + window.scrollX + 12 + col * charWidth;
  return { top, left };
}

function findToken(text, pos) {
  // Return last word-ish token before caret
  const upTo = text.slice(0, pos);
  const match = upTo.match(/[A-Za-z_$][\w.$]*$/);
  return match ? match[0] : "";
}

function showAutocomplete(items, position) {
  if (!items.length) return hideAutocomplete();
  const panel = els.acPanel;
  panel.innerHTML = "";
  items.slice(0, 8).forEach((it, i) => {
    const div = document.createElement("div");
    div.role = "option";
    div.className = "autocomplete-item" + (i === 0 ? " active" : "");
    div.dataset.value = it;
    div.innerHTML = `<span>${it}</span>`;
    div.addEventListener("mousedown", (e) => {
      e.preventDefault();
      commitAutocomplete(it);
    });
    panel.appendChild(div);
  });
  panel.style.top = `${position.top}px`;
  panel.style.left = `${position.left}px`;
  panel.classList.remove("hidden");
}

function hideAutocomplete() {
  els.acPanel.classList.add("hidden");
  els.acPanel.innerHTML = "";
}

function commitAutocomplete(value) {
  const ta = els.code;
  const pos = ta.selectionStart;
  const token = findToken(ta.value, pos);
  const start = pos - token.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(pos);
  ta.value = before + value + after;
  const newPos = before.length + value.length;
  ta.setSelectionRange(newPos, newPos);
  localStorage.setItem(STORAGE_KEY_CODE, ta.value);
  hideAutocomplete();
}

function handleAutocomplete() {
  if (!els.acToggle.checked) return hideAutocomplete();
  const ta = els.code;
  const pos = ta.selectionStart;
  const token = findToken(ta.value, pos);
  if (!token || token.length < 2) {
    hideAutocomplete();
    return;
  }
  const items = JS_SUGGESTIONS.filter((s) =>
    s.toLowerCase().includes(token.toLowerCase())
  );
  const caret = getCaretPosition(ta);
  showAutocomplete(items, caret);
}

// Editor events for autocomplete
els.code.addEventListener("input", handleAutocomplete);
els.code.addEventListener("keyup", (e) => {
  // Navigate dropdown
  if (els.acPanel.classList.contains("hidden")) return;
  const items = Array.from(els.acPanel.querySelectorAll(".autocomplete-item"));
  if (!items.length) return;
  const idx = items.findIndex((i) => i.classList.contains("active"));
  if (e.key === "ArrowDown") {
    const next = items[Math.min(items.length - 1, idx + 1)];
    items.forEach((i) => i.classList.remove("active"));
    next.classList.add("active");
    e.preventDefault();
  } else if (e.key === "ArrowUp") {
    const prev = items[Math.max(0, idx - 1)];
    items.forEach((i) => i.classList.remove("active"));
    prev.classList.add("active");
    e.preventDefault();
  } else if (e.key === "Enter" || e.key === "Tab") {
    const active = items[idx >= 0 ? idx : 0];
    if (active) commitAutocomplete(active.dataset.value);
    e.preventDefault();
  } else if (e.key === "Escape") {
    hideAutocomplete();
    e.preventDefault();
  }
});
els.code.addEventListener("blur", () => setTimeout(hideAutocomplete, 100));

/* CodeImpact — Change Impact Analyzer
   Front-end prototype: basic import detection, dependency graph, text diff and heuristic risk. */
(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const state = {
    files: new Map(),
    graph: new Map(),
    target: "",
    report: null,
    cy: null,
    history: loadHistory()
  };

  const sampleFiles = {
    "src/app.js": `import { login, logout } from './auth.js';
import { getProfile } from './profile.js';
import { renderDashboard } from './dashboard.js';

export function startApp() {
  const user = login();
  const profile = getProfile(user.id);
  renderDashboard(profile);
}

export function stopApp() {
  logout();
}`,
    "src/auth.js": `import { getUserById } from './userService.js';

export function login() {
  const userId = localStorage.getItem('userId') || 'u-100';
  return getUserById(userId);
}

export function logout() {
  localStorage.removeItem('userId');
}`,
    "src/profile.js": `import { getUserById } from './userService.js';

export function getProfile(userId) {
  const user = getUserById(userId);
  return {
    name: user.name,
    email: user.email,
    role: user.role
  };
}`,
    "src/dashboard.js": `export function renderDashboard(profile) {
  const root = document.querySelector('#app');
  root.innerHTML = \`<h1>Welcome, \${profile.name}</h1>
    <p>\${profile.email}</p>\`;
}`,
    "src/userService.js": `const users = [
  { id: 'u-100', name: 'Alex Morgan', email: 'alex@example.com', role: 'admin' }
];

export function getUserById(id) {
  return users.find(user => user.id === id) || {
    id, name: 'Guest', email: '', role: 'visitor'
  };
}`,
    "src/api.js": `export async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}`,
    "src/settings.js": `export const settings = {
  theme: 'dark',
  notifications: true
};`
  };

  const fileInput = $("#fileInput");
  const dropZone = $("#dropZone");
  const targetSelect = $("#targetFile");
  const beforeCode = $("#beforeCode");
  const afterCode = $("#afterCode");
  const toast = window.bootstrap ? new bootstrap.Toast($("#appToast"), { delay: 3000 }) : null;

  function showToast(message) {
    $("#toastMessage").textContent = message;
    if (toast) toast.show();
    else alert(message);
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem("codeImpactHistory") || "[]"); }
    catch { return []; }
  }

  function saveHistory() {
    try { localStorage.setItem("codeImpactHistory", JSON.stringify(state.history.slice(0, 20))); }
    catch { /* Storage can be disabled; analysis still works. */ }
    renderHistory();
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function normalizePath(path) {
    const parts = [];
    for (const part of path.replace(/\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    return parts.join("/");
  }

  function fileExtension(path) {
    const match = path.match(/\.[^.\/]+$/);
    return match ? match[0].toLowerCase() : "";
  }

  function isSupported(path) {
    return [".js", ".mjs", ".cjs"].includes(fileExtension(path));
  }

  function getLineCount(text) {
    return text ? text.split(/\r?\n/).length : 0;
  }

  function setStats() {
    $("#statFiles").textContent = state.files.size;
    $("#statDeps").textContent = [...state.graph.values()].reduce((sum, list) => sum + list.length, 0);
    $("#statImpacted").textContent = state.report ? state.report.impacted.length : "—";
    $("#statRisk").textContent = state.report ? state.report.risk.label : "—";
    $("#historyCount").textContent = state.history.length;
    $("#fileCountLabel").textContent = `${state.files.size} ${state.files.size === 1 ? "file" : "files"}`;
  }

  function renderFileList() {
    const container = $("#fileList");
    if (!state.files.size) {
      container.className = "file-list empty-list";
      container.innerHTML = '<div class="empty-state"><i class="bi bi-file-earmark-code"></i><span>No files loaded yet</span></div>';
      setStats();
      return;
    }
    container.className = "file-list";
    container.innerHTML = [...state.files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => `
      <div class="file-row ${path === state.target ? "selected" : ""}" data-path="${escapeHtml(path)}" tabindex="0" role="button" aria-label="Select ${escapeHtml(path)}">
        <i class="bi bi-filetype-js file-type-icon"></i>
        <div class="file-row-main"><strong>${escapeHtml(path.split("/").pop())}</strong><small>${escapeHtml(path)} · ${formatBytes(new Blob([content]).size)}</small></div>
        <i class="bi bi-chevron-right"></i>
      </div>`).join("");
    container.querySelectorAll(".file-row").forEach((row) => {
      const choose = () => selectTarget(row.dataset.path);
      row.addEventListener("click", choose);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); }
      });
    });
    setStats();
  }

  function populateTargetSelect() {
    const paths = [...state.files.keys()].sort();
    targetSelect.innerHTML = paths.length
      ? paths.map((path) => `<option value="${escapeHtml(path)}">${escapeHtml(path)}</option>`).join("")
      : '<option value="">Load a project first</option>';
    targetSelect.disabled = paths.length === 0;
    $("#impactBtn").disabled = paths.length === 0;
    beforeCode.disabled = paths.length === 0;
    afterCode.disabled = paths.length === 0;
  }

  function selectTarget(path) {
    if (!state.files.has(path)) return;
    state.target = path;
    targetSelect.value = path;
    beforeCode.value = state.files.get(path);
    afterCode.value = state.files.get(path);
    updateLineCounts();
    renderFileList();
    $("#changeDescription").value = "";
  }

  function updateLineCounts() {
    $("#beforeLines").textContent = `${getLineCount(beforeCode.value)} lines`;
    $("#afterLines").textContent = `${getLineCount(afterCode.value)} lines`;
  }

  function resolveImport(fromPath, importPath) {
    if (!importPath || !importPath.startsWith(".")) return null;
    const fromParts = fromPath.split("/");
    fromParts.pop();
    const base = normalizePath([...fromParts, importPath].join("/"));
    const candidates = [
      base, `${base}.js`, `${base}.mjs`, `${base}.cjs`,
      `${base}/index.js`, `${base}/index.mjs`, `${base}/index.cjs`
    ];
    return candidates.find((candidate) => state.files.has(candidate)) || null;
  }

  function parseImports(path, content) {
    const imports = new Set();
    const patterns = [
      /\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
      /\bexport\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g,
      /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const resolved = resolveImport(path, match[1]);
        if (resolved && resolved !== path) imports.add(resolved);
      }
    }
    return [...imports];
  }

  function analyzeDependencies() {
    state.graph = new Map();
    for (const [path, content] of state.files) {
      state.graph.set(path, parseImports(path, content));
    }
    setStats();
  }

  async function loadFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    let loaded = 0;
    for (const file of incoming) {
      if (file.name.toLowerCase().endsWith(".zip")) {
        if (!window.JSZip) {
          showToast("ZIP support could not load. Check your internet connection or upload .js files.");
          continue;
        }
        try {
          const zip = await JSZip.loadAsync(file);
          for (const [zipPath, entry] of Object.entries(zip.files)) {
            if (entry.dir || !isSupported(zipPath) || zipPath.split("/").some((part) => part === "node_modules" || part.startsWith("."))) continue;
            const content = await entry.async("string");
            state.files.set(normalizePath(zipPath), content);
            loaded++;
          }
        } catch (error) {
          console.error(error);
          showToast(`Could not read ZIP file: ${file.name}`);
        }
      } else if (isSupported(file.name)) {
        const content = await file.text();
        state.files.set(normalizePath(file.webkitRelativePath || file.name), content);
        loaded++;
      }
    }
    if (!state.files.size) {
      showToast("No supported JavaScript files found. Use .js, .mjs, .cjs or a ZIP project.");
      return;
    }
    analyzeDependencies();
    populateTargetSelect();
    const firstPath = [...state.files.keys()].sort()[0];
    selectTarget(state.target && state.files.has(state.target) ? state.target : firstPath);
    clearResults();
    showToast(`${loaded} file${loaded === 1 ? "" : "s"} loaded. Select a target and analyze.`);
  }

  function loadSample() {
    state.files = new Map(Object.entries(sampleFiles));
    state.report = null;
    analyzeDependencies();
    populateTargetSelect();
    selectTarget("src/auth.js");
    clearResults();
    showToast("Sample project loaded. Try changing src/auth.js.");
  }

  function clearResults() {
    state.report = null;
    $("#resultsEmpty").classList.remove("hidden");
    $("#resultsContent").classList.add("hidden");
    $("#riskBadge").className = "risk-badge neutral";
    $("#riskBadge").textContent = "AWAITING ANALYSIS";
    $("#exportBtn").disabled = true;
    $("#statImpacted").textContent = "—";
    $("#statRisk").textContent = "—";
    if (state.cy) { state.cy.destroy(); state.cy = null; }
  }

  function getDependents(target) {
    const reverse = new Map();
    for (const [source, deps] of state.graph) {
      for (const dep of deps) {
        if (!reverse.has(dep)) reverse.set(dep, []);
        reverse.get(dep).push(source);
      }
    }
    const distances = new Map();
    const queue = [{ path: target, depth: 0 }];
    const visited = new Set([target]);
    while (queue.length) {
      const current = queue.shift();
      for (const dependent of (reverse.get(current.path) || [])) {
        if (visited.has(dependent)) continue;
        visited.add(dependent);
        distances.set(dependent, current.depth + 1);
        queue.push({ path: dependent, depth: current.depth + 1 });
      }
    }
    return [...distances.entries()].map(([path, depth]) => ({ path, depth })).sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  }

  function calculateRisk(target, impacted, before, after, description) {
    const changedLines = simpleDiff(before, after);
    let score = 12;
    score += Math.min(impacted.length * 16, 48);
    score += Math.min(changedLines.added + changedLines.removed, 20);
    if (/auth|login|permission|token|security|payment|delete/i.test(target + " " + description)) score += 20;
    if (/export\s+(?:async\s+)?function|export\s+class|module\.exports|export\s+default/.test(before) !== /export\s+(?:async\s+)?function|export\s+class|module\.exports|export\s+default/.test(after)) score += 12;
    score = Math.min(100, score);
    if (score >= 65) return { score, label: "HIGH", className: "high" };
    if (score >= 35) return { score, label: "MEDIUM", className: "medium" };
    return { score, label: "LOW", className: "low" };
  }

  function simpleDiff(before, after) {
    const oldLines = before.split(/\r?\n/);
    const newLines = after.split(/\r?\n/);
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    const removedLines = oldLines.filter((line) => !newSet.has(line));
    const addedLines = newLines.filter((line) => !oldSet.has(line));
    return { added: addedLines.length, removed: removedLines.length, addedLines, removedLines, oldLines, newLines };
  }

  function runAnalysis() {
    if (!state.files.size || !state.target) {
      showToast("Load a project and select a target file first.");
      return;
    }
    const target = state.target;
    const before = beforeCode.value;
    const after = afterCode.value;
    const description = $("#changeDescription").value.trim() || "Code change";
    const impacted = getDependents(target);
    const diff = simpleDiff(before, after);
    const risk = calculateRisk(target, impacted, before, after, description);
    state.report = {
      id: Date.now(), createdAt: new Date().toISOString(), target, description, before, after,
      impacted, diff, risk, fileCount: state.files.size,
      dependencyCount: [...state.graph.values()].reduce((sum, deps) => sum + deps.length, 0)
    };
    renderReport();
    const saved = {
      id: state.report.id, createdAt: state.report.createdAt, target, description,
      impactedCount: impacted.length, risk: risk.label, score: risk.score,
      fileCount: state.files.size, before, after, impacted
    };
    state.history.unshift(saved);
    state.history = state.history.slice(0, 20);
    saveHistory();
    showToast("Impact analysis complete.");
  }

  function renderReport() {
    const report = state.report;
    if (!report) return;
    $("#resultsEmpty").classList.add("hidden");
    $("#resultsContent").classList.remove("hidden");
    $("#riskBadge").className = `risk-badge ${report.risk.className}`;
    $("#riskBadge").textContent = `${report.risk.label} RISK · ${report.risk.score}/100`;
    $("#statImpacted").textContent = report.impacted.length;
    $("#statRisk").textContent = report.risk.label;
    $("#exportBtn").disabled = false;
    $("#resultSummary").innerHTML = `
      <div class="summary-cell"><small>CHANGE TARGET</small><strong title="${escapeHtml(report.target)}" style="font-size:12px;overflow-wrap:anywhere">${escapeHtml(report.target)}</strong><span>${escapeHtml(report.description)}</span></div>
      <div class="summary-cell"><small>DEPENDENTS FOUND</small><strong>${report.impacted.length}</strong><span>direct + transitive files</span></div>
      <div class="summary-cell"><small>RISK SCORE</small><strong>${report.risk.score}<span style="display:inline;font-size:10px"> / 100</span></strong><span>${report.risk.label.toLowerCase()} heuristic risk</span></div>`;
    renderGraph(report);
    renderImpactList(report);
    renderDiff(report);
  }

  function renderGraph(report) {
    const container = $("#dependencyGraph");
    if (state.cy) { state.cy.destroy(); state.cy = null; }
    if (!window.cytoscape) {
      container.innerHTML = '<div class="graph-fallback">Graph library unavailable. Reconnect to the internet and reload to render the map.</div>';
      return;
    }
    const nodes = [...state.files.keys()].map((path) => ({
      data: { id: path, label: path.split("/").pop(), fullPath: path },
      classes: path === report.target ? "target" : report.impacted.some((item) => item.path === path) ? "impacted" : "normal"
    }));
    const edges = [];
    for (const [source, deps] of state.graph) {
      for (const target of deps) edges.push({ data: { id: `${source}->${target}`, source, target } });
    }
    container.innerHTML = "";
    try {
      state.cy = cytoscape({
        container,
        elements: [...nodes, ...edges],
        style: [
          { selector: "node", style: { "background-color": "#5f6c82", "label": "data(label)", "color": "#e5eaf3", "font-family": "Manrope, sans-serif", "font-size": 10, "text-wrap": "ellipsis", "text-max-width": 115, "text-valign": "center", "text-halign": "center", "width": 30, "height": 30, "border-width": 1, "border-color": "#8290a8" } },
          { selector: "node.target", style: { "background-color": "#8b7cff", "border-color": "#c1baff", "border-width": 3, "width": 42, "height": 42, "font-weight": 700 } },
          { selector: "node.impacted", style: { "background-color": "#d99a51", "border-color": "#ffc982", "color": "#fff5e8", "width": 36, "height": 36 } },
          { selector: "edge", style: { "width": 1.4, "line-color": "#48556d", "target-arrow-color": "#65748e", "target-arrow-shape": "triangle", "curve-style": "bezier", "arrow-scale": .8 } },
          { selector: ":selected", style: { "border-width": 4, "border-color": "#fff" } }
        ],
        layout: { name: "cose", animate: false, padding: 35, nodeRepulsion: () => 5000, idealEdgeLength: () => 100 }
      });
      state.cy.on("tap", "node", (event) => {
        const path = event.target.data("fullPath");
        if (state.files.has(path)) {
          selectTarget(path);
          showToast(`Selected ${path}. Run analysis to update the report.`);
        }
      });
      state.cy.nodes().forEach((node) => node.qtip && node.qtip({ content: node.data("fullPath") }));
    } catch (error) {
      console.error(error);
      container.innerHTML = '<div class="graph-fallback">Could not render dependency graph for this project.</div>';
    }
  }

  function renderImpactList(report) {
    $("#impactCount").textContent = `${report.impacted.length} ${report.impacted.length === 1 ? "file" : "files"}`;
    const container = $("#impactList");
    if (!report.impacted.length) {
      container.innerHTML = '<div class="no-impact"><i class="bi bi-check-circle me-2"></i>No dependent files were detected for this target. This does not guarantee that no impact exists.</div>';
      return;
    }
    container.innerHTML = report.impacted.map(({ path, depth }) => `
      <div class="impact-row">
        <span class="impact-row-icon"><i class="bi bi-file-earmark-code"></i></span>
        <div class="impact-row-main"><strong>${escapeHtml(path)}</strong><small>${depth === 1 ? "Direct dependent" : `Indirect dependent · ${depth} dependency steps away`}</small></div>
        <span class="impact-level">${depth === 1 ? "DIRECT" : "INDIRECT"}</span>
      </div>`).join("");
  }

  function renderDiff(report) {
    const diff = report.diff;
    $("#diffSummary").innerHTML = `
      <span class="diff-chip added"><i class="bi bi-plus-lg me-1"></i>${diff.added} added</span>
      <span class="diff-chip removed"><i class="bi bi-dash-lg me-1"></i>${diff.removed} removed</span>
      <span class="diff-chip changed"><i class="bi bi-arrow-left-right me-1"></i>${diff.added + diff.removed} changed lines</span>`;
    const lines = [];
    const max = 120;
    diff.removedLines.slice(0, max).forEach((line, index) => lines.push({ type: "remove", number: index + 1, text: `− ${line}` }));
    diff.addedLines.slice(0, max).forEach((line, index) => lines.push({ type: "add", number: index + 1, text: `+ ${line}` }));
    if (!lines.length) {
      $("#diffSummary").insertAdjacentHTML("beforeend", '<span class="diff-chip">No text differences detected</span>');
      $("#diffPreview")?.remove();
      $("#diffSummary").insertAdjacentHTML("afterend", '<div class="diff-preview" id="diffPreview"><div class="diff-line context"><span class="line-number">—</span><span>No changes detected.</span></div></div>');
      return;
    }
    const preview = `<div class="diff-preview" id="diffPreview">${lines.map((line) => `<div class="diff-line ${line.type}"><span class="line-number">${line.number}</span><span>${escapeHtml(line.text)}</span></div>`).join("")}${diff.addedLines.length + diff.removedLines.length > max * 2 ? '<div class="diff-line context"><span class="line-number">…</span><span>Preview truncated</span></div>' : ""}</div>`;
    $("#diffPreview")?.remove();
    $("#diffSummary").insertAdjacentHTML("afterend", preview);
  }

  function buildReportText(report) {
    return [
      "CODEIMPACT — CHANGE IMPACT REPORT",
      "================================",
      `Generated: ${new Date(report.createdAt).toLocaleString()}`,
      `Target file: ${report.target}`,
      `Change description: ${report.description}`,
      `Files analyzed: ${report.fileCount}`,
      `Local dependencies: ${report.dependencyCount}`,
      `Potentially impacted files: ${report.impacted.length}`,
      `Heuristic risk: ${report.risk.label} (${report.risk.score}/100)`,
      "",
      "POTENTIALLY IMPACTED FILES",
      "-------------------------",
      ...(report.impacted.length ? report.impacted.map((item) => `- ${item.path} (${item.depth === 1 ? "direct" : `indirect, depth ${item.depth}`})`) : ["No dependents detected."]),
      "",
      "CHANGE SUMMARY",
      "--------------",
      `Added lines (approx.): ${report.diff.added}`,
      `Removed lines (approx.): ${report.diff.removed}`,
      "",
      "PROPOSED CODE",
      "-------------",
      report.after,
      "",
      "LIMITATIONS",
      "-----------",
      "This report is based on basic import detection, text comparison, and heuristic scoring. It is not a guarantee of program correctness or safety."
    ].join("\n");
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([buildReportText(state.report)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `codeimpact-report-${Date.now()}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("Report export started.");
  }

  function renderHistory() {
    const container = $("#historyList");
    $("#historyCount").textContent = state.history.length;
    if (!state.history.length) {
      container.innerHTML = '<div class="empty-state history-empty"><i class="bi bi-clock-history"></i><span>No saved analyses yet</span><small>Completed reports will appear here.</small></div>';
      return;
    }
    container.innerHTML = state.history.map((item) => `
      <div class="history-item">
        <span class="history-item-icon"><i class="bi bi-file-earmark-bar-graph"></i></span>
        <div class="history-item-main"><strong>${escapeHtml(item.target)}</strong><small>${escapeHtml(item.description)} · ${new Date(item.createdAt).toLocaleString()} · ${item.impactedCount} impacted · ${item.risk} risk</small></div>
        <button class="btn btn-dark-outline" data-history-id="${item.id}">Load report</button>
      </div>`).join("");
    container.querySelectorAll("[data-history-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = state.history.find((entry) => String(entry.id) === button.dataset.historyId);
        if (!item) return;
        if (!state.files.has(item.target)) {
          showToast("That report's source files are not loaded. Load the project first.");
          return;
        }
        state.target = item.target;
        targetSelect.value = item.target;
        beforeCode.value = item.before || state.files.get(item.target);
        afterCode.value = item.after || beforeCode.value;
        $("#changeDescription").value = item.description || "";
        updateLineCounts();
        const impacted = item.impacted || getDependents(item.target);
        const diff = simpleDiff(beforeCode.value, afterCode.value);
        state.report = {
          ...item, before: beforeCode.value, after: afterCode.value, impacted, diff,
          risk: { label: item.risk, score: item.score, className: String(item.risk).toLowerCase() },
          dependencyCount: [...state.graph.values()].reduce((sum, deps) => sum + deps.length, 0)
        };
        switchView("analyzer");
        renderFileList();
        renderReport();
        $("#resultsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function switchView(view) {
    const isHistory = view === "history";
    $("#analyzerView").classList.toggle("active-view", !isHistory);
    $("#historyView").classList.toggle("active-view", isHistory);
    $("#breadcrumbCurrent").textContent = isHistory ? "Analysis History" : "Impact Analyzer";
    document.querySelectorAll(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    if (isHistory) renderHistory();
  }

  // Profile details: this listener is registered at startup, so Profile works immediately.
  const profileModalElement = $("#profileModal");
  const profileModal = profileModalElement && window.bootstrap ? new bootstrap.Modal(profileModalElement) : null;
  const profileStorageKey = "codeimpact-profile";
  function loadProfileDetails() {
    let profile = {};
    try { profile = JSON.parse(localStorage.getItem(profileStorageKey) || "{}"); } catch (_) {}
    $("#profileName").value = profile.name || "";
    $("#profileNumber").value = profile.number || "";
    $("#profileCompany").value = profile.company || "";
  }
  $("#profileBtn")?.addEventListener("click", () => {
    loadProfileDetails();
    if (profileModal) profileModal.show();
    else showToast("Profile modal could not open. Please check the Bootstrap connection.");
  });
  $("#profileForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const profile = {
      name: $("#profileName").value.trim(),
      number: $("#profileNumber").value.trim(),
      company: $("#profileCompany").value.trim()
    };
    try { localStorage.setItem(profileStorageKey, JSON.stringify(profile)); }
    catch (_) { showToast("Could not save profile in this browser."); return; }
    if (profileModal) profileModal.hide();
    showToast("Profile information saved.");
  });
  $("#logoutBtn")?.addEventListener("click", () => {
    if (!confirm("Log out of this demo profile? Your saved profile details will be cleared.")) return;
    try { localStorage.removeItem(profileStorageKey); } catch (_) {}
    if (profileModal) profileModal.hide();
    loadProfileDetails();
    showToast("You have logged out of the demo profile.");
  });

  fileInput.addEventListener("change", (event) => loadFiles(event.target.files));
  targetSelect.addEventListener("change", () => selectTarget(targetSelect.value));
  beforeCode.addEventListener("input", updateLineCounts);
  afterCode.addEventListener("input", updateLineCounts);
  $("#analyzeBtn").addEventListener("click", () => {
    if (!state.files.size) { showToast("Load files or try the sample project first."); return; }
    // Rebuild dependency graph from the current in-memory project.
    analyzeDependencies();
    runAnalysis();
  });
  $("#impactBtn").addEventListener("click", runAnalysis);
  $("#exportBtn").addEventListener("click", exportReport);
  ["#sampleBtn", "#sampleBtn2", "#resultsSampleBtn", "#loadSampleNav"].forEach((selector) => $(selector).addEventListener("click", loadSample));
  $("#clearBtn").addEventListener("click", () => {
    state.files.clear(); state.graph.clear(); state.target = "";
    populateTargetSelect(); renderFileList(); clearResults();
    beforeCode.value = ""; afterCode.value = ""; $("#changeDescription").value = "";
    updateLineCounts(); fileInput.value = "";
    showToast("Workspace reset.");
  });
  document.querySelectorAll(".nav-item[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#clearHistoryBtn").addEventListener("click", () => {
    if (!state.history.length) return;
    if (confirm("Clear all saved analysis history from this browser?")) {
      state.history = []; saveHistory(); showToast("Analysis history cleared.");
    }
  });
  $("#helpBtn").addEventListener("click", () => {
    if (window.bootstrap) new bootstrap.Modal($("#helpModal")).show();
    else showToast("CodeImpact estimates impact using basic imports and text differences.");
  });
  dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("drag-over"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault(); dropZone.classList.remove("drag-over");
    loadFiles(event.dataTransfer.files);
  });

  renderFileList();
  renderHistory();
  populateTargetSelect();
  updateLineCounts();
  setStats();
})();

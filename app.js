const state = {
  videos: [],
  copyBlocks: [],
  rows: []
};

const els = {
  folderInput: document.querySelector("#folderInput"),
  videoInput: document.querySelector("#videoInput"),
  copyInput: document.querySelector("#copyInput"),
  manualCopy: document.querySelector("#manualCopy"),
  matchMode: document.querySelector("#matchMode"),
  scheduleStartDate: document.querySelector("#scheduleStartDate"),
  weekdayGrid: document.querySelector("#weekdayGrid"),
  timeSlots: document.querySelector("#timeSlots"),
  matchButton: document.querySelector("#matchButton"),
  videoCount: document.querySelector("#videoCount"),
  copyCount: document.querySelector("#copyCount"),
  readyCount: document.querySelector("#readyCount"),
  selectedVideoSummary: document.querySelector("#selectedVideoSummary"),
  selectedVideoList: document.querySelector("#selectedVideoList"),
  copySummary: document.querySelector("#copySummary"),
  copyBlockList: document.querySelector("#copyBlockList"),
  publishRows: document.querySelector("#publishRows"),
  hintText: document.querySelector("#hintText"),
  batchStartDate: document.querySelector("#batchStartDate"),
  applyBatchTime: document.querySelector("#applyBatchTime"),
  batchFb: document.querySelector("#batchFb"),
  batchIg: document.querySelector("#batchIg"),
  applyPlatforms: document.querySelector("#applyPlatforms"),
  exportCsv: document.querySelector("#exportCsv"),
  exportJson: document.querySelector("#exportJson"),
  connectMeta: document.querySelector("#connectMeta"),
  loadAccounts: document.querySelector("#loadAccounts"),
  connectorUrl: document.querySelector("#connectorUrl"),
  graphVersion: document.querySelector("#graphVersion"),
  pageAccounts: document.querySelector("#pageAccounts"),
  igAccounts: document.querySelector("#igAccounts"),
  openBusinessSuite: document.querySelector("#openBusinessSuite"),
  sendConnector: document.querySelector("#sendConnector"),
  connectorStatus: document.querySelector("#connectorStatus"),
  clearAll: document.querySelector("#clearAll")
};

setInitialDates();
render();
refreshMetaStatus();

els.folderInput.addEventListener("change", () => loadVideosFromFiles(els.folderInput.files));
els.videoInput.addEventListener("change", () => loadVideosFromFiles(els.videoInput.files));

els.copyInput.addEventListener("change", async () => {
  const file = els.copyInput.files[0];
  if (!file) return;

  if (/\.(xls|xlsx)$/i.test(file.name)) {
    state.copyBlocks = await parseOfficeFile(file);
    render();
    return;
  }

  if (/\.(doc|docx)$/i.test(file.name)) {
    state.copyBlocks = [];
    els.hintText.textContent = "Word 檔請先另存成 txt；Excel 已可透過本機串接端解析。";
    render();
    return;
  }

  const text = await file.text();
  state.copyBlocks = splitCopyBlocks(normalizeCopySource(text, file.name));
  render();
});

els.manualCopy.addEventListener("input", () => {
  state.copyBlocks = splitCopyBlocks(els.manualCopy.value);
  render();
});

els.matchButton.addEventListener("click", () => {
  state.rows = buildRows();
  render();
});

els.applyBatchTime.addEventListener("click", () => {
  const schedule = buildScheduleSlots(state.rows.length, els.batchStartDate.value || els.scheduleStartDate.value);
  state.rows = state.rows.map((row, index) => ({ ...row, scheduledAt: schedule[index] || row.scheduledAt }));
  render();
});

els.applyPlatforms.addEventListener("click", () => {
  const defaultPage = getAccounts("page")[0]?.id || "";
  const defaultIg = getAccounts("ig")[0]?.id || "";
  state.rows = state.rows.map((row) => ({
    ...row,
    facebook: els.batchFb.checked,
    instagram: els.batchIg.checked,
    facebookPageId: defaultPage || row.facebookPageId,
    instagramBusinessAccountId: defaultIg || row.instagramBusinessAccountId
  }));
  render();
});

[els.pageAccounts, els.igAccounts].forEach((input) => {
  input.addEventListener("input", () => renderRows());
});

els.connectMeta.addEventListener("click", () => {
  window.open("http://127.0.0.1:8812/api/meta/oauth/start", "_blank", "noopener");
});

els.loadAccounts.addEventListener("click", loadMetaAccounts);

els.openBusinessSuite.addEventListener("click", () => {
  window.open("https://business.facebook.com/latest/composer", "_blank", "noopener");
});

els.exportCsv.addEventListener("click", () => {
  if (!state.rows.length) return;
  downloadFile("text/csv;charset=utf-8", "\ufeff" + toCsv(state.rows), `meta-publish-plan-${todayKey()}.csv`);
});

els.exportJson.addEventListener("click", () => {
  if (!state.rows.length) return;
  downloadFile("application/json;charset=utf-8", JSON.stringify(buildApiPayload(), null, 2), `meta-api-payload-${todayKey()}.json`);
});

els.sendConnector.addEventListener("click", async () => {
  if (!state.rows.length) {
    setConnectorStatus("請先建立配對清單。", "error");
    return;
  }

  try {
    setConnectorStatus("送出中...", "");
    const response = await fetch(els.connectorUrl.value, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildApiPayload())
    });
    const text = await response.text();
    setConnectorStatus(response.ok ? `已送出：${response.status}` : `串接端回應錯誤：${response.status} ${text}`, response.ok ? "ok" : "error");
  } catch (error) {
    setConnectorStatus(`無法連線到本機串接端：${error.message}`, "error");
  }
});

els.clearAll.addEventListener("click", () => {
  state.videos = [];
  state.copyBlocks = [];
  state.rows = [];
  els.folderInput.value = "";
  els.videoInput.value = "";
  els.copyInput.value = "";
  els.manualCopy.value = "";
  setConnectorStatus("尚未送出", "");
  render();
});

async function refreshMetaStatus() {
  try {
    const response = await fetch("http://127.0.0.1:8812/api/meta/status");
    const status = await response.json();
    els.graphVersion.value = status.graphVersion || "v24.0";
    if (!status.configured) {
      setConnectorStatus("請先建立 meta_config.json 並填入 App ID / App Secret。", "error");
    } else if (!status.hasToken) {
      setConnectorStatus("Meta App 已設定，請按「連接 Meta 開發者 App」完成授權。", "");
    } else {
      setConnectorStatus("Meta 已授權，可載入粉專與 IG 帳號。", "ok");
    }
  } catch {
    setConnectorStatus("請先啟動本機串接端。", "error");
  }
}

async function loadMetaAccounts() {
  try {
    setConnectorStatus("載入帳號中...", "");
    const response = await fetch("http://127.0.0.1:8812/api/meta/accounts");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "載入失敗");
    els.pageAccounts.value = payload.pages.map((page) => `${page.name} | ${page.id}`).join("\n");
    els.igAccounts.value = payload.instagramAccounts.map((ig) => `${ig.name} | ${ig.id}`).join("\n");
    setConnectorStatus(`已載入 ${payload.pages.length} 個粉專、${payload.instagramAccounts.length} 個 IG 帳號。`, "ok");
    renderRows();
  } catch (error) {
    setConnectorStatus(`載入帳號失敗：${error.message}`, "error");
  }
}

function loadVideosFromFiles(files) {
  state.videos = Array.from(files)
    .filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name))
    .sort((a, b) => naturalSort(getDisplayPath(a), getDisplayPath(b)));
  render();
}

function buildRows() {
  const schedule = buildScheduleSlots(state.videos.length, els.scheduleStartDate.value);
  const usedCopyIndexes = new Set();
  const defaultPage = getAccounts("page")[0]?.id || "";
  const defaultIg = getAccounts("ig")[0]?.id || "";

  return state.videos.map((video, index) => {
    const match = findBestCopyMatch(video, index, usedCopyIndexes);
    if (match.index >= 0) usedCopyIndexes.add(match.index);
    const copyBlock = state.copyBlocks[match.index];
    return {
      id: `${video.name}-${video.size}-${index}`,
      videoName: video.name,
      videoPath: getDisplayPath(video),
      videoSize: video.size,
      scheduledAt: copyBlock?.scheduledAt || schedule[index] || "",
      facebook: true,
      instagram: true,
      facebookPageId: defaultPage,
      instagramBusinessAccountId: defaultIg,
      copy: copyBlock?.text || "",
      copyTitle: copyBlock?.title || "",
      matchScore: match.score,
      matchReason: match.reason
    };
  });
}

function findBestCopyMatch(video, index, usedCopyIndexes) {
  if (!state.copyBlocks.length) return { index: -1, score: 0, reason: "無文案" };
  if (els.matchMode.value === "order") {
    return { index: index < state.copyBlocks.length ? index : -1, score: 1, reason: "依序配對" };
  }

  const tokens = tokenize(`${video.name} ${getDisplayPath(video)}`);
  let best = { index: -1, score: -1, reason: "未命中" };
  state.copyBlocks.forEach((block, blockIndex) => {
    if (usedCopyIndexes.has(blockIndex)) return;
    let score = 0;
    const lowerRaw = block.raw.toLowerCase();
    const lowerTitle = block.title.toLowerCase();
    tokens.forEach((token) => {
      if (lowerTitle.includes(token)) score += 8;
      if (lowerRaw.includes(token)) score += 3;
    });
    const videoNumber = getFirstNumber(video.name);
    const blockNumber = getFirstNumber(block.title || block.raw);
    if (videoNumber && blockNumber && videoNumber === blockNumber) score += 12;
    if (blockIndex === index && els.matchMode.value === "smart") score += 2;
    if (score > best.score) {
      best = { index: blockIndex, score, reason: score > 0 ? `智慧配對分數 ${score}` : "依序備援" };
    }
  });

  if (best.score <= 0 && els.matchMode.value === "filename") return { index: -1, score: 0, reason: "檔名無命中" };
  if (best.index < 0 && index < state.copyBlocks.length) return { index, score: 1, reason: "依序備援" };
  return best;
}

function buildScheduleSlots(total, startDateValue) {
  const weekdays = Array.from(els.weekdayGrid.querySelectorAll("input:checked")).map((input) => Number(input.value));
  const times = parseTimeSlots(els.timeSlots.value);
  const slots = [];
  if (!startDateValue || !weekdays.length || !times.length) return slots;

  const cursor = new Date(`${startDateValue}T00:00:00`);
  let guard = 0;
  while (slots.length < total && guard < 750) {
    if (weekdays.includes(cursor.getDay())) {
      times.forEach((time) => {
        if (slots.length < total) slots.push(`${toDateKey(cursor)}T${time}`);
      });
    }
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return slots;
}

function parseTimeSlots(value) {
  return value
    .split(/[,\n，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return null;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (hour > 23 || minute > 59) return null;
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    })
    .filter(Boolean)
    .sort();
}

async function parseOfficeFile(file) {
  const form = new FormData();
  form.append("file", file);
  try {
    const response = await fetch("http://127.0.0.1:8812/api/captions/parse", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "解析失敗");
    els.hintText.textContent = `已從 ${file.name} 匯入 ${payload.blocks.length} 段文案。`;
    return payload.blocks.map((block, index) => ({
      title: block.title || `文案 ${index + 1}`,
      text: block.text || "",
      raw: block.raw || "",
      tokens: tokenize(`${block.title || ""} ${block.raw || ""}`),
      source: "xlsx",
      sourceItem: block.sourceItem || "",
      scheduledAt: block.scheduledAt || "",
      sheet: block.sheet || "",
      sourceRow: block.sourceRow || ""
    }));
  } catch (error) {
    els.hintText.textContent = `Excel 需要先啟動本機串接端才能解析：${error.message}`;
    return [];
  }
}

function normalizeCopySource(text, fileName) {
  if (/\.(html|htm)$/i.test(fileName)) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    doc.querySelectorAll("p, div, li, h1, h2, h3").forEach((node) => node.append("\n"));
    return doc.body.textContent || "";
  }
  if (/\.csv$/i.test(fileName)) {
    return text.split(/\r?\n/).map((line) => parseCsvLine(line).filter(Boolean).join("\n")).join("\n\n");
  }
  return text;
}

function splitCopyBlocks(text) {
  return text
    .replace(/\r/g, "")
    .split(/\n\s*(?:---+|###|={3,}|第\s*\d+\s*[段則支篇]?|\d+[.)、])\s*/g)
    .map((raw, index) => createCopyBlock(raw, index))
    .filter((block) => block.text || block.title);
}

function createCopyBlock(raw, index) {
  const clean = raw.trim();
  const lines = clean.split("\n").map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] || `文案 ${index + 1}`;
  const titleLooksLikeCaption = firstLine.length > 42 || /[，。！？,.!?]/.test(firstLine);
  const title = titleLooksLikeCaption ? `文案 ${index + 1}` : firstLine;
  const text = titleLooksLikeCaption ? clean : lines.slice(1).join("\n") || clean;
  return { title, text, raw: clean, tokens: tokenize(`${title} ${clean}`), source: "copy" };
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function buildApiPayload() {
  return {
    graphVersion: els.graphVersion.value.trim(),
    items: state.rows.map((row, index) => ({
      sequence: index + 1,
      localVideoPath: row.videoPath,
      videoName: row.videoName,
      scheduledAt: row.scheduledAt,
      caption: row.copy,
      facebookPageId: row.facebookPageId,
      instagramBusinessAccountId: row.instagramBusinessAccountId,
      platforms: { facebook: row.facebook, instagram: row.instagram },
      match: { title: row.copyTitle, score: row.matchScore, reason: row.matchReason }
    }))
  };
}

function setInitialDates() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  els.scheduleStartDate.value = toDateKey(tomorrow);
  els.batchStartDate.value = toDateKey(tomorrow);
}

function render() {
  els.videoCount.textContent = state.videos.length;
  els.copyCount.textContent = state.copyBlocks.length;
  els.readyCount.textContent = state.rows.filter((row) => row.copy && row.scheduledAt && (row.facebook || row.instagram)).length;
  renderSelectedVideos();
  renderCopyBlocks();
  renderRows();
}

function renderSelectedVideos() {
  els.selectedVideoSummary.textContent = state.videos.length ? `${state.videos.length} 支影片` : "尚未選擇";
  els.selectedVideoList.innerHTML = state.videos.length
    ? state.videos.map((video) => `<li>${escapeHtml(getDisplayPath(video))} <span class="video-meta">${formatBytes(video.size)}</span></li>`).join("")
    : `<li>選擇資料夾後會顯示影片清單。</li>`;
}

function renderCopyBlocks() {
  els.copySummary.textContent = state.copyBlocks.length ? `${state.copyBlocks.length} 段文案` : "尚未匯入";
  els.copyBlockList.innerHTML = state.copyBlocks.length
    ? state.copyBlocks.map((block) => `<li><strong>${escapeHtml(block.title)}</strong><span class="match-note">${escapeHtml(formatCopyBlockMeta(block))}</span><span class="match-note">${escapeHtml((block.text || "尚未解析內容").slice(0, 90))}</span></li>`).join("")
    : `<li>文案會依空白行、分隔線、標題或序號切成多段。</li>`;
}

function renderRows() {
  if (!state.rows.length) {
    els.publishRows.innerHTML = `<tr class="empty-row"><td colspan="7">尚未建立清單</td></tr>`;
    return;
  }
  const pageOptions = getAccounts("page");
  const igOptions = getAccounts("ig");
  els.hintText.textContent = "可逐筆修改時間、平台、帳號與文案。";
  els.publishRows.innerHTML = state.rows.map((row, index) => `
    <tr>
      <td><div class="video-name">${escapeHtml(row.videoName)}</div><span class="video-meta">${escapeHtml(row.videoPath)} · ${formatBytes(row.videoSize)}</span></td>
      <td><input type="datetime-local" value="${escapeHtml(row.scheduledAt)}" data-index="${index}" data-field="scheduledAt"></td>
      <td class="platform-cell">
        <label><input type="checkbox" ${row.facebook ? "checked" : ""} data-index="${index}" data-field="facebook"> FB</label>
        <label><input type="checkbox" ${row.instagram ? "checked" : ""} data-index="${index}" data-field="instagram"> IG</label>
      </td>
      <td>
        <label class="account-select-label">粉專<select data-index="${index}" data-field="facebookPageId">${renderAccountSelect(pageOptions, row.facebookPageId)}</select></label>
        <label class="account-select-label">IG<select data-index="${index}" data-field="instagramBusinessAccountId">${renderAccountSelect(igOptions, row.instagramBusinessAccountId)}</select></label>
      </td>
      <td><textarea class="copy-editor" data-index="${index}" data-field="copy">${escapeHtml(row.copy)}</textarea></td>
      <td><strong>${escapeHtml(row.copyTitle || "未配對")}</strong><span class="match-note">${escapeHtml(row.matchReason || "")}</span></td>
      <td><span class="status-pill ${row.copy && row.scheduledAt ? "" : "warn"}">${row.copy && row.scheduledAt ? "可發布" : "需補資料"}</span></td>
    </tr>
  `).join("");
  els.publishRows.querySelectorAll("input, textarea, select").forEach((control) => {
    control.addEventListener("input", updateRowFromControl);
    control.addEventListener("change", updateRowFromControl);
  });
}

function updateRowFromControl(event) {
  const index = Number(event.target.dataset.index);
  const field = event.target.dataset.field;
  const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  state.rows[index] = { ...state.rows[index], [field]: value };
  els.readyCount.textContent = state.rows.filter((row) => row.copy && row.scheduledAt && (row.facebook || row.instagram)).length;
}

function toCsv(rows) {
  const headers = ["video_path", "video_name", "scheduled_at", "facebook", "instagram", "facebook_page_id", "instagram_business_account_id", "caption", "match_title", "match_score", "status"];
  const lines = rows.map((row) => [
    row.videoPath,
    row.videoName,
    row.scheduledAt,
    row.facebook ? "yes" : "no",
    row.instagram ? "yes" : "no",
    row.facebookPageId,
    row.instagramBusinessAccountId,
    row.copy,
    row.copyTitle,
    row.matchScore,
    row.copy && row.scheduledAt ? "ready" : "needs_review"
  ]);
  return [headers, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
}

function getAccounts(type) {
  const source = type === "page" ? els.pageAccounts.value : els.igAccounts.value;
  return source.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, id] = line.split("|").map((part) => part.trim());
    return { name: name || id || line, id: id || name || line };
  });
}

function renderAccountSelect(accounts, selectedId) {
  return [`<option value="">未指定</option>`].concat(
    accounts.map((account) => `<option value="${escapeHtml(account.id)}" ${account.id === selectedId ? "selected" : ""}>${escapeHtml(account.name)} (${escapeHtml(account.id)})</option>`)
  ).join("");
}

function formatCopyBlockMeta(block) {
  const parts = [];
  if (block.sheet) parts.push(block.sheet);
  if (block.sourceRow) parts.push(`第 ${block.sourceRow} 列`);
  if (block.sourceItem) parts.push(`項次 ${block.sourceItem}`);
  if (block.scheduledAt) parts.push(`原排程 ${block.scheduledAt.replace("T", " ")}`);
  return parts.join(" · ");
}

function downloadFile(type, content, fileName) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function setConnectorStatus(message, mode) {
  els.connectorStatus.textContent = message;
  els.connectorStatus.className = `connector-status ${mode || ""}`.trim();
}

function tokenize(value) {
  return String(value).toLowerCase().replace(/\.[^.]+$/, "").split(/[^a-z0-9\u4e00-\u9fff]+/i).filter((token) => token.length >= 2);
}

function getFirstNumber(value) {
  return String(value).match(/\d+/)?.[0] || "";
}

function naturalSort(a, b) {
  return a.localeCompare(b, "zh-Hant", { numeric: true, sensitivity: "base" });
}

function getDisplayPath(file) {
  return file.webkitRelativePath || file.name;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex ? 1 : 0)} ${units[unitIndex]}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function toDateKey(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

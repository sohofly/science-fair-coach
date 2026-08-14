(function () {
  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const inline = (value = "") => escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  function renderTable(lines) {
    const rows = lines.map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
    if (rows.length < 2 || !rows[1].every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
    const head = `<thead><tr>${rows[0].map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>`;
    const body = rows.slice(2).map((row) => `<tr>${row.map((cell, index) => `<td${index === 1 ? ' class="coach-judgement"' : ""}>${inline(cell)}</td>`).join("")}</tr>`).join("");
    return `<div class="coach-table-wrap"><table>${head}<tbody>${body}</tbody></table></div>`;
  }

  function renderCoachResponse(value = "") {
    let source = String(value || "").trim();
    try { const parsed = JSON.parse(source); if (typeof parsed === "string") source = parsed; } catch {}
    // Some API/client combinations return Markdown with escaped line breaks.
    // Normalize them before parsing so a newly received reply renders exactly
    // like the same reply loaded from history.
    if (!source.includes("\n") && source.includes("\\n")) source = source.replace(/\\r\\n|\\n|\\r/g, "\n");
    if (!/^#\s+AI 教練回覆\s*$/m.test(source)) source = `# AI 教練回覆\n\n${source}`;
    if (!source) return "";
    const lines = source.replace(/\r\n?/g, "\n").split("\n"), html = [];
    for (let index = 0; index < lines.length;) {
      const line = lines[index].trim();
      if (!line) { index += 1; continue; }
      if (/^\|.*\|$/.test(line)) {
        const tableLines = [];
        while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) tableLines.push(lines[index++]);
        const table = renderTable(tableLines);
        if (table) html.push(table); else tableLines.forEach((row) => html.push(`<p>${inline(row)}</p>`));
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const level = Math.min(heading[1].length + 2, 5), title = heading[2].trim();
        const kind = /下一步/.test(title) ? " coach-heading-next" : /限制|注意|待確認|需修正|問題/.test(title) ? " coach-heading-alert" : heading[1].length === 1 ? " coach-heading-main" : " coach-heading-section";
        html.push(`<h${level} class="${kind.trim()}">${inline(title)}</h${level}>`); index += 1; continue;
      }
      if (/^>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ""));
        html.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`); continue;
      }
      if (/^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
        const ordered = /^\d+[.)]\s+/.test(line), items = [], pattern = ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/;
        while (index < lines.length && pattern.test(lines[index].trim())) items.push(lines[index++].trim().replace(pattern, ""));
        const tag = ordered ? "ol" : "ul";
        html.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`); continue;
      }
      const paragraph = [line]; index += 1;
      while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+|^\|.*\|$|^>\s?|^[-*]\s+|^\d+[.)]\s+/.test(lines[index].trim())) paragraph.push(lines[index++].trim());
      html.push(`<p>${inline(paragraph.join(" "))}</p>`);
    }
    return html.join("");
  }
  window.renderCoachResponse = renderCoachResponse;
})();

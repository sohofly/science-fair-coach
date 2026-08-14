(function () {
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

  function render(record = {}) {
    const id = record.id || record.record_id;
    const name = record.fileName || record.file_name;
    const mime = record.mimeType || record.mime_type || "application/octet-stream";
    if (!id || !name) return "";
    const previewable = mime.startsWith("image/") || mime === "application/pdf";
    const autoPreview = mime.startsWith("image/");
    return `<section class="record-attachment" data-attachment-id="${esc(id)}" data-attachment-name="${esc(name)}" data-attachment-mime="${esc(mime)}"${autoPreview ? " data-auto-preview" : ""}><div class="attachment-head"><div><strong>📎 上傳附件</strong><span>${esc(name)}</span></div><div class="attachment-actions">${previewable ? `<button class="secondary" type="button" data-attachment-preview>${autoPreview ? "隱藏預覽" : "顯示預覽"}</button>` : ""}<button class="secondary" type="button" data-attachment-download>下載檔案</button></div></div>${previewable ? `<div class="attachment-preview"${autoPreview ? "" : " hidden"}><p>正在載入預覽……</p></div>` : ""}</section>`;
  }

  function authHeaders() {
    if (location.pathname.endsWith("admin.html")) return { "x-admin-token": localStorage.getItem("sfcAdminToken") || "" };
    if (location.pathname.endsWith("portal.html")) return { "x-teacher-token": localStorage.getItem("sfcTeacherToken") || "" };
    return { "x-student-token": localStorage.getItem("sfcStudentToken") || "" };
  }

  async function fetchFile(container) {
    if (container._attachmentBlob) return container._attachmentBlob;
    const response = await fetch(`${window.SFC_CONFIG?.apiUrl || ""}/record-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ recordId: container.dataset.attachmentId }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "附件載入失敗");
    }
    container._attachmentBlob = await response.blob();
    return container._attachmentBlob;
  }

  async function showPreview(container) {
    const preview = container.querySelector(".attachment-preview");
    if (!preview) return;
    preview.hidden = false;
    if (preview.dataset.loaded === "true") return;
    preview.innerHTML = "<p>正在載入預覽……</p>";
    try {
      const blob = await fetchFile(container);
      const url = URL.createObjectURL(blob);
      preview.dataset.loaded = "true";
      preview.dataset.objectUrl = url;
      preview.innerHTML = container.dataset.attachmentMime.startsWith("image/")
        ? `<img src="${url}" alt="${esc(container.dataset.attachmentName)} 的附件預覽" loading="lazy">`
        : `<iframe src="${url}" title="${esc(container.dataset.attachmentName)} 的 PDF 預覽"></iframe>`;
    } catch (error) {
      preview.innerHTML = `<p class="attachment-error">${esc(error.message)}</p>`;
    }
  }

  document.addEventListener("click", async (event) => {
    const previewButton = event.target.closest("[data-attachment-preview]");
    if (previewButton) {
      const container = previewButton.closest("[data-attachment-id]");
      const preview = container.querySelector(".attachment-preview");
      if (!preview.hidden && preview.dataset.loaded === "true") {
        preview.hidden = true;
        previewButton.textContent = "顯示預覽";
      } else {
        previewButton.disabled = true;
        await showPreview(container);
        previewButton.disabled = false;
        previewButton.textContent = "隱藏預覽";
      }
      return;
    }
    const downloadButton = event.target.closest("[data-attachment-download]");
    if (!downloadButton) return;
    const container = downloadButton.closest("[data-attachment-id]");
    downloadButton.disabled = true;
    const oldText = downloadButton.textContent;
    downloadButton.textContent = "準備下載……";
    try {
      const blob = await fetchFile(container);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = container.dataset.attachmentName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      alert(error.message);
    } finally {
      downloadButton.disabled = false;
      downloadButton.textContent = oldText;
    }
  });

  function scan(root = document) {
    const containers = root.matches?.("[data-auto-preview]")
      ? [root]
      : [...(root.querySelectorAll?.("[data-auto-preview]") || [])];
    for (const container of containers) {
      if (container.dataset.autoLoading) continue;
      container.dataset.autoLoading = "true";
      showPreview(container);
    }
  }
  const observer = new MutationObserver((changes) => {
    for (const change of changes) {
      for (const node of change.addedNodes) if (node.nodeType === 1) scan(node);
      for (const node of change.removedNodes) {
        if (node.nodeType !== 1) continue;
        const previews = node.matches?.(".attachment-preview")
          ? [node]
          : [...(node.querySelectorAll?.(".attachment-preview") || [])];
        for (const preview of previews)
          if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();

  window.SFCAttachments = { render, showPreview };
})();

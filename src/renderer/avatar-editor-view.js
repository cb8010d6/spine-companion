import { h } from "./lib/dom.js";
import { addLayer, issueFieldId, moveLayer, normalizeAvatarManifest, removeLayer, setMotion, updateLayer } from "./avatar-editor-model.js";

const STATES = ["idle", "working", "reviewing", "running", "success", "failed", "waiting", "sleeping", "reminder", "interact"];

export async function createAvatarEditor({ path, bridge, labels, onSaved }) {
  let manifest = normalizeAvatarManifest(await bridge.loadAvatarManifest(path));
  let selectedId = manifest.layers[0]?.id || "";
  let validation = await bridge.validateAvatarPack(path);
  const objectUrls = new Map();
  const root = h("div", { class: "avatar-editor" });

  async function assetUrl(file) {
    if (!file) return "";
    if (objectUrls.has(file)) return objectUrls.get(file);
    try {
      const result = await bridge.readAvatarAsset(path, file);
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: result.mime }));
      objectUrls.set(file, url);
      return url;
    } catch { return ""; }
  }

  async function renderEditor() {
    const selected = manifest.layers.find((layer) => layer.id === selectedId) || manifest.layers[0] || null;
    const selectedIndex = selected ? manifest.layers.findIndex((layer) => layer.id === selected.id) : -1;
    if (selected && !selectedId) selectedId = selected.id;
    const stage = h("canvas", { class: "avatar-compose-stage", width: 720, height: 480, role: "img", "aria-label": labels.preview });
    const drawnLayers = [];
    const context = stage.getContext("2d");
    context.clearRect(0, 0, stage.width, stage.height);
    for (const layer of [...manifest.layers].sort((a, b) => a.order - b.order)) {
      if (!layer.visible) continue;
      const url = await assetUrl(layer.file);
      if (!url) continue;
      const image = await loadImage(url);
      const crop = normalizedCrop(layer.crop, image.naturalWidth, image.naturalHeight);
      const width = crop.width * layer.scale.x;
      const height = crop.height * layer.scale.y;
      const x = stage.width / 2 + layer.offset.x - width * layer.anchor.x;
      const y = stage.height / 2 + layer.offset.y - height * layer.anchor.y;
      context.save();
      context.translate(stage.width / 2 + layer.offset.x, stage.height / 2 + layer.offset.y);
      context.scale(layer.scale.x, layer.scale.y);
      context.drawImage(image, crop.x, crop.y, crop.width, crop.height, -crop.width * layer.anchor.x, -crop.height * layer.anchor.y, crop.width, crop.height);
      context.restore();
      drawnLayers.push({ id: layer.id, x: Math.min(x, x + width), y: Math.min(y, y + height), width: Math.abs(width), height: Math.abs(height) });
      if (selected?.id === layer.id) {
        context.save();
        context.strokeStyle = "#62a8ff";
        context.lineWidth = 2;
        context.strokeRect(Math.min(x, x + width), Math.min(y, y + height), Math.abs(width), Math.abs(height));
        context.restore();
      }
    }
    stage.addEventListener("click", (event) => {
      const rect = stage.getBoundingClientRect();
      const x = (event.clientX - rect.left) * stage.width / rect.width;
      const y = (event.clientY - rect.top) * stage.height / rect.height;
      const hit = [...drawnLayers].reverse().find((item) => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height);
      if (hit) { selectedId = hit.id; renderEditor(); }
    });

    const layerRows = manifest.layers.map((layer) => h("div", { class: `avatar-layer-row${layer.id === selectedId ? " active" : ""}` },
      h("input", { type: "checkbox", checked: layer.visible, "aria-label": labels.visible, onChange: (event) => { manifest = updateLayer(manifest, layer.id, { visible: event.target.checked }); renderEditor(); } }),
      h("button", { class: "avatar-layer-select", type: "button", onClick: () => { selectedId = layer.id; renderEditor(); } }, layer.name || layer.id),
      h("button", { class: "icon-btn", type: "button", title: labels.up, onClick: () => { manifest = moveLayer(manifest, layer.id, -1); renderEditor(); } }, "↑"),
      h("button", { class: "icon-btn", type: "button", title: labels.down, onClick: () => { manifest = moveLayer(manifest, layer.id, 1); renderEditor(); } }, "↓"),
      h("button", { class: "icon-btn danger", type: "button", title: labels.remove, onClick: () => { manifest = removeLayer(manifest, layer.id); selectedId = manifest.layers[0]?.id || ""; renderEditor(); } }, "×")
    ));

    const numberField = (label, group, key, step = "0.01") => h("label", { class: "avatar-number-field", id: issueFieldId(`layers[${selectedIndex}].${group}.${key}`) }, h("span", {}, label), h("input", {
      class: "input", type: "number", step, value: selected?.[group]?.[key] ?? 0,
      onInput: (event) => { manifest = updateLayer(manifest, selected.id, { [group]: { [key]: Number(event.target.value) } }); renderEditor(); }
    }));
    const inspector = selected ? h("div", { class: "avatar-inspector" },
      h("label", { id: issueFieldId(`layers[${selectedIndex}].name`) }, h("span", {}, labels.name), h("input", { class: "input", value: selected.name, onInput: (event) => { manifest = updateLayer(manifest, selected.id, { name: event.target.value }); } })),
      h("label", { id: issueFieldId(`layers[${selectedIndex}].file`) }, h("span", {}, labels.file), h("input", { class: "input", value: selected.file, onInput: (event) => { manifest = updateLayer(manifest, selected.id, { file: event.target.value }); } })),
      h("div", { class: "avatar-number-grid" },
        numberField(labels.anchorX, "anchor", "x"), numberField(labels.anchorY, "anchor", "y"),
        numberField(labels.offsetX, "offset", "x", "1"), numberField(labels.offsetY, "offset", "y", "1"),
        numberField(labels.scaleX, "scale", "x"), numberField(labels.scaleY, "scale", "y"),
        numberField(labels.cropX, "crop", "x", "1"), numberField(labels.cropY, "crop", "y", "1"),
        numberField(labels.cropWidth, "crop", "width", "1"), numberField(labels.cropHeight, "crop", "height", "1")
      )
    ) : h("p", { class: "empty-text" }, labels.noLayer);

    const issues = (validation?.issues || []).map((issue) => h("button", {
      class: `avatar-issue ${issue.severity}`, type: "button",
      onClick: () => {
        const field = document.getElementById(issueFieldId(issue.path));
        field?.scrollIntoView({ behavior: "smooth", block: "center" });
        (field?.matches?.("input, select, textarea") ? field : field?.querySelector?.("input, select, textarea"))?.focus();
      }
    }, h("strong", {}, issue.code), h("span", {}, issue.message), h("small", {}, issue.path)));

    root.replaceChildren(
      h("div", { class: "avatar-editor-toolbar" },
        h("button", { class: "btn", type: "button", onClick: async () => {
          const files = await bridge.pickAvatarLayerFiles();
          const imported = files.length ? await bridge.importAvatarLayers(path, files) : [];
          for (const file of imported) {
            const name = String(file).split(/[\\/]/).pop();
            manifest = addLayer(manifest, { name: name.replace(/\.[^.]+$/, ""), file });
          }
          renderEditor();
        } }, labels.addLayer),
        h("button", { class: "btn", type: "button", onClick: async () => { validation = await bridge.saveAvatarManifest(path, manifest); await onSaved?.(validation); renderEditor(); } }, labels.save),
        h("button", { class: "btn", type: "button", onClick: async () => { validation = await bridge.validateAvatarPack(path); renderEditor(); } }, labels.validate)
      ),
      h("div", { class: "avatar-editor-grid" },
        h("aside", { class: "avatar-layers" }, h("h4", {}, labels.layers), ...layerRows),
        h("div", { class: "avatar-preview-panel" }, stage),
        h("aside", { class: "avatar-properties" }, h("h4", {}, labels.properties), inspector)
      ),
      h("section", { class: "avatar-motion-editor" }, h("h4", {}, labels.motions),
        h("div", { class: "avatar-motion-grid" }, STATES.map((state) => h("label", { id: issueFieldId(`motions.${state}`) }, h("span", {}, state), h("input", {
          class: "input", value: manifest.motions[state] || "", placeholder: state,
          onInput: (event) => { manifest = setMotion(manifest, state, event.target.value); }
        }))))
      ),
      h("section", { class: "avatar-issues" }, h("h4", {}, `${labels.issues} (${issues.length})`), ...(issues.length ? issues : [h("p", { class: "status-ok" }, labels.noIssues)]))
    );
  }

  await renderEditor();
  root.cleanup = () => { for (const url of objectUrls.values()) URL.revokeObjectURL(url); };
  return root;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to decode avatar layer image."));
    image.src = url;
  });
}

export function normalizedCrop(crop, imageWidth, imageHeight) {
  if (!crop || crop.width <= 0 || crop.height <= 0) return { x: 0, y: 0, width: imageWidth, height: imageHeight };
  const x = Math.max(0, Math.min(imageWidth, crop.x));
  const y = Math.max(0, Math.min(imageHeight, crop.y));
  return {
    x,
    y,
    width: Math.max(0, Math.min(crop.width, imageWidth - x)),
    height: Math.max(0, Math.min(crop.height, imageHeight - y))
  };
}

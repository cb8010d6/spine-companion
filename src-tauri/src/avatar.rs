use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarPackInput {
    pub path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarValidation {
    pub ok: bool,
    pub path: String,
    pub id: String,
    pub name: String,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub has_preview: bool,
    pub has_layers_dir: bool,
    pub has_exports_dir: bool,
    pub has_runtime_export: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarImportResult {
    pub imported: bool,
    pub validation: AvatarValidation,
    pub registry_path: String,
}

pub fn requirements() -> Value {
    json!({
        "layout": ["avatar-pack.json", "preview.png", "layers/", "exports/"],
        "requiredManifestFields": ["id", "name", "source", "licenseNote"],
        "recommendedLayers": ["head", "hair_back", "body", "arm_left", "arm_right", "leg_left", "leg_right"],
        "motions": ["idle", "working", "reviewing", "running", "success", "failed", "waiting", "sleeping", "reminder", "interact"],
        "runtimeExports": [".skel", ".atlas", ".png"],
        "limits": "Without Spine Editor or another legal export path, Spine Companion can validate and manage an intermediate avatar pack but cannot claim a finished runtime rig."
    })
}

fn manifest_value(root: &Path) -> Result<Value, String> {
    let manifest = root.join("avatar-pack.json");
    let text = std::fs::read_to_string(&manifest)
        .map_err(|error| format!("Cannot read avatar-pack.json: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("Invalid avatar-pack.json: {error}"))
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub fn validate_pack(path: &Path) -> AvatarValidation {
    let root = path;
    let mut warnings = Vec::new();
    let mut errors = Vec::new();
    let mut id = String::new();
    let mut name = String::new();
    let manifest = match manifest_value(root) {
        Ok(value) => value,
        Err(error) => {
            errors.push(error);
            Value::Null
        }
    };
    if manifest.is_object() {
        id = string_field(&manifest, "id");
        name = string_field(&manifest, "name");
        for key in ["id", "name", "source", "licenseNote"] {
            if string_field(&manifest, key).is_empty() {
                errors.push(format!("Missing required manifest field: {key}"));
            }
        }
        if !manifest.get("layers").map(|value| value.is_array()).unwrap_or(false) {
            warnings.push("Manifest should include a layers array.".to_string());
        }
        if !manifest.get("motions").map(|value| value.is_object()).unwrap_or(false) {
            warnings.push("Manifest should include a motions mapping.".to_string());
        }
    }
    let has_preview = root.join("preview.png").exists();
    let has_layers_dir = root.join("layers").is_dir();
    let has_exports_dir = root.join("exports").is_dir();
    if !has_preview {
        errors.push("Missing preview.png".to_string());
    }
    if !has_layers_dir {
        errors.push("Missing layers/ directory".to_string());
    }
    let has_runtime_export = if has_exports_dir {
        let mut has_skel = false;
        let mut has_atlas = false;
        let mut has_png = false;
        if let Ok(entries) = std::fs::read_dir(root.join("exports")) {
            for entry in entries.flatten() {
                let ext = entry
                    .path()
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                has_skel |= ext == "skel";
                has_atlas |= ext == "atlas";
                has_png |= ext == "png";
            }
        }
        has_skel && has_atlas && has_png
    } else {
        false
    };
    if !has_exports_dir {
        warnings.push("Missing exports/ directory. Runtime import will not be available yet.".to_string());
    } else if !has_runtime_export {
        warnings.push("exports/ does not contain a complete .skel/.atlas/.png runtime set.".to_string());
    }
    AvatarValidation {
        ok: errors.is_empty(),
        path: root.to_string_lossy().to_string(),
        id,
        name,
        warnings,
        errors,
        has_preview,
        has_layers_dir,
        has_exports_dir,
        has_runtime_export,
    }
}

pub fn import_pack(path: &Path, config_dir: &Path) -> Result<AvatarImportResult, String> {
    let validation = validate_pack(path);
    if !validation.ok {
        return Err(format!("Avatar pack is invalid: {}", validation.errors.join("; ")));
    }
    let registry_path = config_dir.join("avatar-packs.json");
    if let Some(parent) = registry_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut items = std::fs::read_to_string(&registry_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<Value>>(&text).ok())
        .unwrap_or_default();
    items.retain(|item| item.get("id").and_then(|value| value.as_str()) != Some(validation.id.as_str()));
    items.push(json!({
        "id": validation.id,
        "name": validation.name,
        "path": validation.path,
        "hasRuntimeExport": validation.has_runtime_export
    }));
    std::fs::write(
        &registry_path,
        serde_json::to_string_pretty(&items).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(AvatarImportResult {
        imported: true,
        validation,
        registry_path: registry_path.to_string_lossy().to_string(),
    })
}

pub fn path_from_input(input: AvatarPackInput) -> PathBuf {
    PathBuf::from(input.path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_pack(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "spine-companion-avatar-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn invalid_pack_reports_missing_files() {
        let root = temp_pack("invalid");
        let result = validate_pack(&root);
        assert!(!result.ok);
        assert!(result.errors.iter().any(|item| item.contains("avatar-pack.json")));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn valid_minimal_pack_can_be_imported() {
        let root = temp_pack("valid");
        std::fs::write(
            root.join("avatar-pack.json"),
            r#"{"id":"test_avatar","name":"Test Avatar","source":"local","licenseNote":"User-owned","layers":[],"motions":{}}"#,
        )
        .unwrap();
        std::fs::write(root.join("preview.png"), []).unwrap();
        std::fs::create_dir_all(root.join("layers")).unwrap();
        let validation = validate_pack(&root);
        assert!(validation.ok);
        assert!(!validation.has_runtime_export);
        let registry = temp_pack("registry");
        let imported = import_pack(&root, &registry).unwrap();
        assert!(imported.imported);
        assert!(Path::new(&imported.registry_path).exists());
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(registry);
    }
}

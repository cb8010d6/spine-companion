#[path = "spine_assets.rs"]
pub(crate) mod spine_assets;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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
    pub runtime_errors: Vec<String>,
    pub has_preview: bool,
    pub has_layers_dir: bool,
    pub has_exports_dir: bool,
    pub has_runtime_export: bool,
    pub runtime_ready: bool,
    pub draft: bool,
    pub runtime_skel: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarImportResult {
    pub imported: bool,
    pub validation: AvatarValidation,
    pub registry_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarRuntimeInstallResult {
    pub installed: bool,
    pub validation: AvatarValidation,
    pub registry_path: String,
    pub runtime_path: String,
    pub skel: String,
}

pub fn requirements() -> Value {
    json!({
        "layout": ["avatar-pack.json", "preview.png", "layers/", "exports/"],
        "requiredManifestFields": ["id", "name", "source", "licenseNote"],
        "recommendedLayers": ["head", "hair_back", "body", "arm_left", "arm_right", "leg_left", "leg_right"],
        "motions": ["idle", "working", "reviewing", "running", "success", "failed", "waiting", "sleeping", "reminder", "interact"],
        "runtimeExports": [".skel", ".atlas", ".png"],
        "runtimeFields": ["runtimeSkel", "runtimeAtlas", "runtimeReady"],
        "runtimeSkel": "Required when exports/ contains more than one .skel file; it is relative to exports/.",
        "limits": "Without Spine Editor or another legal export path, Spine Companion can validate and manage an intermediate avatar pack but cannot claim a finished runtime rig."
    })
}

pub fn avatar_registry_path(config_dir: &Path) -> PathBuf {
    config_dir.join("avatar-packs.json")
}

pub fn avatar_runtime_dir(config_dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_safe_avatar_id(id) {
        return Err("Avatar ID must use 1-64 ASCII letters, digits, underscores, or hyphens and start with a letter or digit.".to_string());
    }
    Ok(config_dir.join("models").join(id))
}

pub fn is_safe_avatar_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

pub fn load_registry(config_dir: &Path) -> Result<Vec<Value>, String> {
    let path = avatar_registry_path(config_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Cannot read avatar registry: {error}"))?;
    serde_json::from_str::<Vec<Value>>(&text)
        .map_err(|error| format!("Invalid avatar registry: {error}"))
}

pub fn validate_pack(path: &Path) -> AvatarValidation {
    let root = path;
    let mut warnings = Vec::new();
    let mut errors = Vec::new();
    let mut runtime_errors = Vec::new();
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
        if !id.is_empty() && !is_safe_avatar_id(&id) {
            errors.push("Manifest id is unsafe. Use 1-64 ASCII letters, digits, underscores, or hyphens and start with a letter or digit.".to_string());
        }
        if !manifest.get("layers").map(Value::is_array).unwrap_or(false) {
            warnings.push("Manifest should include a layers array.".to_string());
        }
        if !manifest
            .get("motions")
            .map(Value::is_object)
            .unwrap_or(false)
        {
            warnings.push("Manifest should include a motions mapping.".to_string());
        }
    }

    let has_preview = root.join("preview.png").is_file();
    let has_layers_dir = root.join("layers").is_dir();
    let has_exports_dir = root.join("exports").is_dir();
    if !has_preview {
        errors.push("Missing preview.png".to_string());
    }
    if !has_layers_dir {
        errors.push("Missing layers/ directory".to_string());
    }

    if has_exports_dir {
        validate_declared_exports(&manifest, &root.join("exports"), &mut errors);
    } else if manifest.get("exports").is_some() {
        errors.push("Manifest declares exports but exports/ directory is missing.".to_string());
    }

    let mut runtime_skel = String::new();
    let mut runtime_ready = false;
    if !has_exports_dir {
        warnings.push("Missing exports/ directory. This pack is a draft and runtime installation is unavailable.".to_string());
    } else {
        let exports = root.join("exports");
        match validate_runtime_fields(&manifest, &exports) {
            Ok(fields) => {
                let skeletons = spine_assets::list_skeletons(&exports).unwrap_or_else(|error| {
                    runtime_errors.push(error);
                    Vec::new()
                });
                match choose_runtime_skel(&skeletons, fields.runtime_skel.as_deref()) {
                    Ok(Some(selected)) => {
                        match spine_assets::validate_spine_asset_dir(&exports, &selected) {
                            Ok(_) => {
                                runtime_skel = selected;
                                runtime_ready = true;
                            }
                            Err(error) => runtime_errors.push(error),
                        }
                    }
                    Ok(None) => warnings.push(
                        "exports/ has no .skel runtime export. This pack remains a draft."
                            .to_string(),
                    ),
                    Err(error) => errors.push(error),
                }
                if fields.runtime_ready == Some(true) && !runtime_ready {
                    errors.push("Manifest runtimeReady is true, but exports/ is not a valid Spine runtime set.".to_string());
                }
            }
            Err(field_errors) => errors.extend(field_errors),
        }
    }

    if !runtime_errors.is_empty() {
        runtime_errors.sort();
        runtime_errors.dedup();
        warnings.push(format!(
            "Runtime exports are not installable yet: {}",
            runtime_errors.join("; ")
        ));
    }
    let has_runtime_export = runtime_ready;
    AvatarValidation {
        ok: errors.is_empty(),
        path: root.to_string_lossy().to_string(),
        id,
        name,
        warnings,
        errors,
        runtime_errors,
        has_preview,
        has_layers_dir,
        has_exports_dir,
        has_runtime_export,
        runtime_ready,
        draft: !runtime_ready,
        runtime_skel,
    }
}

/// Adds a valid draft or runtime-ready pack to the local registry without copying assets.
pub fn register_pack(path: &Path, config_dir: &Path) -> Result<AvatarImportResult, String> {
    let validation = validate_pack(path);
    if !validation.ok {
        return Err(format!(
            "Avatar pack is invalid: {}",
            validation.errors.join("; ")
        ));
    }
    let registry_path = update_registry(config_dir, &validation, None)?;
    Ok(AvatarImportResult {
        imported: true,
        validation,
        registry_path: registry_path.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
fn import_pack(path: &Path, config_dir: &Path) -> Result<AvatarImportResult, String> {
    register_pack(path, config_dir)
}

/// Copies a runtime-ready pack into models/<id> through a staging directory and atomic replace.
pub fn install_runtime_pack(
    path: &Path,
    config_dir: &Path,
) -> Result<AvatarRuntimeInstallResult, String> {
    let validation = validate_pack(path);
    if !validation.ok {
        return Err(format!(
            "Avatar pack is invalid: {}",
            validation.errors.join("; ")
        ));
    }
    if !validation.runtime_ready {
        let detail = if validation.runtime_errors.is_empty() {
            "No complete Spine runtime export was found.".to_string()
        } else {
            validation.runtime_errors.join("; ")
        };
        return Err(format!(
            "Avatar pack is a draft and cannot be installed: {detail}"
        ));
    }
    let runtime_path = avatar_runtime_dir(config_dir, &validation.id)?;
    let models_dir = runtime_path
        .parent()
        .ok_or_else(|| "Cannot resolve avatar runtime directory.".to_string())?;
    fs::create_dir_all(models_dir).map_err(|error| error.to_string())?;
    let staging = models_dir.join(format!(".{}.install-{}", validation.id, unique_suffix()));
    if let Err(error) = copy_tree(&path.join("exports"), &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if let Err(error) = spine_assets::validate_spine_asset_dir(&staging, &validation.runtime_skel) {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Staged avatar runtime failed validation: {error}"));
    }

    let backup = replace_directory_atomically(&staging, &runtime_path)?;
    let registry_path = match update_registry(config_dir, &validation, Some(&runtime_path)) {
        Ok(path) => path,
        Err(error) => {
            let _ = rollback_directory_replace(&runtime_path, backup.as_deref());
            return Err(error);
        }
    };
    if let Some(backup) = backup {
        let _ = fs::remove_dir_all(backup);
    }
    let skel = validation.runtime_skel.clone();
    Ok(AvatarRuntimeInstallResult {
        installed: true,
        validation,
        registry_path: registry_path.to_string_lossy().to_string(),
        runtime_path: runtime_path.to_string_lossy().to_string(),
        skel,
    })
}

pub fn path_from_input(input: AvatarPackInput) -> PathBuf {
    PathBuf::from(input.path)
}

fn manifest_value(root: &Path) -> Result<Value, String> {
    let manifest = root.join("avatar-pack.json");
    let text = fs::read_to_string(&manifest)
        .map_err(|error| format!("Cannot read avatar-pack.json: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("Invalid avatar-pack.json: {error}"))
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn validate_declared_exports(manifest: &Value, exports_dir: &Path, errors: &mut Vec<String>) {
    let Some(exports) = manifest.get("exports") else {
        return;
    };
    let Some(entries) = exports.as_array() else {
        errors.push("Manifest exports must be an array of paths relative to exports/.".to_string());
        return;
    };
    for value in entries {
        let Some(value) = value.as_str() else {
            errors.push("Manifest exports entries must be strings.".to_string());
            continue;
        };
        match contained_export_file(exports_dir, value) {
            Ok(_) => {}
            Err(error) => errors.push(format!("Invalid manifest export {value:?}: {error}")),
        }
    }
}

struct RuntimeFields {
    runtime_skel: Option<String>,
    runtime_ready: Option<bool>,
}

fn validate_runtime_fields(
    manifest: &Value,
    exports_dir: &Path,
) -> Result<RuntimeFields, Vec<String>> {
    let mut errors = Vec::new();
    let runtime_skel =
        optional_runtime_path(manifest, "runtimeSkel", "skel", exports_dir, &mut errors);
    let _ = optional_runtime_path(manifest, "runtimeAtlas", "atlas", exports_dir, &mut errors);
    let runtime_ready = match manifest.get("runtimeReady") {
        Some(Value::Bool(value)) => Some(*value),
        Some(_) => {
            errors.push("Manifest runtimeReady must be a boolean.".to_string());
            None
        }
        None => None,
    };
    if errors.is_empty() {
        Ok(RuntimeFields {
            runtime_skel,
            runtime_ready,
        })
    } else {
        Err(errors)
    }
}

fn optional_runtime_path(
    manifest: &Value,
    key: &str,
    extension: &str,
    exports_dir: &Path,
    errors: &mut Vec<String>,
) -> Option<String> {
    let Some(value) = manifest.get(key) else {
        return None;
    };
    let Some(value) = value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        errors.push(format!(
            "Manifest {key} must be a non-empty path relative to exports/."
        ));
        return None;
    };
    let path = match spine_assets::safe_relative_path(value) {
        Ok(path) => path,
        Err(error) => {
            errors.push(format!("Invalid manifest {key}: {error}"));
            return None;
        }
    };
    if path
        .extension()
        .and_then(|extension_value| extension_value.to_str())
        .is_none_or(|extension_value| !extension_value.eq_ignore_ascii_case(extension))
    {
        errors.push(format!("Manifest {key} must name a .{extension} file."));
        return None;
    }
    match contained_export_file(exports_dir, value) {
        Ok(_) => Some(normalize_relative(&path)),
        Err(error) => {
            errors.push(format!("Invalid manifest {key}: {error}"));
            None
        }
    }
}

fn choose_runtime_skel(
    skeletons: &[String],
    requested: Option<&str>,
) -> Result<Option<String>, String> {
    match (skeletons, requested) {
        ([], Some(_)) => {
            Err("Manifest runtimeSkel does not name an exported .skel file.".to_string())
        }
        ([], None) => Ok(None),
        (_, Some(requested)) if skeletons.iter().any(|skel| skel == requested) => {
            Ok(Some(requested.to_string()))
        }
        (_, Some(_)) => {
            Err("Manifest runtimeSkel does not name an exported .skel file.".to_string())
        }
        ([only], None) => Ok(Some(only.clone())),
        (_, None) => Err(
            "exports/ contains multiple .skel files; manifest runtimeSkel must select one."
                .to_string(),
        ),
    }
}

fn contained_export_file(exports_dir: &Path, value: &str) -> Result<PathBuf, String> {
    let relative = spine_assets::safe_relative_path(value)?;
    let root = exports_dir
        .canonicalize()
        .map_err(|error| format!("Cannot read exports/: {error}"))?;
    let candidate = root.join(relative);
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "file does not exist under exports/.".to_string())?;
    if !canonical.starts_with(&root) || !canonical.is_file() {
        return Err("file must stay inside exports/.".to_string());
    }
    Ok(canonical)
}

fn update_registry(
    config_dir: &Path,
    validation: &AvatarValidation,
    runtime_path: Option<&Path>,
) -> Result<PathBuf, String> {
    let registry_path = avatar_registry_path(config_dir);
    if let Some(parent) = registry_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut items = load_registry(config_dir)?;
    items.retain(|item| item.get("id").and_then(Value::as_str) != Some(validation.id.as_str()));
    items.push(json!({
        "id": validation.id,
        "name": validation.name,
        "path": validation.path,
        "hasRuntimeExport": validation.has_runtime_export,
        "runtimeReady": validation.runtime_ready,
        "runtimeSkel": validation.runtime_skel,
        "runtimePath": runtime_path.map(|path| path.to_string_lossy().to_string())
    }));
    write_json_atomically(&registry_path, &items)?;
    Ok(registry_path)
}

fn write_json_atomically(path: &Path, value: &[Value]) -> Result<(), String> {
    let temp = path.with_extension(format!("json.tmp-{}", unique_suffix()));
    let data = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    fs::write(&temp, data).map_err(|error| error.to_string())?;
    replace_file_atomically(&temp, path)
}

fn replace_file_atomically(temp: &Path, target: &Path) -> Result<(), String> {
    let backup = target.with_extension(format!("json.backup-{}", unique_suffix()));
    let had_target = target.exists();
    if had_target {
        fs::rename(target, &backup).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(temp, target) {
        if had_target {
            let _ = fs::rename(&backup, target);
        }
        return Err(error.to_string());
    }
    if had_target {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    let root = source
        .canonicalize()
        .map_err(|error| format!("Cannot read runtime exports: {error}"))?;
    if !root.is_dir() {
        return Err("Runtime exports must be a directory.".to_string());
    }
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    copy_tree_inner(&root, &root, destination)
}

fn copy_tree_inner(root: &Path, source: &Path, destination: &Path) -> Result<(), String> {
    let mut entries = fs::read_dir(source)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if file_type.is_symlink() {
            return Err(format!(
                "Runtime exports cannot contain symlinks: {}",
                source_path.to_string_lossy()
            ));
        }
        if file_type.is_dir() {
            fs::create_dir_all(&destination_path).map_err(|error| error.to_string())?;
            copy_tree_inner(root, &source_path, &destination_path)?;
        } else if file_type.is_file() {
            let canonical = source_path
                .canonicalize()
                .map_err(|error| error.to_string())?;
            if !canonical.starts_with(root) {
                return Err(format!(
                    "Runtime export escapes exports/: {}",
                    source_path.to_string_lossy()
                ));
            }
            fs::copy(&canonical, &destination_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn replace_directory_atomically(staging: &Path, target: &Path) -> Result<Option<PathBuf>, String> {
    let backup = target.with_file_name(format!(
        ".{}.backup-{}",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("runtime"),
        unique_suffix()
    ));
    let had_target = target.exists();
    if had_target {
        fs::rename(target, &backup).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(staging, target) {
        if had_target {
            let _ = fs::rename(&backup, target);
        }
        return Err(error.to_string());
    }
    Ok(had_target.then_some(backup))
}

fn rollback_directory_replace(target: &Path, backup: Option<&Path>) -> Result<(), String> {
    if target.exists() {
        fs::remove_dir_all(target).map_err(|error| error.to_string())?;
    }
    if let Some(backup) = backup {
        fs::rename(backup, target).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn normalize_relative(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn unique_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{}-{nanos}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_pack(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("spine-companion-avatar-{name}-{}", unique_suffix()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_draft_pack(root: &Path, id: &str) {
        fs::write(
            root.join("avatar-pack.json"),
            format!(r#"{{"id":"{id}","name":"Test Avatar","source":"local","licenseNote":"User-owned","layers":[],"motions":{{}}}}"#),
        )
        .unwrap();
        fs::write(root.join("preview.png"), []).unwrap();
        fs::create_dir_all(root.join("layers")).unwrap();
    }

    fn write_runtime(root: &Path, skel: &str) {
        let exports = root.join("exports");
        fs::create_dir_all(&exports).unwrap();
        fs::write(exports.join(skel), []).unwrap();
        fs::write(exports.join("avatar.atlas"), "avatar.png\nsize: 1,1\n").unwrap();
        fs::write(exports.join("avatar.png"), []).unwrap();
    }

    #[test]
    fn invalid_pack_reports_missing_files() {
        let root = temp_pack("invalid");
        let result = validate_pack(&root);
        assert!(!result.ok);
        assert!(result
            .errors
            .iter()
            .any(|item| item.contains("avatar-pack.json")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn draft_pack_can_be_registered_without_runtime() {
        let root = temp_pack("draft");
        write_draft_pack(&root, "test_avatar");
        let validation = validate_pack(&root);
        assert!(validation.ok);
        assert!(validation.draft);
        assert!(!validation.runtime_ready);
        let registry = temp_pack("registry");
        let imported = import_pack(&root, &registry).unwrap();
        assert!(imported.imported);
        assert!(Path::new(&imported.registry_path).exists());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(registry);
    }

    #[test]
    fn rejects_unsafe_id_and_export_path() {
        let root = temp_pack("unsafe");
        write_draft_pack(&root, "../escape");
        fs::create_dir_all(root.join("exports")).unwrap();
        fs::write(
            root.join("avatar-pack.json"),
            r#"{"id":"../escape","name":"Test","source":"local","licenseNote":"User-owned","layers":[],"motions":{},"exports":["../outside.skel"]}"#,
        )
        .unwrap();
        let validation = validate_pack(&root);
        assert!(!validation.ok);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.contains("unsafe")));
        assert!(validation
            .errors
            .iter()
            .any(|error| error.contains("Invalid manifest export")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn requires_runtime_skel_for_multiple_exports() {
        let root = temp_pack("multiple-runtime");
        write_draft_pack(&root, "test_avatar");
        write_runtime(&root, "a.skel");
        fs::write(root.join("exports").join("b.skel"), []).unwrap();
        let validation = validate_pack(&root);
        assert!(!validation.ok);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.contains("runtimeSkel")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn runtime_skel_selects_one_of_multiple_exports() {
        let root = temp_pack("selected-runtime");
        write_draft_pack(&root, "test_avatar");
        write_runtime(&root, "a.skel");
        fs::write(root.join("exports").join("b.skel"), []).unwrap();
        fs::write(
            root.join("avatar-pack.json"),
            r#"{"id":"test_avatar","name":"Test Avatar","source":"local","licenseNote":"User-owned","layers":[],"motions":{},"runtimeSkel":"b.skel"}"#,
        )
        .unwrap();
        let validation = validate_pack(&root);
        assert!(validation.ok);
        assert!(validation.runtime_ready);
        assert_eq!(validation.runtime_skel, "b.skel");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn installs_runtime_with_atomic_registry_update() {
        let root = temp_pack("runtime");
        write_draft_pack(&root, "test_avatar");
        write_runtime(&root, "avatar.skel");
        assert!(spine_assets::validate_spine_asset_selection(
            &root.join("exports").join("avatar.skel")
        )
        .is_ok());
        let config = temp_pack("runtime-config");
        let installed = install_runtime_pack(&root, &config).unwrap();
        assert!(installed.installed);
        assert!(Path::new(&installed.runtime_path)
            .join("avatar.skel")
            .is_file());
        let registry = load_registry(&config).unwrap();
        assert_eq!(registry.len(), 1);
        assert_eq!(registry[0]["runtimeSkel"], "avatar.skel");
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn missing_atlas_texture_keeps_pack_as_draft() {
        let root = temp_pack("missing-texture");
        write_draft_pack(&root, "test_avatar");
        write_runtime(&root, "avatar.skel");
        fs::remove_file(root.join("exports").join("avatar.png")).unwrap();
        let validation = validate_pack(&root);
        assert!(validation.ok);
        assert!(!validation.runtime_ready);
        assert!(validation
            .runtime_errors
            .iter()
            .any(|error| error.contains("texture")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn failed_directory_replace_restores_previous_model() {
        let root = temp_pack("replace-rollback");
        let target = root.join("model");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("previous.txt"), "previous").unwrap();
        let missing_staging = root.join("missing-staging");
        assert!(replace_directory_atomically(&missing_staging, &target).is_err());
        assert_eq!(
            fs::read_to_string(target.join("previous.txt")).unwrap(),
            "previous"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reinstall_replaces_previous_runtime_without_leaving_old_files() {
        let root = temp_pack("reinstall");
        write_draft_pack(&root, "test_avatar");
        write_runtime(&root, "avatar.skel");
        fs::write(root.join("exports").join("old.txt"), "old").unwrap();
        let config = temp_pack("reinstall-config");
        install_runtime_pack(&root, &config).unwrap();

        fs::remove_file(root.join("exports").join("old.txt")).unwrap();
        fs::write(root.join("exports").join("new.txt"), "new").unwrap();
        let installed = install_runtime_pack(&root, &config).unwrap();
        let runtime = Path::new(&installed.runtime_path);
        assert!(!runtime.join("old.txt").exists());
        assert_eq!(fs::read_to_string(runtime.join("new.txt")).unwrap(), "new");
        assert_eq!(load_registry(&config).unwrap().len(), 1);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(config);
    }
}

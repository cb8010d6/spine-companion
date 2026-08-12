use crate::{avatar, model_by_skel, public_server_config, url_encode_path_segment};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UiSettings {
    pub(crate) hud_visible: bool,
    pub(crate) bubble_visible: bool,
    pub(crate) bubble_shadow: bool,
    pub(crate) bubble_background: String,
    pub(crate) bubble_hold_ms: u64,
    pub(crate) drag_mode: String,
    pub(crate) frame_rate_mode: String,
    pub(crate) auto_reveal_on_mcp: bool,
    pub(crate) system_notifications: bool,
    pub(crate) update_auto_check: bool,
    pub(crate) update_channel: String,
    pub(crate) max_device_pixel_ratio: f64,
    pub(crate) hitbox_padding: f64,
    pub(crate) gpu_mode: String,
    pub(crate) debug_hitbox: bool,
}

#[derive(Clone)]
pub(crate) struct RuntimeConfig {
    pub(crate) public: serde_json::Value,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) initial_state: String,
    pub(crate) asset_root: Option<PathBuf>,
    pub(crate) ui_settings: UiSettings,
    pub(crate) config_dir: PathBuf,
    pub(crate) local_config_path: PathBuf,
}

#[derive(Clone, Debug)]
pub(crate) struct RecoveredModel {
    pub(crate) asset_dir: PathBuf,
    pub(crate) skel: String,
}

pub(crate) fn fallback_config() -> serde_json::Value {
    serde_json::json!({
        "window": { "width": 360, "height": 460, "alwaysOnTop": true, "transparent": true },
        "server": { "host": "127.0.0.1", "port": 17388 },
        "spine": {
            "assetDir": "",
            "skel": "amiya.skel",
            "scale": 0.86,
            "offsetX": 0,
            "offsetY": -18,
            "fitMode": "legacy",
            "mixDurationMs": 520,
            "boundsSamples": 10,
            "framePadding": 1.08,
            "maxViewportFill": 0.72,
            "stageBottomInset": 154,
            "fitStates": ["idle", "working", "running", "waiting", "reviewing", "success", "reminder"]
        },
        "ui": {
            "theme": "system",
            "hudVisible": false,
            "bubbleVisible": true,
            "bubbleShadow": true,
            "bubbleBackground": "solid",
            "bubbleHoldMs": 8000,
            "dragMode": "smooth",
            "frameRateMode": "display",
            "autoRevealOnMcp": true,
            "systemNotifications": true,
            "updateAutoCheck": true,
            "updateChannel": "auto",
            "maxDevicePixelRatio": 2,
            "hitboxPadding": 8,
            "gpuMode": "hardware",
            "debugHitbox": false
        },
        "models": {
            "presentations": {},
            "sources": [
                {
                    "id": "ark-models",
                    "label": "Operators",
                    "catalogUrl": "https://raw.githubusercontent.com/cb8010d6/spine-companion/v0.2.6-rc.10/catalog/catalog.json",
                    "kind": "official",
                    "enabled": true
                },
                {
                    "id": "ark-illustrations",
                    "label": "Dynamic illustrations",
                    "catalogUrl": "https://raw.githubusercontent.com/cb8010d6/spine-companion/v0.2.6-rc.10/catalog/illustrations.json",
                    "kind": "official",
                    "enabled": true
                },
                {
                    "id": "ark-enemies",
                    "label": "Enemies",
                    "catalogUrl": "https://raw.githubusercontent.com/cb8010d6/spine-companion/v0.2.6-rc.10/catalog/enemies.json",
                    "kind": "official",
                    "enabled": true
                }
            ],
            "catalog": []
        },
        "state": { "initial": "idle", "pollMs": 1000, "sources": [{ "type": "local-http" }] },
        "specialSegments": {
            "review": { "from": 2.6, "to": 4.35, "loop": true },
            "success": { "from": 4.4, "to": 14.433, "loop": false },
            "successLoop": { "from": 9.2, "to": 14.433, "loop": true, "mixDurationMs": 420 },
            "special": { "from": 0, "to": 14.433, "loop": true }
        }
    })
}

pub(crate) fn merge_json(base: &mut serde_json::Value, patch: serde_json::Value) {
    match (base, patch) {
        (serde_json::Value::Object(base), serde_json::Value::Object(patch)) => {
            for (key, value) in patch {
                merge_json(base.entry(key).or_insert(serde_json::Value::Null), value);
            }
        }
        (base, patch) => *base = patch,
    }
}

pub(crate) fn read_json_if_exists(path: &Path) -> Option<serde_json::Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

pub(crate) fn user_config_dir() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("SPINE_COMPANION_CONFIG_DIR") {
        return Some(PathBuf::from(value));
    }
    #[cfg(target_os = "windows")]
    if let Ok(value) = std::env::var("APPDATA") {
        return Some(PathBuf::from(value).join("spine-companion"));
    }
    #[cfg(target_os = "macos")]
    if let Ok(value) = std::env::var("HOME") {
        return Some(PathBuf::from(value).join("Library/Application Support/spine-companion"));
    }
    if let Ok(value) = std::env::var("XDG_CONFIG_HOME") {
        return Some(PathBuf::from(value).join("spine-companion"));
    }
    std::env::var("HOME")
        .ok()
        .map(|home| PathBuf::from(home).join(".config/spine-companion"))
}

fn local_config_candidates_with_context(
    root: &Path,
    cwd: Option<&Path>,
    user_dir: Option<&Path>,
    exe_dir: Option<&Path>,
) -> Vec<PathBuf> {
    // Legacy layers are read first. The per-user file is appended last so it
    // always wins without making any legacy file a write target.
    let mut candidates = Vec::new();
    let mut push_unique = |path: PathBuf| {
        if !candidates.iter().any(|candidate| candidate == &path) {
            candidates.push(path);
        }
    };
    push_unique(root.join("companion.local.json"));
    if let Some(cwd) = cwd {
        push_unique(cwd.join("companion.local.json"));
    }
    if let Some(dir) = exe_dir {
        push_unique(dir.join("companion.local.json"));
    }
    if let Some(dir) = user_dir {
        push_unique(dir.join("companion.local.json"));
    }
    candidates
}

pub(crate) fn local_config_candidates(root: &Path) -> Vec<PathBuf> {
    let cwd = std::env::current_dir().ok();
    let user_dir = user_config_dir();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));
    local_config_candidates_with_context(
        root,
        cwd.as_deref(),
        user_dir.as_deref(),
        exe_dir.as_deref(),
    )
}

pub(crate) fn default_local_config_path(root: &Path) -> PathBuf {
    user_config_dir()
        .unwrap_or_else(|| root.to_path_buf())
        .join("companion.local.json")
}

pub(crate) fn string_at<'a>(value: &'a serde_json::Value, path: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str()
}

pub(crate) fn number_at(value: &serde_json::Value, path: &[&str], fallback: u16) -> u16 {
    let mut current = value;
    for key in path {
        if let Some(next) = current.get(*key) {
            current = next;
        } else {
            return fallback;
        }
    }
    current.as_u64().map(|n| n as u16).unwrap_or(fallback)
}

fn bool_at(value: &serde_json::Value, path: &[&str], fallback: bool) -> bool {
    let mut current = value;
    for key in path {
        if let Some(next) = current.get(*key) {
            current = next;
        } else {
            return fallback;
        }
    }
    current.as_bool().unwrap_or(fallback)
}

fn u64_at(value: &serde_json::Value, path: &[&str], fallback: u64) -> u64 {
    let mut current = value;
    for key in path {
        if let Some(next) = current.get(*key) {
            current = next;
        } else {
            return fallback;
        }
    }
    current.as_u64().unwrap_or(fallback)
}

fn f64_at(value: &serde_json::Value, path: &[&str], fallback: f64) -> f64 {
    let mut current = value;
    for key in path {
        if let Some(next) = current.get(*key) {
            current = next;
        } else {
            return fallback;
        }
    }
    current.as_f64().unwrap_or(fallback)
}

pub(crate) fn resolve_asset_dir(root: &Path, value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path.to_string_lossy().to_string()
    } else {
        root.join(path).to_string_lossy().to_string()
    }
}

pub(crate) fn validate_spine_asset_dir(asset_dir: &Path, skel: &str) -> Result<(), String> {
    avatar::spine_assets::validate_spine_asset_dir(asset_dir, skel).map(|_| ())
}

pub(crate) fn ui_settings_from_config(config: &serde_json::Value) -> UiSettings {
    let background = string_at(config, &["ui", "bubbleBackground"])
        .unwrap_or("solid")
        .to_string();
    let drag_mode = string_at(config, &["ui", "dragMode"])
        .unwrap_or("smooth")
        .to_string();
    let frame_rate_mode = string_at(config, &["ui", "frameRateMode"])
        .unwrap_or("display")
        .to_string();
    let gpu_mode = string_at(config, &["ui", "gpuMode"])
        .unwrap_or("hardware")
        .to_string();
    UiSettings {
        hud_visible: bool_at(config, &["ui", "hudVisible"], false),
        bubble_visible: bool_at(config, &["ui", "bubbleVisible"], true),
        bubble_shadow: bool_at(config, &["ui", "bubbleShadow"], true),
        bubble_background: normalize_bubble_background(&background),
        bubble_hold_ms: u64_at(config, &["ui", "bubbleHoldMs"], 8000),
        drag_mode: normalize_drag_mode(&drag_mode),
        frame_rate_mode: normalize_frame_rate_mode(&frame_rate_mode),
        auto_reveal_on_mcp: bool_at(config, &["ui", "autoRevealOnMcp"], true),
        system_notifications: bool_at(config, &["ui", "systemNotifications"], true),
        update_auto_check: bool_at(config, &["ui", "updateAutoCheck"], true),
        update_channel: normalize_update_channel(
            string_at(config, &["ui", "updateChannel"]).unwrap_or("auto"),
        ),
        max_device_pixel_ratio: f64_at(config, &["ui", "maxDevicePixelRatio"], 2.0).clamp(1.0, 3.0),
        hitbox_padding: f64_at(config, &["ui", "hitboxPadding"], 8.0).clamp(0.0, 48.0),
        gpu_mode: normalize_gpu_mode(&gpu_mode),
        debug_hitbox: bool_at(config, &["ui", "debugHitbox"], false),
    }
}

pub(crate) fn normalize_bubble_background(value: &str) -> String {
    match value {
        "soft" | "clear" | "light" => value.to_string(),
        _ => "solid".to_string(),
    }
}

pub(crate) fn normalize_drag_mode(value: &str) -> String {
    if value == "smooth" {
        "smooth".to_string()
    } else {
        "compatible".to_string()
    }
}

pub(crate) fn normalize_frame_rate_mode(value: &str) -> String {
    match value {
        "60" | "30" => value.to_string(),
        _ => "display".to_string(),
    }
}

pub(crate) fn normalize_gpu_mode(value: &str) -> String {
    if value == "software" {
        "software".to_string()
    } else {
        "hardware".to_string()
    }
}

pub(crate) fn normalize_update_channel(value: &str) -> String {
    match value {
        "stable" | "prerelease" => value.to_string(),
        _ => "auto".to_string(),
    }
}

pub(crate) fn resolved_update_channel(configured: &str, current_version: &str) -> &'static str {
    match configured {
        "stable" => "stable",
        "prerelease" => "prerelease",
        _ if crate::is_prerelease_version(current_version) => "prerelease",
        _ => "stable",
    }
}

fn load_config_layers(
    root: &Path,
    candidates: &[PathBuf],
) -> (serde_json::Value, PathBuf, Vec<PathBuf>) {
    let mut config = fallback_config();
    let committed_path = root.join("companion.config.json");
    let mut loaded_paths = Vec::new();
    if let Some(committed) = read_json_if_exists(&committed_path) {
        merge_json(&mut config, committed);
        loaded_paths.push(committed_path);
    }
    let mut asset_base_dir = root.to_path_buf();
    for candidate in candidates {
        if let Some(local) = read_json_if_exists(candidate) {
            if string_at(&local, &["spine", "assetDir"]).is_some() {
                if let Some(parent) = candidate.parent() {
                    asset_base_dir = parent.to_path_buf();
                }
            }
            merge_json(&mut config, local);
            loaded_paths.push(candidate.clone());
        }
    }
    (config, asset_base_dir, loaded_paths)
}

fn config_layer_report(
    root: &Path,
    canonical_path: &Path,
    candidates: &[PathBuf],
    loaded_paths: &[PathBuf],
) -> serde_json::Value {
    let is_loaded = |path: &Path| loaded_paths.iter().any(|loaded| loaded == path);
    let layer = |path: &Path, writable: bool| {
        serde_json::json!({
            "path": path.to_string_lossy().to_string(),
            "exists": path.exists(),
            "loaded": is_loaded(path),
            "writable": writable
        })
    };
    let committed_path = root.join("companion.config.json");
    let legacy = candidates
        .iter()
        .filter(|path| *path != canonical_path)
        .map(|path| layer(path, false))
        .collect::<Vec<_>>();
    let loaded = loaded_paths
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    serde_json::json!({
        "canonical": layer(canonical_path, true),
        "committed": layer(&committed_path, false),
        "legacy": legacy,
        "loaded": loaded
    })
}

pub(crate) fn apply_env_overlays<F>(config: &mut serde_json::Value, get_env: F)
where
    F: Fn(&str) -> Option<String>,
{
    if let Some(asset_dir) = get_env("SPINE_ASSET_DIR") {
        config["spine"]["assetDir"] = serde_json::Value::String(asset_dir);
    }
    if let Some(skel) = get_env("SPINE_SKEL") {
        config["spine"]["skel"] = serde_json::Value::String(skel);
    }
    if let Some(port) = get_env("COMPANION_PORT").and_then(|value| value.parse::<u16>().ok()) {
        config["server"]["port"] = serde_json::Value::Number(port.into());
    }
}

fn active_env_overlay_names<F>(get_env: F) -> Vec<&'static str>
where
    F: Fn(&str) -> Option<String>,
{
    let mut names = Vec::new();
    if get_env("SPINE_ASSET_DIR").is_some() {
        names.push("SPINE_ASSET_DIR");
    }
    if get_env("SPINE_SKEL").is_some() {
        names.push("SPINE_SKEL");
    }
    if get_env("COMPANION_PORT")
        .and_then(|value| value.parse::<u16>().ok())
        .is_some()
    {
        names.push("COMPANION_PORT");
    }
    names
}

pub(crate) fn first_recoverable_model(
    config_dir: &Path,
    config: &serde_json::Value,
) -> Option<RecoveredModel> {
    let catalog = config
        .get("models")
        .and_then(|models| models.get("catalog"))
        .and_then(|catalog| catalog.as_array())?;
    for model in catalog {
        let Some(id) = model.get("id").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(skel) = model.get("skel").and_then(|value| value.as_str()) else {
            continue;
        };
        let asset_dir = config_dir.join("models").join(id);
        if validate_spine_asset_dir(&asset_dir, skel).is_ok() {
            let canonical = asset_dir.canonicalize().unwrap_or(asset_dir);
            return Some(RecoveredModel {
                asset_dir: canonical,
                skel: skel.to_string(),
            });
        }
    }
    None
}

pub(crate) fn ensure_official_model_sources(config: &mut serde_json::Value) {
    let defaults = fallback_config();
    let Some(default_sources) = defaults
        .get("models")
        .and_then(|models| models.get("sources"))
        .and_then(|sources| sources.as_array())
    else {
        return;
    };
    let Some(sources) = config
        .get_mut("models")
        .and_then(|models| models.get_mut("sources"))
        .and_then(|sources| sources.as_array_mut())
    else {
        return;
    };
    for source in default_sources {
        let id = source.get("id").and_then(|value| value.as_str());
        if let Some(current) = sources
            .iter_mut()
            .find(|current| current.get("id").and_then(|value| value.as_str()) == id)
        {
            let enabled = current.get("enabled").cloned();
            *current = source.clone();
            if let Some(enabled) = enabled {
                current["enabled"] = enabled;
            }
        } else {
            sources.push(source.clone());
        }
    }
}

pub(crate) fn verify_local_model_config(
    path: &Path,
    expected_asset_dir: &Path,
    expected_skel: &str,
) -> Result<(), String> {
    let config = read_json_if_exists(path)
        .ok_or_else(|| format!("{} was not written", path.to_string_lossy()))?;
    let spine = config
        .get("spine")
        .ok_or_else(|| "spine config section is missing".to_string())?;
    let asset_dir = spine
        .get("assetDir")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "spine.assetDir is missing".to_string())?;
    let skel = spine
        .get("skel")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "spine.skel is missing".to_string())?;
    if skel != expected_skel {
        return Err(format!(
            "spine.skel is {}, expected {}",
            skel, expected_skel
        ));
    }
    let written = PathBuf::from(asset_dir);
    if written != expected_asset_dir {
        return Err(format!(
            "spine.assetDir is {}, expected {}",
            asset_dir,
            expected_asset_dir.to_string_lossy()
        ));
    }
    Ok(())
}

pub(crate) fn write_local_model_config(
    path: &Path,
    asset_dir: &Path,
    skel: &str,
) -> Result<(), String> {
    let mut config = read_json_if_exists(path).unwrap_or_else(|| serde_json::json!({}));
    merge_json(
        &mut config,
        serde_json::json!({
            "spine": {
                "assetDir": asset_dir.to_string_lossy().to_string(),
                "skel": skel
            }
        }),
    );
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let temporary = path.with_extension(format!("tmp-{}-{suffix}", std::process::id()));
    let backup = path.with_extension(format!("previous-{}-{suffix}", std::process::id()));
    std::fs::write(&temporary, format!("{}\n", text)).map_err(|error| error.to_string())?;
    let had_previous = path.exists();
    if had_previous {
        let _ = std::fs::remove_file(&backup);
        std::fs::rename(path, &backup).map_err(|error| error.to_string())?;
    }
    if let Err(error) = std::fs::rename(&temporary, path) {
        if had_previous {
            let _ = std::fs::rename(&backup, path);
        }
        let _ = std::fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    let _ = std::fs::remove_file(&backup);
    Ok(())
}

pub(crate) fn load_runtime_config() -> RuntimeConfig {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let config_dir_path = user_config_dir().unwrap_or_else(|| root.clone());
    let canonical_config_path = default_local_config_path(&root);
    let candidates = local_config_candidates(&root);
    let (mut config, asset_base_dir, mut loaded_config_paths) =
        load_config_layers(&root, &candidates);
    ensure_official_model_sources(&mut config);
    let local_config_path = canonical_config_path;
    let environment_overrides = active_env_overlay_names(|key| std::env::var(key).ok());
    apply_env_overlays(&mut config, |key| std::env::var(key).ok());

    let host = string_at(&config, &["server", "host"])
        .unwrap_or("127.0.0.1")
        .to_string();
    let port = number_at(&config, &["server", "port"], 17388);
    let origin = format!("http://{}:{}", host, port);
    let raw_asset_dir = string_at(&config, &["spine", "assetDir"]).unwrap_or("");
    let mut asset_dir = resolve_asset_dir(&asset_base_dir, raw_asset_dir);
    config["spine"]["assetDir"] = serde_json::Value::String(asset_dir.clone());
    let mut skel = string_at(&config, &["spine", "skel"])
        .unwrap_or("amiya.skel")
        .to_string();
    if asset_dir.is_empty() {
        if let Some(recovered) = first_recoverable_model(&config_dir_path, &config) {
            if write_local_model_config(&local_config_path, &recovered.asset_dir, &recovered.skel)
                .and_then(|_| {
                    verify_local_model_config(
                        &local_config_path,
                        &recovered.asset_dir,
                        &recovered.skel,
                    )
                })
                .is_ok()
            {
                asset_dir = recovered.asset_dir.to_string_lossy().to_string();
                skel = recovered.skel;
                config["spine"]["assetDir"] = serde_json::Value::String(asset_dir.clone());
                config["spine"]["skel"] = serde_json::Value::String(skel.clone());
                if !loaded_config_paths
                    .iter()
                    .any(|path| path == &local_config_path)
                {
                    loaded_config_paths.push(local_config_path.clone());
                }
            }
        }
    }
    let active_model_metadata = model_by_skel(&config, &skel).or_else(|| {
        if asset_dir.is_empty() {
            None
        } else {
            std::fs::read_to_string(PathBuf::from(&asset_dir).join(".companion-model.json"))
                .ok()
                .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        }
    });
    let model_category = active_model_metadata
        .as_ref()
        .and_then(|model| model.get("category"))
        .and_then(|value| value.as_str())
        .unwrap_or("operator");
    let compatibility_profile = active_model_metadata
        .as_ref()
        .and_then(|model| model.get("compatibilityProfile"))
        .and_then(|value| value.as_str())
        .unwrap_or("companion");
    let config_dir = config_dir_path.to_string_lossy().to_string();
    let ui_settings = ui_settings_from_config(&config);
    let mut config_layers =
        config_layer_report(&root, &local_config_path, &candidates, &loaded_config_paths);
    config_layers["environmentOverrides"] = serde_json::json!(environment_overrides);

    let public = serde_json::json!({
        "window": config["window"].clone(),
        "server": public_server_config(&origin),
        "spine": {
            "assetDir": asset_dir.clone(),
            "skel": skel.clone(),
            "assetUrl": format!("{}/assets/spine/{}", origin, url_encode_path_segment(&skel)),
            "assetDirConfigured": !asset_dir.is_empty(),
            "scale": config["spine"]["scale"].clone(),
            "offsetX": config["spine"]["offsetX"].clone(),
            "offsetY": config["spine"]["offsetY"].clone(),
            "fitMode": config["spine"]["fitMode"].clone(),
            "presentationDefaults": {
                "scale": config["spine"]["scale"].clone(),
                "offsetX": config["spine"]["offsetX"].clone(),
                "offsetY": config["spine"]["offsetY"].clone(),
                "fitMode": config["spine"]["fitMode"].clone()
            },
            "mixDurationMs": config["spine"]["mixDurationMs"].clone(),
            "boundsSamples": config["spine"]["boundsSamples"].clone(),
            "framePadding": config["spine"]["framePadding"].clone(),
            "maxViewportFill": config["spine"]["maxViewportFill"].clone(),
            "stageBottomInset": config["spine"]["stageBottomInset"].clone(),
            "fitStates": config["spine"]["fitStates"].clone(),
            "modelCategory": model_category,
            "compatibilityProfile": compatibility_profile
        },
        "ui": config["ui"].clone(),
        "models": config["models"].clone(),
        "paths": {
            "configDir": config_dir,
            "localConfigPath": local_config_path.to_string_lossy().to_string(),
            "canonicalConfigPath": local_config_path.to_string_lossy().to_string(),
            "hasLocalConfig": loaded_config_paths.iter().any(|path| path == &local_config_path),
            "configLayers": config_layers
        },
        "state": config["state"].clone(),
        "specialSegments": config["specialSegments"].clone()
    });

    RuntimeConfig {
        public,
        host,
        port,
        initial_state: string_at(&config, &["state", "initial"])
            .unwrap_or("idle")
            .to_string(),
        asset_root: if asset_dir.is_empty() {
            None
        } else {
            Some(PathBuf::from(asset_dir))
        },
        ui_settings,
        config_dir: config_dir_path,
        local_config_path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!("spine-companion-config-{label}-{suffix}"))
    }

    #[test]
    fn canonical_config_has_highest_precedence_over_legacy_layers() {
        let root = temp_root("precedence");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("companion.config.json"),
            r#"{"server":{"port":18000},"spine":{"skel":"committed.skel"}}"#,
        )
        .unwrap();
        let legacy_dir = root.join("legacy");
        std::fs::create_dir_all(&legacy_dir).unwrap();
        let legacy = legacy_dir.join("companion.local.json");
        let canonical = root.join("user").join("companion.local.json");
        std::fs::create_dir_all(canonical.parent().unwrap()).unwrap();
        std::fs::write(
            &legacy,
            r#"{"server":{"port":18001},"spine":{"scale":1.1,"assetDir":"assets"}}"#,
        )
        .unwrap();
        std::fs::write(
            &canonical,
            r#"{"server":{"port":18002},"spine":{"skel":"local.skel"}}"#,
        )
        .unwrap();

        let (config, base, loaded) =
            load_config_layers(&root, &[legacy.clone(), canonical.clone()]);
        assert_eq!(config["server"]["port"], 18002);
        assert_eq!(config["spine"]["scale"], 1.1);
        assert_eq!(config["spine"]["skel"], "local.skel");
        assert!(loaded.contains(&legacy));
        assert!(loaded.contains(&canonical));
        assert_eq!(base, legacy_dir);
        assert_eq!(
            resolve_asset_dir(&base, "models"),
            legacy_dir.join("models").to_string_lossy()
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn local_config_candidates_preserve_root_cwd_user_and_exe_order() {
        let root = PathBuf::from("root");
        let cwd = PathBuf::from("cwd");
        let user = PathBuf::from("user");
        let exe = PathBuf::from("exe");
        assert_eq!(
            local_config_candidates_with_context(&root, Some(&cwd), Some(&user), Some(&exe)),
            vec![
                root.join("companion.local.json"),
                cwd.join("companion.local.json"),
                exe.join("companion.local.json"),
                user.join("companion.local.json")
            ]
        );
    }

    #[test]
    fn canonical_write_does_not_modify_legacy_config() {
        let root = temp_root("canonical-write");
        let legacy = root.join("companion.local.json");
        let canonical = root.join("user").join("companion.local.json");
        let asset_dir = root.join("models").join("amiya");
        std::fs::create_dir_all(&asset_dir).unwrap();
        std::fs::write(
            &legacy,
            r#"{"spine":{"assetDir":"legacy-assets","skel":"legacy.skel"}}"#,
        )
        .unwrap();

        write_local_model_config(&canonical, &asset_dir, "amiya.skel").unwrap();
        verify_local_model_config(&canonical, &asset_dir, "amiya.skel").unwrap();
        assert_eq!(
            std::fs::read_to_string(&legacy).unwrap(),
            r#"{"spine":{"assetDir":"legacy-assets","skel":"legacy.skel"}}"#
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn config_layer_report_identifies_canonical_and_loaded_legacy_layers() {
        let root = temp_root("layer-report");
        let cwd = root.join("cwd");
        let canonical = root.join("user").join("companion.local.json");
        let legacy = cwd.join("companion.local.json");
        std::fs::create_dir_all(cwd).unwrap();
        std::fs::create_dir_all(canonical.parent().unwrap()).unwrap();
        std::fs::write(&legacy, r#"{"ui":{"theme":"dark"}}"#).unwrap();
        std::fs::write(&canonical, r#"{"ui":{"theme":"light"}}"#).unwrap();
        let report = config_layer_report(
            &root,
            &canonical,
            &[legacy.clone(), canonical.clone()],
            &[legacy.clone(), canonical.clone()],
        );
        assert_eq!(
            report["canonical"]["path"],
            canonical.to_string_lossy().to_string()
        );
        assert_eq!(report["canonical"]["writable"], true);
        assert_eq!(
            report["legacy"][0]["path"],
            legacy.to_string_lossy().to_string()
        );
        assert_eq!(report["legacy"][0]["writable"], false);
        assert_eq!(report["loaded"].as_array().unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn environment_overlays_have_highest_precedence_and_ignore_invalid_port() {
        let mut config = serde_json::json!({
            "server": { "port": 18000 },
            "spine": { "assetDir": "committed", "skel": "committed.skel" }
        });
        let env = |key: &str| match key {
            "SPINE_ASSET_DIR" => Some("env/assets".to_string()),
            "SPINE_SKEL" => Some("env.skel".to_string()),
            "COMPANION_PORT" => Some("not-a-port".to_string()),
            _ => None,
        };
        apply_env_overlays(&mut config, env);
        assert_eq!(config["spine"]["assetDir"], "env/assets");
        assert_eq!(config["spine"]["skel"], "env.skel");
        assert_eq!(config["server"]["port"], 18000);

        apply_env_overlays(&mut config, |key| {
            (key == "COMPANION_PORT").then(|| "18100".to_string())
        });
        assert_eq!(config["server"]["port"], 18100);
    }

    #[test]
    fn environment_override_report_lists_names_without_values() {
        let names = active_env_overlay_names(|key| match key {
            "SPINE_ASSET_DIR" => Some("private-model-path".to_string()),
            "COMPANION_PORT" => Some("17389".to_string()),
            _ => None,
        });
        assert_eq!(names, vec!["SPINE_ASSET_DIR", "COMPANION_PORT"]);
        assert!(!format!("{names:?}").contains("private-model-path"));
    }

    #[test]
    fn official_source_reconciliation_preserves_custom_sources_and_enabled_flags() {
        let mut config = serde_json::json!({
            "models": { "sources": [
                {
                    "id": "custom",
                    "label": "Custom",
                    "catalogUrl": "https://example.com/catalog.json",
                    "kind": "customCdn",
                    "enabled": true
                },
                {
                    "id": "ark-models",
                    "label": "Old operators label",
                    "catalogUrl": "https://example.com/old.json",
                    "kind": "official",
                    "enabled": false
                }
            ] }
        });
        ensure_official_model_sources(&mut config);
        let sources = config["models"]["sources"].as_array().unwrap();
        assert!(sources.iter().any(|source| source["id"] == "custom"));
        assert!(sources
            .iter()
            .any(|source| source["id"] == "ark-illustrations"));
        assert!(sources.iter().any(|source| source["id"] == "ark-enemies"));
        let operators = sources
            .iter()
            .find(|source| source["id"] == "ark-models")
            .unwrap();
        assert_eq!(operators["enabled"], false);
        assert!(operators["catalogUrl"]
            .as_str()
            .unwrap()
            .contains("/v0.2.6-rc.10/"));
    }

    #[test]
    fn local_model_config_write_and_validation_preserve_existing_json() {
        let root = temp_root("local-write");
        let path = root.join("companion.local.json");
        let asset_dir = root.join("models").join("amiya");
        std::fs::create_dir_all(&asset_dir).unwrap();
        std::fs::write(&path, r#"{"ui":{"theme":"light"}}"#).unwrap();
        write_local_model_config(&path, &asset_dir, "amiya.skel").unwrap();
        verify_local_model_config(&path, &asset_dir, "amiya.skel").unwrap();
        let config = read_json_if_exists(&path).unwrap();
        assert_eq!(config["ui"]["theme"], "light");
        assert_eq!(config["spine"]["skel"], "amiya.skel");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn defaults_new_local_config_to_user_config_dir() {
        let root = temp_root("default-local-path");
        let user_config = root.join("user-config");
        let old = std::env::var("SPINE_COMPANION_CONFIG_DIR").ok();
        std::env::set_var("SPINE_COMPANION_CONFIG_DIR", &user_config);
        assert_eq!(
            default_local_config_path(&root),
            user_config.join("companion.local.json")
        );
        match old {
            Some(value) => std::env::set_var("SPINE_COMPANION_CONFIG_DIR", value),
            None => std::env::remove_var("SPINE_COMPANION_CONFIG_DIR"),
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn recovers_first_valid_downloaded_catalog_model() {
        let root = temp_root("recovery");
        let invalid_dir = root.join("models").join("invalid-model");
        let valid_dir = root.join("models").join("valid-model");
        std::fs::create_dir_all(&invalid_dir).unwrap();
        std::fs::create_dir_all(&valid_dir).unwrap();
        std::fs::write(valid_dir.join("valid.skel"), b"").unwrap();
        std::fs::write(valid_dir.join("valid.png"), b"").unwrap();
        std::fs::write(valid_dir.join("valid.atlas"), "valid.png\nsize: 1,1\n").unwrap();
        let config = serde_json::json!({
            "models": {
                "catalog": [
                    { "id": "invalid-model", "skel": "invalid.skel" },
                    { "id": "valid-model", "skel": "valid.skel" }
                ]
            }
        });
        let recovered = first_recoverable_model(&root, &config).unwrap();
        assert_eq!(recovered.skel, "valid.skel");
        assert_eq!(recovered.asset_dir, valid_dir.canonicalize().unwrap());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn gpu_mode_defaults_to_hardware_and_allows_software() {
        let defaults = ui_settings_from_config(&fallback_config());
        assert_eq!(defaults.gpu_mode, "hardware");

        let config = serde_json::json!({
            "ui": {
                "gpuMode": "software"
            }
        });
        assert_eq!(ui_settings_from_config(&config).gpu_mode, "software");

        let invalid = serde_json::json!({
            "ui": {
                "gpuMode": "auto"
            }
        });
        assert_eq!(ui_settings_from_config(&invalid).gpu_mode, "hardware");
    }

    #[test]
    fn settings_normalization_and_update_channel_defaults_are_unchanged() {
        let defaults = ui_settings_from_config(&fallback_config());
        assert_eq!(defaults.gpu_mode, "hardware");
        assert_eq!(defaults.frame_rate_mode, "display");
        assert_eq!(normalize_drag_mode("compatible"), "compatible");
        assert_eq!(resolved_update_channel("auto", "0.2.6-rc.1"), "prerelease");
        assert_eq!(resolved_update_channel("auto", "0.2.6"), "stable");
        assert_eq!(resolved_update_channel("stable", "0.2.6-rc.1"), "stable");
    }
}

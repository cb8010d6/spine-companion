#[path = "spine_assets.rs"]
pub(crate) mod spine_assets;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const AVATAR_PACK_VERSION: u32 = 1;

pub const AVATAR_JOB_STORE_VERSION: u32 = 1;
const AVATAR_JOB_MAX_COUNT: usize = 100;
const AVATAR_JOB_MAX_HISTORY: usize = 32;
const AVATAR_JOB_MAX_ID_BYTES: usize = 64;
const AVATAR_JOB_MAX_PHASE_BYTES: usize = 64;
const AVATAR_JOB_MAX_MESSAGE_BYTES: usize = 2048;
const AVATAR_JOB_MAX_PATH_BYTES: usize = 2048;
const AVATAR_JOB_MAX_MOTIONS: usize = 32;
const AVATAR_JOB_MAX_MOTION_BYTES: usize = 64;
const AVATAR_JOB_MAX_STORE_BYTES: u64 = 8 * 1024 * 1024;
const AVATAR_JOB_MAX_BACKUPS: usize = 3;
const AVATAR_JOB_LOCK_BYTES: u64 = 1024;
// A valid owner change marks progress; bound each no-progress interval and the
// aggregate wait so a queue cannot wait forever.
const AVATAR_JOB_LOCK_TIMEOUT: Duration = Duration::from_secs(2);
const AVATAR_JOB_LOCK_MAX_WAIT: Duration = Duration::from_secs(10);
const AVATAR_JOB_LOCK_STALE_AFTER: Duration = Duration::from_secs(30);
const AVATAR_JOB_LOCK_RETRY: Duration = Duration::from_millis(20);

const STANDARD_LAYERS: &[&str] = &[
    "hair_back",
    "body",
    "leg_left",
    "leg_right",
    "arm_left",
    "arm_right",
    "head",
];
const STANDARD_MOTIONS: &[&str] = &[
    "idle",
    "working",
    "reviewing",
    "running",
    "success",
    "failed",
    "waiting",
    "sleeping",
    "reminder",
    "interact",
];
const TRANSPARENT_PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarPackInput {
    pub path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarPackCreateInput {
    pub path: String,
    pub id: String,
    pub name: String,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_license_note")]
    pub license_note: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarPackDuplicateInput {
    pub path: String,
    pub destination_parent: String,
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarPoint {
    pub x: f64,
    pub y: f64,
}

impl Default for AvatarPoint {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarScale {
    pub x: f64,
    pub y: f64,
}

impl Default for AvatarScale {
    fn default() -> Self {
        Self { x: 1.0, y: 1.0 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarCrop {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarLayer {
    pub id: String,
    pub file: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub visible: bool,
    #[serde(default)]
    pub order: i32,
    #[serde(default = "default_anchor")]
    pub anchor: AvatarPoint,
    #[serde(default)]
    pub offset: AvatarPoint,
    #[serde(default)]
    pub scale: AvatarScale,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<AvatarCrop>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarPackManifest {
    #[serde(default = "avatar_pack_version", alias = "manifestVersion")]
    pub version: u32,
    pub id: String,
    pub name: String,
    pub source: String,
    pub license_note: String,
    #[serde(default = "default_preview")]
    pub preview: String,
    #[serde(default)]
    pub layers: Vec<AvatarLayer>,
    #[serde(default)]
    pub motions: BTreeMap<String, String>,
    #[serde(default)]
    pub states: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exports: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spine_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_skel: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_atlas: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_ready: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarValidationIssue {
    pub severity: String,
    pub code: String,
    pub path: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarPackLifecycleResult {
    pub path: String,
    pub id: String,
    pub created: bool,
    pub duplicated: bool,
    pub deleted: bool,
    pub repacked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<AvatarValidation>,
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
    pub runtime_atlas: String,
    pub spine_version: String,
    pub atlas_pages: Vec<String>,
    pub textures: Vec<String>,
    pub missing_attachments: Vec<String>,
    pub issues: Vec<AvatarValidationIssue>,
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarJobCreateInput {
    pub job_id: String,
    #[serde(default = "default_avatar_job_phase")]
    pub phase: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub pack_path: Option<String>,
    #[serde(default)]
    pub motions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarJobUpdateInput {
    pub job_id: String,
    #[serde(default)]
    pub phase: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub pack_path: Option<String>,
    #[serde(default)]
    pub motions: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarJobHistoryEntry {
    pub phase: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pack_path: Option<String>,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarJob {
    #[serde(default = "avatar_job_store_version")]
    pub schema_version: u32,
    pub job_id: String,
    pub phase: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pack_path: Option<String>,
    pub motions: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default = "avatar_job_record_type")]
    pub record_type: String,
    #[serde(default = "default_resumable")]
    pub resumable: bool,
    #[serde(default)]
    pub history: Vec<AvatarJobHistoryEntry>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AvatarJobLockMetadata {
    owner: String,
    created_at_ms: u64,
}

struct AvatarJobStoreLock {
    path: PathBuf,
    owner: String,
}

impl Drop for AvatarJobStoreLock {
    fn drop(&mut self) {
        let owner_matches =
            read_bytes_bounded(&self.path, AVATAR_JOB_LOCK_BYTES, "Avatar job lock")
                .ok()
                .and_then(|bytes| serde_json::from_slice::<AvatarJobLockMetadata>(&bytes).ok())
                .is_some_and(|metadata| metadata.owner == self.owner);
        if owner_matches {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub fn requirements() -> Value {
    json!({
        "manifestVersion": AVATAR_PACK_VERSION,
        "layout": ["avatar-pack.json", "preview.png", "layers/", "exports/"],
        "requiredManifestFields": ["version", "id", "name", "source", "licenseNote"],
        "layerFields": ["id", "file", "name", "visible", "order", "anchor", "offset", "scale", "crop"],
        "recommendedLayers": STANDARD_LAYERS,
        "motions": STANDARD_MOTIONS,
        "stateMappings": STANDARD_MOTIONS,
        "runtimeExports": [".skel", ".atlas", ".png"],
        "runtimeFields": ["spineVersion", "runtimeSkel", "runtimeAtlas", "runtimeReady", "attachments"],
        "runtimeSkel": "Required when exports/ contains more than one .skel file; it is relative to exports/.",
        "limits": "Without Spine Editor or another legal export path, Spine Companion can validate and manage an intermediate avatar pack but cannot claim a finished runtime rig.",
        "avatarJobs": {
            "recordType": "planning-progress",
            "storage": "avatar-jobs.json in the application user configuration directory",
            "maxJobs": AVATAR_JOB_MAX_COUNT,
            "maxHistoryEntriesPerJob": AVATAR_JOB_MAX_HISTORY,
            "resumableMeaning": "A persisted record can provide context for explicit AI planning; it does not resume execution, auto-rig, or export Spine runtime files."
        }
    })
}

fn avatar_pack_version() -> u32 {
    AVATAR_PACK_VERSION
}

fn default_true() -> bool {
    true
}

fn default_anchor() -> AvatarPoint {
    AvatarPoint { x: 0.5, y: 0.5 }
}

fn default_preview() -> String {
    "preview.png".to_string()
}

fn default_source() -> String {
    "local".to_string()
}

fn default_license_note() -> String {
    "User-owned local content".to_string()
}

fn default_avatar_job_phase() -> String {
    "planning".to_string()
}

fn avatar_job_store_version() -> u32 {
    AVATAR_JOB_STORE_VERSION
}

fn avatar_job_record_type() -> String {
    "planning-progress".to_string()
}

fn default_resumable() -> bool {
    true
}

fn avatar_job_path(config_dir: &Path) -> PathBuf {
    config_dir.join("avatar-jobs.json")
}

fn avatar_job_lock_path(config_dir: &Path) -> PathBuf {
    config_dir.join("avatar-jobs.lock")
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

fn read_bytes_bounded(path: &Path, max_bytes: u64, label: &str) -> Result<Vec<u8>, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("Cannot inspect {label}: {error}"))?;
    if metadata.len() > max_bytes {
        return Err(format!(
            "{label} exceeds the {max_bytes}-byte safety limit."
        ));
    }
    let file = File::open(path).map_err(|error| format!("Cannot read {label}: {error}"))?;
    let mut bytes = Vec::new();
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read {label}: {error}"))?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "{label} exceeds the {max_bytes}-byte safety limit."
        ));
    }
    Ok(bytes)
}

fn avatar_job_lock_is_stale(path: &Path, stale_after: Duration) -> bool {
    let stale_ms = stale_after.as_millis().min(u64::MAX as u128) as u64;
    if let Ok(bytes) = read_bytes_bounded(path, AVATAR_JOB_LOCK_BYTES, "Avatar job lock") {
        if let Ok(metadata) = serde_json::from_slice::<AvatarJobLockMetadata>(&bytes) {
            if current_timestamp_ms().saturating_sub(metadata.created_at_ms) > stale_ms {
                return true;
            }
        }
    }
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|age| age > stale_after)
}

fn avatar_job_lock_is_contended(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::AlreadyExists
        || error.kind() == std::io::ErrorKind::PermissionDenied
}

fn avatar_job_lock_owner(path: &Path) -> Option<String> {
    read_bytes_bounded(path, AVATAR_JOB_LOCK_BYTES, "Avatar job lock")
        .ok()
        .and_then(|bytes| serde_json::from_slice::<AvatarJobLockMetadata>(&bytes).ok())
        .map(|metadata| metadata.owner)
        .filter(|owner| !owner.trim().is_empty())
}

fn avatar_job_lock_wait_timed_out(
    started_at: Instant,
    no_progress_at: &mut Instant,
    observed_owner: &mut Option<String>,
    owner: Option<&str>,
    now: Instant,
    timeout: Duration,
    max_wait: Duration,
) -> bool {
    if let Some(owner) = owner.filter(|owner| !owner.trim().is_empty()) {
        if observed_owner.as_deref() != Some(owner) {
            *observed_owner = Some(owner.to_string());
            *no_progress_at = now;
        }
    }
    now.duration_since(*no_progress_at) >= timeout || now.duration_since(started_at) >= max_wait
}

fn acquire_avatar_job_lock_with_limits(
    config_dir: &Path,
    timeout: Duration,
    stale_after: Duration,
) -> Result<AvatarJobStoreLock, String> {
    fs::create_dir_all(config_dir).map_err(|error| error.to_string())?;
    let path = avatar_job_lock_path(config_dir);
    let owner = unique_suffix();
    let started_at = Instant::now();
    let mut no_progress_at = started_at;
    let mut observed_owner = None;
    loop {
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                let metadata = AvatarJobLockMetadata {
                    owner: owner.clone(),
                    created_at_ms: current_timestamp_ms(),
                };
                let bytes = match serde_json::to_vec(&metadata) {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        drop(file);
                        let _ = fs::remove_file(&path);
                        return Err(error.to_string());
                    }
                };
                // create_new provides atomic ownership; marker metadata only needs visibility.
                if let Err(error) = file.write_all(&bytes) {
                    drop(file);
                    let _ = fs::remove_file(&path);
                    return Err(format!("Cannot initialize Avatar job lock: {error}"));
                }
                return Ok(AvatarJobStoreLock { path, owner });
            }
            Err(error) if avatar_job_lock_is_contended(&error) => {
                if avatar_job_lock_is_stale(&path, stale_after) {
                    match fs::remove_file(&path) {
                        Ok(()) => continue,
                        Err(remove_error)
                            if remove_error.kind() == std::io::ErrorKind::NotFound =>
                        {
                            continue
                        }
                        Err(_) => {}
                    }
                }
                let now = Instant::now();
                if avatar_job_lock_wait_timed_out(
                    started_at,
                    &mut no_progress_at,
                    &mut observed_owner,
                    avatar_job_lock_owner(&path).as_deref(),
                    now,
                    timeout,
                    AVATAR_JOB_LOCK_MAX_WAIT,
                ) {
                    return Err(format!(
                        "Avatar job store is busy; lock acquisition exceeded the {} ms no-progress timeout or {} ms hard cap.",
                        timeout.as_millis(),
                        AVATAR_JOB_LOCK_MAX_WAIT.as_millis()
                    ));
                }
                let no_progress_deadline = no_progress_at + timeout;
                let hard_deadline = started_at + AVATAR_JOB_LOCK_MAX_WAIT;
                let sleep_for = AVATAR_JOB_LOCK_RETRY
                    .min(no_progress_deadline.saturating_duration_since(now))
                    .min(hard_deadline.saturating_duration_since(now));
                if !sleep_for.is_zero() {
                    thread::sleep(sleep_for);
                }
            }
            Err(error) => return Err(format!("Cannot acquire Avatar job lock: {error}")),
        }
    }
}

fn acquire_avatar_job_lock(config_dir: &Path) -> Result<AvatarJobStoreLock, String> {
    acquire_avatar_job_lock_with_limits(
        config_dir,
        AVATAR_JOB_LOCK_TIMEOUT,
        AVATAR_JOB_LOCK_STALE_AFTER,
    )
}

fn validate_job_text(
    value: &str,
    label: &str,
    max_bytes: usize,
    required: bool,
) -> Result<String, String> {
    let value = value.trim();
    if required && value.is_empty() {
        return Err(format!("{label} must not be empty."));
    }
    if value.len() > max_bytes {
        return Err(format!("{label} must be at most {max_bytes} bytes."));
    }
    if value
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(format!(
            "{label} contains an unsupported control character."
        ));
    }
    Ok(value.to_string())
}

fn validate_structured_job_text(
    value: &str,
    label: &str,
    max_bytes: usize,
    required: bool,
) -> Result<String, String> {
    if value.chars().any(char::is_control) {
        return Err(format!("{label} must not contain control characters."));
    }
    validate_job_text(value, label, max_bytes, required)
}

fn validate_avatar_job_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.len() > AVATAR_JOB_MAX_ID_BYTES || !is_safe_avatar_id(value) {
        return Err("Avatar job ID must use 1-64 ASCII letters, digits, underscores, or hyphens and start with a letter or digit.".to_string());
    }
    Ok(value.to_string())
}

fn validate_avatar_job_pack_path(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = validate_structured_job_text(
        &value,
        "Avatar job packPath",
        AVATAR_JOB_MAX_PATH_BYTES,
        true,
    )?;
    let path = PathBuf::from(&value);
    if !path.is_absolute() {
        return Err(
            "Avatar job packPath must be an absolute local path when provided.".to_string(),
        );
    }
    if path.exists() {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("Cannot resolve Avatar job packPath: {error}"))?;
        if !canonical.is_dir() {
            return Err(
                "Avatar job packPath must point to a directory when it exists.".to_string(),
            );
        }
        return Ok(Some(canonical.to_string_lossy().to_string()));
    }
    Ok(Some(value))
}

fn validate_avatar_job_motions(values: Vec<String>) -> Result<Vec<String>, String> {
    if values.len() > AVATAR_JOB_MAX_MOTIONS {
        return Err(format!(
            "Avatar job motions must contain at most {} items.",
            AVATAR_JOB_MAX_MOTIONS
        ));
    }
    let mut motions = Vec::with_capacity(values.len());
    for value in values {
        let value = validate_structured_job_text(
            &value,
            "Avatar job motion",
            AVATAR_JOB_MAX_MOTION_BYTES,
            true,
        )?;
        if !motions.contains(&value) {
            motions.push(value);
        }
    }
    Ok(motions)
}

fn is_terminal_avatar_job_phase(phase: &str) -> bool {
    matches!(
        phase.trim().to_ascii_lowercase().as_str(),
        "complete" | "completed" | "success" | "succeeded" | "failed" | "cancelled" | "canceled"
    )
}

fn normalize_avatar_job(job: &mut AvatarJob) -> Result<(), String> {
    job.schema_version = AVATAR_JOB_STORE_VERSION;
    job.job_id = validate_avatar_job_id(&job.job_id)?;
    job.phase = validate_structured_job_text(
        &job.phase,
        "Avatar job phase",
        AVATAR_JOB_MAX_PHASE_BYTES,
        true,
    )?;
    job.message = validate_job_text(
        &job.message,
        "Avatar job message",
        AVATAR_JOB_MAX_MESSAGE_BYTES,
        false,
    )?;
    job.pack_path = validate_avatar_job_pack_path(job.pack_path.take())?;
    job.motions = validate_avatar_job_motions(std::mem::take(&mut job.motions))?;
    job.record_type = avatar_job_record_type();
    job.resumable = !is_terminal_avatar_job_phase(&job.phase);
    if job.history.len() > AVATAR_JOB_MAX_HISTORY {
        let start = job.history.len() - AVATAR_JOB_MAX_HISTORY;
        job.history = job.history.split_off(start);
    }
    for entry in &mut job.history {
        entry.phase = validate_structured_job_text(
            &entry.phase,
            "Avatar job history phase",
            AVATAR_JOB_MAX_PHASE_BYTES,
            true,
        )?;
        entry.message = validate_job_text(
            &entry.message,
            "Avatar job history message",
            AVATAR_JOB_MAX_MESSAGE_BYTES,
            false,
        )?;
        entry.pack_path = validate_avatar_job_pack_path(entry.pack_path.take())?;
    }
    Ok(())
}

fn parse_avatar_jobs(bytes: &[u8], label: &str) -> Result<Vec<AvatarJob>, String> {
    let mut jobs: Vec<AvatarJob> =
        serde_json::from_slice(bytes).map_err(|error| format!("Invalid {label}: {error}"))?;
    if jobs.len() > AVATAR_JOB_MAX_COUNT {
        return Err("Avatar job store contains too many jobs.".to_string());
    }
    for job in &mut jobs {
        normalize_avatar_job(job)?;
    }
    jobs.sort_by_key(|job| std::cmp::Reverse(job.updated_at));
    Ok(jobs)
}

fn read_avatar_jobs_file(path: &Path, label: &str) -> Result<Vec<AvatarJob>, String> {
    let bytes = read_bytes_bounded(path, AVATAR_JOB_MAX_STORE_BYTES, label)?;
    parse_avatar_jobs(&bytes, label)
}

fn avatar_job_files_with_prefix(
    config_dir: &Path,
    prefixes: &[&str],
) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(config_dir)
        .map_err(|error| format!("Cannot inspect Avatar job recovery files: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("Cannot inspect an Avatar job recovery file: {error}"))?;
        if !entry
            .file_type()
            .map_err(|error| format!("Cannot inspect an Avatar job recovery file: {error}"))?
            .is_file()
        {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if prefixes.iter().any(|prefix| name.starts_with(prefix)) {
            paths.push(entry.path());
        }
    }
    paths.sort_by_key(|path| {
        let modified = fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        (modified, path.file_name().map(|name| name.to_os_string()))
    });
    Ok(paths)
}

fn avatar_job_backup_candidates(config_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = avatar_job_files_with_prefix(
        config_dir,
        &["avatar-jobs.backup-", "avatar-jobs.json.backup-"],
    )?;
    paths.reverse();
    paths.truncate(AVATAR_JOB_MAX_BACKUPS * 2);
    Ok(paths)
}

fn prune_avatar_job_files(config_dir: &Path, prefixes: &[&str], keep: usize) -> Result<(), String> {
    let paths = avatar_job_files_with_prefix(config_dir, prefixes)?;
    let remove_count = paths.len().saturating_sub(keep);
    for path in paths.into_iter().take(remove_count) {
        fs::remove_file(&path).map_err(|error| {
            format!(
                "Cannot prune Avatar job recovery file {}: {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

fn write_bytes_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_extension(format!("tmp-{}", unique_suffix()));
    let result = (|| {
        let mut file = File::create(&temp).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        replace_file_atomically(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn write_avatar_jobs_locked(config_dir: &Path, jobs: &[AvatarJob]) -> Result<(), String> {
    if jobs.len() > AVATAR_JOB_MAX_COUNT {
        return Err("Avatar job store contains too many jobs.".to_string());
    }
    let bytes = serde_json::to_vec_pretty(jobs).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > AVATAR_JOB_MAX_STORE_BYTES {
        return Err("Avatar job store exceeds the safety limit.".to_string());
    }
    fs::create_dir_all(config_dir).map_err(|error| error.to_string())?;
    prune_avatar_job_files(
        config_dir,
        &["avatar-jobs.backup-", "avatar-jobs.json.backup-"],
        AVATAR_JOB_MAX_BACKUPS.saturating_sub(1),
    )?;
    let backup = config_dir.join(format!(
        "avatar-jobs.backup-{}-{}.json",
        current_timestamp_ms(),
        unique_suffix()
    ));
    write_bytes_atomically(&backup, &bytes)
        .map_err(|error| format!("Cannot write Avatar job backup: {error}"))?;
    if let Err(error) = write_bytes_atomically(&avatar_job_path(config_dir), &bytes) {
        let _ = fs::remove_file(&backup);
        return Err(format!("Cannot write Avatar job store: {error}"));
    }
    Ok(())
}

fn recover_avatar_jobs(
    config_dir: &Path,
    main_error: &str,
    main_exists: bool,
) -> Result<Vec<AvatarJob>, String> {
    let backups = avatar_job_backup_candidates(config_dir)?;
    let mut invalid_backups = 0;
    for backup in backups {
        let Ok(jobs) = read_avatar_jobs_file(&backup, "Avatar job backup") else {
            invalid_backups += 1;
            continue;
        };
        if main_exists {
            prune_avatar_job_files(
                config_dir,
                &["avatar-jobs.corrupt-"],
                AVATAR_JOB_MAX_BACKUPS.saturating_sub(1),
            )?;
            let quarantine = config_dir.join(format!(
                "avatar-jobs.corrupt-{}-{}.json",
                current_timestamp_ms(),
                unique_suffix()
            ));
            fs::rename(avatar_job_path(config_dir), &quarantine)
                .map_err(|error| format!("Cannot isolate the damaged Avatar job store: {error}"))?;
        }
        write_avatar_jobs_locked(config_dir, &jobs).map_err(|error| {
            format!("Avatar job backup was valid but restoring it failed: {error}")
        })?;
        return Ok(jobs);
    }
    Err(format!(
        "{main_error}; no valid Avatar job backup was available ({invalid_backups} invalid backup files checked). The damaged store was preserved."
    ))
}

fn load_avatar_jobs_locked(config_dir: &Path) -> Result<Vec<AvatarJob>, String> {
    let path = avatar_job_path(config_dir);
    let main_exists = match fs::symlink_metadata(&path) {
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(format!("Cannot inspect Avatar job store: {error}")),
    };
    if main_exists {
        match read_avatar_jobs_file(&path, "Avatar job store") {
            Ok(jobs) => return Ok(jobs),
            Err(error) => return recover_avatar_jobs(config_dir, &error, true),
        }
    }
    let backups = avatar_job_backup_candidates(config_dir)?;
    if backups.is_empty() {
        return Ok(Vec::new());
    }
    recover_avatar_jobs(
        config_dir,
        "Avatar job store is missing after an interrupted write",
        false,
    )
}

pub fn load_avatar_jobs(config_dir: &Path) -> Result<Vec<AvatarJob>, String> {
    let _lock = acquire_avatar_job_lock(config_dir)?;
    load_avatar_jobs_locked(config_dir)
}

fn trim_avatar_jobs(jobs: &mut Vec<AvatarJob>) {
    while jobs.len() > AVATAR_JOB_MAX_COUNT {
        let index = jobs
            .iter()
            .enumerate()
            .min_by_key(|(_, job)| (!is_terminal_avatar_job_phase(&job.phase), job.updated_at))
            .map(|(index, _)| index)
            .unwrap_or(0);
        jobs.remove(index);
    }
}

fn append_avatar_job_history(job: &mut AvatarJob) {
    job.history.push(AvatarJobHistoryEntry {
        phase: job.phase.clone(),
        message: job.message.clone(),
        pack_path: job.pack_path.clone(),
        updated_at: job.updated_at,
    });
    if job.history.len() > AVATAR_JOB_MAX_HISTORY {
        let start = job.history.len() - AVATAR_JOB_MAX_HISTORY;
        job.history = job.history.split_off(start);
    }
}

pub fn create_avatar_job(
    config_dir: &Path,
    input: AvatarJobCreateInput,
) -> Result<AvatarJob, String> {
    let job_id = validate_avatar_job_id(&input.job_id)?;
    let phase = validate_structured_job_text(
        &input.phase,
        "Avatar job phase",
        AVATAR_JOB_MAX_PHASE_BYTES,
        true,
    )?;
    let message = validate_job_text(
        &input.message,
        "Avatar job message",
        AVATAR_JOB_MAX_MESSAGE_BYTES,
        false,
    )?;
    let pack_path = validate_avatar_job_pack_path(input.pack_path)?;
    let motions = validate_avatar_job_motions(input.motions)?;
    let _lock = acquire_avatar_job_lock(config_dir)?;
    let mut jobs = load_avatar_jobs_locked(config_dir)?;
    if jobs.iter().any(|job| job.job_id == job_id) {
        return Err(format!(
            "Avatar job '{job_id}' already exists; use companion_update_avatar_job to continue it."
        ));
    }
    let now = current_timestamp();
    let mut job = AvatarJob {
        schema_version: AVATAR_JOB_STORE_VERSION,
        job_id,
        phase,
        message,
        pack_path,
        motions,
        created_at: now,
        updated_at: now,
        record_type: avatar_job_record_type(),
        resumable: true,
        history: Vec::new(),
    };
    job.resumable = !is_terminal_avatar_job_phase(&job.phase);
    append_avatar_job_history(&mut job);
    jobs.push(job.clone());
    trim_avatar_jobs(&mut jobs);
    write_avatar_jobs_locked(config_dir, &jobs)?;
    Ok(job)
}

pub fn update_avatar_job(
    config_dir: &Path,
    input: AvatarJobUpdateInput,
) -> Result<AvatarJob, String> {
    let job_id = validate_avatar_job_id(&input.job_id)?;
    let phase = input
        .phase
        .map(|value| {
            validate_structured_job_text(
                &value,
                "Avatar job phase",
                AVATAR_JOB_MAX_PHASE_BYTES,
                true,
            )
        })
        .transpose()?;
    let message = input
        .message
        .map(|value| {
            validate_job_text(
                &value,
                "Avatar job message",
                AVATAR_JOB_MAX_MESSAGE_BYTES,
                false,
            )
        })
        .transpose()?;
    let has_pack_path = input.pack_path.is_some();
    let pack_path = input
        .pack_path
        .map(|value| validate_avatar_job_pack_path(Some(value)))
        .transpose()?
        .flatten();
    let motions = input.motions.map(validate_avatar_job_motions).transpose()?;
    if phase.is_none() && message.is_none() && pack_path.is_none() && motions.is_none() {
        return Err(
            "Avatar job update must include phase, message, packPath, or motions.".to_string(),
        );
    }
    let _lock = acquire_avatar_job_lock(config_dir)?;
    let mut jobs = load_avatar_jobs_locked(config_dir)?;
    let job = jobs
        .iter_mut()
        .find(|job| job.job_id == job_id)
        .ok_or_else(|| format!("Avatar job '{job_id}' was not found."))?;
    if let Some(phase) = phase {
        job.phase = phase;
    }
    if let Some(message) = message {
        job.message = message;
    }
    if has_pack_path {
        job.pack_path = pack_path;
    }
    if let Some(motions) = motions {
        job.motions = motions;
    }
    job.updated_at = current_timestamp().max(job.updated_at.saturating_add(1));
    job.resumable = !is_terminal_avatar_job_phase(&job.phase);
    append_avatar_job_history(job);
    let result = job.clone();
    write_avatar_jobs_locked(config_dir, &jobs)?;
    Ok(result)
}

pub fn get_avatar_job(config_dir: &Path, job_id: &str) -> Result<AvatarJob, String> {
    let job_id = validate_avatar_job_id(job_id)?;
    load_avatar_jobs(config_dir)?
        .into_iter()
        .find(|job| job.job_id == job_id)
        .ok_or_else(|| format!("Avatar job '{job_id}' was not found."))
}

fn standard_manifest(
    id: String,
    name: String,
    source: String,
    license_note: String,
) -> AvatarPackManifest {
    let layers = STANDARD_LAYERS
        .iter()
        .enumerate()
        .map(|(order, id)| AvatarLayer {
            id: (*id).to_string(),
            file: format!("layers/{id}.png"),
            name: id.replace('_', " "),
            visible: true,
            order: order as i32,
            anchor: default_anchor(),
            offset: AvatarPoint::default(),
            scale: AvatarScale::default(),
            crop: None,
        })
        .collect();
    let motions = STANDARD_MOTIONS
        .iter()
        .map(|motion| ((*motion).to_string(), (*motion).to_string()))
        .collect();
    let states = STANDARD_MOTIONS
        .iter()
        .map(|state| ((*state).to_string(), (*state).to_string()))
        .collect();
    AvatarPackManifest {
        version: AVATAR_PACK_VERSION,
        id,
        name,
        source,
        license_note,
        preview: default_preview(),
        layers,
        motions,
        states,
        exports: Vec::new(),
        attachments: Vec::new(),
        spine_version: None,
        runtime_skel: None,
        runtime_atlas: None,
        runtime_ready: None,
        extra: Map::new(),
    }
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

pub fn load_manifest(path: &Path) -> Result<AvatarPackManifest, String> {
    let manifest = path.join("avatar-pack.json");
    let text = fs::read_to_string(&manifest)
        .map_err(|error| format!("Cannot read avatar-pack.json: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("Invalid avatar-pack.json: {error}"))
}

pub fn save_manifest(
    path: &Path,
    mut manifest: AvatarPackManifest,
) -> Result<AvatarValidation, String> {
    ensure_existing_pack_root(path)?;
    manifest.version = AVATAR_PACK_VERSION;
    write_json_atomically(&path.join("avatar-pack.json"), &manifest)?;
    Ok(validate_pack(path))
}

pub fn create_standard_pack(
    input: AvatarPackCreateInput,
) -> Result<AvatarPackLifecycleResult, String> {
    let root = PathBuf::from(&input.path);
    if root.exists() {
        return Err("Avatar pack destination already exists.".to_string());
    }
    if !is_safe_avatar_id(input.id.trim()) {
        return Err("Avatar ID must use 1-64 ASCII letters, digits, underscores, or hyphens and start with a letter or digit.".to_string());
    }
    if input.name.trim().is_empty() {
        return Err("Avatar name must not be empty.".to_string());
    }
    let parent = root
        .parent()
        .ok_or_else(|| "Avatar pack destination must have a parent directory.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let staging = sibling_staging_path(&root, "create")?;
    let manifest = standard_manifest(
        input.id.trim().to_string(),
        input.name.trim().to_string(),
        non_empty_or(input.source, default_source()),
        non_empty_or(input.license_note, default_license_note()),
    );
    let result = (|| {
        fs::create_dir(&staging).map_err(|error| error.to_string())?;
        fs::create_dir(staging.join("layers")).map_err(|error| error.to_string())?;
        fs::create_dir(staging.join("exports")).map_err(|error| error.to_string())?;
        fs::write(staging.join("preview.png"), TRANSPARENT_PNG)
            .map_err(|error| error.to_string())?;
        for layer in &manifest.layers {
            fs::write(staging.join(&layer.file), TRANSPARENT_PNG)
                .map_err(|error| error.to_string())?;
        }
        write_json_atomically(&staging.join("avatar-pack.json"), &manifest)?;
        let validation = validate_pack(&staging);
        if !validation.ok {
            return Err(format!(
                "Generated avatar pack failed validation: {}",
                validation.errors.join("; ")
            ));
        }
        fs::rename(&staging, &root).map_err(|error| error.to_string())?;
        Ok(validate_pack(&root))
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    let validation = result?;
    Ok(AvatarPackLifecycleResult {
        path: root.to_string_lossy().to_string(),
        id: validation.id.clone(),
        created: true,
        duplicated: false,
        deleted: false,
        repacked: false,
        validation: Some(validation),
    })
}

pub fn duplicate_pack(
    input: AvatarPackDuplicateInput,
) -> Result<AvatarPackLifecycleResult, String> {
    let source = PathBuf::from(&input.path);
    let mut manifest = load_manifest(&source)?;
    if !is_safe_avatar_id(input.id.trim()) {
        return Err("Avatar ID must use 1-64 ASCII letters, digits, underscores, or hyphens and start with a letter or digit.".to_string());
    }
    if input.name.trim().is_empty() {
        return Err("Avatar name must not be empty.".to_string());
    }
    let destination_parent = PathBuf::from(&input.destination_parent);
    fs::create_dir_all(&destination_parent).map_err(|error| error.to_string())?;
    let destination = destination_parent.join(input.id.trim());
    if destination.exists() {
        return Err("Avatar pack destination already exists.".to_string());
    }
    let staging = sibling_staging_path(&destination, "duplicate")?;
    let result = (|| {
        copy_tree(&source, &staging)?;
        manifest.version = AVATAR_PACK_VERSION;
        manifest.id = input.id.trim().to_string();
        manifest.name = input.name.trim().to_string();
        write_json_atomically(&staging.join("avatar-pack.json"), &manifest)?;
        let validation = validate_pack(&staging);
        if !validation.ok {
            return Err(format!(
                "Duplicated avatar pack failed validation: {}",
                validation.errors.join("; ")
            ));
        }
        fs::rename(&staging, &destination).map_err(|error| error.to_string())?;
        Ok(validate_pack(&destination))
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    let validation = result?;
    Ok(AvatarPackLifecycleResult {
        path: destination.to_string_lossy().to_string(),
        id: validation.id.clone(),
        created: false,
        duplicated: true,
        deleted: false,
        repacked: false,
        validation: Some(validation),
    })
}

pub fn delete_pack(path: &Path) -> Result<AvatarPackLifecycleResult, String> {
    let manifest = load_manifest(path)?;
    let root = path
        .canonicalize()
        .map_err(|error| format!("Cannot read avatar pack: {error}"))?;
    if !root.is_dir() {
        return Err("Avatar pack path must be a directory.".to_string());
    }
    let tombstone = sibling_staging_path(&root, "delete")?;
    fs::rename(&root, &tombstone).map_err(|error| error.to_string())?;
    if let Err(error) = fs::remove_dir_all(&tombstone) {
        let _ = fs::rename(&tombstone, &root);
        return Err(error.to_string());
    }
    Ok(AvatarPackLifecycleResult {
        path: root.to_string_lossy().to_string(),
        id: manifest.id,
        created: false,
        duplicated: false,
        deleted: true,
        repacked: false,
        validation: None,
    })
}

pub fn repack_pack(path: &Path) -> Result<AvatarPackLifecycleResult, String> {
    let root = path
        .canonicalize()
        .map_err(|error| format!("Cannot read avatar pack: {error}"))?;
    let mut manifest = load_manifest(&root)?;
    let staging = sibling_staging_path(&root, "repack")?;
    let result = (|| {
        copy_tree(&root, &staging)?;
        manifest.version = AVATAR_PACK_VERSION;
        write_json_atomically(&staging.join("avatar-pack.json"), &manifest)?;
        let validation = validate_pack(&staging);
        if !validation.ok {
            return Err(format!(
                "Repacked avatar pack failed validation: {}",
                validation.errors.join("; ")
            ));
        }
        let backup = replace_directory_atomically(&staging, &root)?;
        if let Some(backup) = backup {
            fs::remove_dir_all(backup).map_err(|error| error.to_string())?;
        }
        Ok(validate_pack(&root))
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    let validation = result?;
    Ok(AvatarPackLifecycleResult {
        path: root.to_string_lossy().to_string(),
        id: validation.id.clone(),
        created: false,
        duplicated: false,
        deleted: false,
        repacked: true,
        validation: Some(validation),
    })
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
    let mut issues = Vec::new();
    let mut id = String::new();
    let mut name = String::new();
    let manifest = match load_manifest(root) {
        Ok(value) => Some(value),
        Err(error) => {
            push_issue(
                &mut issues,
                &mut errors,
                "error",
                "manifest.invalid",
                "avatar-pack.json",
                error,
            );
            None
        }
    };

    if let Some(manifest) = &manifest {
        id = manifest.id.trim().to_string();
        name = manifest.name.trim().to_string();
        validate_manifest_model(root, manifest, &mut issues, &mut errors, &mut warnings);
        if !id.is_empty() && !is_safe_avatar_id(&id) {
            push_issue(
                &mut issues,
                &mut errors,
                "error",
                "manifest.id.unsafe",
                "id",
                "Manifest id is unsafe. Use 1-64 ASCII letters, digits, underscores, or hyphens and start with a letter or digit.",
            );
        }
    }

    let preview = manifest
        .as_ref()
        .map(|value| value.preview.as_str())
        .unwrap_or("preview.png");
    let has_preview = contained_pack_file(root, preview).is_ok();
    let has_layers_dir = root.join("layers").is_dir();
    let has_exports_dir = root.join("exports").is_dir();
    if !has_preview {
        push_issue(
            &mut issues,
            &mut errors,
            "error",
            "preview.missing",
            "preview",
            format!("Missing {preview}"),
        );
    }
    if !has_layers_dir {
        push_issue(
            &mut issues,
            &mut errors,
            "error",
            "layers.directoryMissing",
            "layers",
            "Missing layers/ directory",
        );
    }

    if has_exports_dir {
        if let Some(manifest) = &manifest {
            validate_declared_exports(
                &manifest.exports,
                &root.join("exports"),
                &mut issues,
                &mut errors,
            );
        }
    } else if manifest
        .as_ref()
        .is_some_and(|value| !value.exports.is_empty())
    {
        push_issue(
            &mut issues,
            &mut errors,
            "error",
            "exports.directoryMissing",
            "exports",
            "Manifest declares exports but exports/ directory is missing.",
        );
    }

    let mut runtime_skel = String::new();
    let mut runtime_atlas = String::new();
    let mut spine_version = manifest
        .as_ref()
        .and_then(|value| value.spine_version.clone())
        .unwrap_or_default();
    let mut atlas_pages = Vec::new();
    let mut textures = Vec::new();
    let mut missing_attachments = Vec::new();
    let mut runtime_ready = false;
    if !has_exports_dir {
        push_issue(
            &mut issues,
            &mut warnings,
            "warning",
            "runtime.exportsMissing",
            "exports",
            "Missing exports/ directory. This pack is a draft and runtime installation is unavailable.",
        );
    } else if let Some(manifest) = &manifest {
        let exports = root.join("exports");
        let manifest_value = serde_json::to_value(manifest).unwrap_or(Value::Null);
        match validate_runtime_fields(&manifest_value, &exports) {
            Ok(fields) => {
                let skeletons = spine_assets::list_skeletons(&exports).unwrap_or_else(|error| {
                    runtime_errors.push(error);
                    Vec::new()
                });
                match choose_runtime_skel(&skeletons, fields.runtime_skel.as_deref()) {
                    Ok(Some(selected)) => {
                        match spine_assets::validate_spine_asset_dir(&exports, &selected) {
                            Ok(asset_set) => {
                                runtime_skel = selected;
                                runtime_atlas = choose_runtime_atlas(
                                    &asset_set.atlas_files,
                                    fields.runtime_atlas.as_deref(),
                                )
                                .unwrap_or_default();
                                atlas_pages = asset_set.atlas_texture_refs.clone();
                                textures = asset_set.texture_files.clone();
                                if spine_version.is_empty() {
                                    spine_version =
                                        read_spine_binary_version(&exports.join(&runtime_skel))
                                            .unwrap_or_default();
                                }
                                missing_attachments = find_missing_attachments(
                                    &exports,
                                    &asset_set.atlas_files,
                                    &manifest.attachments,
                                );
                                runtime_ready = true;
                                if !missing_attachments.is_empty() {
                                    runtime_errors.push(format!(
                                        "Missing atlas attachment region(s): {}",
                                        missing_attachments.join(", ")
                                    ));
                                    runtime_ready = false;
                                }
                                if !spine_version.is_empty() && !spine_version.starts_with("3.8") {
                                    runtime_errors.push(format!(
                                        "Unsupported Spine runtime version {spine_version}; expected Spine 3.8."
                                    ));
                                    runtime_ready = false;
                                }
                            }
                            Err(error) => runtime_errors.push(error),
                        }
                    }
                    Ok(None) => push_issue(
                        &mut issues,
                        &mut warnings,
                        "warning",
                        "runtime.skeletonMissing",
                        "runtimeSkel",
                        "exports/ has no .skel runtime export. This pack remains a draft.",
                    ),
                    Err(error) => push_issue(
                        &mut issues,
                        &mut errors,
                        "error",
                        "runtime.skeletonSelection",
                        "runtimeSkel",
                        error,
                    ),
                }
                if fields.runtime_ready == Some(true) && !runtime_ready {
                    push_issue(
                        &mut issues,
                        &mut errors,
                        "error",
                        "runtime.readyMismatch",
                        "runtimeReady",
                        "Manifest runtimeReady is true, but exports/ is not a valid Spine runtime set.",
                    );
                }
            }
            Err(field_errors) => {
                for error in field_errors {
                    push_issue(
                        &mut issues,
                        &mut errors,
                        "error",
                        "runtime.fieldInvalid",
                        runtime_error_path(&error),
                        error,
                    );
                }
            }
        }
    }

    if !runtime_errors.is_empty() {
        runtime_errors.sort();
        runtime_errors.dedup();
        let message = format!(
            "Runtime exports are not installable yet: {}",
            runtime_errors.join("; ")
        );
        push_issue(
            &mut issues,
            &mut warnings,
            "runtime",
            "runtime.invalid",
            "exports",
            message,
        );
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
        runtime_atlas,
        spine_version,
        atlas_pages,
        textures,
        missing_attachments,
        issues,
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

fn validate_manifest_model(
    root: &Path,
    manifest: &AvatarPackManifest,
    issues: &mut Vec<AvatarValidationIssue>,
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
) {
    if manifest.version != AVATAR_PACK_VERSION {
        push_issue(
            issues,
            errors,
            "error",
            "manifest.version.unsupported",
            "version",
            format!(
                "Unsupported avatar pack version {}; expected {}.",
                manifest.version, AVATAR_PACK_VERSION
            ),
        );
    }
    for (path, value) in [
        ("id", manifest.id.as_str()),
        ("name", manifest.name.as_str()),
        ("source", manifest.source.as_str()),
        ("licenseNote", manifest.license_note.as_str()),
    ] {
        if value.trim().is_empty() {
            push_issue(
                issues,
                errors,
                "error",
                "manifest.required",
                path,
                format!("Missing required manifest field: {path}"),
            );
        }
    }
    if let Err(error) = validate_pack_relative_file(root, &manifest.preview, None) {
        push_issue(
            issues,
            errors,
            "error",
            "preview.invalid",
            "preview",
            format!("Invalid preview path: {error}"),
        );
    }

    let mut layer_ids = HashSet::new();
    let mut orders = BTreeSet::new();
    for (index, layer) in manifest.layers.iter().enumerate() {
        let prefix = format!("layers[{index}]");
        if layer.id.trim().is_empty() {
            push_issue(
                issues,
                errors,
                "error",
                "layer.id.required",
                format!("{prefix}.id"),
                "Layer id must not be empty.",
            );
        } else if !is_safe_avatar_id(&layer.id) {
            push_issue(
                issues,
                errors,
                "error",
                "layer.id.unsafe",
                format!("{prefix}.id"),
                "Layer id must use safe ASCII letters, digits, underscores, or hyphens.",
            );
        } else if !layer_ids.insert(layer.id.clone()) {
            push_issue(
                issues,
                errors,
                "error",
                "layer.id.duplicate",
                format!("{prefix}.id"),
                format!("Duplicate layer id: {}", layer.id),
            );
        }
        if layer.name.trim().is_empty() {
            push_issue(
                issues,
                errors,
                "error",
                "layer.name.required",
                format!("{prefix}.name"),
                "Layer name must not be empty.",
            );
        }
        if let Err(error) = validate_pack_relative_file(root, &layer.file, Some("layers")) {
            push_issue(
                issues,
                errors,
                "error",
                "layer.file.invalid",
                format!("{prefix}.file"),
                format!("Invalid layer file: {error}"),
            );
        }
        if !orders.insert(layer.order) {
            push_issue(
                issues,
                warnings,
                "warning",
                "layer.order.duplicate",
                format!("{prefix}.order"),
                format!("Multiple layers use order {}.", layer.order),
            );
        }
        validate_layer_geometry(layer, &prefix, issues, errors);
    }

    for (motion, animation) in &manifest.motions {
        if motion.trim().is_empty() || animation.trim().is_empty() {
            push_issue(
                issues,
                errors,
                "error",
                "motion.invalid",
                format!("motions.{motion}"),
                "Motion keys and animation names must not be empty.",
            );
        }
    }
    for (state, motion) in &manifest.states {
        if state.trim().is_empty() || motion.trim().is_empty() {
            push_issue(
                issues,
                errors,
                "error",
                "state.invalid",
                format!("states.{state}"),
                "State keys and motion mappings must not be empty.",
            );
        } else if !manifest.motions.contains_key(motion) {
            push_issue(
                issues,
                warnings,
                "warning",
                "state.motionMissing",
                format!("states.{state}"),
                format!("State {state} maps to undeclared motion {motion}."),
            );
        }
    }
}

fn validate_layer_geometry(
    layer: &AvatarLayer,
    prefix: &str,
    issues: &mut Vec<AvatarValidationIssue>,
    errors: &mut Vec<String>,
) {
    for (path, value) in [
        (format!("{prefix}.anchor.x"), layer.anchor.x),
        (format!("{prefix}.anchor.y"), layer.anchor.y),
    ] {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            push_issue(
                issues,
                errors,
                "error",
                "layer.anchor.invalid",
                path,
                "Layer anchor coordinates must be finite values from 0 to 1.",
            );
        }
    }
    for (path, value) in [
        (format!("{prefix}.offset.x"), layer.offset.x),
        (format!("{prefix}.offset.y"), layer.offset.y),
    ] {
        if !value.is_finite() {
            push_issue(
                issues,
                errors,
                "error",
                "layer.offset.invalid",
                path,
                "Layer offsets must be finite numbers.",
            );
        }
    }
    for (path, value) in [
        (format!("{prefix}.scale.x"), layer.scale.x),
        (format!("{prefix}.scale.y"), layer.scale.y),
    ] {
        if !value.is_finite() || value <= 0.0 {
            push_issue(
                issues,
                errors,
                "error",
                "layer.scale.invalid",
                path,
                "Layer scale values must be finite and greater than zero.",
            );
        }
    }
    if let Some(crop) = &layer.crop {
        if [crop.x, crop.y, crop.width, crop.height]
            .iter()
            .any(|value| !value.is_finite())
            || crop.x < 0.0
            || crop.y < 0.0
            || crop.width <= 0.0
            || crop.height <= 0.0
        {
            push_issue(
                issues,
                errors,
                "error",
                "layer.crop.invalid",
                format!("{prefix}.crop"),
                "Layer crop must use finite non-negative coordinates and positive dimensions.",
            );
        }
    }
}

fn validate_declared_exports(
    entries: &[String],
    exports_dir: &Path,
    issues: &mut Vec<AvatarValidationIssue>,
    errors: &mut Vec<String>,
) {
    for (index, value) in entries.iter().enumerate() {
        match contained_export_file(exports_dir, value) {
            Ok(_) => {}
            Err(error) => push_issue(
                issues,
                errors,
                "error",
                "exports.pathInvalid",
                format!("exports[{index}]"),
                format!("Invalid manifest export {value:?}: {error}"),
            ),
        }
    }
}

struct RuntimeFields {
    runtime_skel: Option<String>,
    runtime_atlas: Option<String>,
    runtime_ready: Option<bool>,
}

fn validate_runtime_fields(
    manifest: &Value,
    exports_dir: &Path,
) -> Result<RuntimeFields, Vec<String>> {
    let mut errors = Vec::new();
    let runtime_skel =
        optional_runtime_path(manifest, "runtimeSkel", "skel", exports_dir, &mut errors);
    let runtime_atlas =
        optional_runtime_path(manifest, "runtimeAtlas", "atlas", exports_dir, &mut errors);
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
            runtime_atlas,
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
    let value = manifest.get(key)?;
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

fn contained_pack_file(root: &Path, value: &str) -> Result<PathBuf, String> {
    let relative = spine_assets::safe_relative_path(value)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Cannot read avatar pack: {error}"))?;
    let candidate = canonical_root.join(relative);
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "file does not exist under the avatar pack.".to_string())?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err("file must stay inside the avatar pack.".to_string());
    }
    Ok(canonical)
}

fn validate_pack_relative_file(
    root: &Path,
    value: &str,
    required_directory: Option<&str>,
) -> Result<PathBuf, String> {
    let relative = spine_assets::safe_relative_path(value)?;
    if let Some(required_directory) = required_directory {
        if relative
            .components()
            .next()
            .and_then(|value| value.as_os_str().to_str())
            != Some(required_directory)
        {
            return Err(format!("path must be inside {required_directory}/."));
        }
    }
    contained_pack_file(root, value)
}

fn choose_runtime_atlas(atlases: &[String], requested: Option<&str>) -> Option<String> {
    match requested {
        Some(requested) if atlases.iter().any(|atlas| atlas == requested) => {
            Some(requested.to_string())
        }
        None if atlases.len() == 1 => atlases.first().cloned(),
        _ => None,
    }
}

fn find_missing_attachments(
    exports_dir: &Path,
    atlases: &[String],
    attachments: &[String],
) -> Vec<String> {
    if attachments.is_empty() {
        return Vec::new();
    }
    let mut regions = HashSet::new();
    for atlas in atlases {
        let Ok(text) = fs::read_to_string(exports_dir.join(atlas)) else {
            continue;
        };
        for line in text.lines() {
            let trimmed = line.trim();
            let top_level = !line.chars().next().is_some_and(char::is_whitespace);
            let is_texture = Path::new(trimmed)
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    ["png", "jpg", "jpeg", "webp"]
                        .iter()
                        .any(|allowed| extension.eq_ignore_ascii_case(allowed))
                });
            if top_level && !trimmed.is_empty() && !trimmed.contains(':') && !is_texture {
                regions.insert(trimmed.to_string());
            }
        }
    }
    let mut missing = attachments
        .iter()
        .filter(|attachment| !regions.contains(attachment.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    missing.sort();
    missing.dedup();
    missing
}

pub(crate) fn read_spine_binary_version(path: &Path) -> Option<String> {
    const MAX_HEADER_BYTES: u64 = 64 * 1024;
    let file = File::open(path).ok()?;
    let mut data = Vec::new();
    file.take(MAX_HEADER_BYTES)
        .read_to_end(&mut data)
        .ok()?;
    let mut offset = 0;
    read_spine_string(&data, &mut offset)?;
    read_spine_string(&data, &mut offset)
}

fn read_spine_string(data: &[u8], offset: &mut usize) -> Option<String> {
    let length = read_spine_varint(data, offset)?;
    if length == 0 {
        return Some(String::new());
    }
    let length = length.checked_sub(1)? as usize;
    let end = offset.checked_add(length)?;
    let value = std::str::from_utf8(data.get(*offset..end)?)
        .ok()?
        .to_string();
    *offset = end;
    Some(value)
}

fn read_spine_varint(data: &[u8], offset: &mut usize) -> Option<u32> {
    let mut value = 0_u32;
    for shift in (0..35).step_by(7) {
        let byte = *data.get(*offset)?;
        *offset += 1;
        value |= u32::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

fn push_issue(
    issues: &mut Vec<AvatarValidationIssue>,
    legacy: &mut Vec<String>,
    severity: &str,
    code: &str,
    path: impl Into<String>,
    message: impl Into<String>,
) {
    let message = message.into();
    legacy.push(message.clone());
    issues.push(AvatarValidationIssue {
        severity: severity.to_string(),
        code: code.to_string(),
        path: path.into(),
        message,
    });
}

fn runtime_error_path(error: &str) -> &'static str {
    if error.contains("runtimeAtlas") {
        "runtimeAtlas"
    } else if error.contains("runtimeReady") {
        "runtimeReady"
    } else {
        "runtimeSkel"
    }
}

fn ensure_existing_pack_root(path: &Path) -> Result<(), String> {
    let root = path
        .canonicalize()
        .map_err(|error| format!("Cannot read avatar pack: {error}"))?;
    if !root.is_dir() || !root.join("avatar-pack.json").is_file() {
        return Err(
            "Avatar pack must be an existing directory containing avatar-pack.json.".to_string(),
        );
    }
    Ok(())
}

fn sibling_staging_path(target: &Path, operation: &str) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Avatar pack path must have a parent directory.".to_string())?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Avatar pack path must end with a valid directory name.".to_string())?;
    Ok(parent.join(format!(".{name}.{operation}-{}", unique_suffix())))
}

fn non_empty_or(value: String, fallback: String) -> String {
    let value = value.trim();
    if value.is_empty() {
        fallback
    } else {
        value.to_string()
    }
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

fn write_json_atomically<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
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

pub(crate) fn replace_directory_atomically(
    staging: &Path,
    target: &Path,
) -> Result<Option<PathBuf>, String> {
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

pub(crate) fn rollback_directory_replace(
    target: &Path,
    backup: Option<&Path>,
) -> Result<(), String> {
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
    use std::sync::{mpsc, Arc, Barrier};

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
    fn avatar_jobs_persist_updates_and_bound_history() {
        let config = temp_pack("job-store");
        let created = create_avatar_job(
            &config,
            AvatarJobCreateInput {
                job_id: "amiya-demo".to_string(),
                phase: "layer-split".to_string(),
                message: "Planning editable layers".to_string(),
                pack_path: Some(config.to_string_lossy().to_string()),
                motions: vec!["idle".to_string(), "working".to_string()],
            },
        )
        .unwrap();
        assert!(created.resumable);
        assert!(avatar_job_path(&config).is_file());

        for index in 0..40 {
            update_avatar_job(
                &config,
                AvatarJobUpdateInput {
                    job_id: "amiya-demo".to_string(),
                    phase: Some("motion-draft".to_string()),
                    message: Some(format!("Draft update {index}")),
                    pack_path: None,
                    motions: None,
                },
            )
            .unwrap();
        }
        let loaded = get_avatar_job(&config, "amiya-demo").unwrap();
        assert_eq!(loaded.history.len(), AVATAR_JOB_MAX_HISTORY);
        assert_eq!(load_avatar_jobs(&config).unwrap().len(), 1);
        assert!(avatar_job_backup_candidates(&config).unwrap().len() <= AVATAR_JOB_MAX_BACKUPS);
        assert!(loaded.history.last().unwrap().message.contains("39"));
        let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn avatar_job_backup_remains_a_recovery_snapshot_after_update() {
        let config = temp_pack("job-backup-snapshot");
        create_avatar_job(
            &config,
            AvatarJobCreateInput {
                job_id: "snapshot-job".to_string(),
                phase: "planning".to_string(),
                message: "before update".to_string(),
                pack_path: None,
                motions: Vec::new(),
            },
        )
        .unwrap();
        let initial_backup = avatar_job_backup_candidates(&config)
            .unwrap()
            .into_iter()
            .next()
            .expect("creating a job should produce a recovery backup");
        assert_eq!(
            read_avatar_jobs_file(&initial_backup, "Avatar job backup").unwrap()[0].message,
            "before update"
        );
        fs::write(avatar_job_path(&config), b"{corrupt").unwrap();
        assert_eq!(
            load_avatar_jobs(&config).unwrap()[0].message,
            "before update"
        );

        update_avatar_job(
            &config,
            AvatarJobUpdateInput {
                job_id: "snapshot-job".to_string(),
                phase: None,
                message: Some("after update".to_string()),
                pack_path: None,
                motions: None,
            },
        )
        .unwrap();
        assert_eq!(
            load_avatar_jobs(&config).unwrap()[0].message,
            "after update"
        );
        assert_eq!(
            read_avatar_jobs_file(&initial_backup, "Avatar job backup").unwrap()[0].message,
            "before update"
        );
        let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn avatar_jobs_reject_unsafe_ids_and_relative_pack_paths() {
        let config = temp_pack("job-validation");
        let result = create_avatar_job(
            &config,
            AvatarJobCreateInput {
                job_id: "../escape".to_string(),
                phase: "planning".to_string(),
                message: String::new(),
                pack_path: None,
                motions: Vec::new(),
            },
        );
        assert!(result.is_err());

        let result = create_avatar_job(
            &config,
            AvatarJobCreateInput {
                job_id: "safe-job".to_string(),
                phase: "planning".to_string(),
                message: String::new(),
                pack_path: Some("relative/avatar-pack".to_string()),
                motions: Vec::new(),
            },
        );
        assert!(result.is_err());
        assert!(!avatar_job_path(&config).exists());
        let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn concurrent_avatar_job_creates_preserve_every_job() {
        let config = temp_pack("job-concurrency");
        let workers = 24;
        let barrier = Arc::new(Barrier::new(workers));
        let handles = (0..workers)
            .map(|index| {
                let config = config.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    create_avatar_job(
                        &config,
                        AvatarJobCreateInput {
                            job_id: format!("concurrent-{index}"),
                            phase: "planning".to_string(),
                            message: String::new(),
                            pack_path: None,
                            motions: Vec::new(),
                        },
                    )
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().unwrap().unwrap();
        }
        assert_eq!(load_avatar_jobs(&config).unwrap().len(), workers);
        let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn corrupt_avatar_job_store_recovers_a_valid_backup() {
        let config = temp_pack("job-recovery");
        create_avatar_job(
            &config,
            AvatarJobCreateInput {
                job_id: "recover-me".to_string(),
                phase: "planning".to_string(),
                message: "Keep this task".to_string(),
                pack_path: None,
                motions: Vec::new(),
            },
        )
        .unwrap();
        fs::copy(
            avatar_job_path(&config),
            config.join("avatar-jobs.backup-1.json"),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(10));
        fs::write(config.join("avatar-jobs.backup-2.json"), b"invalid backup").unwrap();
        fs::write(avatar_job_path(&config), b"{broken").unwrap();
        let jobs = load_avatar_jobs(&config).unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].job_id, "recover-me");
        assert!(fs::read_dir(&config).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("avatar-jobs.corrupt-")));
        let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn corrupt_avatar_job_store_without_backup_is_preserved_and_reported() {
        let config = temp_pack("job-no-recovery");
        fs::write(avatar_job_path(&config), b"{broken").unwrap();
        let result = load_avatar_jobs(&config);
        assert!(result.is_err());
        assert_eq!(fs::read(avatar_job_path(&config)).unwrap(), b"{broken");
        assert!(!fs::read_dir(&config).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("avatar-jobs.corrupt-")));
        let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn avatar_job_store_reads_are_bounded_by_actual_bytes() {
        let config = temp_pack("job-bounded-read");
        let oversized = vec![b' '; AVATAR_JOB_MAX_STORE_BYTES as usize + 1];
        fs::write(avatar_job_path(&config), oversized).unwrap();
        let error = load_avatar_jobs(&config).unwrap_err();
        assert!(error.contains("exceeds"));
        let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn stale_avatar_job_lock_is_recovered_but_live_lock_times_out() {
        let config = temp_pack("job-lock-recovery");
        fs::write(
            avatar_job_lock_path(&config),
            serde_json::to_vec(&AvatarJobLockMetadata {
                owner: "dead-process".to_string(),
                created_at_ms: 0,
            })
            .unwrap(),
        )
        .unwrap();
        let lock = acquire_avatar_job_lock_with_limits(
            &config,
            Duration::from_millis(100),
            Duration::from_millis(10),
        )
        .unwrap();
        drop(lock);
        assert!(!avatar_job_lock_path(&config).exists());

        fs::write(
            avatar_job_lock_path(&config),
            serde_json::to_vec(&AvatarJobLockMetadata {
                owner: "live-process".to_string(),
                created_at_ms: current_timestamp_ms(),
            })
            .unwrap(),
        )
        .unwrap();
        let started = Instant::now();
        let error = acquire_avatar_job_lock_with_limits(
            &config,
            Duration::from_millis(80),
            Duration::from_secs(30),
        )
        .err()
        .expect("a live lock should time out");
        assert!(error.contains("busy"));
        assert!(started.elapsed() < Duration::from_secs(1));
        fs::remove_file(avatar_job_lock_path(&config)).unwrap();
        let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn avatar_job_lock_wait_policy_allows_owner_progress_past_short_timeout() {
        let started = Instant::now();
        let mut no_progress = started;
        let mut owner = None;
        assert!(!avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            Some("owner-a"),
            started,
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
        assert!(!avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            Some("owner-a"),
            started + Duration::from_millis(1_999),
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
        assert!(!avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            Some("owner-b"),
            started + Duration::from_millis(2_001),
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
        assert!(!avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            Some("owner-c"),
            started + Duration::from_millis(4_001),
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
    }

    #[test]
    fn avatar_job_lock_wait_policy_times_out_without_owner_progress() {
        let started = Instant::now();
        let mut no_progress = started;
        let mut owner = None;
        assert!(!avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            Some("owner-a"),
            started,
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
        assert!(!avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            Some("owner-a"),
            started + Duration::from_millis(1_999),
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
        assert!(avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            Some("owner-a"),
            started + Duration::from_secs(2),
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
    }

    #[test]
    fn avatar_job_lock_wait_policy_ignores_invalid_owner_markers() {
        let started = Instant::now();
        let mut no_progress = started;
        let mut owner = None;
        assert!(!avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            Some("owner-a"),
            started + Duration::from_millis(1_000),
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
        assert!(!avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            Some(""),
            started + Duration::from_millis(1_999),
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
        assert!(avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            None,
            started + Duration::from_millis(3_000),
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
    }

    #[test]
    fn avatar_job_lock_wait_policy_has_a_hard_total_cap() {
        let started = Instant::now();
        let mut no_progress = started;
        let mut owner = None;
        assert!(!avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            Some("owner-a"),
            started,
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
        assert!(!avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            Some("owner-b"),
            started + Duration::from_millis(9_999),
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
        assert!(avatar_job_lock_wait_timed_out(
            started,
            &mut no_progress,
            &mut owner,
            Some("owner-c"),
            started + AVATAR_JOB_LOCK_MAX_WAIT,
            Duration::from_secs(2),
            AVATAR_JOB_LOCK_MAX_WAIT,
        ));
    }

    #[test]
    fn live_avatar_job_lock_metadata_survives_timeout_and_owned_drop_allows_reacquire() {
        let config = temp_pack("job-lock-owned-marker");
        let lock = acquire_avatar_job_lock_with_limits(
            &config,
            Duration::from_millis(500),
            Duration::from_secs(30),
        )
        .unwrap();
        let metadata = serde_json::from_slice::<AvatarJobLockMetadata>(
            &read_bytes_bounded(
                &avatar_job_lock_path(&config),
                AVATAR_JOB_LOCK_BYTES,
                "Avatar job lock",
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(metadata.owner, lock.owner);

        let error = acquire_avatar_job_lock_with_limits(
            &config,
            Duration::from_millis(80),
            Duration::from_secs(30),
        )
        .err()
        .expect("a live lock should time out");
        assert!(error.contains("busy"));
        assert!(avatar_job_lock_path(&config).exists());
        drop(lock);
        assert!(!avatar_job_lock_path(&config).exists());

        let replacement = acquire_avatar_job_lock_with_limits(
            &config,
            Duration::from_millis(100),
            Duration::from_secs(30),
        )
        .unwrap();
        assert!(avatar_job_lock_path(&config).exists());
        drop(replacement);
        assert!(!avatar_job_lock_path(&config).exists());
        let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn live_avatar_job_lock_waits_through_progressing_owners() {
        let config = temp_pack("job-lock-progress");
        let lock = acquire_avatar_job_lock_with_limits(
            &config,
            Duration::from_millis(100),
            Duration::from_secs(30),
        )
        .unwrap();
        let lock_path = avatar_job_lock_path(&config);
        let (ready_tx, ready_rx) = mpsc::sync_channel(0);
        let (result_tx, result_rx) = mpsc::sync_channel(0);
        let contender_config = config.clone();
        let contender = thread::spawn(move || {
            ready_tx.send(()).unwrap();
            let started = Instant::now();
            let result = acquire_avatar_job_lock_with_limits(
                &contender_config,
                Duration::from_millis(500),
                Duration::from_secs(30),
            );
            result_tx.send((started.elapsed(), result)).unwrap();
        });
        ready_rx.recv().unwrap();

        // Keep the marker live while advancing its owner identity. Every
        // interval is below the 500 ms no-progress timeout, but the aggregate
        // hold exceeds it and therefore exercises the real retry loop.
        for index in 0..8 {
            thread::sleep(Duration::from_millis(100));
            fs::write(
                &lock_path,
                serde_json::to_vec(&AvatarJobLockMetadata {
                    owner: format!("progress-owner-{index}"),
                    created_at_ms: current_timestamp_ms(),
                })
                .unwrap(),
            )
            .unwrap();
        }
        // Restore the original owner before dropping the lock so its normal
        // owner-checked cleanup can remove the marker.
        fs::write(
            &lock_path,
            serde_json::to_vec(&AvatarJobLockMetadata {
                owner: lock.owner.clone(),
                created_at_ms: current_timestamp_ms(),
            })
            .unwrap(),
        )
        .unwrap();
        drop(lock);

        let (elapsed, result) = result_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("contender should finish after the owner releases the lock");
        assert!(
            elapsed >= Duration::from_millis(500),
            "contender unexpectedly acquired before the aggregate timeout: {elapsed:?}"
        );
        let acquired = result.expect("progressing owners must not cause timeout");
        drop(acquired);
        contender.join().unwrap();
        let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn permission_denied_is_transient_lock_contention() {
        let config = temp_pack("job-lock-contention");
        fs::create_dir_all(&config).unwrap();
        let lock_path = avatar_job_lock_path(&config);
        fs::write(&lock_path, b"locked").unwrap();

        let permission_denied = std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "simulated Windows sharing violation",
        );
        assert!(avatar_job_lock_is_contended(&permission_denied));

        fs::remove_file(&lock_path).unwrap();
        assert!(avatar_job_lock_is_contended(&permission_denied));
        let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn avatar_job_structured_fields_reject_all_control_characters() {
        let config = temp_pack("job-controls");
        let invalid_phase = create_avatar_job(
            &config,
            AvatarJobCreateInput {
                job_id: "invalid-phase".to_string(),
                phase: "layer\nsplit".to_string(),
                message: String::new(),
                pack_path: None,
                motions: Vec::new(),
            },
        );
        assert!(invalid_phase.is_err());
        let invalid_motion = create_avatar_job(
            &config,
            AvatarJobCreateInput {
                job_id: "invalid-motion".to_string(),
                phase: "planning".to_string(),
                message: String::new(),
                pack_path: None,
                motions: vec!["idle\tloop".to_string()],
            },
        );
        assert!(invalid_motion.is_err());
        let invalid_path = create_avatar_job(
            &config,
            AvatarJobCreateInput {
                job_id: "invalid-path".to_string(),
                phase: "planning".to_string(),
                message: String::new(),
                pack_path: Some(format!("{}\nchild", config.display())),
                motions: Vec::new(),
            },
        );
        assert!(invalid_path.is_err());
        let allowed_message = create_avatar_job(
            &config,
            AvatarJobCreateInput {
                job_id: "message-lines".to_string(),
                phase: "planning".to_string(),
                message: "line one\n\tline two".to_string(),
                pack_path: None,
                motions: Vec::new(),
            },
        );
        assert!(allowed_message.is_ok());
        let _ = fs::remove_dir_all(config);
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

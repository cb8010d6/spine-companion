#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceInfo {
    pub source: String,
    pub label: String,
}

const KNOWN_SOURCES: &[(&str, &str, &[&str])] = &[
    ("codex", "Codex", &["codex"]),
    ("claude", "Claude", &["claude"]),
    ("cursor", "Cursor", &["cursor"]),
    (
        "vscode",
        "VS Code",
        &["vscode", "vs-code", "visual-studio-code"],
    ),
    ("cline", "Cline", &["cline"]),
    ("roo", "Roo", &["roo"]),
    ("gemini", "Gemini", &["gemini"]),
    ("antigravity", "Antigravity", &["antigravity"]),
    ("opencode", "OpenCode", &["opencode", "open-code"]),
    ("mimocode", "MiMoCode", &["mimocode", "mimo"]),
    ("kimi", "Kimi", &["kimi", "moonshot"]),
    ("windsurf", "Windsurf", &["windsurf"]),
    ("continue", "Continue", &["continue"]),
    ("zed", "Zed", &["zed"]),
    ("aider", "Aider", &["aider"]),
    ("goose", "Goose", &["goose"]),
    ("local-ai", "Local AI", &["local-ai"]),
];

pub fn normalize_source(source: &str) -> String {
    source.trim().to_ascii_lowercase()
}

fn starts_with_token(source: &str, token: &str) -> bool {
    source == token || source.starts_with(&format!("{}-", token))
}

fn known_source(source: &str) -> Option<(&'static str, &'static str)> {
    let source = normalize_source(source);
    KNOWN_SOURCES.iter().find_map(|(id, label, aliases)| {
        aliases
            .iter()
            .any(|alias| starts_with_token(&source, alias))
            .then_some((*id, *label))
    })
}

pub fn canonical_source_id(source: &str) -> Option<&'static str> {
    known_source(source).map(|(id, _label)| id)
}

pub fn is_ai_source(source: &str) -> bool {
    let source = normalize_source(source);
    if source.is_empty() {
        return false;
    }
    if known_source(&source).is_some() {
        return true;
    }
    source.ends_with("-mcp")
        || source.contains("-agent")
        || source.contains("-assistant")
        || source.contains("-code")
        || source.contains("-ai")
        || source.contains("-llm")
}

fn title_case_source(source: &str) -> String {
    let source = source
        .trim()
        .trim_end_matches("-mcp")
        .trim_end_matches("_mcp");
    let mut words = Vec::new();
    for word in source
        .split(['-', '_', ' '])
        .filter(|word| !word.is_empty())
    {
        let lower = word.to_ascii_lowercase();
        words.push(match lower.as_str() {
            "mcp" => "MCP".to_string(),
            "ai" => "AI".to_string(),
            "llm" => "LLM".to_string(),
            _ => {
                let mut chars = lower.chars();
                match chars.next() {
                    Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                    None => String::new(),
                }
            }
        });
    }
    words.join(" ")
}

pub fn source_display_name(source: &str, explicit_label: Option<&str>) -> String {
    if let Some(label) = explicit_label {
        let label = label.trim();
        if !label.is_empty() {
            return label.to_string();
        }
    }
    if let Some((_id, label)) = known_source(source) {
        return label.to_string();
    }
    if is_ai_source(source) {
        let label = title_case_source(source);
        return if label.is_empty() {
            "AI".to_string()
        } else {
            label
        };
    }
    if source.trim().is_empty() {
        "Local".to_string()
    } else {
        source.to_string()
    }
}

pub fn source_from_client_name(name: &str) -> Option<SourceInfo> {
    let normalized = name
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if normalized.is_empty() {
        return None;
    }
    let source = if let Some((id, _label)) = known_source(&normalized) {
        format!("{}-mcp", id)
    } else {
        format!("{}-mcp", normalized)
    };
    Some(SourceInfo {
        label: source_display_name(&source, None),
        source,
    })
}

pub fn source_from_env_or_client(client_name: Option<&str>) -> SourceInfo {
    let env_source = std::env::var("COMPANION_SOURCE").unwrap_or_default();
    let env_label = std::env::var("COMPANION_SOURCE_LABEL").unwrap_or_default();
    if !env_source.trim().is_empty() {
        return SourceInfo {
            label: source_display_name(&env_source, Some(&env_label)),
            source: env_source.trim().to_string(),
        };
    }
    if let Some(info) = client_name.and_then(source_from_client_name) {
        return info;
    }
    SourceInfo {
        source: "ai-mcp".to_string(),
        label: "AI".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_known_and_future_ai_sources() {
        assert!(is_ai_source("mimocode-mcp"));
        assert!(is_ai_source("opencode-mcp"));
        assert!(is_ai_source("kimi-mcp"));
        assert!(is_ai_source("my-new-agent-mcp"));
        assert!(!is_ai_source("tray"));
        assert_eq!(source_display_name("mimocode-mcp", None), "MiMoCode");
        assert_eq!(source_display_name("kimi-mcp", None), "Kimi");
        assert_eq!(canonical_source_id("vs-code-mcp"), Some("vscode"));
        assert_eq!(canonical_source_id("open-code-mcp"), Some("opencode"));
        assert_eq!(canonical_source_id("moonshot-mcp"), Some("kimi"));
        assert_eq!(
            source_display_name("my-new-agent-mcp", None),
            "My New Agent"
        );
    }

    #[test]
    fn derives_source_from_client_name() {
        let info = source_from_client_name("OpenCode").unwrap();
        assert_eq!(info.source, "opencode-mcp");
        assert_eq!(info.label, "OpenCode");

        let kimi = source_from_client_name("Kimi Code CLI").unwrap();
        assert_eq!(kimi.source, "kimi-mcp");
        assert_eq!(kimi.label, "Kimi");
    }
}

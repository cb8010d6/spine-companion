const dictionaries = {
  en: {
    "app.name": "Spine Companion",
    "manager.library.title": "Library",
    "manager.installed.title": "Installed Models",
    "manager.downloads.title": "Downloads",
    "manager.settings.title": "Settings",
    "manager.diagnostics.title": "Diagnostics",
    "manager.actions.download": "Download",
    "manager.actions.setActive": "Set Active",
    "manager.actions.openFolder": "Open Folder",
    "manager.actions.remove": "Remove",
    "manager.actions.retry": "Retry",
    "manager.status.installed": "Installed",
    "manager.status.active": "Active",
    "manager.empty.noModels": "No models installed.",
    "manager.empty.noDownloads": "No active downloads.",
    "panel.aiBridge": "AI Bridge Status",
    "onboarding.title": "Set up Spine Companion",
    "onboarding.body": "Download a test model or place your own Spine 3.8 files in the local config folder.",
    "onboarding.start": "Open Manager",
    "error.retry": "Retry",
    "error.openManager": "Open Manager"
  },
  "zh-CN": {
    "app.name": "Spine Companion",
    "manager.library.title": "模型库",
    "manager.installed.title": "已安装模型",
    "manager.downloads.title": "下载",
    "manager.settings.title": "设置",
    "manager.diagnostics.title": "诊断",
    "manager.actions.download": "下载",
    "manager.actions.setActive": "设为当前",
    "manager.actions.openFolder": "打开目录",
    "manager.actions.remove": "删除",
    "manager.actions.retry": "重试",
    "manager.status.installed": "已安装",
    "manager.status.active": "当前",
    "manager.empty.noModels": "还没有安装模型。",
    "manager.empty.noDownloads": "当前没有下载任务。",
    "panel.aiBridge": "AI 桥接状态",
    "onboarding.title": "设置 Spine Companion",
    "onboarding.body": "下载测试模型，或把你自己的 Spine 3.8 文件放到本地配置目录。",
    "onboarding.start": "打开管理器",
    "error.retry": "重试",
    "error.openManager": "打开管理器"
  }
};

let currentLocale = "en";

export function detectLocale(config = {}, nav = globalThis.navigator) {
  const configured = config.locale || config.ui?.locale;
  const raw = configured || nav?.language || "en";
  return raw.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function setLocale(locale) {
  currentLocale = dictionaries[locale] ? locale : "en";
  return currentLocale;
}

export function getLocale() {
  return currentLocale;
}

export function t(key, params = {}) {
  const template = dictionaries[currentLocale]?.[key] || dictionaries.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? "");
}

export function createI18n(config = {}, nav) {
  setLocale(detectLocale(config, nav));
  return { t, setLocale, getLocale, detectLocale };
}

export { dictionaries };

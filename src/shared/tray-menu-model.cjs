const STATE_MENU_ITEMS = Object.freeze([
  { label: "Idle", state: "idle" },
  { label: "Working", state: "working" },
  { label: "Reviewing", state: "reviewing" },
  { label: "Running Left", state: "running", direction: "left" },
  { label: "Running Right", state: "running", direction: "right" },
  { label: "Success", state: "success" },
  { label: "Failed", state: "failed" },
  { label: "Waiting", state: "waiting" },
  { label: "Sleeping", state: "sleeping" },
  { label: "Reminder", state: "reminder" }
]);

function trayMenuModel(ui = {}, options = {}) {
  const showQuickPanel = options.showQuickPanel !== false;
  return [
    { id: "show_companion", label: "Show Companion" },
    { id: "hide_companion", label: "Hide Companion" },
    ...(showQuickPanel ? [{ id: "open_panel", label: "Open Quick Panel" }] : []),
    { id: "open_manager", label: "Open Manager" },
    { type: "separator" },
    {
      id: "toggle_bubble",
      label: `Progress Bubble: ${ui.bubbleVisible === false ? "Off" : "On"}`
    },
    {
      id: "toggle_hud",
      label: `Status Panel: ${ui.hudVisible === false ? "Off" : "On"}`
    },
    {
      id: "toggle_click_through",
      label: `Click-through: ${options.mousePassthrough ? "On" : "Off"}`
    },
    { type: "separator" },
    { id: "state_menu", label: "Set State", submenu: STATE_MENU_ITEMS },
    { type: "separator" },
    { id: "diagnostics", label: "Diagnostics" },
    { id: "open_config_dir", label: "Open Config Folder" },
    { id: "open_local_api", label: "Open Local API" },
    { type: "separator" },
    { id: "quit", label: "Quit" }
  ];
}

module.exports = {
  STATE_MENU_ITEMS,
  trayMenuModel
};

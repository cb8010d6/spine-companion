# Spine Companion v0.2.3-rc.4

Release candidate focused on final interaction blockers before promoting v0.2.3 to main.

## Fixes

- Makes **Open Manager** report completion and tolerate non-critical focus/raise failures, especially in installed Tauri builds.
- Hides the setup/onboarding overlay after opening Manager or after a model successfully loads.
- Restores click feedback by replaying the interaction animation and returning to idle automatically.
- Makes drag direction changes respond sooner and returns to idle immediately when dragging stops.
- Extends the default success Special segment so the full completion sequence can play before returning to idle.

## Notes

This RC should be validated with the installed build before tagging the stable main release.

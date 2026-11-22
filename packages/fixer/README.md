# icex-dsh-fixer

A local DSH web bundle with four adjustments:

- Input anchor rail: a vertical dot rail left of the transcript, one dot per user input. Hover shows the input after a delay; click scrolls to it.
- Session delete: a trash-icon item in each session row's "…" menu. It moves the session log to `~/.dsh/trash/sessions/` and drops the row from the list; sessions that are currently open are refused.
- Window summon: double-tap the right Option key to bring the DSH window to the top of the screen under the pointer, full width, at its current height. Runs through a small macOS helper (Accessibility/Input Monitoring).
- Bare mode: one switch in this bundle's configuration turns every other plugin off to show DSH as it ships, then restores the exact set. The snapshot lives in the profile on the Host, so it survives a reload and a restart; this plugin stays loaded and hides its own changes so the switch is always reachable.

Open **Plugins** in the sidebar, select the bundle, and use the configuration section on its page. Most options are stored in this browser; bare mode is stored in the profile on the Host.

See [docs/DETAIL.md](docs/DETAIL.md) for the settings, behavior, and known limits.

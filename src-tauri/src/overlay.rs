use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::error::{AppError, AppResult};

const COMPACT_WIDTH: f64 = 420.0;
const COMPACT_HEIGHT: f64 = 220.0;
const MARGIN: f64 = 16.0;

#[derive(Clone)]
pub struct OverlayController {
    is_compact: Arc<AtomicBool>,
    hud_corner: Arc<Mutex<String>>,
}

impl Default for OverlayController {
    fn default() -> Self {
        Self {
            is_compact: Arc::new(AtomicBool::new(false)),
            hud_corner: Arc::new(Mutex::new("top-right".to_string())),
        }
    }
}

pub fn parse_shortcut_preset(spec: &str) -> Shortcut {
    match spec.trim() {
        "Alt+B" => Shortcut::new(Some(Modifiers::ALT), Code::KeyB),
        "Ctrl+Shift+J" => Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyJ),
        "F8" => Shortcut::new(None, Code::F8),
        _ => Shortcut::new(Some(Modifiers::ALT), Code::KeyJ),
    }
}

impl OverlayController {
    pub fn set_corner(&self, corner: &str) {
        if let Ok(mut guard) = self.hud_corner.lock() {
            *guard = corner.to_string();
        }
    }

    pub fn set_mode(&self, app: &AppHandle, compact: bool) -> AppResult<()> {
        self.is_compact.store(compact, Ordering::SeqCst);
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| AppError::Overlay("Main overlay window not found".to_string()))?;

        if compact {
            window
                .set_size(LogicalSize::new(COMPACT_WIDTH, COMPACT_HEIGHT))
                .map_err(|e| AppError::Overlay(e.to_string()))?;
            self.position_in_corner(&window);
            window
                .set_ignore_cursor_events(true)
                .map_err(|e| AppError::Overlay(e.to_string()))?;
        } else {
            window
                .set_ignore_cursor_events(false)
                .map_err(|e| AppError::Overlay(e.to_string()))?;
            window
                .set_size(LogicalSize::new(1080.0, 760.0))
                .map_err(|e| AppError::Overlay(e.to_string()))?;
            let _ = window.center();
            let _ = window.set_focus();
        }

        let mode_str = if compact { "compact" } else { "expanded" };
        let _ = app.emit("overlay-mode-changed", mode_str);
        Ok(())
    }

    fn position_in_corner(&self, window: &tauri::WebviewWindow) {
        let corner = self
            .hud_corner
            .lock()
            .map(|c| c.clone())
            .unwrap_or_else(|_| "top-right".to_string());

        if let Ok(Some(monitor)) = window.current_monitor() {
            let scale = monitor.scale_factor();
            let size = monitor.size();
            let screen_w = size.width as f64 / scale;
            let screen_h = size.height as f64 / scale;

            let (x, y) = match corner.as_str() {
                "top-left" => (MARGIN, MARGIN),
                "bottom-left" => (MARGIN, (screen_h - COMPACT_HEIGHT - MARGIN).max(MARGIN)),
                "bottom-right" => (
                    (screen_w - COMPACT_WIDTH - MARGIN).max(MARGIN),
                    (screen_h - COMPACT_HEIGHT - MARGIN).max(MARGIN),
                ),
                _ => ((screen_w - COMPACT_WIDTH - MARGIN).max(MARGIN), MARGIN),
            };
            let _ = window.set_position(LogicalPosition::new(x, y));
        }
    }

    pub fn toggle(&self, app: &AppHandle) -> AppResult<()> {
        let next = !self.is_compact.load(Ordering::SeqCst);
        self.set_mode(app, next)
    }

    pub fn rebind_hotkey(&self, app: &AppHandle, hotkey: &str) -> AppResult<()> {
        let _ = app.global_shortcut().unregister_all();
        let shortcut = parse_shortcut_preset(hotkey);
        let ctrl_shortcut = self.clone();
        app.global_shortcut()
            .on_shortcut(shortcut, move |handle, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let _ = ctrl_shortcut.toggle(handle);
                }
            })
            .map_err(|e| AppError::Overlay(e.to_string()))?;
        Ok(())
    }
}

pub fn setup_overlay_controls(
    app: &AppHandle,
    controller: OverlayController,
    initial_hotkey: &str,
) -> AppResult<()> {
    controller.rebind_hotkey(app, initial_hotkey)?;

    let expand_item =
        MenuItem::with_id(app, "expand", "Expand BetterJungler", true, None::<&str>)
            .map_err(|e| AppError::Overlay(e.to_string()))?;
    let compact_item =
        MenuItem::with_id(app, "compact", "Compact Click-Through HUD", true, None::<&str>)
            .map_err(|e| AppError::Overlay(e.to_string()))?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit BetterJungler", true, None::<&str>)
        .map_err(|e| AppError::Overlay(e.to_string()))?;

    let menu = Menu::with_items(app, &[&expand_item, &compact_item, &quit_item])
        .map_err(|e| AppError::Overlay(e.to_string()))?;

    let ctrl_tray = controller;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("BetterJungler — Toggle HUD via Hotkey")
        .on_menu_event(move |handle, event| match event.id().as_ref() {
            "expand" => {
                let _ = ctrl_tray.set_mode(handle, false);
            }
            "compact" => {
                let _ = ctrl_tray.set_mode(handle, true);
            }
            "quit" => {
                handle.exit(0);
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app).map_err(|e| AppError::Overlay(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_shortcut_presets() {
        assert_eq!(
            parse_shortcut_preset("Alt+J"),
            Shortcut::new(Some(Modifiers::ALT), Code::KeyJ)
        );
        assert_eq!(
            parse_shortcut_preset("Alt+B"),
            Shortcut::new(Some(Modifiers::ALT), Code::KeyB)
        );
        assert_eq!(
            parse_shortcut_preset("Ctrl+Shift+J"),
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyJ)
        );
        assert_eq!(
            parse_shortcut_preset("F8"),
            Shortcut::new(None, Code::F8)
        );
    }
}

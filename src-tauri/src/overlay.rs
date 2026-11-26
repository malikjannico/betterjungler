use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, LogicalSize, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::error::{AppError, AppResult};

#[derive(Clone, Default)]
pub struct OverlayController {
    is_compact: Arc<AtomicBool>,
}

impl OverlayController {
    pub fn set_mode(&self, app: &AppHandle, compact: bool) -> AppResult<()> {
        self.is_compact.store(compact, Ordering::SeqCst);
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| AppError::Overlay("Main overlay window not found".to_string()))?;

        if compact {
            window
                .set_size(LogicalSize::new(420.0, 220.0))
                .map_err(|e| AppError::Overlay(e.to_string()))?;
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

    pub fn toggle(&self, app: &AppHandle) -> AppResult<()> {
        let next = !self.is_compact.load(Ordering::SeqCst);
        self.set_mode(app, next)
    }
}

pub fn setup_overlay_controls(app: &AppHandle, controller: OverlayController) -> AppResult<()> {
    // 1. Register global Alt+J shortcut so the user can always toggle click-through HUD
    let alt_j = Shortcut::new(Some(Modifiers::ALT), Code::KeyJ);
    let ctrl_shortcut = controller.clone();
    app.global_shortcut()
        .on_shortcut(alt_j, move |handle, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = ctrl_shortcut.toggle(handle);
            }
        })
        .map_err(|e| AppError::Overlay(e.to_string()))?;

    // 2. Register Windows System Tray fallback so user is never locked out of click-through HUD
    let expand_item =
        MenuItem::with_id(app, "expand", "Expand BetterJungler (Alt+J)", true, None::<&str>)
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
        .tooltip("BetterJungler — Press Alt+J to toggle HUD")
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

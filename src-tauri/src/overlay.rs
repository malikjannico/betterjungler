use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::error::{AppError, AppResult};

const BASE_HUD_WIDTH: f64 = 424.0;
const BASE_HUD_HEIGHT: f64 = 184.0;
const MARGIN: f64 = 16.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudPreferencesPayload {
    pub hud_corner: String,
    pub overlay_hotkey: String,
    pub hud_opacity: u8,
    pub hud_scale: u16,
    pub hud_monitor: String,
    pub minimap_side: String,
    pub hud_x: Option<i32>,
    pub hud_y: Option<i32>,
    pub hud_locked: bool,
}

#[derive(Clone)]
pub struct OverlayController {
    hud_visible: Arc<AtomicBool>,
    prefs: Arc<Mutex<HudPreferencesPayload>>,
    current_hotkey: Arc<Mutex<Option<String>>>,
}

impl Default for OverlayController {
    fn default() -> Self {
        Self {
            hud_visible: Arc::new(AtomicBool::new(false)),
            prefs: Arc::new(Mutex::new(HudPreferencesPayload {
                hud_corner: "beside-minimap".to_string(),
                overlay_hotkey: "Alt+J".to_string(),
                hud_opacity: 80,
                hud_scale: 100,
                hud_monitor: "primary".to_string(),
                minimap_side: "right".to_string(),
                hud_x: None,
                hud_y: None,
                hud_locked: true,
            })),
            current_hotkey: Arc::new(Mutex::new(None)),
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

pub fn normalize_hud_scale(raw: u16) -> u16 {
    match raw {
        125 => 125,
        150 => 150,
        _ => 100,
    }
}

pub fn scaled_hud_dimensions(scale_pct: u16) -> (f64, f64) {
    let factor = f64::from(normalize_hud_scale(scale_pct)) / 100.0;
    (
        (BASE_HUD_WIDTH * factor).round(),
        (BASE_HUD_HEIGHT * factor).round(),
    )
}

pub fn compute_hud_offset(
    corner: &str,
    minimap_side: &str,
    screen_w: f64,
    screen_h: f64,
    hud_w: f64,
    hud_h: f64,
) -> (f64, f64) {
    let minimap_gutter = (screen_w * 0.16).clamp(270.0, 340.0);
    match corner {
        "top-left" => (MARGIN, MARGIN),
        "top-right" => ((screen_w - hud_w - MARGIN).max(MARGIN), MARGIN),
        "bottom-left" => (MARGIN, (screen_h - hud_h - MARGIN).max(MARGIN)),
        "bottom-right" => (
            (screen_w - hud_w - MARGIN).max(MARGIN),
            (screen_h - hud_h - MARGIN).max(MARGIN),
        ),
        _ if minimap_side == "left" => (
            minimap_gutter.min((screen_w - hud_w - MARGIN).max(MARGIN)),
            (screen_h - hud_h - MARGIN).max(MARGIN),
        ),
        _ => (
            (screen_w - hud_w - minimap_gutter).max(MARGIN),
            (screen_h - hud_h - MARGIN).max(MARGIN),
        ),
    }
}

/// Computes target `(phys_w, phys_h, phys_x, phys_y)` on the destination monitor using its DPI.
#[allow(clippy::too_many_arguments)]
pub fn compute_physical_hud_rect(
    corner: &str,
    minimap_side: &str,
    scale_pct: u16,
    mon_x: i32,
    mon_y: i32,
    mon_w: u32,
    mon_h: u32,
    dpi_scale: f64,
) -> (u32, u32, i32, i32) {
    let safe_dpi = if dpi_scale.is_finite() && dpi_scale > 0.0 {
        dpi_scale
    } else {
        1.0
    };
    let (hud_w, hud_h) = scaled_hud_dimensions(scale_pct);
    let screen_w = f64::from(mon_w) / safe_dpi;
    let screen_h = f64::from(mon_h) / safe_dpi;
    let (dx, dy) = compute_hud_offset(corner, minimap_side, screen_w, screen_h, hud_w, hud_h);
    let phys_w = (hud_w * safe_dpi).round().max(1.0) as u32;
    let phys_h = (hud_h * safe_dpi).round().max(1.0) as u32;
    let phys_x = mon_x + (dx * safe_dpi).round() as i32;
    let phys_y = mon_y + (dy * safe_dpi).round() as i32;
    (phys_w, phys_h, phys_x, phys_y)
}

/// Clamps custom `(x, y)` HUD coordinates into the nearest monitor's physical bounds
/// so display changes or resolution drops never push the overlay off-screen.
pub fn clamp_custom_hud_pos(
    x: i32,
    y: i32,
    hud_w: u32,
    hud_h: u32,
    monitors: &[(i32, i32, u32, u32)],
) -> Option<(i32, i32)> {
    if monitors.is_empty() {
        return None;
    }
    let center_x = i64::from(x) + i64::from(hud_w) / 2;
    let center_y = i64::from(y) + i64::from(hud_h) / 2;

    let chosen = monitors
        .iter()
        .find(|&&(mx, my, mw, mh)| {
            center_x >= i64::from(mx)
                && center_x <= i64::from(mx) + i64::from(mw)
                && center_y >= i64::from(my)
                && center_y <= i64::from(my) + i64::from(mh)
        })
        .or_else(|| {
            monitors.iter().min_by_key(|&&(mx, my, mw, mh)| {
                let mcx = i64::from(mx) + i64::from(mw) / 2;
                let mcy = i64::from(my) + i64::from(mh) / 2;
                let dx = center_x - mcx;
                let dy = center_y - mcy;
                dx * dx + dy * dy
            })
        })?;

    let (mx, my, mw, mh) = *chosen;
    let max_x = mx.saturating_add((mw.saturating_sub(hud_w)) as i32).max(mx);
    let max_y = my.saturating_add((mh.saturating_sub(hud_h)) as i32).max(my);
    Some((x.clamp(mx, max_x), y.clamp(my, max_y)))
}

impl OverlayController {
    pub fn mark_hud_hidden(&self) {
        self.hud_visible.store(false, Ordering::SeqCst);
    }

    pub fn is_hud_locked(&self) -> bool {
        self.prefs.lock().map(|g| g.hud_locked).unwrap_or(true)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn apply_preferences(
        &self,
        app: Option<&AppHandle>,
        corner: &str,
        hotkey: &str,
        opacity: u8,
        scale: u16,
        monitor: &str,
        minimap_side: &str,
    ) {
        let prev = self
            .prefs
            .lock()
            .ok()
            .map(|g| (g.hud_x, g.hud_y, g.hud_locked));
        let (hud_x, hud_y, hud_locked) = prev.unwrap_or((None, None, true));
        let next = HudPreferencesPayload {
            hud_corner: corner.to_string(),
            overlay_hotkey: hotkey.to_string(),
            hud_opacity: opacity.clamp(70, 100),
            hud_scale: normalize_hud_scale(scale),
            hud_monitor: if monitor == "active" {
                "active".to_string()
            } else {
                "primary".to_string()
            },
            minimap_side: if minimap_side == "left" {
                "left".to_string()
            } else {
                "right".to_string()
            },
            hud_x,
            hud_y,
            hud_locked,
        };
        if let Ok(mut guard) = self.prefs.lock() {
            *guard = next.clone();
        }
        if let Some(handle) = app {
            if let Some(hud_window) = handle.get_webview_window("hud") {
                self.position_hud_window(handle, &hud_window, &next);
            }
            if let Err(err) = handle.emit("hud-preferences-changed", next) {
                tracing::warn!(error = %err, "Failed to emit hud-preferences-changed");
            }
        }
    }

    pub fn set_custom_position(
        &self,
        app: Option<&AppHandle>,
        x: Option<i32>,
        y: Option<i32>,
        reposition: bool,
    ) {
        let next = if let Ok(mut guard) = self.prefs.lock() {
            guard.hud_x = x;
            guard.hud_y = y;
            guard.clone()
        } else {
            return;
        };
        if let Some(handle) = app {
            if reposition {
                if let Some(hud_window) = handle.get_webview_window("hud") {
                    self.position_hud_window(handle, &hud_window, &next);
                }
            }
            let _ = handle.emit("hud-preferences-changed", next);
        }
    }

    pub fn set_hud_locked(&self, app: &AppHandle, locked: bool) -> AppResult<()> {
        let hud_window = app
            .get_webview_window("hud")
            .ok_or_else(|| AppError::Overlay("Dedicated HUD window not found".to_string()))?;

        let prefs = if let Ok(mut guard) = self.prefs.lock() {
            guard.hud_locked = locked;
            guard.clone()
        } else {
            return Err(AppError::Overlay("Overlay state lock poisoned".to_string()));
        };

        if !locked {
            self.position_hud_window(app, &hud_window, &prefs);
            hud_window
                .set_ignore_cursor_events(false)
                .map_err(|e| AppError::Overlay(e.to_string()))?;
            let _ = hud_window.set_focusable(true);
            hud_window
                .show()
                .map_err(|e| AppError::Overlay(e.to_string()))?;
            self.hud_visible.store(true, Ordering::SeqCst);
            let _ = app.emit("overlay-mode-changed", "compact");
        } else {
            hud_window
                .set_ignore_cursor_events(true)
                .map_err(|e| AppError::Overlay(e.to_string()))?;
            let _ = hud_window.set_focusable(false);
        }

        if let Err(err) = app.emit("hud-preferences-changed", prefs) {
            tracing::warn!(error = %err, "Failed to emit hud-preferences-changed");
        }
        Ok(())
    }

    /// Shows or hides the dedicated `hud` overlay window without stealing focus when locked.
    pub fn set_mode(&self, app: &AppHandle, show_hud: bool) -> AppResult<()> {
        let hud_window = app
            .get_webview_window("hud")
            .ok_or_else(|| AppError::Overlay("Dedicated HUD window not found".to_string()))?;

        let prefs =
            self.prefs
                .lock()
                .map(|g| g.clone())
                .unwrap_or_else(|_| HudPreferencesPayload {
                    hud_corner: "beside-minimap".to_string(),
                    overlay_hotkey: "Alt+J".to_string(),
                    hud_opacity: 80,
                    hud_scale: 100,
                    hud_monitor: "primary".to_string(),
                    minimap_side: "right".to_string(),
                    hud_x: None,
                    hud_y: None,
                    hud_locked: true,
                });

        if show_hud {
            self.position_hud_window(app, &hud_window, &prefs);
            hud_window
                .set_ignore_cursor_events(prefs.hud_locked)
                .map_err(|e| AppError::Overlay(e.to_string()))?;
            let _ = hud_window.set_focusable(!prefs.hud_locked);
            hud_window
                .show()
                .map_err(|e| AppError::Overlay(e.to_string()))?;
        } else {
            hud_window
                .hide()
                .map_err(|e| AppError::Overlay(e.to_string()))?;
        }

        self.hud_visible.store(show_hud, Ordering::SeqCst);
        let mode_str = if show_hud { "compact" } else { "expanded" };
        if let Err(err) = app.emit("overlay-mode-changed", mode_str) {
            tracing::warn!(error = %err, "Failed to emit overlay-mode-changed");
        }
        Ok(())
    }

    pub fn focus_main_window(&self, app: &AppHandle) -> AppResult<()> {
        let main_window = app
            .get_webview_window("main")
            .ok_or_else(|| AppError::Overlay("Main desktop window not found".to_string()))?;
        let _ = main_window.show();
        let _ = main_window.unminimize();
        let _ = main_window.set_focus();
        Ok(())
    }

    fn position_hud_window(
        &self,
        app: &AppHandle,
        hud_window: &tauri::WebviewWindow,
        prefs: &HudPreferencesPayload,
    ) {
        let monitor_opt = if prefs.hud_monitor == "active" {
            app.get_webview_window("main")
                .and_then(|w| w.current_monitor().ok().flatten())
                .or_else(|| app.primary_monitor().ok().flatten())
        } else {
            app.primary_monitor()
                .ok()
                .flatten()
                .or_else(|| hud_window.current_monitor().ok().flatten())
        };

        if let Some(monitor) = monitor_opt {
            let scale = monitor.scale_factor();
            let size = monitor.size();
            let pos = monitor.position();
            let (pw, ph, default_px, default_py) = compute_physical_hud_rect(
                &prefs.hud_corner,
                &prefs.minimap_side,
                prefs.hud_scale,
                pos.x,
                pos.y,
                size.width,
                size.height,
                scale,
            );
            let (px, py) = if let (Some(cx), Some(cy)) = (prefs.hud_x, prefs.hud_y) {
                let monitors_rects: Vec<(i32, i32, u32, u32)> = app
                    .available_monitors()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|m| {
                        let mp = m.position();
                        let ms = m.size();
                        (mp.x, mp.y, ms.width, ms.height)
                    })
                    .collect();
                clamp_custom_hud_pos(cx, cy, pw, ph, &monitors_rects)
                    .unwrap_or((default_px, default_py))
            } else {
                (default_px, default_py)
            };
            if let Err(err) = hud_window.set_size(PhysicalSize::new(pw, ph)) {
                tracing::warn!(error = %err, "Failed to size HUD window");
            }
            if let Err(err) = hud_window.set_position(PhysicalPosition::new(px, py)) {
                tracing::warn!(error = %err, "Failed to position HUD window");
            }
        }
    }

    pub fn toggle(&self, app: &AppHandle) -> AppResult<()> {
        let next = !self.hud_visible.load(Ordering::SeqCst);
        self.set_mode(app, next)
    }

    /// Atomic hotkey rebind: validates & registers the new shortcut before unregistering the old
    /// binding, leaving the previous shortcut intact if registration fails.
    pub fn rebind_hotkey(&self, app: &AppHandle, hotkey: &str) -> AppResult<()> {
        let trimmed = hotkey.trim();
        let new_shortcut = parse_shortcut_preset(trimmed);
        let prev_spec = self.current_hotkey.lock().ok().and_then(|g| g.clone());
        if prev_spec.as_deref() == Some(trimmed) {
            return Ok(());
        }

        let ctrl_shortcut = self.clone();
        app.global_shortcut()
            .on_shortcut(new_shortcut, move |handle, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    if let Err(err) = ctrl_shortcut.toggle(handle) {
                        tracing::warn!(error = %err, "Failed to toggle HUD via hotkey");
                    }
                }
            })
            .map_err(|e| AppError::Overlay(format!("Could not bind {trimmed}: {e}")))?;

        if let Some(old_spec) = prev_spec {
            let old_shortcut = parse_shortcut_preset(&old_spec);
            if old_shortcut != new_shortcut {
                if let Err(err) = app.global_shortcut().unregister(old_shortcut) {
                    tracing::warn!(
                        error = %err,
                        old = %old_spec,
                        "Failed to unregister prior hotkey"
                    );
                }
            }
        }
        if let Ok(mut guard) = self.current_hotkey.lock() {
            *guard = Some(trimmed.to_string());
        }
        if let Ok(mut guard) = self.prefs.lock() {
            guard.overlay_hotkey = trimmed.to_string();
        }
        Ok(())
    }

    pub fn active_hotkey(&self) -> Option<String> {
        self.current_hotkey
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
    }
}

pub fn setup_overlay_controls(
    app: &AppHandle,
    controller: OverlayController,
    initial_hotkey: &str,
    on_toggle_lock: Arc<dyn Fn(&AppHandle) + Send + Sync>,
    on_quit: Arc<dyn Fn(&AppHandle) + Send + Sync>,
) -> AppResult<()> {
    if let Err(err) = controller.rebind_hotkey(app, initial_hotkey) {
        tracing::warn!(
            error = %err,
            "Failed to bind initial overlay hotkey; continuing with tray controls"
        );
    }

    let expand_item = MenuItem::with_id(app, "show_main", "Show App", true, None::<&str>)
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    let toggle_hud_item = MenuItem::with_id(app, "toggle_hud", "Toggle HUD", true, None::<&str>)
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    let toggle_lock_item = MenuItem::with_id(
        app,
        "toggle_hud_lock",
        "Unlock / Lock HUD Drag",
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::Overlay(e.to_string()))?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit BetterJungler", true, None::<&str>)
        .map_err(|e| AppError::Overlay(e.to_string()))?;

    let menu = Menu::with_items(
        app,
        &[
            &expand_item,
            &toggle_hud_item,
            &toggle_lock_item,
            &quit_item,
        ],
    )
    .map_err(|e| AppError::Overlay(e.to_string()))?;

    let ctrl_tray = controller;
    let ver = env!("CARGO_PKG_VERSION");
    let tooltip = format!("BetterJungler v{ver} — Toggle HUD via Hotkey");
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip(tooltip)
        .on_menu_event(move |handle, event| match event.id().as_ref() {
            "show_main" => {
                let _ = ctrl_tray.focus_main_window(handle);
            }
            "toggle_hud" => {
                let _ = ctrl_tray.toggle(handle);
            }
            "toggle_hud_lock" => {
                on_toggle_lock(handle);
            }
            "quit" => {
                on_quit(handle);
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_shortcut_presets() {
        let expected_alt_j = Shortcut::new(Some(Modifiers::ALT), Code::KeyJ);
        let expected_alt_b = Shortcut::new(Some(Modifiers::ALT), Code::KeyB);
        let expected_ctrl_shift_j =
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyJ);
        let expected_f8 = Shortcut::new(None, Code::F8);
        assert_eq!(parse_shortcut_preset("Alt+J"), expected_alt_j);
        assert_eq!(parse_shortcut_preset("Alt+B"), expected_alt_b);
        assert_eq!(parse_shortcut_preset("Ctrl+Shift+J"), expected_ctrl_shift_j);
        assert_eq!(parse_shortcut_preset("F8"), expected_f8);
    }

    #[test]
    fn scales_and_computes_physical_hud_pixels_for_high_dpi_monitors() {
        assert_eq!(scaled_hud_dimensions(100), (424.0, 184.0));
        assert_eq!(scaled_hud_dimensions(125), (530.0, 230.0));
        assert_eq!(scaled_hud_dimensions(150), (636.0, 276.0));

        let (rx, ry) = compute_hud_offset("beside-minimap", "right", 1920.0, 1080.0, 424.0, 184.0);
        assert!(rx < 1920.0 - 424.0 - 250.0);
        assert!((ry - 880.0).abs() < f64::EPSILON);

        let (lx, ly) = compute_hud_offset("beside-minimap", "left", 1920.0, 1080.0, 424.0, 184.0);
        assert!((270.0..=340.0).contains(&lx));
        assert!((ly - 880.0).abs() < f64::EPSILON);

        // Secondary 4K monitor offset at (1920, 0) with 150% DPI scaling & 125% HUD scale
        let (pw, ph, px, py) =
            compute_physical_hud_rect("bottom-right", "right", 125, 1920, 0, 3840, 2160, 1.5);
        assert_eq!((pw, ph), (795, 345));
        assert_eq!(
            px,
            1920 + ((2560.0_f64 - 530.0 - 16.0) * 1.5).round() as i32
        );
        assert_eq!(py, ((1440.0_f64 - 230.0 - 16.0) * 1.5).round() as i32);
    }

    #[test]
    fn clamps_custom_hud_position_to_monitor_bounds() {
        let monitors = [(0, 0, 1920, 1080), (1920, 0, 2560, 1440)];
        // Inside primary monitor -> preserved
        assert_eq!(
            clamp_custom_hud_pos(500, 400, 424, 184, &monitors),
            Some((500, 400))
        );
        // Way off top-left -> clamped to (0, 0)
        assert_eq!(
            clamp_custom_hud_pos(-900, -200, 424, 184, &monitors),
            Some((0, 0))
        );
        // Inside secondary monitor near right edge -> clamped inside secondary monitor
        assert_eq!(
            clamp_custom_hud_pos(4400, 1400, 424, 184, &monitors),
            Some((1920 + 2560 - 424, 1440 - 184))
        );
    }
}

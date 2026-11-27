use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
#[cfg(windows)]
use std::time::Duration;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::replay_api;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareEncoderStatus {
    pub hardware_available: bool,
    pub encoder_names: Vec<String>,
    pub recommended_preset: String,
    pub message: String,
    pub league_window_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingRuntimeStatus {
    pub state: String, // "idle" | "recording" | "stopping" | "unavailable" | "error"
    pub recording_id: Option<String>,
    pub preset: String,
    pub elapsed_sec: f64,
    pub encoder_name: Option<String>,
    pub message: Option<String>,
}

impl Default for RecordingRuntimeStatus {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            recording_id: None,
            preset: "720p30".to_string(),
            elapsed_sec: 0.0,
            encoder_name: None,
            message: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct StartedRecordingMeta {
    pub recording_id: String,
    pub file_path: String,
    pub started_at: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub preset: String,
    pub encoder_name: String,
}

#[derive(Debug, Clone)]
pub struct StoppedRecordingMeta {
    pub recording_id: String,
    pub ended_at: String,
    pub duration_sec: f64,
    pub size_bytes: u64,
    pub status: String,
}

pub fn resolve_preset_spec(preset: &str, src_w: u32, src_h: u32) -> (u32, u32, u32, u32) {
    let (fps, bitrate) = match preset {
        "1080p60" => (60_u32, 8_000_000_u32),
        _ => (30_u32, 3_500_000_u32),
    };

    if src_w == 0 || src_h == 0 {
        let fallback_w = if preset == "1080p60" { 1920 } else { 1280 };
        let fallback_h = if preset == "1080p60" { 1080 } else { 720 };
        return (fallback_w, fallback_h, fps, bitrate);
    }

    // Encode at native even dimensions so windows-capture VideoEncoder never crops frames
    let even_w = (src_w & !1).max(2);
    let even_h = (src_h & !1).max(2);
    (even_w, even_h, fps, bitrate)
}

pub fn is_safe_recording_path(recordings_dir: &Path, candidate: &Path) -> bool {
    let ext_ok = candidate
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("mp4"));
    if !ext_ok {
        return false;
    }
    let Ok(dir_canon) = std::fs::canonicalize(recordings_dir) else {
        return false;
    };
    let Ok(file_canon) = std::fs::canonicalize(candidate) else {
        return false;
    };
    file_canon.starts_with(dir_canon)
}

#[cfg(windows)]
pub fn probe_hardware_encoder(lol_install_path: &str) -> HardwareEncoderStatus {
    use std::ffi::c_void;
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::Media::MediaFoundation::{
        IMFActivate, MFMediaType_Video, MFTEnumEx, MFT_FRIENDLY_NAME_Attribute, MFVideoFormat_H264,
        MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_ASYNCMFT, MFT_ENUM_FLAG_HARDWARE,
        MFT_ENUM_FLAG_SORTANDFILTER, MFT_REGISTER_TYPE_INFO,
    };
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_MULTITHREADED,
    };

    let league_window_mode = replay_api::inspect_game_cfg(lol_install_path).window_mode;
    let mut encoder_names = Vec::new();

    unsafe {
        let co_res = CoInitializeEx(None, COINIT_MULTITHREADED);
        let should_uninit = if co_res.is_ok() {
            true
        } else if co_res.0 == RPC_E_CHANGED_MODE.0 {
            false
        } else {
            return HardwareEncoderStatus {
                hardware_available: false,
                encoder_names,
                recommended_preset: "720p30".to_string(),
                message: format!("COM initialization failed during encoder probe: {co_res}"),
                league_window_mode,
            };
        };

        let output_type = MFT_REGISTER_TYPE_INFO {
            guidMajorType: MFMediaType_Video,
            guidSubtype: MFVideoFormat_H264,
        };
        let flags = MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_ASYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER;
        let mut activates_ptr: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count: u32 = 0;

        let enum_res = MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            flags,
            None,
            Some(&output_type),
            &mut activates_ptr,
            &mut count,
        );

        if enum_res.is_ok() && !activates_ptr.is_null() {
            let slice = std::slice::from_raw_parts_mut(activates_ptr, count as usize);
            for slot in slice.iter_mut() {
                if let Some(activate) = slot.take() {
                    let mut pushed = false;
                    if let Ok(len) = activate.GetStringLength(&MFT_FRIENDLY_NAME_Attribute) {
                        let mut buf = vec![0_u16; len as usize + 1];
                        let mut copied = 0_u32;
                        let name_ok = activate.GetString(
                            &MFT_FRIENDLY_NAME_Attribute,
                            &mut buf,
                            Some(&mut copied),
                        );
                        if name_ok.is_ok() {
                            let valid = (copied as usize).min(buf.len());
                            let raw = String::from_utf16_lossy(&buf[..valid]);
                            let name = raw.trim().to_string();
                            if !name.is_empty() {
                                encoder_names.push(name);
                                pushed = true;
                            }
                        }
                    }
                    if !pushed {
                        encoder_names.push("Windows Hardware H.264 MFT".to_string());
                    }
                    drop(activate);
                }
            }
            CoTaskMemFree(Some(activates_ptr as *const c_void));
        }

        if should_uninit {
            CoUninitialize();
        }
    }

    let hardware_available = !encoder_names.is_empty();
    let message = if hardware_available {
        format!(
            "Hardware H.264 GPU adapter detected ({}). Uses OS Media Foundation H.264 encoder.",
            encoder_names.join(", ")
        )
    } else {
        "No hardware H.264 GPU encoder found (NVENC / AMF / QuickSync required). Use Riot Replay API deep-links instead.".to_string()
    };

    HardwareEncoderStatus {
        hardware_available,
        encoder_names,
        recommended_preset: "720p30".to_string(),
        message,
        league_window_mode,
    }
}

#[cfg(not(windows))]
pub fn probe_hardware_encoder(lol_install_path: &str) -> HardwareEncoderStatus {
    let league_window_mode = replay_api::inspect_game_cfg(lol_install_path).window_mode;
    HardwareEncoderStatus {
        hardware_available: false,
        encoder_names: Vec::new(),
        recommended_preset: "720p30".to_string(),
        message: "Windows Graphics Capture is only available on Windows 10/11.".to_string(),
        league_window_mode,
    }
}

struct ActiveRecordingSession {
    recording_id: String,
    output_path: PathBuf,
    preset: String,
    encoder_name: String,
    started_at: Instant,
    first_frame_at: Arc<std::sync::Mutex<Option<Instant>>>,
    is_alive: Arc<AtomicBool>,
    runtime_error: Arc<std::sync::Mutex<Option<String>>>,
    stop_fn: Option<Box<dyn FnOnce() + Send>>,
}

#[derive(Default)]
pub struct RecorderManager {
    inner: std::sync::Mutex<Option<ActiveRecordingSession>>,
    last_error: std::sync::Mutex<Option<String>>,
}

impl RecorderManager {
    pub fn start_recording(
        &self,
        recordings_dir: &Path,
        preset: &str,
        lol_install_path: &str,
    ) -> AppResult<StartedRecordingMeta> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        if guard.is_some() {
            let msg = "A recording is already active.".to_string();
            return Err(AppError::Storage(msg));
        }

        let probe = probe_hardware_encoder(lol_install_path);
        if !probe.hardware_available {
            if let Ok(mut err_guard) = self.last_error.lock() {
                *err_guard = Some(probe.message.clone());
            }
            return Err(AppError::Storage(probe.message));
        }
        let encoder_name = probe
            .encoder_names
            .first()
            .cloned()
            .unwrap_or_else(|| "Hardware H.264".to_string());

        std::fs::create_dir_all(recordings_dir).map_err(|e| AppError::Storage(e.to_string()))?;
        let now = chrono::Utc::now();
        let recording_id = format!("rec-{}", now.format("%Y%m%d-%H%M%S-%3f"));
        let output_path = recordings_dir.join(format!("{recording_id}.mp4"));

        #[cfg(windows)]
        {
            let spawned = spawn_wgc_capture_thread(&output_path, preset)?;
            *guard = Some(ActiveRecordingSession {
                recording_id: recording_id.clone(),
                output_path: output_path.clone(),
                preset: preset.to_string(),
                encoder_name: encoder_name.clone(),
                started_at: Instant::now(),
                first_frame_at: spawned.first_frame_at,
                is_alive: spawned.is_alive,
                runtime_error: spawned.runtime_error,
                stop_fn: Some(spawned.stop_fn),
            });
            if let Ok(mut err_guard) = self.last_error.lock() {
                *err_guard = None;
            }

            Ok(StartedRecordingMeta {
                recording_id,
                file_path: output_path.to_string_lossy().to_string(),
                started_at: now.to_rfc3339(),
                width: spawned.width,
                height: spawned.height,
                fps: spawned.fps,
                preset: preset.to_string(),
                encoder_name,
            })
        }

        #[cfg(not(windows))]
        {
            let _ = (&recording_id, &output_path, &encoder_name, preset);
            Err(AppError::Storage(
                "Windows Graphics Capture is only available on Windows.".to_string(),
            ))
        }
    }

    pub fn stop_recording(&self) -> Option<StoppedRecordingMeta> {
        let mut session = {
            let mut guard = self.inner.lock().ok()?;
            guard.take()?
        };

        if let Some(stop_fn) = session.stop_fn.take() {
            stop_fn();
        }

        let err_msg = session.runtime_error.lock().ok().and_then(|e| e.clone());
        if let Some(ref msg) = err_msg {
            if let Ok(mut last_err) = self.last_error.lock() {
                *last_err = Some(msg.clone());
            }
        }

        let origin = session
            .first_frame_at
            .lock()
            .ok()
            .and_then(|g| *g)
            .unwrap_or(session.started_at);
        let duration_sec = origin.elapsed().as_secs_f64();
        let size_bytes = std::fs::metadata(&session.output_path)
            .map(|m| m.len())
            .unwrap_or(0);
        let status = if err_msg.is_some() && size_bytes == 0 {
            "failed"
        } else {
            "ready"
        };

        Some(StoppedRecordingMeta {
            recording_id: session.recording_id,
            ended_at: chrono::Utc::now().to_rfc3339(),
            duration_sec,
            size_bytes,
            status: status.to_string(),
        })
    }

    pub fn has_active_session(&self) -> bool {
        self.inner
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    pub fn active_recording_id(&self) -> Option<String> {
        let guard = self.inner.lock().ok()?;
        guard.as_ref().map(|s| s.recording_id.clone())
    }

    pub fn current_elapsed_sec(&self) -> Option<(String, f64)> {
        let guard = self.inner.lock().ok()?;
        let session = guard.as_ref()?;
        if !session.is_alive.load(Ordering::SeqCst) {
            return None;
        }
        let origin = session
            .first_frame_at
            .lock()
            .ok()
            .and_then(|g| *g)
            .unwrap_or(session.started_at);
        Some((session.recording_id.clone(), origin.elapsed().as_secs_f64()))
    }

    pub fn status(&self, preset: &str, hardware_available: bool) -> RecordingRuntimeStatus {
        if let Ok(guard) = self.inner.lock() {
            if let Some(session) = guard.as_ref() {
                if session.is_alive.load(Ordering::SeqCst) {
                    let origin = session
                        .first_frame_at
                        .lock()
                        .ok()
                        .and_then(|g| *g)
                        .unwrap_or(session.started_at);
                    return RecordingRuntimeStatus {
                        state: "recording".to_string(),
                        recording_id: Some(session.recording_id.clone()),
                        preset: session.preset.clone(),
                        elapsed_sec: origin.elapsed().as_secs_f64(),
                        encoder_name: Some(session.encoder_name.clone()),
                        message: None,
                    };
                }
            }
        }

        let last_error = self.last_error.lock().ok().and_then(|e| e.clone());
        let state = if last_error.is_some() {
            "error"
        } else if !hardware_available {
            "unavailable"
        } else {
            "idle"
        };
        RecordingRuntimeStatus {
            state: state.to_string(),
            recording_id: None,
            preset: preset.to_string(),
            elapsed_sec: 0.0,
            encoder_name: None,
            message: last_error,
        }
    }
}

#[cfg(windows)]
struct SpawnedWgcCapture {
    width: u32,
    height: u32,
    fps: u32,
    first_frame_at: Arc<std::sync::Mutex<Option<Instant>>>,
    is_alive: Arc<AtomicBool>,
    runtime_error: Arc<std::sync::Mutex<Option<String>>>,
    stop_fn: Box<dyn FnOnce() + Send>,
}

#[cfg(windows)]
fn spawn_wgc_capture_thread(output_path: &Path, preset: &str) -> AppResult<SpawnedWgcCapture> {
    use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
    use windows_capture::encoder::{
        AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder,
        VideoSettingsSubType,
    };
    use windows_capture::frame::Frame;
    use windows_capture::graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl};
    use windows_capture::settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    };
    use windows_capture::window::Window;

    let windows = Window::enumerate()
        .map_err(|e| AppError::Storage(format!("Failed to enumerate windows for capture: {e}")))?;

    // Strict exact match on the League game client HWND only (never LeagueClient or browser tabs)
    let mut target_window: Option<Window> = None;
    for win in windows {
        let is_game_window = win
            .title()
            .map(|t| {
                t.trim()
                    .eq_ignore_ascii_case("League of Legends (TM) Client")
            })
            .unwrap_or(false);
        if is_game_window {
            target_window = Some(win);
            break;
        }
    }

    let window = target_window.ok_or_else(|| {
        let msg =
            "League of Legends (TM) Client window not found (desktop windows are never recorded).";
        AppError::Storage(msg.to_string())
    })?;
    let rect = window
        .rect()
        .map_err(|e| AppError::Storage(format!("Unable to read game window bounds: {e}")))?;
    let raw_w = (rect.right - rect.left).max(0) as u32;
    let raw_h = (rect.bottom - rect.top).max(0) as u32;
    let (width, height, fps, bitrate) = resolve_preset_spec(preset, raw_w, raw_h);

    struct WgcFlags {
        is_alive: Arc<AtomicBool>,
        first_frame_at: Arc<std::sync::Mutex<Option<Instant>>>,
        runtime_error: Arc<std::sync::Mutex<Option<String>>>,
        fps: u32,
        bitrate: u32,
        output_path: PathBuf,
    }

    struct LeagueWgcHandler {
        encoder: Option<VideoEncoder>,
        encoded_size: Option<(u32, u32)>,
        flags: WgcFlags,
    }

    impl Drop for LeagueWgcHandler {
        fn drop(&mut self) {
            self.flags.is_alive.store(false, Ordering::SeqCst);
            if let Some(encoder) = self.encoder.take() {
                let _ = encoder.finish();
            }
        }
    }

    impl GraphicsCaptureApiHandler for LeagueWgcHandler {
        type Flags = WgcFlags;
        type Error = Box<dyn std::error::Error + Send + Sync>;

        fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
            Ok(Self {
                encoder: None,
                encoded_size: None,
                flags: ctx.flags,
            })
        }

        fn on_frame_arrived(
            &mut self,
            frame: &mut Frame,
            capture_control: InternalCaptureControl,
        ) -> Result<(), Self::Error> {
            let fw = (frame.width() & !1).max(2);
            let fh = (frame.height() & !1).max(2);

            if self.encoder.is_none() {
                let video_settings = VideoSettingsBuilder::new(fw, fh)
                    .sub_type(VideoSettingsSubType::H264)
                    .bitrate(self.flags.bitrate)
                    .frame_rate(self.flags.fps);
                match VideoEncoder::new(
                    video_settings,
                    AudioSettingsBuilder::default().disabled(true),
                    ContainerSettingsBuilder::default(),
                    &self.flags.output_path,
                ) {
                    Ok(encoder) => {
                        self.encoder = Some(encoder);
                        self.encoded_size = Some((fw, fh));
                        if let Ok(mut guard) = self.flags.first_frame_at.lock() {
                            if guard.is_none() {
                                *guard = Some(Instant::now());
                            }
                        }
                    }
                    Err(err) => {
                        if let Ok(mut guard) = self.flags.runtime_error.lock() {
                            *guard = Some(format!(
                                "Hardware video encoder failed to initialize: {err}"
                            ));
                        }
                        self.flags.is_alive.store(false, Ordering::SeqCst);
                        capture_control.stop();
                        return Ok(());
                    }
                }
            }

            if let Some(encoder) = self.encoder.as_mut() {
                if let Err(err) = encoder.send_frame(frame) {
                    if let Ok(mut guard) = self.flags.runtime_error.lock() {
                        *guard = Some(format!("Hardware video frame encode error: {err}"));
                    }
                    if let Some(enc) = self.encoder.take() {
                        let _ = enc.finish();
                    }
                    self.flags.is_alive.store(false, Ordering::SeqCst);
                    capture_control.stop();
                }
            }
            Ok(())
        }

        fn on_closed(&mut self) -> Result<(), Self::Error> {
            self.flags.is_alive.store(false, Ordering::SeqCst);
            if let Some(encoder) = self.encoder.take() {
                let _ = encoder.finish();
            }
            Ok(())
        }
    }

    let is_alive = Arc::new(AtomicBool::new(true));
    let first_frame_at = Arc::new(std::sync::Mutex::new(None));
    let runtime_error = Arc::new(std::sync::Mutex::new(None));

    let border_setting = if GraphicsCaptureApi::is_border_settings_supported().unwrap_or(false) {
        DrawBorderSettings::WithoutBorder
    } else {
        DrawBorderSettings::Default
    };
    let secondary_setting = if GraphicsCaptureApi::is_secondary_windows_supported().unwrap_or(false)
    {
        SecondaryWindowSettings::Exclude
    } else {
        SecondaryWindowSettings::Default
    };
    let interval_ms = (1000 / fps.max(1)) as u64;
    let interval_setting =
        if GraphicsCaptureApi::is_minimum_update_interval_supported().unwrap_or(false) {
            MinimumUpdateIntervalSettings::Custom(Duration::from_millis(interval_ms))
        } else {
            MinimumUpdateIntervalSettings::Default
        };

    let flags = WgcFlags {
        is_alive: is_alive.clone(),
        first_frame_at: first_frame_at.clone(),
        runtime_error: runtime_error.clone(),
        fps,
        bitrate,
        output_path: output_path.to_path_buf(),
    };
    let settings = Settings::new(
        window,
        CursorCaptureSettings::Default,
        border_setting,
        secondary_setting,
        interval_setting,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        flags,
    );

    let control = LeagueWgcHandler::start_free_threaded(settings).map_err(|err| {
        is_alive.store(false, Ordering::SeqCst);
        AppError::Storage(format!("Unable to start Windows Graphics Capture: {err}"))
    })?;

    let alive_after_stop = is_alive.clone();
    let err_after_stop = runtime_error.clone();
    let stop_fn: Box<dyn FnOnce() + Send> = Box::new(move || {
        if let Err(err) = control.stop() {
            if let Ok(mut guard) = err_after_stop.lock() {
                *guard = Some(format!("WGC capture stopped with error: {err}"));
            }
        }
        alive_after_stop.store(false, Ordering::SeqCst);
    });

    Ok(SpawnedWgcCapture {
        width,
        height,
        fps,
        first_frame_at,
        is_alive,
        runtime_error,
        stop_fn,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_even_aspect_preserved_dimensions() {
        assert_eq!(
            resolve_preset_spec("720p30", 1920, 1080),
            (1920, 1080, 30, 3_500_000)
        );
        assert_eq!(
            resolve_preset_spec("1080p60", 1920, 1080),
            (1920, 1080, 60, 8_000_000)
        );
        let (uw, uh, _, _) = resolve_preset_spec("720p30", 3441, 1441);
        assert_eq!(uw % 2, 0);
        assert_eq!(uh % 2, 0);
        assert_eq!(uw, 3440);
        assert_eq!(uh, 1440);
    }

    #[test]
    fn validates_recording_paths_inside_recordings_dir() {
        let base = std::env::temp_dir().join(format!(
            "bj_rec_path_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&base).expect("create rec dir");
        let good = base.join("rec-1.mp4");
        let bad_ext = base.join("rec-1.exe");
        let outside = std::env::temp_dir().join("outside.mp4");
        std::fs::write(&good, b"mp4").expect("good");
        std::fs::write(&bad_ext, b"exe").expect("bad");
        std::fs::write(&outside, b"out").expect("out");

        assert!(is_safe_recording_path(&base, &good));
        assert!(!is_safe_recording_path(&base, &bad_ext));
        assert!(!is_safe_recording_path(&base, &outside));

        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::remove_file(&outside);
    }
}

fn main() {
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "get_app_state",
            "set_overlay_mode",
            "get_settings",
            "save_settings",
            "save_riot_api_key",
            "sync_ddragon",
            "fetch_summoner_profile",
            "get_lcu_profile",
            "apply_runes_and_spells",
            "sync_recent_matches",
            "get_cached_matches",
            "get_climb_goals",
            "upsert_climb_goal",
            "delete_climb_goal",
            "set_focus_goal",
            "refresh_high_elo_meta",
            "get_cached_meta_snapshot",
            "save_ai_api_key",
            "generate_ai_debrief",
            "update_overlay_preferences",
            "get_lp_history",
            "check_riot_api_key_health",
            "get_app_meta",
            "open_logs_folder",
            "check_update",
            "install_update",
            "stage_update",
        ]));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}

// デイリーフラッシュのデスクトップ版。中身は Web 版と同じ HTML / JS で、
// ブラウザではできない「トラックパッドの振動」だけをここで受け持つ。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// JS の haptic(kind) から呼ばれる。
///   edge   … スワイプが確定ラインを越えた（指がまだトラックパッドに乗っている瞬間）
///   tick   … 新しい単語を打ち終えた
///   ok, ng … 判定が確定した
#[tauri::command]
fn haptic(app: tauri::AppHandle, kind: String) {
    #[cfg(target_os = "macos")]
    {
        // AppKit はメインスレッドからしか触れない
        let _ = app.run_on_main_thread(move || mac::perform(&kind));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, kind);
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2_app_kit::{
        NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime,
        NSHapticFeedbackPerformer,
    };

    pub fn perform(kind: &str) {
        let pattern = match kind {
            // 「カチッ」とはっきり。確定ラインを越えたときに使う
            "edge" => NSHapticFeedbackPattern::LevelChange,
            "tick" => NSHapticFeedbackPattern::Alignment,
            _ => NSHapticFeedbackPattern::Generic,
        };
        let performer = NSHapticFeedbackManager::defaultPerformer();
        performer.performFeedbackPattern_performanceTime(pattern, NSHapticFeedbackPerformanceTime::Now);
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![haptic])
        .run(tauri::generate_context!())
        .expect("デイリーフラッシュを起動できませんでした");
}

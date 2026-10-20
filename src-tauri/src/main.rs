// デイリーフラッシュのデスクトップ版。中身は Web 版と同じ HTML / JS で、
// ブラウザではできない「トラックパッドの振動」だけをここで受け持つ。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// JS の haptic(kind) から呼ばれる。
///   ramp-light / ramp … 確定ラインに向かって引っぱっている途中。だんだん間隔が詰まって鳴る
///   edge   … スワイプが確定ラインを越えた（指がまだトラックパッドに乗っている瞬間）。2連打で強く
///   tick   … 新しい単語を打ち終えた
///   ok, ng … 判定が確定した
#[tauri::command]
fn haptic(app: tauri::AppHandle, kind: String) {
    #[cfg(target_os = "macos")]
    {
        // AppKit はメインスレッドからしか触れない
        let first = kind.clone();
        let _ = app.run_on_main_thread(move || mac::perform(&first));
        // Mac の振動には強さの指定がないので、edge は少し間をあけてもう1回鳴らして「強く」する
        if kind == "edge" {
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(45));
                let _ = app.run_on_main_thread(move || mac::perform(&kind));
            });
        }
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
            // いちばんはっきりした「カチッ」。確定ラインを越えたとき
            "edge" => NSHapticFeedbackPattern::LevelChange,
            // いちばん弱い「コツ」。引っぱり始めと、新しい単語を打ち終えたとき
            "ramp-light" | "tick" => NSHapticFeedbackPattern::Alignment,
            // 中くらい。ラインに近づいてきたとき・判定が確定したとき
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

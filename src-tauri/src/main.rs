// 桌面壳：只负责开一个窗口加载前端页面，所有数据处理仍在前端完成。
// 关掉调试控制台窗口，双击运行时不弹黑框。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

/// 启动黑匣子：把关键事件写进日志，桌面版白屏时这是唯一线索。
fn log_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(dir) = std::env::var_os("TEMP") {
        paths.push(PathBuf::from(dir).join("labclean-boot.log"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("labclean-boot.log"));
        }
    }
    paths
}

fn log_line(line: &str) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let msg = format!("[{stamp}] {line}\n");
    for path in log_paths() {
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let _ = f.write_all(msg.as_bytes());
        }
    }
}

fn main() {
    log_line("=== LabClean 启动 ===");
    log_line(&format!(
        "exe={:?} version={}",
        std::env::current_exe(),
        env!("CARGO_PKG_VERSION")
    ));

    // 部分环境（新系统 / 杀软挂钩 / 虚拟机显卡）下 WebView2 初始化会卡死。
    // 这两个参数是社区验证过的绕过方式，允许用户自己覆盖。
    if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-features=RendererCodeIntegrity --disable-gpu",
        );
        log_line("已注入 WebView2 兼容参数");
    }

    // 看门狗线程：主线程如果卡在窗口创建上，这里会持续留下记录
    std::thread::spawn(|| {
        for secs in [5u64, 15, 30] {
            std::thread::sleep(Duration::from_secs(if secs == 5 { 5 } else { 10 }));
            log_line(&format!("看门狗: 已启动 {secs} 秒"));
        }
    });

    let result = tauri::Builder::default()
        .setup(|_app| {
            log_line("setup: 应用初始化完成");
            Ok(())
        })
        .on_page_load(|_webview, payload| {
            log_line(&format!("page_load: {:?} {}", payload.event(), payload.url()));
        })
        .build(tauri::generate_context!())
        .map(|app| {
            log_line("builder 完成，进入事件循环");
            app.run(|_app, event| {
                if let tauri::RunEvent::Exit = event {
                    log_line("退出");
                }
            });
        });

    if let Err(err) = result {
        log_line(&format!("启动失败: {err}"));
        panic!("启动 LabClean 失败: {err}");
    }
}

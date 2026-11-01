// 桌面壳：只负责开一个窗口加载前端页面，所有数据处理仍在前端完成。
// 关掉调试控制台窗口，双击运行时不弹黑框。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("启动 LabClean 失败");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 注册剪贴板插件，允许前端通过官方 API 读写系统剪贴板内容
    // 这里不额外暴露自定义命令，避免在 Rust 层重复维护权限与业务逻辑
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

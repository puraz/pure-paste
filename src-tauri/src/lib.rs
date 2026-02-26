mod commands;
mod db;
mod desktop;
mod models;

use crate::models::AppState;
use rusqlite::Connection;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 注册剪贴板插件，并在启动时初始化 SQLite，确保历史记录持久化
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    let builder = builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                // 将应用切换为辅助应用模式，隐藏 Dock 与 Cmd+Tab，仅通过托盘入口访问
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
            std::fs::create_dir_all(&app_data_dir).map_err(|err| err.to_string())?;
            let db_path = app_data_dir.join("clipboard.db");
            let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
            db::init_db(&conn).map_err(|err| err.to_string())?;
            // 启动前读取快捷键设置，稍后用于注册全局快捷键
            let open_window_shortcut = db::get_app_setting(&conn, models::OPEN_WINDOW_SHORTCUT_KEY)
                .map_err(|err| err.to_string())?;
            app.manage(AppState {
                db: Mutex::new(conn),
                monitoring_enabled: AtomicBool::new(true),
                last_clipboard_text: Mutex::new(None),
                skip_next_text: Mutex::new(None),
                allow_exit: AtomicBool::new(false),
            });
            #[cfg(desktop)]
            {
                desktop::setup_desktop(app, open_window_shortcut.as_deref())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_clipboard_history,
            commands::upsert_clipboard_item,
            commands::update_clipboard_item_text,
            commands::set_clipboard_item_pinned,
            commands::delete_clipboard_item,
            commands::clear_clipboard_history,
            commands::set_clipboard_monitoring,
            commands::get_clipboard_monitoring,
            commands::mark_clipboard_skip,
            commands::get_autostart_status,
            commands::set_autostart_enabled,
            commands::get_open_window_shortcut,
            commands::set_open_window_shortcut,
            commands::open_settings_window_command
        ]);
    #[cfg(desktop)]
    let builder = builder
        // 托盘菜单与主菜单共享同一事件回调，统一处理“打开/设置/退出”
        .on_menu_event(|app, event| {
            if event.id() == "show" {
                desktop::show_main_window(app);
            }
            if event.id() == "settings" {
                // 打开或聚焦设置窗口
                desktop::open_settings_window(app);
            }
            if event.id() == "quit" {
                // 标记为允许退出，确保只通过托盘菜单触发真正退出
                app.state::<AppState>()
                    .allow_exit
                    .store(true, Ordering::Relaxed);
                app.exit(0);
            }
        })
        // 仅左键点击托盘图标时显示主窗口，右键只负责弹出菜单避免误触打开
        .on_tray_icon_event(|app, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                ..
            } = event
            {
                desktop::show_main_window(app);
            }
        })
        // 关闭窗口时隐藏到托盘，保持后台监听不中断
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        });
    #[cfg(desktop)]
    {
        let app = builder
            .build(tauri::generate_context!())
            .expect("error while building tauri application");
        // 拦截系统级退出请求，确保只能通过托盘菜单真正退出
        app.run(|app_handle, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                let state = app_handle.state::<AppState>();
                if !state.allow_exit.load(Ordering::Relaxed) {
                    api.prevent_exit();
                }
            }
        });
    }
    #[cfg(not(desktop))]
    {
        builder
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}

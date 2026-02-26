// desktop.rs：集中放置桌面端（tray/快捷键/watcher/多窗口）相关逻辑，避免与 DB/命令混在一起难以维护。
// 说明：所有桌面端能力都必须在 `#[cfg(desktop)]` 下编译，确保未来支持移动端时不会被桌面依赖阻塞。

#[cfg(desktop)]
use crate::db::upsert_clipboard_item_internal;
#[cfg(desktop)]
use crate::models::{
    build_clipboard_payload, AppState, ClipboardBroadcastPayload, CLIPBOARD_POLL_INTERVAL_MS,
    MAX_HISTORY,
};
#[cfg(desktop)]
use arboard::Clipboard;
#[cfg(desktop)]
use std::error::Error;
#[cfg(desktop)]
use std::sync::atomic::Ordering;
#[cfg(desktop)]
use std::time::Duration;
#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItem};
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;
#[cfg(desktop)]
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// 优先使用固定尺寸托盘图标，避免默认图标过大导致菜单栏不可见
#[cfg(desktop)]
fn load_tray_icon_image() -> Option<tauri::image::Image<'static>> {
    let bytes = include_bytes!("../icons/32x32.png");
    tauri::image::Image::from_bytes(bytes)
        .ok()
        .map(|image| image.to_owned())
}

// 打开或聚焦设置窗口，避免重复创建并确保跨平台稳定
#[cfg(desktop)]
pub(crate) fn open_settings_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let window = tauri::WebviewWindowBuilder::new(
            &app_handle,
            "settings",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("设置")
        // 增大设置窗口高度，避免设置项增多后底部被遮挡
        .inner_size(520.0, 480.0)
        .resizable(false)
        .skip_taskbar(true)
        .build();
        if let Ok(window) = window {
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}

// 打开并聚焦主窗口，统一在托盘与菜单中复用
#[cfg(desktop)]
pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // 先显示再聚焦，确保窗口从隐藏状态恢复
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// 注册全局快捷键，用于唤起主窗口，确保快捷键触发时窗口始终可见
#[cfg(desktop)]
pub(crate) fn register_open_window_shortcut(
    app: &tauri::AppHandle,
    shortcut: &str,
) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                show_main_window(app);
            }
        })
        .map_err(|err| err.to_string())
}

// 切换全局快捷键注册状态，保障旧快捷键卸载、新快捷键生效
#[cfg(desktop)]
pub(crate) fn update_open_window_shortcut(
    app: &tauri::AppHandle,
    previous: Option<&str>,
    next: Option<&str>,
) -> Result<(), String> {
    if previous == next {
        return Ok(());
    }
    let manager = app.global_shortcut();
    if let Some(next) = next {
        register_open_window_shortcut(app, next)?;
        if let Some(previous) = previous {
            if let Err(err) = manager.unregister(previous).map_err(|err| err.to_string()) {
                let _ = manager.unregister(next);
                return Err(err);
            }
        }
        return Ok(());
    }
    if let Some(previous) = previous {
        manager
            .unregister(previous)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

// 后台剪贴板轮询任务，负责捕获系统剪贴板并写入数据库
#[cfg(desktop)]
pub(crate) fn start_clipboard_watcher(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        // 只在后台线程中持有剪贴板实例，避免跨线程竞争导致死锁
        let mut clipboard = loop {
            match Clipboard::new() {
                Ok(instance) => break instance,
                Err(_) => {
                    // 初始化失败时稍后重试，避免启动瞬间阻塞
                    std::thread::sleep(Duration::from_millis(1200));
                }
            }
        };

        // 启动后先读取一次当前剪贴板，避免重复计数已有内容
        if let Ok(initial_text) = clipboard.get_text() {
            let trimmed = initial_text.trim();
            if !trimmed.is_empty() {
                let state = app_handle.state::<AppState>();
                if let Ok(mut last_lock) = state.last_clipboard_text.lock() {
                    *last_lock = Some(trimmed.to_string());
                };
            }
        }

        loop {
            std::thread::sleep(Duration::from_millis(CLIPBOARD_POLL_INTERVAL_MS));
            let state = app_handle.state::<AppState>();
            if !state.monitoring_enabled.load(Ordering::Relaxed) {
                continue;
            }
            let content = match clipboard.get_text() {
                Ok(text) => text,
                Err(_) => continue,
            };
            let trimmed = content.trim();
            if trimmed.is_empty() {
                continue;
            }

            // 如果是应用自身写入的内容则跳过一次，避免重复计数
            let should_skip = {
                let mut skip_lock = match state.skip_next_text.lock() {
                    Ok(lock) => lock,
                    Err(_) => continue,
                };
                if skip_lock.as_deref() == Some(trimmed) {
                    *skip_lock = None;
                    true
                } else {
                    false
                }
            };
            if should_skip {
                if let Ok(mut last_lock) = state.last_clipboard_text.lock() {
                    *last_lock = Some(trimmed.to_string());
                }
                continue;
            }

            // 与最近一次记录对比，避免剪贴板未变化时重复写入
            let is_duplicate = match state.last_clipboard_text.lock() {
                Ok(lock) => lock.as_deref() == Some(trimmed),
                Err(_) => true,
            };
            if is_duplicate {
                continue;
            }

            let payload = build_clipboard_payload(trimmed.to_string());
            match upsert_clipboard_item_internal(&state, payload, MAX_HISTORY) {
                Ok(persisted) => {
                    if let Ok(mut last_lock) = state.last_clipboard_text.lock() {
                        *last_lock = Some(trimmed.to_string());
                    }
                    let _ = app_handle.emit(
                        "clipboard-updated",
                        ClipboardBroadcastPayload {
                            item: persisted,
                            merged_id: None,
                        },
                    );
                }
                Err(_) => {
                    // 写入失败时保持 last_clipboard_text 不更新，便于下次重试
                }
            }
        }
    });
}

// 在 setup 阶段一次性完成桌面端能力初始化：快捷键、自启动插件、托盘、后台 watcher。
#[cfg(desktop)]
pub(crate) fn setup_desktop(
    app: &mut tauri::App,
    open_window_shortcut: Option<&str>,
) -> Result<(), Box<dyn Error>> {
    // 根据已保存的配置注册全局快捷键，保证启动后即可生效
    if let Some(shortcut) = open_window_shortcut {
        register_open_window_shortcut(&app.handle(), shortcut)?;
    }

    // 初始化开机自启动插件，保证设置页可以读取/切换系统自启动状态
    app.handle()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&'static str>>,
        ))
        .map_err(|err| err.to_string())?;

    // 创建托盘菜单，确保应用关闭窗口后仍可快速唤起
    let show_item = MenuItem::with_id(app, "show", "打开", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let tray_menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()?;
    let mut tray_builder = TrayIconBuilder::new()
        .menu(&tray_menu)
        .tooltip("我的剪贴板")
        // 左键点击直接触发点击事件，退出改为右键/菜单操作
        .show_menu_on_left_click(false);
    if let Some(icon) = load_tray_icon_image().or_else(|| app.default_window_icon().cloned()) {
        tray_builder = tray_builder.icon(icon);
    }
    #[cfg(target_os = "macos")]
    {
        // 使用模板图标适配深浅色菜单栏，避免图标不可见
        tray_builder = tray_builder.icon_as_template(true);
    }
    let tray = tray_builder.build(app)?;

    // 保持托盘实例存活，避免离开作用域后图标被自动移除
    app.manage(tray);

    // 启动后台剪贴板监听任务，确保隐藏窗口后仍可记录
    start_clipboard_watcher(app.handle().clone());

    Ok(())
}

// Runway for Mac: one window onto the published Runway page, so it opens from the Dock like any app.
// The data stays in the page's claude.ai database, which is how the phone and the float see the same thing.
import Cocoa
import WebKit

let PAGE_URL = URL(string: "https://claude.ai/artifact/S2ciyRbWrBAj86haWpHMhG")!
// claude.ai serves its full page only to browsers it recognises
let SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var asleepAt: Date?
    let defaults = UserDefaults.standard

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let vf = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        var rect = NSRect(x: vf.midX - 640, y: vf.midY - 420, width: 1280, height: 840).intersection(vf)
        if let f = defaults.string(forKey: "frame") {
            let r = NSRectFromString(f)
            if r.width > 400 && r.height > 300 { rect = r }
        }
        window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Runway"
        window.minSize = NSSize(width: 380, height: 480)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.delegate = self

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        web = WKWebView(frame: window.contentView!.bounds, configuration: config)
        web.autoresizingMask = [.width, .height]
        web.customUserAgent = SAFARI_UA
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        window.contentView = web
        web.load(URLRequest(url: PAGE_URL))
        window.makeKeyAndOrderFront(nil)

        // after a long sleep the page's data connection can hang without saying so; a fresh load reconnects it
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in self?.asleepAt = Date() }
        ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self, let t = self.asleepAt, Date().timeIntervalSince(t) > 300 else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.reload() }
        }
    }

    func buildMenu() {
        let main = NSMenu()
        func sub(_ title: String, _ items: [NSMenuItem]) {
            let holder = NSMenuItem(); let m = NSMenu(title: title)
            items.forEach { m.addItem($0) }
            holder.submenu = m; main.addItem(holder)
        }
        func item(_ t: String, _ a: Selector?, _ k: String, target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: t, action: a, keyEquivalent: k); i.target = target; return i
        }
        sub("Runway", [
            item("隐藏 Runway", #selector(NSApplication.hide(_:)), "h"),
            .separator(),
            item("退出 Runway", #selector(NSApplication.terminate(_:)), "q"),
        ])
        sub("编辑", [
            item("撤销", Selector(("undo:")), "z"),
            item("重做", Selector(("redo:")), "Z"),
            .separator(),
            item("剪切", #selector(NSText.cut(_:)), "x"),
            item("复制", #selector(NSText.copy(_:)), "c"),
            item("粘贴", #selector(NSText.paste(_:)), "v"),
            item("全选", #selector(NSText.selectAll(_:)), "a"),
        ])
        sub("显示", [
            item("重新载入", #selector(reload), "r", target: self),
            item("放大", #selector(zoomIn), "=", target: self),
            item("缩小", #selector(zoomOut), "-", target: self),
            item("实际大小", #selector(zoomReset), "0", target: self),
            .separator(),
            item("在浏览器里打开", #selector(openInBrowser), "", target: self),
        ])
        sub("窗口", [
            item("最小化", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("关闭窗口", #selector(NSWindow.performClose(_:)), "w"),
        ])
        NSApp.mainMenu = main
    }

    @objc func reload() { web.load(URLRequest(url: PAGE_URL)) }
    @objc func zoomIn() { setZoom(web.pageZoom + 0.1) }
    @objc func zoomOut() { setZoom(web.pageZoom - 0.1) }
    @objc func zoomReset() { setZoom(1) }
    func setZoom(_ z: CGFloat) { web.pageZoom = max(0.6, min(2, z)); defaults.set(Double(web.pageZoom), forKey: "zoom") }
    @objc func openInBrowser() { NSWorkspace.shared.open(PAGE_URL) }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let z = defaults.double(forKey: "zoom"); if z > 0 { webView.pageZoom = z }
        // after signing in, claude.ai lands on its home page: go back to Runway
        guard let url = webView.url, (url.host ?? "").hasSuffix("claude.ai") else { return }
        let p = url.path
        if p == "/" || p.hasPrefix("/new") || p.hasPrefix("/recents") || p.hasPrefix("/chat") || p.hasPrefix("/project") { reload() }
    }
    // sign-in popups load in place; other links open in the browser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            let h = url.host ?? ""
            if h.hasSuffix("claude.ai") || h.contains("accounts.google") || h.contains("appleid.apple") { webView.load(navigationAction.request) }
            else { NSWorkspace.shared.open(url) }
        }
        return nil
    }
    // backups ("导出与备份") arrive as downloads; save them where the user picks
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p = NSOpenPanel(); p.allowsMultipleSelection = parameters.allowsMultipleSelection
        p.beginSheetModal(for: window) { r in completionHandler(r == .OK ? p.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "好"); a.addButton(withTitle: "取消")
        a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { reload() }

    func saveFrame() { defaults.set(NSStringFromRect(window.frame), forKey: "frame") }
    func windowDidMove(_ notification: Notification) { saveFrame() }
    func windowDidEndLiveResize(_ notification: Notification) { saveFrame() }
    // closing the window keeps the app and the page alive, like Mail or Notes
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }
}

extension AppDelegate: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let p = NSSavePanel(); p.nameFieldStringValue = suggestedFilename
        p.beginSheetModal(for: window) { r in completionHandler(r == .OK ? p.url : nil) }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

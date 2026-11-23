// Runway for Mac. The window shows Runway's own page, bundled in the app, so there is no claude.ai around it.
// The data still lives in the claude.ai page's database, which is what keeps the phone and the float in step:
// the app keeps that page open out of sight and passes data between the two (app/store.ts, serveRelay).
import Cocoa
import WebKit
import Network

let PAGE_URL = URL(string: "https://claude.ai/artifact/S2ciyRbWrBAj86haWpHMhG")!
// claude.ai serves its full page only to browsers it recognises
let SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

/// WKUserContentController keeps its handlers alive; this breaks the cycle back to the delegate.
final class Handler: NSObject, WKScriptMessageHandler {
    let on: (WKScriptMessage) -> Void
    init(_ on: @escaping (WKScriptMessage) -> Void) { self.on = on }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { on(m) }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var app: WKWebView!            // what the user sees
    var relay: WKWebView!          // the claude.ai page, out of sight
    var relayFrame: WKFrameInfo?
    var pending: [String] = []     // writes made before the hidden page answered
    var lastSnap: String?
    var signIn: NSWindow?
    var lastHeard = Date(), lastLoad = Date(), misses = 0
    var asleepAt: Date?
    let net = NWPathMonitor()
    var lastPath: String?
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
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        // must match --desk in app/template.html, so the title bar reads as part of the page
        window.backgroundColor = NSColor(name: nil) { a in
            a.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
                ? NSColor(srgbRed: 0x12/255, green: 0x13/255, blue: 0x13/255, alpha: 1)
                : NSColor(srgbRed: 0xED/255, green: 0xEC/255, blue: 0xE8/255, alpha: 1)
        }
        window.minSize = NSSize(width: 380, height: 480)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.delegate = self
        let box = NSView(frame: window.contentView!.bounds)
        box.autoresizingMask = [.width, .height]
        window.contentView = box

        let rc = WKWebViewConfiguration()
        rc.websiteDataStore = .default()
        rc.userContentController.add(Handler { [weak self] m in self?.fromRelay(m) }, name: "runwayRelay")
        relay = WKWebView(frame: box.bounds, configuration: rc)
        relay.autoresizingMask = [.width, .height]
        relay.customUserAgent = SAFARI_UA
        relay.navigationDelegate = self
        relay.uiDelegate = self
        relay.alphaValue = 0
        box.addSubview(relay)

        let ac = WKWebViewConfiguration()
        ac.userContentController.add(Handler { [weak self] m in self?.fromApp(m) }, name: "runwayApp")
        ac.userContentController.addUserScript(WKUserScript(source: "const s=document.createElement('style');s.textContent='body{margin-top:0}#app{padding-top:2px}';document.head.appendChild(s)", injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        app = WKWebView(frame: box.bounds, configuration: ac)
        app.autoresizingMask = [.width, .height]
        app.uiDelegate = self
        app.navigationDelegate = self
        box.addSubview(app)
        let z = defaults.double(forKey: "zoom"); if z > 0 { app.pageZoom = z }

        if let page = Bundle.main.url(forResource: "runway", withExtension: "html") {
            app.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        }
        loadRelay("start")
        window.makeKeyAndOrderFront(nil)

        let t = Timer(timeInterval: 5, target: self, selector: #selector(checkRelay), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        // after sleep or a network change the hidden page's connection can hang without saying so
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in self?.asleepAt = Date() }
        ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self?.loadRelay("woke from sleep") }
        }
        net.pathUpdateHandler = { [weak self] path in
            let key = path.status == .satisfied ? path.availableInterfaces.map(\.name).joined(separator: ",") : "down"
            DispatchQueue.main.async {
                guard let self = self else { return }
                defer { self.lastPath = key }
                guard let was = self.lastPath, was != key, key != "down" else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.loadRelay("network changed") }
            }
        }
        net.start(queue: .global(qos: .utility))
    }

    // hidden page -> window: a snapshot of everything
    func fromRelay(_ m: WKScriptMessage) {
        guard let text = m.body as? String else { return }
        relayFrame = m.frameInfo
        lastHeard = Date(); misses = 0
        lastSnap = text
        app.evaluateJavaScript("window.runwayData && window.runwayData(\(text))") { _, _ in }
        if !pending.isEmpty { let p = pending; pending = []; p.forEach(toRelay) }
        if signIn != nil, text.contains("\"mode\":\"live\"") { closeSignIn() }
    }
    // window -> hidden page: one write, or a file to save
    func fromApp(_ m: WKScriptMessage) {
        guard let text = m.body as? String, let data = text.data(using: .utf8),
              let c = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let op = c["op"] as? String else { return }
        switch op {
        case "hello": if let s = lastSnap { app.evaluateJavaScript("window.runwayData && window.runwayData(\(s))") { _, _ in } }
        case "save": save(name: c["filename"] as? String ?? "Runway.txt", text: c["data"] as? String ?? "")
        default: toRelay(text)
        }
    }
    func toRelay(_ text: String) {
        guard let f = relayFrame else { pending.append(text); return }
        relay.evaluateJavaScript("window.runwayRelay && window.runwayRelay(\(text))", in: f, in: .page) { _ in }
    }

    func loadRelay(_ why: String) {
        guard signIn == nil else { return }
        NSLog("Runway: loading the data page (%@)", why)
        relayFrame = nil
        lastLoad = Date()
        relay.load(URLRequest(url: PAGE_URL))
    }
    /// The hidden page posts at least every 10 s. Silence means it is signed out, offline or stuck.
    @objc func checkRelay() {
        let quiet = Date().timeIntervalSince(lastHeard), since = Date().timeIntervalSince(lastLoad)
        if lastSnap == nil, since > 15, signIn == nil { showSignIn(); return }
        if lastSnap != nil, quiet > 30, since > min(600, 30 * pow(2, Double(misses))) { misses += 1; loadRelay("silent \(Int(quiet)) s") }
    }

    // the claude.ai page in its own window, only for signing in
    @objc func showSignIn() {
        guard signIn == nil else { signIn?.makeKeyAndOrderFront(nil); return }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 680), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        w.title = "登录 claude.ai，Runway 的数据存在那里"
        w.isReleasedWhenClosed = false
        w.delegate = self
        relay.removeFromSuperview()
        relay.alphaValue = 1
        relay.frame = w.contentView!.bounds
        w.contentView!.addSubview(relay)
        w.center()
        signIn = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func closeSignIn() {
        guard let w = signIn else { return }
        signIn = nil
        relay.removeFromSuperview()
        relay.alphaValue = 0
        relay.frame = window.contentView!.bounds
        window.contentView!.addSubview(relay, positioned: .below, relativeTo: app)
        w.orderOut(nil)
    }

    func save(name: String, text: String) {
        let p = NSSavePanel(); p.nameFieldStringValue = name
        p.beginSheetModal(for: window) { r in
            guard r == .OK, let url = p.url else { return }
            try? text.write(to: url, atomically: true, encoding: .utf8)
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
            item("重新连接数据", #selector(reconnect), "r", target: self),
            item("放大", #selector(zoomIn), "=", target: self),
            item("缩小", #selector(zoomOut), "-", target: self),
            item("实际大小", #selector(zoomReset), "0", target: self),
            .separator(),
            item("登录 claude.ai", #selector(showSignIn), "", target: self),
        ])
        sub("窗口", [
            item("最小化", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("关闭窗口", #selector(NSWindow.performClose(_:)), "w"),
        ])
        NSApp.mainMenu = main
    }
    @objc func reconnect() { loadRelay("menu") }
    @objc func zoomIn() { setZoom(app.pageZoom + 0.1) }
    @objc func zoomOut() { setZoom(app.pageZoom - 0.1) }
    @objc func zoomReset() { setZoom(1) }
    func setZoom(_ z: CGFloat) { app.pageZoom = max(0.6, min(2, z)); defaults.set(Double(app.pageZoom), forKey: "zoom") }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === relay, let url = webView.url, (url.host ?? "").hasSuffix("claude.ai") else { return }
        // after signing in, claude.ai lands on its home page: go back to the Runway page
        let p = url.path
        if p == "/" || p.hasPrefix("/new") || p.hasPrefix("/recents") || p.hasPrefix("/chat") || p.hasPrefix("/project") { relay.load(URLRequest(url: PAGE_URL)) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // the window only ever shows its own page; links in it open in the browser
        if webView === app, action.navigationType == .linkActivated, let url = action.request.url, !url.isFileURL {
            NSWorkspace.shared.open(url); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    // sign-in popups load in place; other links open in the browser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            let h = url.host ?? ""
            if webView === relay, h.hasSuffix("claude.ai") || h.contains("accounts.google") || h.contains("appleid.apple") { relay.load(navigationAction.request) }
            else { NSWorkspace.shared.open(url) }
        }
        return nil
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p = NSOpenPanel(); p.allowsMultipleSelection = parameters.allowsMultipleSelection
        p.beginSheetModal(for: window) { r in completionHandler(r == .OK ? p.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "好"); a.addButton(withTitle: "取消")
        a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView === relay { loadRelay("page process ended") }
        else if let page = Bundle.main.url(forResource: "runway", withExtension: "html") { app.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent()) }
    }

    func saveFrame() { defaults.set(NSStringFromRect(window.frame), forKey: "frame") }
    func windowDidMove(_ notification: Notification) { if (notification.object as? NSWindow) === window { saveFrame() } }
    func windowDidEndLiveResize(_ notification: Notification) { if (notification.object as? NSWindow) === window { saveFrame() } }
    func windowWillClose(_ notification: Notification) {
        if (notification.object as? NSWindow) === signIn { closeSignIn() }
    }
    // closing the window keeps the app, and the data connection, alive
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()

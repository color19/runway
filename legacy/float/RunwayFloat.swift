// Runway Float: a frosted-glass, always-on-top window for today's Runway.
// The glass UI is native SwiftUI. Data is the real Runway: a hidden web view keeps
// the Runway page open (signed in to claude.ai once) and talks to it over a bridge.
import SwiftUI
import AppKit
import WebKit

let MINI_URL = URL(string: "https://claude.ai/artifact/4PgX2pfjffLRxsxxD1g41b#mini")!
let FULL_URL = URL(string: "https://claude.ai/artifact/4PgX2pfjffLRxsxxD1g41b")!
let SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

// MARK: - Spiral rules (same as the page)
let A_MIN = [10, 20, 30, 40, 45]
let B_MIN = [10, 15]
func blockMin(_ i: Int) -> Int { i % 2 == 0 ? A_MIN[min(i / 2, A_MIN.count - 1)] : B_MIN[min((i - 1) / 2, B_MIN.count - 1)] }
func isA(_ i: Int) -> Bool { i % 2 == 0 }
func fmt(_ sec: Int) -> String { let a = abs(sec); return (sec < 0 ? "+" : "") + String(format: "%02d:%02d", a / 60, a % 60) }

let warnC   = Color(red: 0.77, green: 0.28, blue: 0.12)

// MARK: - What the page sends
struct RTask: Decodable, Identifiable, Equatable { let id: String; let title: String; let done: Bool }
struct RSpiral: Decodable, Equatable { var idx: Int; var endsAt: Double?; var left: Int; var bi: Int }
struct RExam: Decodable, Equatable { let title: String; let days: Int }
struct RTarget: Decodable, Equatable, Identifiable { let id: String; let title: String; let days: Int }
struct RState: Decodable, Equatable {
    let today: String
    let nick: String?
    let local: Bool?
    let acc: [String]?
    let exam: RExam?
    let targets: [RTarget]?
    let spiral: RSpiral
    let b: [String]
    let tasks: [RTask]
    let overdue: [RTask]
}

final class Model: ObservableObject {
    @Published var st: RState?
    @Published var now = Date()
    @Published var waiting = true          // nothing heard from the page yet
    var send: (([String: Any]) -> Void)?
    var showWeb: (() -> Void)?
    private var lastEnds: Double? = nil
    private var rang = false

    func apply(_ s: RState) {
        if s.spiral.endsAt != lastEnds { lastEnds = s.spiral.endsAt; rang = false }
        if s != st { st = s }
        waiting = false
    }
    func tick() {
        now = Date()
        if let e = st?.spiral.endsAt, now.timeIntervalSince1970 * 1000 >= e, !rang {
            rang = true
            NSSound(named: "Glass")?.play()
        }
    }
    func cmd(_ op: String, _ extra: [String: Any] = [:]) {
        var d = extra
        d["op"] = op
        send?(d)
    }

    var signedIn: Bool { st != nil && !(st?.local ?? false) }
    var idx: Int { st?.spiral.idx ?? 0 }
    var running: Bool { st?.spiral.endsAt != nil }
    var leftSec: Int {
        guard let sp = st?.spiral else { return 600 }
        if let e = sp.endsAt { return Int((e / 1000 - now.timeIntervalSince1970).rounded()) }
        return sp.left
    }
    var open: [RTask] { (st?.tasks ?? []).filter { !$0.done } }
    var done: [RTask] { (st?.tasks ?? []).filter { $0.done } }
    var greeting: String {
        let h = Calendar.current.component(.hour, from: now)
        return h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好"
    }
    var dateLine: String {
        let c = Calendar.current.dateComponents([.month, .day, .weekday], from: now)
        let wd = ["日", "一", "二", "三", "四", "五", "六"][((c.weekday ?? 1) - 1) % 7]
        return "\(c.month ?? 0) 月 \(c.day ?? 0) 日 · 周\(wd)"
    }
    var whatTitle: String {
        if isA(idx) { return open.first?.title ?? "先在下面加一件今天的事" }
        let b = st?.b ?? []
        return b.isEmpty ? "离开屏幕，喝口水" : b[(st?.spiral.bi ?? 0) % b.count]
    }
    var whatSub: String {
        if isA(idx) { return open.isEmpty ? "A 段做的是今天清单里的第一件" : (idx == 0 ? "这 10 分钟只要打开它就算赢" : "接着刚才的往下做") }
        return "玩完回来接着做"
    }
}

// MARK: - Glass and small pieces (old Runway "简约" edition: paper, ink, one signal colour)
extension Color {
    init(hex: String) {
        var h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        var v: UInt64 = 0
        Scanner(string: h).scanHexInt64(&v)
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

struct Glass: NSViewRepresentable {
    var dark: Bool
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.blendingMode = .behindWindow
        v.state = .active
        v.wantsLayer = true
        v.layer?.cornerRadius = 22
        v.layer?.cornerCurve = .continuous
        v.layer?.masksToBounds = true
        apply(v)
        return v
    }
    func updateNSView(_ v: NSVisualEffectView, context: Context) { apply(v) }
    func apply(_ v: NSVisualEffectView) {
        v.material = dark ? .hudWindow : .popover
        v.appearance = NSAppearance(named: dark ? .vibrantDark : .vibrantLight)
    }
}

final class DragView: NSView {
    override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
}
struct DragHandle: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { DragView() }
    func updateNSView(_ nsView: NSView, context: Context) {}
}

// a paper card on the glass, with the old 3pt colour stripe on the left
struct CardBG: ViewModifier {
    @Environment(\.colorScheme) var cs
    var stripe: Color? = nil
    func body(content: Content) -> some View {
        content
            .padding(12)
            .padding(.leading, stripe == nil ? 0 : 2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 14, style: .continuous).fill(cs == .dark ? Color.white.opacity(0.06) : Color.white.opacity(0.62))
                    if let s = stripe { Rectangle().fill(s).frame(width: 3) }
                }
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            )
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(cs == .dark ? Color.white.opacity(0.10) : Color.black.opacity(0.08), lineWidth: 1))
    }
}

// mono label, like the old eyebrows and stat captions
struct Mono: View {
    var text: String
    var size: CGFloat = 10
    var body: some View {
        Text(text).font(.system(size: size, weight: .medium, design: .monospaced)).tracking(0.8).foregroundColor(.secondary)
    }
}

// ink button (default), signal button, or outline
enum PillKind { case ink, signal, outline }
struct Pill: ButtonStyle {
    var kind: PillKind = .ink
    var sig: Color
    @Environment(\.colorScheme) var cs
    func makeBody(configuration: Configuration) -> some View {
        let paper = cs == .dark ? Color(hex: "#141415") : Color.white
        let bg: Color = kind == .ink ? .primary : (kind == .signal ? sig : (cs == .dark ? Color.white.opacity(0.06) : Color.white.opacity(0.7)))
        let fg: Color = kind == .outline ? .primary : (kind == .signal ? .white : paper)
        return configuration.label
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(bg))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(kind == .outline ? Color.primary.opacity(0.2) : Color.clear, lineWidth: 1))
            .foregroundColor(fg)
            .opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(Rectangle())
    }
}

// MARK: - The window's content
struct RootView: View {
    @EnvironmentObject var m: Model
    @AppStorage("darkGlass") var dark = false
    @AppStorage("countPick") var pick = ""
    @State private var draft = ""
    @State private var bDraft = ""

    var sig: Color {
        let a = m.st?.acc ?? ["#1F3BE0", "#7B8CFF"]
        return Color(hex: dark ? (a.count > 1 ? a[1] : a[0]) : a[0])
    }
    var target: RTarget? {
        let ts = m.st?.targets ?? []
        if let t = ts.first(where: { $0.id == pick }) { return t }
        if let t = ts.first { return t }
        if let ex = m.st?.exam, ex.days >= 0 { return RTarget(id: "", title: ex.title, days: ex.days) }
        return nil
    }
    func cycleTarget() {
        let ts = m.st?.targets ?? []
        guard !ts.isEmpty else { return }
        let i = ts.firstIndex(where: { $0.id == target?.id }) ?? -1
        pick = ts[(i + 1) % ts.count].id
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ZStack {
                Capsule().fill(Color.primary.opacity(0.22)).frame(width: 36, height: 4)
                DragHandle()
            }
            .frame(maxWidth: .infinity)
            .frame(height: 12)
            .padding(.top, -8)
            .padding(.bottom, -6)
            .help("按住这里拖动")
            header
            Rectangle().fill(Color.primary.opacity(0.1)).frame(height: 1)
            if m.st == nil {
                connecting
            } else {
                if !m.signedIn { notSignedIn }
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 10) {
                        spiral
                        tasks
                        bSection
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Glass(dark: dark))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.white.opacity(dark ? 0.16 : 0.65), lineWidth: 0.8))
        .environment(\.colorScheme, dark ? .dark : .light)
    }

    var connecting: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("正在连接 Runway").font(.system(size: 15, weight: .bold)).tracking(-0.3)
            Text("第一次用要登录一次 claude.ai。几秒后还连不上，点下面的按钮登录，登录完会自动回来。")
                .font(.system(size: 12)).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
            Button("去登录") { m.showWeb?() }.buttonStyle(Pill(kind: .ink, sig: sig))
        }
        .modifier(CardBG(stripe: sig))
    }

    var notSignedIn: some View {
        HStack(spacing: 8) {
            Text("还没登录，现在改的只存在小窗里").font(.system(size: 11)).foregroundColor(warnC)
            Spacer()
            Button("登录") { m.showWeb?() }.buttonStyle(Pill(kind: .outline, sig: sig))
        }
    }

    var header: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Circle().fill(sig).frame(width: 5, height: 5)
                    Mono(text: m.dateLine)
                }
                Text("\(m.greeting)，\(m.st?.nick ?? "Color")")
                    .font(.system(size: 20, weight: .bold))
                    .tracking(-0.8)
            }
            .overlay(DragHandle())
            Spacer()
                .frame(minHeight: 30)
                .overlay(DragHandle())
            if let t = target {
                Button { cycleTarget() } label: {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(t.days == 0 ? "今天" : "\(t.days)")
                            .font(.system(size: 28, weight: .bold))
                            .tracking(-1.4)
                            .monospacedDigit()
                            .foregroundColor(sig)
                        Text(t.days == 0 ? t.title : "天到 \(t.title)")
                            .font(.system(size: 9, weight: .medium, design: .monospaced))
                            .foregroundColor(.secondary)
                            .lineLimit(1).truncationMode(.tail)
                            .frame(maxWidth: 140, alignment: .trailing)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("点一下换下一个，右键选全部")
                .contextMenu {
                    ForEach(m.st?.targets ?? []) { x in
                        Button("\(x.title) · \(x.days) 天") { pick = x.id }
                    }
                }
            }
        }
        .background(DragHandle())
    }

    var spiral: some View {
        let a = isA(m.idx)
        return VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(0..<max(8, m.idx + 3), id: \.self) { i in
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(isA(i) ? sig : Color.primary.opacity(0.25))
                            .opacity(i < m.idx ? 0.18 : (i == m.idx ? 1 : 0.4))
                            .frame(width: CGFloat(blockMin(i)) * 0.8 + 6, height: CGFloat(blockMin(i)) * 0.35 + 6)
                    }
                }
                .padding(.vertical, 2)
            }
            .frame(height: 26)
            HStack(spacing: 6) {
                Text(a ? "A" : "B")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .padding(.horizontal, 6).padding(.vertical, 1)
                    .background(RoundedRectangle(cornerRadius: 4).fill(a ? sig : Color.primary))
                    .foregroundColor(a ? .white : (dark ? .black : .white))
                Mono(text: "第 \(m.idx / 2 + 1) 轮 · \(a ? "做事" : "奖励") \(blockMin(m.idx)) 分钟")
            }
            Text(fmt(m.leftSec))
                .font(.system(size: 50, weight: .bold))
                .tracking(-2.6)
                .monospacedDigit()
            VStack(alignment: .leading, spacing: 2) {
                Text(m.whatTitle).font(.system(size: 14, weight: .semibold)).tracking(-0.2).fixedSize(horizontal: false, vertical: true)
                Text(m.whatSub).font(.system(size: 11)).foregroundColor(.secondary)
            }
            controls(a: a)
        }
        .modifier(CardBG(stripe: a ? sig : Color.primary))
    }

    @ViewBuilder func controls(a: Bool) -> some View {
        let sec = m.leftSec
        let fresh = sec == blockMin(m.idx) * 60
        HStack(spacing: 6) {
            if m.running && sec <= 0 {
                Text("时间到").font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundColor(sig)
                if a {
                    Button("去玩 \(blockMin(m.idx + 1)) 分钟") { m.cmd("next") }.buttonStyle(Pill(kind: .ink, sig: sig))
                    Button("再做 10 分钟") { m.cmd("more10") }.buttonStyle(Pill(kind: .outline, sig: sig))
                } else {
                    Button("回来做 \(blockMin(m.idx + 1)) 分钟") { m.cmd("next") }.buttonStyle(Pill(kind: .signal, sig: sig))
                }
            } else if m.running {
                Button("暂停") { m.cmd("pause") }.buttonStyle(Pill(kind: .ink, sig: sig))
                Button("这段结束") { m.cmd("next") }.buttonStyle(Pill(kind: .outline, sig: sig))
                if !a && (m.st?.b.count ?? 0) > 1 {
                    Button("换一个") { m.cmd("swapB") }.buttonStyle(Pill(kind: .outline, sig: sig))
                }
            } else {
                Button(fresh ? "开始" : "继续") { m.cmd("start") }.buttonStyle(Pill(kind: a ? .signal : .ink, sig: sig))
                if m.idx > 0 || !fresh {
                    Button("重来") { m.cmd("reset") }.buttonStyle(Pill(kind: .outline, sig: sig))
                }
            }
        }
    }

    var tasks: some View {
        let open = m.open
        let done = m.done
        let over = m.st?.overdue ?? []
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("今天做这几件").font(.system(size: 15, weight: .bold)).tracking(-0.4)
                Spacer()
                if !over.isEmpty {
                    Menu("之前没做完 \(over.count)") {
                        ForEach(over) { it in
                            Button("今天做：\(it.title)") { m.cmd("toToday", ["id": it.id]) }
                        }
                        Divider()
                        Button("全部放回待排池") { m.cmd("clearOver") }
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                }
            }
            if open.isEmpty && done.isEmpty {
                Text("还没排事，在下面加一件。").font(.system(size: 12)).foregroundColor(.secondary)
            }
            ForEach(Array(open.prefix(3))) { it in row(it) }
            if open.count > 3 {
                HStack(spacing: 6) {
                    Mono(text: "还有 \(open.count - 3) 件")
                    Button("挪到明天") { m.cmd("extraTmr") }.buttonStyle(Pill(kind: .outline, sig: sig))
                }
            }
            ForEach(done) { it in row(it) }
            TextField("加一件今天的事，回车", text: $draft)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(dark ? Color.white.opacity(0.05) : Color.white.opacity(0.8)))
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Color.primary.opacity(0.14), lineWidth: 1))
                .onSubmit { m.cmd("add", ["title": draft]); draft = "" }
        }
        .modifier(CardBG())
    }

    func row(_ it: RTask) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Button { m.cmd("toggle", ["id": it.id]) } label: {
                Image(systemName: it.done ? "checkmark.square.fill" : "square")
                    .font(.system(size: 15))
                    .foregroundColor(it.done ? sig : .primary)
            }
            .buttonStyle(.plain)
            Text(it.title)
                .font(.system(size: 13, weight: .semibold))
                .tracking(-0.1)
                .strikethrough(it.done)
                .foregroundColor(it.done ? .secondary : .primary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .contextMenu {
            if !it.done { Button("挪到明天") { m.cmd("tmr", ["id": it.id]) } }
        }
    }

    var bSection: some View {
        let list = m.st?.b ?? []
        return DisclosureGroup {
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(list.enumerated()), id: \.offset) { pair in
                    HStack {
                        Text(pair.element).font(.system(size: 12))
                        Spacer()
                        Button { m.cmd("delB", ["i": pair.offset]) } label: {
                            Image(systemName: "xmark").font(.system(size: 9, weight: .semibold))
                        }
                        .buttonStyle(.plain)
                        .foregroundColor(.secondary)
                    }
                }
                TextField("加一个 B，回车", text: $bDraft)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(dark ? Color.white.opacity(0.05) : Color.white.opacity(0.8)))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.primary.opacity(0.14), lineWidth: 1))
                    .onSubmit { m.cmd("addB", ["title": bDraft]); bDraft = "" }
            }
            .padding(.top, 6)
        } label: {
            HStack(spacing: 6) {
                Text("B 清单").font(.system(size: 13, weight: .bold)).tracking(-0.3)
                Mono(text: "有尽头的小奖励")
            }
        }
        .modifier(CardBG())
    }
}

// MARK: - Window, hidden Runway page, menu bar
final class DraggableHost: NSHostingView<AnyView> {
    override var mouseDownCanMoveWindow: Bool { true }
}

final class FloatPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class Bridge: NSObject, WKScriptMessageHandler {
    weak var owner: AppDelegate?
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.received(message)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    var panel: FloatPanel!
    var container: NSView!
    var host: DraggableHost!
    var web: WKWebView!
    var status: NSStatusItem!
    var pinItem: NSMenuItem!
    var timer: Timer?
    var frame: WKFrameInfo?
    var webShown = false
    var savedFrame: NSRect?
    let bridge = Bridge()
    let model = Model()
    let defaults = UserDefaults.standard

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()
        let vf = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        var rect = NSRect(x: vf.maxX - 340, y: vf.maxY - 580, width: 320, height: 560)
        if let f = defaults.string(forKey: "glassFrame2") {
            let r = NSRectFromString(f)
            if r.width > 200 && r.height > 200 { rect = r }
        }
        panel = FloatPanel(contentRect: rect, styleMask: [.borderless, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.minSize = NSSize(width: 260, height: 320)
        panel.delegate = self

        container = NSView(frame: NSRect(origin: .zero, size: rect.size))
        container.wantsLayer = true
        container.layer?.cornerRadius = 22
        container.layer?.cornerCurve = .continuous
        container.layer?.masksToBounds = true
        panel.contentView = container

        // hidden Runway page: the real data lives here
        bridge.owner = self
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(bridge, name: "runway")
        web = WKWebView(frame: container.bounds, configuration: config)
        web.autoresizingMask = [.width, .height]
        web.customUserAgent = SAFARI_UA
        web.navigationDelegate = self
        web.uiDelegate = self
        web.alphaValue = 0
        container.addSubview(web)

        host = DraggableHost(rootView: AnyView(RootView().environmentObject(model)))
        host.frame = container.bounds
        host.autoresizingMask = [.width, .height]
        container.addSubview(host)

        model.send = { [weak self] d in self?.send(d) }
        model.showWeb = { [weak self] in self?.showWeb() }

        setPinned(defaults.object(forKey: "pinned") as? Bool ?? true)
        panel.orderFrontRegardless()
        buildStatusItem()

        web.load(URLRequest(url: MINI_URL))
        let t = Timer(timeInterval: 1, target: self, selector: #selector(onTick), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        timer = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self = self else { return }
            if self.model.st == nil { self.showWeb() }
        }
    }

    // page -> app
    func received(_ message: WKScriptMessage) {
        guard let text = message.body as? String, let data = text.data(using: .utf8),
              let s = try? JSONDecoder().decode(RState.self, from: data) else { return }
        frame = message.frameInfo
        model.apply(s)
        if webShown && !(s.local ?? false) { hideWeb() }
    }

    // app -> page
    func send(_ d: [String: Any]) {
        guard let f = frame,
              let data = try? JSONSerialization.data(withJSONObject: d),
              let json = String(data: data, encoding: .utf8) else { NSSound.beep(); return }
        web.evaluateJavaScript("window.runwayCmd && window.runwayCmd(\(json))", in: f, in: .page) { _ in }
    }

    @objc func onTick() {
        model.tick()
        status.button?.title = model.running ? "✈︎ " + fmt(model.leftSec) : "✈︎"
    }

    // sign-in view
    func showWeb() {
        guard !webShown else { return }
        webShown = true
        savedFrame = panel.frame
        var f = panel.frame
        let w: CGFloat = 440, h: CGFloat = 640
        f.origin.y += f.height - h
        f.origin.x += f.width - w
        f.size = NSSize(width: w, height: h)
        panel.setFrame(f, display: true, animate: true)
        web.alphaValue = 1
        container.addSubview(web, positioned: .above, relativeTo: host)
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func hideWeb() {
        guard webShown else { return }
        webShown = false
        web.alphaValue = 0
        container.addSubview(web, positioned: .below, relativeTo: host)
        if let f = savedFrame { panel.setFrame(f, display: true, animate: true) }
    }

    // after signing in, claude.ai lands on its home page: go back to Runway
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url, (url.host ?? "").hasSuffix("claude.ai") else { return }
        let p = url.path
        if p == "/" || p.hasPrefix("/new") || p.hasPrefix("/recents") || p.hasPrefix("/chat") || p.hasPrefix("/project") {
            webView.load(URLRequest(url: MINI_URL))
        }
    }
    // sign-in popups load in place; other links open in the browser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            let h = url.host ?? ""
            if h.hasSuffix("claude.ai") || h.contains("accounts.google") || h.contains("appleid.apple") {
                webView.load(navigationAction.request)
            } else {
                NSWorkspace.shared.open(url)
            }
        }
        return nil
    }

    func buildMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "退出 Runway Float", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "编辑")
        edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        NSApp.mainMenu = main
    }

    func buildStatusItem() {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "✈︎"
        let menu = NSMenu()
        func item(_ title: String, _ sel: Selector) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: sel, keyEquivalent: "")
            i.target = self
            menu.addItem(i)
            return i
        }
        _ = item("显示 / 隐藏", #selector(toggleShow))
        pinItem = item("保持在最前面", #selector(togglePin))
        pinItem.state = panel.level == .floating ? .on : .off
        _ = item("换深色 / 浅色玻璃", #selector(toggleGlass))
        let sizeItem = NSMenuItem(title: "大小", action: nil, keyEquivalent: "")
        let sizes = NSMenu()
        for (i, name) in ["小", "中", "大"].enumerated() {
            let it = NSMenuItem(title: name, action: #selector(setSize(_:)), keyEquivalent: "")
            it.tag = i
            it.target = self
            sizes.addItem(it)
        }
        sizeItem.submenu = sizes
        menu.addItem(sizeItem)
        menu.addItem(.separator())
        _ = item("登录 claude.ai", #selector(signIn))
        _ = item("重新连接", #selector(reconnect))
        _ = item("打开完整版 Runway", #selector(openFull))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        status.menu = menu
    }

    func setPinned(_ on: Bool) {
        panel.level = on ? .floating : .normal
        defaults.set(on, forKey: "pinned")
        pinItem?.state = on ? .on : .off
    }
    @objc func togglePin() { setPinned(panel.level != .floating) }
    @objc func toggleShow() { if panel.isVisible { panel.orderOut(nil) } else { panel.orderFrontRegardless() } }
    @objc func toggleGlass() { defaults.set(!defaults.bool(forKey: "darkGlass"), forKey: "darkGlass") }
    @objc func signIn() { showWeb() }
    @objc func setSize(_ sender: NSMenuItem) {
        let dims: [NSSize] = [NSSize(width: 280, height: 440), NSSize(width: 320, height: 560), NSSize(width: 390, height: 700)]
        let d = dims[max(0, min(2, sender.tag))]
        var f = panel.frame
        f.origin.y += f.height - d.height
        f.size = d
        panel.setFrame(f, display: true, animate: true)
        defaults.set(NSStringFromRect(panel.frame), forKey: "glassFrame2")
    }
    @objc func reconnect() { hideWeb(); web.load(URLRequest(url: MINI_URL)) }
    @objc func openFull() { NSWorkspace.shared.open(FULL_URL) }

    func windowDidMove(_ notification: Notification) {
        if !webShown { defaults.set(NSStringFromRect(panel.frame), forKey: "glassFrame2") }
    }
    func windowDidEndLiveResize(_ notification: Notification) {
        if !webShown { defaults.set(NSStringFromRect(panel.frame), forKey: "glassFrame2") }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        panel.orderFrontRegardless()
        return true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // no Dock icon; lives in the menu bar as ✈︎
app.run()

// Runway Float: an always-on-top memo pad for today's Runway, folding up to one strip like Stickies.
// The pad is native SwiftUI. Data is the real Runway: a hidden web view keeps
// the Runway page open (signed in to claude.ai once) and talks to it over a bridge.
import SwiftUI
import AppKit
import WebKit

let MINI_URL = URL(string: "https://claude.ai/artifact/S2ciyRbWrBAj86haWpHMhG#mini")!
let FULL_URL = URL(string: "https://claude.ai/artifact/S2ciyRbWrBAj86haWpHMhG")!
let SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

// MARK: - Spiral rules (same as the page)
let A_MIN = [10, 20, 30, 40, 45]
let B_MIN = [10, 15]
func blockMin(_ i: Int) -> Int { i % 2 == 0 ? A_MIN[min(i / 2, A_MIN.count - 1)] : B_MIN[min((i - 1) / 2, B_MIN.count - 1)] }
func isA(_ i: Int) -> Bool { i % 2 == 0 }
func fmt(_ sec: Int) -> String { let a = abs(sec); return (sec < 0 ? "+" : "") + String(format: "%02d:%02d", a / 60, a % 60) }


// MARK: - What the page sends
struct RTask: Decodable, Identifiable, Equatable { let id: String; let title: String; let done: Bool; let time: String? }
struct RSpiral: Decodable, Equatable { var idx: Int; var endsAt: Double?; var left: Int; var bi: Int }
struct RExam: Decodable, Equatable { let title: String; let days: Int }
struct RTarget: Decodable, Equatable, Identifiable { let id: String; let title: String; let days: Int }
struct RCount: Decodable, Equatable { let id: String; let title: String; let short: String; let days: Int }
struct RState: Decodable, Equatable {
    let today: String
    let nick: String?
    let local: Bool?
    let acc: [String]?
    let exam: RExam?
    let targets: [RTarget]?
    let count: RCount?
    let spiral: RSpiral
    let b: [String]
    let tasks: [RTask]
    let overdue: [RTask]
    let now: String?
}

final class Model: ObservableObject {
    @Published var st: RState?
    @Published var now = Date()
    @Published var waiting = true          // nothing heard from the page yet
    @Published var collapsed = false
    var onCollapse: ((Bool) -> Void)?
    func toggleCollapse() { collapsed.toggle(); onCollapse?(collapsed) }
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
    /** The page picks it by the clock: the task whose slot is running, else the next one. */
    var current: RTask? { open.first { $0.id == st?.now } ?? open.first }
    var greeting: String {
        let h = Calendar.current.component(.hour, from: now)
        return h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好"
    }
    var dateLine: String {
        let c = Calendar.current.dateComponents([.month, .day, .weekday], from: now)
        let wd = ["日", "一", "二", "三", "四", "五", "六"][((c.weekday ?? 1) - 1) % 7]
        return "\(c.month ?? 0) 月 \(c.day ?? 0) 日 · 周\(wd)"
    }
    var dateShort: String {
        let c = Calendar.current.dateComponents([.month, .day, .weekday], from: now)
        let wd = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][((c.weekday ?? 1) - 1) % 7]
        return String(format: "%02d.%02d ", c.month ?? 0, c.day ?? 0) + wd
    }
    var whatTitle: String {
        if isA(idx) { return current?.title ?? "先在下面加一件今天的事" }
        let b = st?.b ?? []
        return b.isEmpty ? "离开屏幕，喝口水" : b[(st?.spiral.bi ?? 0) % b.count]
    }
    var whatSub: String {
        if isA(idx) { return open.isEmpty ? "A 段做的是今天清单里的第一件" : (idx == 0 ? "这 10 分钟只要打开它就算赢" : "接着刚才的往下做") }
        return "玩完回来接着做"
    }
}

// MARK: - Paper (Runway's Analogue Keeper memo pad as frosted glass: butter tint over a blur, a darker band, tone-on-tone lines, Klein-blue pen)
extension Color {
    init(hex: String) {
        var h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        var v: UInt64 = 0
        Scanner(string: h).scanHexInt64(&v)
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

let BAND_H: CGFloat = 38

struct Paper {
    let dark: Bool
    var paper: Color { Color(hex: dark ? "#24231A" : "#F4F0D6").opacity(dark ? 0.7 : 0.6) }
    var band: Color { Color(hex: dark ? "#2E2C1F" : "#E9E2B6").opacity(dark ? 0.82 : 0.78) }
    var line: Color { Color(hex: dark ? "#4A4630" : "#CFC596").opacity(dark ? 0.75 : 0.65) }
    var sheen: Color { Color.white.opacity(dark ? 0.08 : 0.45) }
    var ink: Color { Color(hex: dark ? "#ECEDEA" : "#2A2D2E") }
    var muted: Color { Color(hex: dark ? "#9DA2A0" : "#73787A") }
    var sig: Color { Color(hex: dark ? "#8A98FF" : "#1F3BE0") }
    var onSig: Color { Color(hex: dark ? "#0E1020" : "#FFFFFF") }
    var field: Color { dark ? Color.black.opacity(0.28) : Color.white.opacity(0.55) }
}

// Jost is drawn after Futura, which every Mac has; Gaegu's hand-drawn O becomes Chalkboard.
func label(_ s: CGFloat) -> Font { .custom("Futura-Medium", size: s) }
func display(_ s: CGFloat) -> Font { .custom("Futura-Bold", size: s) }
func hand(_ s: CGFloat) -> Font { .custom("ChalkboardSE-Bold", size: s) }
func mono(_ s: CGFloat, _ w: Font.Weight = .medium) -> Font { .system(size: s, weight: w, design: .monospaced) }

final class DragView: NSView {
    var onDouble: (() -> Void)?
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { onDouble?() } else { window?.performDrag(with: event) }
    }
}
struct DragHandle: NSViewRepresentable {
    var onDouble: (() -> Void)? = nil
    func makeNSView(context: Context) -> NSView { let v = DragView(); v.onDouble = onDouble; return v }
    func updateNSView(_ nsView: NSView, context: Context) { (nsView as? DragView)?.onDouble = onDouble }
}

// a small lowercase label, like the pad labels on the page
struct Kick: View {
    var text: String
    var color: Color
    var body: some View { Text(text).font(label(11)).tracking(0.4).foregroundColor(color) }
}

// primary = blue pen, plain = paper with a line, quiet = text only
enum PillKind { case primary, plain, quiet }
struct Pill: ButtonStyle {
    var kind: PillKind = .plain
    var p: Paper
    func makeBody(configuration: Configuration) -> some View {
        let bg: Color = kind == .primary ? p.sig : (kind == .plain ? p.field : .clear)
        let fg: Color = kind == .primary ? p.onSig : (kind == .plain ? p.ink : p.muted)
        return configuration.label
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, kind == .quiet ? 4 : 12)
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(bg))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(kind == .plain ? p.line : Color.clear, lineWidth: 1))
            .foregroundColor(fg)
            .opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(Rectangle())
    }
}

// MARK: - The window's content
struct RootView: View {
    @EnvironmentObject var m: Model
    @AppStorage("darkGlass") var dark = false
    @State private var draft = ""
    @State private var bDraft = ""

    var p: Paper { Paper(dark: dark) }
    // what the countdown shows is a setting the page keeps, so the page header and the float always agree
    var target: RTarget? {
        if let c = m.st?.count { return RTarget(id: c.id, title: c.short, days: c.days) }
        if let ex = m.st?.exam, ex.days >= 0 { return RTarget(id: "", title: short(ex.title), days: ex.days) }
        return nil
    }
    func short(_ s: String) -> String {
        let latin = s.prefix { $0.isLetter && $0.isASCII }
        if latin.count >= 2 { return latin.lowercased() }
        let digits = s.prefix { $0.isNumber }
        if !digits.isEmpty { return String(digits) }
        return String(s.prefix(4))
    }

    var body: some View {
        VStack(spacing: 0) {
            band
            if !m.collapsed {
                Rectangle().fill(p.line).frame(height: 1)
                content
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(
            ZStack(alignment: .top) {
                p.paper
                LinearGradient(colors: [p.sheen, .clear], startPoint: .top, endPoint: .bottom).frame(height: 120)
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(p.line, lineWidth: 1))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).inset(by: 1).strokeBorder(p.sheen, lineWidth: 0.5))
        .environment(\.colorScheme, dark ? .dark : .light)
    }

    // the darker strip on top: drag it, double-click it to fold the note up like Stickies
    var band: some View {
        HStack(spacing: 8) {
            ZStack {
                HStack(spacing: 8) {
                    if m.collapsed {
                        Circle().fill(m.running ? (isA(m.idx) ? p.sig : p.ink) : p.muted).frame(width: 6, height: 6)
                        Text(m.st == nil ? "runway" : (isA(m.idx) ? "" : "B · ") + m.whatTitle)
                            .font(.system(size: 12, weight: .semibold)).foregroundColor(p.ink)
                            .lineLimit(1).truncationMode(.tail)
                        Spacer(minLength: 4)
                        if m.st != nil && (m.running || m.leftSec != blockMin(m.idx) * 60) {
                            Text(fmt(m.leftSec)).font(mono(12, .semibold)).monospacedDigit()
                                .foregroundColor(m.running && m.leftSec <= 0 ? p.sig : p.ink)
                        }
                    } else {
                        Text("runway").font(label(13)).foregroundColor(p.ink)
                        Text(m.dateShort).font(mono(10)).foregroundColor(p.muted)
                        Spacer(minLength: 4)
                    }
                }
                .allowsHitTesting(false)
                DragHandle(onDouble: { m.toggleCollapse() })
            }
            if let t = target {
                Menu {
                    Button((m.st?.count?.id ?? "") == "" ? "✓ 最近的一场考试" : "最近的一场考试") { m.cmd("countTo", ["id": ""]) }
                    Divider()
                    ForEach(m.st?.targets ?? []) { x in
                        Button("\(x.id == m.st?.count?.id ? "✓ " : "")\(x.title) · \(x.days) 天") { m.cmd("countTo", ["id": x.id]) }
                    }
                    Divider()
                    Button("改名字或加一个日子…") { NSWorkspace.shared.open(FULL_URL) }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(t.days == 0 ? "today" : "D-\(t.days)").font(display(m.collapsed ? 12 : 14)).foregroundColor(p.sig).monospacedDigit()
                        if !m.collapsed { Text(t.title).font(label(10)).foregroundColor(p.muted).lineLimit(1) }
                    }
                    .contentShape(Rectangle())
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .help("选倒计时数到哪天")
            }
            Button { m.toggleCollapse() } label: {
                Image(systemName: m.collapsed ? "chevron.down" : "chevron.up")
                    .font(.system(size: 10, weight: .bold))
                    .frame(width: 18, height: 18)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundColor(p.muted)
            .help(m.collapsed ? "展开（也可以双击这一条）" : "收起成一条（也可以双击这一条）")
        }
        .padding(.horizontal, 14)
        .frame(height: BAND_H)
        .background(p.band)
    }

    var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            if m.st == nil {
                connecting.padding(16)
            } else {
                if !m.signedIn { notSignedIn.padding(.horizontal, 16).padding(.top, 10) }
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("\(m.greeting)，\(m.st?.nick ?? "Color")")
                            .font(.system(size: 18, weight: .bold)).foregroundColor(p.ink)
                            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 4)
                        spiral.padding(16)
                        Rectangle().fill(p.line).frame(height: 1)
                        tasks.padding(16)
                        Rectangle().fill(p.line).frame(height: 1)
                        bSection.padding(.horizontal, 16).padding(.vertical, 12)
                    }
                }
            }
        }
    }

    var connecting: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("正在连接 Runway").font(.system(size: 15, weight: .bold)).foregroundColor(p.ink)
            Text("第一次用要登录一次 claude.ai。几秒后还连不上，点下面的按钮登录，登录完会自动回来。")
                .font(.system(size: 12)).foregroundColor(p.muted).fixedSize(horizontal: false, vertical: true)
            Button("去登录") { m.showWeb?() }.buttonStyle(Pill(kind: .primary, p: p))
        }
    }

    var notSignedIn: some View {
        HStack(spacing: 8) {
            Text("还没登录，现在改的只存在小窗里").font(.system(size: 11)).foregroundColor(p.muted)
            Spacer()
            Button("登录") { m.showWeb?() }.buttonStyle(Pill(kind: .plain, p: p))
        }
    }

    var spiral: some View {
        let a = isA(m.idx)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Kick(text: "focus on", color: p.ink)
                Spacer()
                Text("第 \(m.idx / 2 + 1) 轮 · \(a ? "做事" : "奖励") \(blockMin(m.idx)) 分钟").font(.system(size: 11)).foregroundColor(p.muted)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(0..<max(8, m.idx + 3), id: \.self) { i in
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(isA(i) ? p.sig : p.ink.opacity(0.35))
                            .opacity(i < m.idx ? 0.2 : (i == m.idx ? 1 : 0.45))
                            .frame(width: CGFloat(blockMin(i)) * 0.8 + 6, height: CGFloat(blockMin(i)) * 0.35 + 6)
                    }
                }
                .padding(.vertical, 2)
            }
            .frame(height: 26)
            Text(fmt(m.leftSec))
                .font(mono(46, .semibold))
                .monospacedDigit()
                .foregroundColor(a ? p.sig : p.ink)
            VStack(alignment: .leading, spacing: 2) {
                Text(m.whatTitle).font(.system(size: 15, weight: .bold)).foregroundColor(p.ink).fixedSize(horizontal: false, vertical: true)
                Text(m.whatSub).font(.system(size: 11)).foregroundColor(p.muted)
            }
            controls(a: a).padding(.top, 2)
        }
    }

    @ViewBuilder func doneNow(a: Bool) -> some View {
        if a, let it = m.current {
            Button("做完了") { m.cmd("doneNow", ["id": it.id]) }.buttonStyle(Pill(kind: .plain, p: p))
        }
    }

    @ViewBuilder func controls(a: Bool) -> some View {
        let sec = m.leftSec
        let fresh = sec == blockMin(m.idx) * 60
        if m.running && sec <= 0 {
            VStack(alignment: .leading, spacing: 6) {
                Text("时间到").font(mono(11)).foregroundColor(p.sig)
                HStack(spacing: 6) {
                    if a {
                        Button("去玩 \(blockMin(m.idx + 1)) 分钟") { m.cmd("next") }.buttonStyle(Pill(kind: .primary, p: p))
                        doneNow(a: a)
                        Button("再做 10 分钟") { m.cmd("more10") }.buttonStyle(Pill(kind: .quiet, p: p))
                    } else {
                        Button("回来做 \(blockMin(m.idx + 1)) 分钟") { m.cmd("next") }.buttonStyle(Pill(kind: .primary, p: p))
                    }
                }
            }
        } else {
            HStack(spacing: 6) {
                if m.running {
                    Button("暂停") { m.cmd("pause") }.buttonStyle(Pill(kind: .plain, p: p))
                    doneNow(a: a)
                    Button("这段结束") { m.cmd("next") }.buttonStyle(Pill(kind: .quiet, p: p))
                    if !a && (m.st?.b.count ?? 0) > 1 {
                        Button("换一个") { m.cmd("swapB") }.buttonStyle(Pill(kind: .quiet, p: p))
                    }
                } else {
                    Button(fresh ? "开始" : "继续") { m.cmd("start") }.buttonStyle(Pill(kind: .primary, p: p))
                    doneNow(a: a)
                    if m.idx > 0 || !fresh {
                        Button("重来") { m.cmd("reset") }.buttonStyle(Pill(kind: .quiet, p: p))
                    }
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
                Kick(text: "tasks", color: p.ink)
                Spacer()
                if !over.isEmpty {
                    Menu("之前没做完 \(over.count)") {
                        ForEach(over) { it in
                            Button("今天做：\(it.title)") { m.cmd("toToday", ["id": it.id]) }
                        }
                        Divider()
                        Button("全部放回项目") { m.cmd("clearOver") }
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .font(.system(size: 11))
                }
            }
            if open.isEmpty && done.isEmpty {
                Text("还没排事，在下面加一件。").font(.system(size: 12)).foregroundColor(p.muted)
            }
            ForEach(open) { it in row(it) }
            ForEach(done) { it in row(it) }
            TextField("加一件今天的事，回车", text: $draft)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .foregroundColor(p.ink)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(p.field))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(p.line, lineWidth: 1))
                .onSubmit { m.cmd("add", ["title": draft]); draft = "" }
        }
    }

    // O when done, an empty circle when not; never an X
    func row(_ it: RTask) -> some View {
        HStack(alignment: .center, spacing: 10) {
            if let t = it.time, !t.isEmpty, !it.done {
                Text(t).font(mono(10)).foregroundColor(p.muted).frame(width: 36, alignment: .leading)
            }
            Text(it.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(it.done ? p.muted : p.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button { m.cmd("toggle", ["id": it.id]) } label: {
                ZStack {
                    if it.done {
                        Text("O").font(hand(20)).foregroundColor(p.sig)
                    } else {
                        Circle().fill(p.field)
                        Circle().strokeBorder(p.line, lineWidth: 1.5)
                    }
                }
                .frame(width: 24, height: 24)
                .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .help(it.done ? "标成没做完" : "做完了")
        }
        .padding(.vertical, 3)
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
                        Text(pair.element).font(.system(size: 12)).foregroundColor(p.ink)
                        Spacer()
                        Button { m.cmd("delB", ["i": pair.offset]) } label: {
                            Image(systemName: "xmark").font(.system(size: 9, weight: .semibold))
                        }
                        .buttonStyle(.plain)
                        .foregroundColor(p.muted)
                    }
                }
                TextField("加一个 B，回车", text: $bDraft)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(p.field))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(p.line, lineWidth: 1))
                    .onSubmit { m.cmd("addB", ["title": bDraft]); bDraft = "" }
            }
            .padding(.top, 6)
        } label: {
            HStack(spacing: 6) {
                Kick(text: "b list", color: p.ink)
                Text("有尽头的小奖励").font(.system(size: 11)).foregroundColor(p.muted)
            }
        }
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
    var fx: NSVisualEffectView!
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
        container.layer?.cornerRadius = 12
        container.layer?.cornerCurve = .continuous
        container.layer?.masksToBounds = true
        panel.contentView = container

        // the frosted glass under the paper
        fx = NSVisualEffectView(frame: container.bounds)
        fx.autoresizingMask = [.width, .height]
        fx.material = .popover
        fx.blendingMode = .behindWindow
        fx.state = .active
        container.addSubview(fx)
        applyAppearance()

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
        model.onCollapse = { [weak self] c in self?.applyCollapsed(c, animate: true) }
        if defaults.bool(forKey: "collapsed") { model.collapsed = true; applyCollapsed(true, animate: false) }

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

    // fold to the band only, keeping the top edge where it is
    func applyCollapsed(_ c: Bool, animate: Bool) {
        defaults.set(c, forKey: "collapsed")
        var f = panel.frame
        let top = f.maxY
        if c {
            if f.height > BAND_H + 40 { defaults.set(Double(f.height), forKey: "expandedH") }
            panel.minSize = NSSize(width: 220, height: BAND_H)
            panel.maxSize = NSSize(width: 4000, height: BAND_H)
            f.size.height = BAND_H
        } else {
            panel.minSize = NSSize(width: 260, height: 320)
            panel.maxSize = NSSize(width: 4000, height: 4000)
            let h = defaults.double(forKey: "expandedH")
            f.size.height = h >= 320 ? h : 560
        }
        f.origin.y = top - f.size.height
        panel.setFrame(f, display: true, animate: animate)
        panel.invalidateShadow()
        saveFrame()
    }
    // always remembered as the unfolded size, so a restart can unfold it
    func saveFrame() {
        guard !webShown, panel != nil else { return }
        var f = panel.frame
        if model.collapsed {
            let h = max(320, defaults.double(forKey: "expandedH"))
            f.origin.y = f.maxY - h
            f.size.height = h
        }
        defaults.set(NSStringFromRect(f), forKey: "glassFrame2")
    }
    @objc func toggleCollapseMenu() { model.toggleCollapse() }

    // sign-in view
    func showWeb() {
        guard !webShown else { return }
        if model.collapsed { model.collapsed = false; applyCollapsed(false, animate: false) }
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
        _ = item("收起成一条 / 展开", #selector(toggleCollapseMenu))
        pinItem = item("保持在最前面", #selector(togglePin))
        pinItem.state = panel.level == .floating ? .on : .off
        _ = item("换深色 / 浅色", #selector(toggleGlass))
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
    @objc func toggleGlass() { defaults.set(!defaults.bool(forKey: "darkGlass"), forKey: "darkGlass"); applyAppearance() }
    func applyAppearance() { panel.appearance = NSAppearance(named: defaults.bool(forKey: "darkGlass") ? .darkAqua : .aqua) }
    @objc func signIn() { showWeb() }
    @objc func setSize(_ sender: NSMenuItem) {
        let dims: [NSSize] = [NSSize(width: 280, height: 440), NSSize(width: 320, height: 560), NSSize(width: 390, height: 700)]
        let d = dims[max(0, min(2, sender.tag))]
        if model.collapsed { model.collapsed = false; applyCollapsed(false, animate: false) }
        var f = panel.frame
        f.origin.y += f.height - d.height
        f.size = d
        panel.setFrame(f, display: true, animate: true)
        saveFrame()
    }
    @objc func reconnect() { hideWeb(); web.load(URLRequest(url: MINI_URL)) }
    @objc func openFull() { NSWorkspace.shared.open(FULL_URL) }

    func windowDidMove(_ notification: Notification) { saveFrame() }
    func windowDidEndLiveResize(_ notification: Notification) { saveFrame() }
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

// RAIMOSA AI — native macOS shell.
//
// A real AppKit application that owns the RAIMOSA runtime: it launches the
// local Node server as a child process, waits for it to answer, and renders
// the interface in a native WKWebView window with a native menu bar.
//
// Two rules shape this shell:
//
// 1. The window shows the product only after the runtime actually answers.
//    A shell that renders a blank frame and hopes would be claiming the app
//    started when it had not.
//
// 2. The child runtime is terminated on quit, including on force-quit paths.
//    An orphaned server holding a live All Access session after its window
//    closed would be authority the owner can no longer see.

import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var runtime: Process?
    private var port: Int = 4173
    private var statusLabel: NSTextField!

    // MARK: - Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        startRuntime()
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopRuntime()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    // MARK: - Window

    private func buildWindow() {
        let frame = NSRect(x: 0, y: 0, width: 1440, height: 940)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "RAIMOSA AI"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = NSColor(red: 0.027, green: 0.012, blue: 0.051, alpha: 1)
        window.minSize = NSSize(width: 1120, height: 720)
        window.center()
        window.setFrameAutosaveName("RAIMOSAMainWindow")
        window.isReleasedWhenClosed = false

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: frame, configuration: configuration)
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.autoresizingMask = [.width, .height]
        // The web content starts hidden so the first thing the owner sees is
        // either the product or an honest status line, never a white flash.
        webView.isHidden = true

        let container = NSView(frame: frame)
        container.autoresizingMask = [.width, .height]
        container.addSubview(webView)

        statusLabel = NSTextField(labelWithString: "Starting the RAIMOSA runtime…")
        statusLabel.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        statusLabel.textColor = NSColor(red: 0.86, green: 0.82, blue: 0.9, alpha: 1)
        statusLabel.alignment = .center
        statusLabel.frame = NSRect(x: 0, y: frame.height / 2 - 12, width: frame.width, height: 24)
        statusLabel.autoresizingMask = [.width, .minYMargin, .maxYMargin]
        container.addSubview(statusLabel)

        window.contentView = container
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func show(status: String) {
        DispatchQueue.main.async { self.statusLabel.stringValue = status }
    }

    // MARK: - Runtime

    /// Locate the Node runtime. A GUI app does not inherit the shell PATH, so
    /// the usual install locations are probed explicitly before giving up.
    private func findNode() -> String? {
        // A downloaded copy must run without the user installing anything, so
        // the bundled runtime is always preferred. The system paths are only a
        // fallback for development builds that were not packaged.
        var candidates: [String] = []
        if let resources = Bundle.main.resourcePath {
            candidates.append("\(resources)/runtime/bin/node")
        }
        candidates += [
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node",
        ]
        if let home = ProcessInfo.processInfo.environment["HOME"] {
            candidates.append("\(home)/.nvm/versions/node/current/bin/node")
            let nvm = "\(home)/.nvm/versions/node"
            if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvm) {
                for version in versions.sorted().reversed() {
                    candidates.append("\(nvm)/\(version)/bin/node")
                }
            }
        }
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// The packaged runtime lives inside the bundle; a development build falls
    /// back to the checkout so the shell can be exercised without packaging.
    private func findRuntimeEntry() -> String? {
        let resources = Bundle.main.resourcePath ?? ""
        let bundled = "\(resources)/app/bin/raimosa.mjs"
        if FileManager.default.fileExists(atPath: bundled) { return bundled }

        var directory = URL(fileURLWithPath: Bundle.main.bundlePath)
        for _ in 0..<6 {
            directory.deleteLastPathComponent()
            let candidate = directory.appendingPathComponent("app/bin/raimosa.mjs").path
            if FileManager.default.fileExists(atPath: candidate) { return candidate }
        }
        return nil
    }

    private func startRuntime() {
        guard let node = findNode() else {
            show(status: "Node.js 22 or newer is required. Install it from nodejs.org, then reopen RAIMOSA.")
            return
        }
        guard let entry = findRuntimeEntry() else {
            show(status: "The RAIMOSA runtime is missing from this application bundle.")
            return
        }

        port = Int.random(in: 4200...4899)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [entry, "--port", String(port), "--no-open"]
        var environment = ProcessInfo.processInfo.environment
        environment["RAIMOSA_NATIVE"] = "macos"
        process.environment = environment
        process.standardOutput = Pipe()
        process.standardError = Pipe()

        do {
            try process.run()
            runtime = process
        } catch {
            show(status: "The RAIMOSA runtime could not start: \(error.localizedDescription)")
            return
        }

        waitForRuntime()
    }

    /// Poll the health endpoint until the runtime answers. Only then is the
    /// interface shown, so the window never claims readiness it cannot back.
    private func waitForRuntime(attempt: Int = 0) {
        guard attempt < 60 else {
            show(status: "The RAIMOSA runtime did not become ready. Check Console for details.")
            return
        }
        let url = URL(string: "http://127.0.0.1:\(port)/api/raimosa/health")!
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let ready = (response as? HTTPURLResponse)?.statusCode == 200 && data != nil
            if ready {
                DispatchQueue.main.async {
                    self.statusLabel.isHidden = true
                    self.webView.isHidden = false
                    self.webView.load(URLRequest(url: URL(string: "http://localhost:\(self.port)")!))
                }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    self.waitForRuntime(attempt: attempt + 1)
                }
            }
        }.resume()
    }

    private func stopRuntime() {
        guard let process = runtime, process.isRunning else { return }
        process.terminate()
        // Give the runtime a moment to close its ledger cleanly, then insist.
        let deadline = Date().addingTimeInterval(3)
        while process.isRunning && Date() < deadline {
            usleep(50_000)
        }
        if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        runtime = nil
    }

    // MARK: - Menu

    private func buildMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About RAIMOSA AI", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide RAIMOSA AI", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit RAIMOSA AI", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let viewMenuItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        viewMenu.addItem(
            withTitle: "Enter Full Screen",
            action: #selector(NSWindow.toggleFullScreen(_:)),
            keyEquivalent: "f"
        )
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApp.mainMenu = mainMenu
    }

    @objc private func reload() {
        webView.reload()
    }

    @objc private func showAbout() {
        let alert = NSAlert()
        alert.messageText = "RAIMOSA AI"
        alert.informativeText = """
            A local, governed desktop commander.

            Everything runs on this machine. The adapter API answers loopback \
            requests only, and every action writes a hash-chained receipt.

            © ECONTEUR LLC
            """
        alert.alertStyle = .informational
        alert.runModal()
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()

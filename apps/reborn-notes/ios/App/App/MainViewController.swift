import UIKit
import Capacitor
import WebKit

/**
 * Capacitor bridge view controller subclass with two jobs:
 *
 *  1. Register the app-local FolderFsPlugin (the native folder-sync FS access
 *     plugin). Local plugins that are not shipped as an npm/SPM package must be
 *     registered manually here, in `capacitorDidLoad()`, which Capacitor calls
 *     after the bridge is ready.
 *
 *  2. Paint the view + WKWebView in the app's real background surface for the
 *     current system scheme. Capacitor already defaults the WKWebView to
 *     UIColor.systemBackground (themed), but that is pure black in dark mode
 *     while the app's --background is #0a0a0a - a brief too-dark dip in the
 *     splash -> webview -> content hand-off. Overriding to the exact app colors
 *     removes that step; a static capacitor.config backgroundColor can't, since
 *     it is one fixed color, not day/night. The Android counterpart
 *     (MainActivity.applyThemedBackground) matters more there: Capacitor sets no
 *     Android webview background at all without a config color, so it flashes
 *     white.
 *
 * Wired in Main.storyboard (the Bridge View Controller scene's custom class points
 * here instead of the stock CAPBridgeViewController). Add more
 * `bridge?.registerPluginInstance(...)` lines in capacitorDidLoad for future
 * app-local plugins.
 */
class MainViewController: CAPBridgeViewController {
    // App's real surface tokens (packages/ui global.css --background): white
    // light, oklch(0.145 0 0) ~= #0a0a0a dark. Kept in sync with the Android
    // splash @color and the app.html loader background.
    private static let backgroundLight = UIColor.white
    private static let backgroundDark = UIColor(
        red: 0x0a / 255.0, green: 0x0a / 255.0, blue: 0x0a / 255.0, alpha: 1
    )

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FolderFsPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        applyThemedBackground()
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        // Keep the frame color correct across a live light<->dark switch (the
        // WebView persists, so the initial viewDidLoad color would otherwise go
        // stale). Cheap and idempotent.
        super.traitCollectionDidChange(previousTraitCollection)
        applyThemedBackground()
    }

    private func applyThemedBackground() {
        let dark = traitCollection.userInterfaceStyle == .dark
        let background = dark
            ? MainViewController.backgroundDark
            : MainViewController.backgroundLight
        // The WKWebView stays opaque (Capacitor's default) and paints this
        // background before the page's own CSS background lands - the same way
        // its systemBackground default already fills the pre-first-paint frame,
        // just in the app's exact shade. Setting the scrollView too keeps
        // rubber-band overscroll on the same color; view.backgroundColor covers
        // any safe-area gap behind the webview.
        view.backgroundColor = background
        webView?.backgroundColor = background
        webView?.scrollView.backgroundColor = background
    }
}

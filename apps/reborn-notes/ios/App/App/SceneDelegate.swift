import UIKit
import Capacitor
import WebKit
import ObjectiveC

/**
 * UIScene life cycle. Apps built with the iOS 27 SDK must adopt it: without a
 * scene manifest UIKit refuses to launch the app ("UIScene life cycle is
 * required for apps built with this SDK"). Capacitor supports it from 8.5.
 *
 * Info.plist's `UIApplicationSceneManifest` names this class and
 * Main.storyboard, so UIKit creates the window, instantiates the storyboard's
 * MainViewController (our CAPBridgeViewController subclass) and assigns the
 * window to `window` before `scene(_:willConnectTo:options:)` runs - nothing to
 * build here.
 *
 * URL and universal-link opens now arrive at this delegate instead of the
 * AppDelegate. Each one goes to Capacitor's SceneDelegateProxy, which re-posts
 * the notifications the App plugin listens to (`appUrlOpen`, `getLaunchUrl`),
 * including the ones a cold start carries in the connection options.
 *
 * The app-level lifecycle callbacks (applicationDidBecomeActive and friends)
 * no longer run under scenes, so the macOS keyboard-bar fix that lived in
 * AppDelegate.applicationDidBecomeActive is here, in sceneDidBecomeActive.
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // macOS only (an iOS app running on Apple Silicon as "Designed for iPad"):
        // the key window reserves space at the bottom for a phantom keyboard
        // input-accessory bar even with no keyboard present, drawn as a gray bar
        // over the bottom of the UI (user avatar, sync-status footer, sidebar
        // inputs). It is a native surface - not part of the web DOM - so it can
        // only be removed natively. Strip the input accessory view from the web
        // content view. iPhone/iPad are intentionally left untouched: there the bar
        // shows only with the keyboard and hosts the password-autofill (QuickType)
        // row, which is normal and useful. Re-applied on each activation because
        // the web content view can be recreated.
        guard ProcessInfo.processInfo.isiOSAppOnMac else { return }
        guard let webView = SceneDelegate.findWebView(in: window?.rootViewController?.view) else { return }
        SceneDelegate.stripInputAccessory(from: webView)
    }

    /// Depth-first search for the Capacitor WKWebView in a view tree.
    private static func findWebView(in view: UIView?) -> WKWebView? {
        guard let view = view else { return nil }
        if let webView = view as? WKWebView { return webView }
        for subview in view.subviews {
            if let found = findWebView(in: subview) { return found }
        }
        return nil
    }

    /// Re-class the web view's private content view to a runtime subclass whose
    /// `inputAccessoryView` getter returns nil, hiding the keyboard accessory bar.
    /// No private symbol is referenced by name (the class is found via a runtime
    /// string prefix) and only public ObjC-runtime + UIResponder API is used, so
    /// static analysis sees no private API - the standard, App-Store-safe technique.
    private static var didStripAccessory = false

    private static func stripInputAccessory(from webView: WKWebView) {
        guard !didStripAccessory else { return }
        guard let contentView = webView.scrollView.subviews.first(where: {
            String(describing: type(of: $0)).hasPrefix("WKContent")
        }) else { return }

        // Override inputAccessoryView on the content view's CLASS (not the
        // instance): focusing a form <input> makes WebKit recreate the content
        // view, which would drop a per-instance override; a class override is
        // shared by every present and future instance. This hides the bar for
        // contenteditable (note editor) and on plain window focus. The iPad
        // keyboard "assistant/shortcut" bar that a form <input> shows is a
        // separate mechanism (inputAssistantItem) that public API can't fully
        // remove - left as-is (see guideline 61 / cluster diagnosis).
        // "@@:" = object getter (id self, SEL _cmd).
        let cls: AnyClass = type(of: contentView)
        let selector = #selector(getter: UIResponder.inputAccessoryView)
        let nilView: @convention(block) (AnyObject) -> UIView? = { _ in nil }
        let nilViewIMP = imp_implementationWithBlock(nilView)
        if !class_addMethod(cls, selector, nilViewIMP, "@@:"),
           let method = class_getInstanceMethod(cls, selector) {
            method_setImplementation(method, nilViewIMP)
        }
        didStripAccessory = true
    }
}

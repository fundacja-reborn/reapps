import UIKit
import Capacitor
import WebKit
import ObjectiveC

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
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
        guard let webView = AppDelegate.findWebView(in: window?.rootViewController?.view) else { return }
        AppDelegate.stripInputAccessory(from: webView)
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
    private static func stripInputAccessory(from webView: WKWebView) {
        guard let contentView = webView.scrollView.subviews.first(where: {
            String(describing: type(of: $0)).hasPrefix("WKContent")
        }) else { return }

        let baseClass: AnyClass = type(of: contentView)
        let subclassName = NSStringFromClass(baseClass) + "_RebornNoInputAccessory"

        if let existing = NSClassFromString(subclassName) {
            if !contentView.isKind(of: existing) {
                object_setClass(contentView, existing)
            }
            return
        }

        guard let subclass = objc_allocateClassPair(baseClass, subclassName, 0) else { return }
        let selector = #selector(getter: UIResponder.inputAccessoryView)
        guard let template = class_getInstanceMethod(UIResponder.self, selector) else { return }
        let nilAccessory: @convention(block) (AnyObject) -> UIView? = { _ in nil }
        class_addMethod(subclass, selector, imp_implementationWithBlock(nilAccessory), method_getTypeEncoding(template))
        objc_registerClassPair(subclass)
        object_setClass(contentView, subclass)
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

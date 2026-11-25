import UIKit
import Capacitor

/**
 * App-level setup only. The app runs on the UIScene life cycle (required for
 * apps built with the iOS 27 SDK), so the window, URL / universal-link opens
 * and the foreground / background callbacks belong to SceneDelegate; UIKit no
 * longer calls their AppDelegate counterparts.
 */
@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        AppDelegate.excludeWebDataFromBackup()
        return true
    }

    /// The single window scene, configured by Info.plist's
    /// `UIApplicationSceneManifest` ("Default Configuration": SceneDelegate +
    /// Main.storyboard). Naming the delegate class here as well keeps the scene
    /// wired even if the manifest entry is edited.
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }

    /// Keep decrypted local state out of iCloud/Finder device backups.
    ///
    /// The Zero Knowledge invariant is that only ciphertext ever leaves the
    /// device. WKWebView's store (Library/WebKit) holds IndexedDB with
    /// decrypted shadow indexes (note titles, folder names used for
    /// sort/filter) plus the access token in localStorage, and the shared
    /// cookie jar (Library/Cookies) holds the refresh/session cookies the API
    /// sets for native clients too. Both live inside the default backup scope,
    /// so without the exclusion flag that plaintext would ride every backup.
    ///
    /// The flag is a per-item resource value and WebKit can recreate its
    /// store, so it is re-applied on every launch; on a fresh install the
    /// directories are created first so the flag lands before WebKit's first
    /// write. Restore cost is nil by design: a restored device gets a fresh
    /// login and re-syncs ciphertext from the server (the master key and
    /// refresh token live in the Keychain as ThisDeviceOnly; the sanctioned
    /// local backup is the app's phrase-encrypted portable backup).
    private static func excludeWebDataFromBackup() {
        let fileManager = FileManager.default
        guard let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        for name in ["WebKit", "Cookies"] {
            var directory = library.appendingPathComponent(name, isDirectory: true)
            if !fileManager.fileExists(atPath: directory.path) {
                do {
                    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
                } catch {
                    NSLog("re/notes: could not create \(name) for backup exclusion: \(error)")
                    continue
                }
            }
            do {
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                try directory.setResourceValues(values)
            } catch {
                NSLog("re/notes: could not exclude \(name) from backup: \(error)")
            }
        }
    }
}

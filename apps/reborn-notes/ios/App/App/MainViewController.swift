import UIKit
import Capacitor

/**
 * Capacitor bridge view controller subclass whose only job is to register the
 * app-local FolderFsPlugin (the native folder-sync FS access plugin). Local plugins
 * that are not shipped as an npm/SPM package must be registered manually here, in
 * `capacitorDidLoad()`, which Capacitor calls after the bridge is ready.
 *
 * Wired in Main.storyboard (the Bridge View Controller scene's custom class points
 * here instead of the stock CAPBridgeViewController). Add more
 * `bridge?.registerPluginInstance(...)` lines here for future app-local plugins.
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FolderFsPlugin())
    }
}

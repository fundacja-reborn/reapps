import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

/**
 * FolderFs - app-local Capacitor plugin: persistent read access to a user-picked
 * directory OUTSIDE the app sandbox, for the one-way native folder sync (disk -> app).
 *
 * SPIKE (Faza 0 of the native-folder-sync feature, plan: native-folder-sync-plan.md).
 * Validated on real hardware before the FolderSource refactor + UI are built. There is
 * no off-the-shelf, permissively-licensed Capacitor 8 plugin that gives persistent
 * bookmarked access to a user-picked folder with recursive enumeration, so we build
 * this small one ourselves (~3 methods).
 *
 * iOS model (verified against Apple DTS / WWDC19 #719):
 *  - Pick a folder with UIDocumentPickerViewController([.folder], asCopy:false). The
 *    grant is recursive over the whole subtree - no per-file picking.
 *  - Persist access with a PLAIN security-scoped bookmark: bookmarkData(options: []).
 *    `.withSecurityScope` is macOS/Catalyst-only and must NOT be used on iOS (a common
 *    community claim to the contrary is wrong). On iOS-app-on-Mac the SAME iOS code path
 *    applies (same binary; iOS-style sandbox auto-applied) - still plain options.
 *  - Bracket every access with start/stopAccessingSecurityScopedResource().
 *  - iCloud files may be dataless placeholders (".<name>.<ext>.icloud"): trigger a
 *    download (startDownloadingUbiquitousItem) and read coordinated (NSFileCoordinator).
 *
 * Registered app-local (not an npm package) via MainViewController.capacitorDidLoad().
 */
@objc(FolderFsPlugin)
public class FolderFsPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FolderFsPlugin"
    public let jsName = "FolderFs"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSameDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFile", returnType: CAPPluginReturnPromise)
    ]

    /// Upper bound on waiting for an iCloud placeholder to download before a read.
    private static let maxDownloadWaitSeconds: TimeInterval = 20

    /// The in-flight pick call, held strongly so Capacitor doesn't release it while
    /// the (async, user-driven) document picker is on screen. Resolved/cleared in the
    /// delegate callbacks. Same approach as Capawesome's FilePicker.
    private var pickCall: CAPPluginCall?

    // MARK: - pickDirectory

    @objc func pickDirectory(_ call: CAPPluginCall) {
        pickCall = call
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            // directoryURL (open-at-folder) is intentionally omitted: it is documented as
            // ignored / unreliable on Mac and flaky on iOS, so we never depend on it.
            self.bridge?.viewController?.present(picker, animated: true, completion: nil)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickCall else { return }
        pickCall = nil
        guard let url = urls.first else {
            call.reject("No folder selected")
            return
        }
        let didAccess = url.startAccessingSecurityScopedResource()
        defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
        do {
            // PLAIN bookmark (options: []) - the iOS form. NOT .withSecurityScope.
            let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            call.resolve([
                "bookmark": data.base64EncodedString(),
                "name": url.lastPathComponent
            ])
        } catch {
            call.reject("Failed to bookmark folder: \(error.localizedDescription)")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = pickCall else { return }
        pickCall = nil
        call.resolve(["cancelled": true])
    }

    // MARK: - listFiles

    @objc func listFiles(_ call: CAPPluginCall) {
        guard let bookmarkB64 = call.getString("bookmark"),
              let bookmarkData = Data(base64Encoded: bookmarkB64) else {
            call.reject("Missing or invalid bookmark")
            return
        }
        var exts: Set<String> = ["md"]
        if let raw = call.getArray("extensions"), !raw.isEmpty {
            let strs = raw.compactMap { $0 as? String }
            if !strs.isEmpty { exts = Set(strs.map { $0.lowercased() }) }
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                var isStale = false
                let root = try URL(
                    resolvingBookmarkData: bookmarkData,
                    options: [],
                    relativeTo: nil,
                    bookmarkDataIsStale: &isStale
                )
                let didAccess = root.startAccessingSecurityScopedResource()
                defer { if didAccess { root.stopAccessingSecurityScopedResource() } }
                guard didAccess else {
                    call.reject("Access denied to bookmarked folder", "ACCESS_DENIED")
                    return
                }

                // Refresh a stale bookmark while we still hold access; the JS layer
                // persists the returned value over the old one.
                var staleBookmark: String?
                if isStale,
                   let fresh = try? root.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                    staleBookmark = fresh.base64EncodedString()
                }

                let files = self.enumerateMarkdown(root: root, extensions: exts)
                var result: [String: Any] = ["files": files]
                if let staleBookmark = staleBookmark { result["staleBookmark"] = staleBookmark }
                call.resolve(result)
            } catch {
                call.reject("Failed to list folder: \(error.localizedDescription)", "RESOLVE_FAILED")
            }
        }
    }

    /// Recursive walk for files matching `extensions`. Relative paths are rooted at the
    /// directory leaf name (`<leaf>/<sub>/<file>`), matching the web walk's shape so the
    /// shared importFolder engine treats both identically. Hidden (dot) segments are
    /// pruned (e.g. `.obsidian/`, `.trash/`), EXCEPT iCloud placeholders
    /// (`.<name>.<ext>.icloud`), which are surfaced under their real name. Empty content
    /// is fine here - only metadata (mtime, size) is collected; bytes are read lazily by
    /// readFile for the (few) changed files.
    private func enumerateMarkdown(root: URL, extensions: Set<String>) -> [[String: Any]] {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [
            .contentModificationDateKey, .fileSizeKey, .isDirectoryKey, .nameKey
        ]
        let rootName = root.lastPathComponent
        let rootPath = root.standardizedFileURL.path

        func walk() -> [[String: Any]] {
            var out: [[String: Any]] = []
            guard let en = fm.enumerator(
                at: root,
                includingPropertiesForKeys: keys,
                options: []  // do NOT skip hidden: we handle dot-segments + .icloud ourselves
            ) else { return out }

            for case let url as URL in en {
                let comp = url.lastPathComponent
                let isPlaceholder = comp.hasPrefix(".") && comp.hasSuffix(".icloud")
                let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false

                if comp.hasPrefix(".") && !isPlaceholder {
                    if isDir { en.skipDescendants() }
                    continue
                }
                if isDir { continue }

                // De-placeholder iCloud names: ".Notes.md.icloud" -> "Notes.md"
                var realName = comp
                var realURL = url
                if isPlaceholder {
                    realName = String(comp.dropFirst().dropLast(".icloud".count))
                    realURL = url.deletingLastPathComponent().appendingPathComponent(realName)
                }

                let ext = (realName as NSString).pathExtension.lowercased()
                guard extensions.contains(ext) else { continue }

                let rv = try? url.resourceValues(forKeys: Set(keys))
                let mtimeMs = (rv?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000
                let size = rv?.fileSize ?? 0

                let fullPath = realURL.standardizedFileURL.path
                let relPath: String
                if fullPath.hasPrefix(rootPath) {
                    let sub = String(fullPath.dropFirst(rootPath.count)).drop(while: { $0 == "/" })
                    relPath = sub.isEmpty ? "\(rootName)/\(realName)" : "\(rootName)/\(sub)"
                } else {
                    relPath = "\(rootName)/\(realName)"
                }

                out.append(["path": relPath, "mtime": mtimeMs, "size": size])
            }
            return out
        }

        // radar r.150542999: the first enumerate of a freshly-picked folder can wrongly
        // return empty; retry once before believing an empty result.
        var result = walk()
        if result.isEmpty { result = walk() }
        return result
    }

    // MARK: - readFile

    @objc func readFile(_ call: CAPPluginCall) {
        guard let bookmarkB64 = call.getString("bookmark"),
              let bookmarkData = Data(base64Encoded: bookmarkB64),
              let relPath = call.getString("path") else {
            call.reject("Missing bookmark or path")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                var isStale = false
                let root = try URL(
                    resolvingBookmarkData: bookmarkData,
                    options: [],
                    relativeTo: nil,
                    bookmarkDataIsStale: &isStale
                )
                let didAccess = root.startAccessingSecurityScopedResource()
                defer { if didAccess { root.stopAccessingSecurityScopedResource() } }
                guard didAccess else {
                    call.reject("Access denied to bookmarked folder", "ACCESS_DENIED")
                    return
                }

                let fileURL = self.resolveChild(root: root, relativePath: relPath)
                try self.ensureDownloaded(fileURL)
                let content = try self.coordinatedRead(fileURL)
                let mtimeMs = ((try? fileURL.resourceValues(forKeys: [.contentModificationDateKey]))?
                    .contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000
                call.resolve(["content": content, "mtime": mtimeMs])
            } catch {
                call.reject("Failed to read file: \(error.localizedDescription)", "READ_FAILED")
            }
        }
    }

    /// Map a `<leaf>/<sub>/<file>` relative path (leaf == root.lastPathComponent) to a
    /// child URL under `root` by dropping the leaf segment.
    private func resolveChild(root: URL, relativePath: String) -> URL {
        var segments = relativePath.split(separator: "/").map(String.init)
        if let first = segments.first, first == root.lastPathComponent {
            segments.removeFirst()
        }
        var url = root
        for seg in segments { url.appendPathComponent(seg) }
        return url
    }

    /// If the item is an undownloaded iCloud placeholder, request a download and wait
    /// (bounded). A non-ubiquitous local file returns immediately.
    private func ensureDownloaded(_ url: URL) throws {
        let status = (try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?
            .ubiquitousItemDownloadingStatus
        guard let status = status, status != .current else { return }

        try FileManager.default.startDownloadingUbiquitousItem(at: url)
        let deadline = Date().addingTimeInterval(FolderFsPlugin.maxDownloadWaitSeconds)
        while Date() < deadline {
            let now = (try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?
                .ubiquitousItemDownloadingStatus
            if now == .current { return }
            Thread.sleep(forTimeInterval: 0.2)
        }
    }

    /// Coordinated UTF-8 read - NSFileCoordinator avoids racing the iCloud sync daemon
    /// for externally-edited files (the exact case here).
    private func coordinatedRead(_ url: URL) throws -> String {
        var coordError: NSError?
        var readError: Error?
        var text = ""
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { newURL in
            do { text = try String(contentsOf: newURL, encoding: .utf8) }
            catch { readError = error }
        }
        if let coordError = coordError { throw coordError }
        if let readError = readError { throw readError }
        return text
    }

    // MARK: - isSameDirectory

    @objc func isSameDirectory(_ call: CAPPluginCall) {
        guard let aB64 = call.getString("a"), let aData = Data(base64Encoded: aB64),
              let bB64 = call.getString("b"), let bData = Data(base64Encoded: bB64) else {
            call.reject("Missing bookmarks")
            return
        }
        do {
            var s1 = false, s2 = false
            let aURL = try URL(resolvingBookmarkData: aData, options: [], relativeTo: nil, bookmarkDataIsStale: &s1)
            let bURL = try URL(resolvingBookmarkData: bData, options: [], relativeTo: nil, bookmarkDataIsStale: &s2)
            call.resolve(["same": aURL.standardizedFileURL.path == bURL.standardizedFileURL.path])
        } catch {
            call.reject("Failed to compare bookmarks: \(error.localizedDescription)")
        }
    }

    // MARK: - writeFile

    /// Create-or-overwrite one UTF-8 file in the bookmarked folder - the automated
    /// backup engine drops an encrypted envelope here (planning/auto-backup-zk.md).
    /// No write-specific grant is needed: a folder picked via UIDocumentPicker in
    /// open mode (asCopy:false) is read-write by nature, so the SAME plain bookmark
    /// used by listFiles/readFile already authorizes writes. (The JS `write` flag on
    /// pickDirectory is therefore an Android-only concern.)
    @objc func writeFile(_ call: CAPPluginCall) {
        guard let bookmarkB64 = call.getString("bookmark"),
              let bookmarkData = Data(base64Encoded: bookmarkB64),
              let relPath = call.getString("path"),
              let content = call.getString("content") else {
            call.reject("Missing bookmark, path or content")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                var isStale = false
                let root = try URL(
                    resolvingBookmarkData: bookmarkData,
                    options: [],
                    relativeTo: nil,
                    bookmarkDataIsStale: &isStale
                )
                let didAccess = root.startAccessingSecurityScopedResource()
                defer { if didAccess { root.stopAccessingSecurityScopedResource() } }
                guard didAccess else {
                    call.reject("Access denied to bookmarked folder", "ACCESS_DENIED")
                    return
                }

                // Refresh a stale bookmark while we still hold access (same contract
                // as listFiles); the JS layer persists it over the old one.
                var staleBookmark: String?
                if isStale,
                   let fresh = try? root.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                    staleBookmark = fresh.base64EncodedString()
                }

                let fileURL = self.resolveChild(root: root, relativePath: relPath)
                try self.coordinatedWrite(fileURL, content: content)

                var result: [String: Any] = [:]
                if let staleBookmark = staleBookmark { result["staleBookmark"] = staleBookmark }
                call.resolve(result)
            } catch {
                call.reject("Failed to write file: \(error.localizedDescription)", "WRITE_FAILED")
            }
        }
    }

    /// Coordinated, atomic UTF-8 write. NSFileCoordinator `.forReplacing` is the
    /// iCloud-safe counterpart of coordinatedRead (the backup folder may live in
    /// iCloud Drive); `.atomic` writes to a temp file then renames, so a crash can
    /// never leave a truncated backup behind.
    private func coordinatedWrite(_ url: URL, content: String) throws {
        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { newURL in
            do { try Data(content.utf8).write(to: newURL, options: .atomic) }
            catch { writeError = error }
        }
        if let coordError = coordError { throw coordError }
        if let writeError = writeError { throw writeError }
    }

    // MARK: - deleteFile

    /// Remove one file from the bookmarked folder (backup rotation). Idempotent: an
    /// already-absent file is the desired end state, so missing is not an error.
    @objc func deleteFile(_ call: CAPPluginCall) {
        guard let bookmarkB64 = call.getString("bookmark"),
              let bookmarkData = Data(base64Encoded: bookmarkB64),
              let relPath = call.getString("path") else {
            call.reject("Missing bookmark or path")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                var isStale = false
                let root = try URL(
                    resolvingBookmarkData: bookmarkData,
                    options: [],
                    relativeTo: nil,
                    bookmarkDataIsStale: &isStale
                )
                let didAccess = root.startAccessingSecurityScopedResource()
                defer { if didAccess { root.stopAccessingSecurityScopedResource() } }
                guard didAccess else {
                    call.reject("Access denied to bookmarked folder", "ACCESS_DENIED")
                    return
                }

                var staleBookmark: String?
                if isStale,
                   let fresh = try? root.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                    staleBookmark = fresh.base64EncodedString()
                }

                let fileURL = self.resolveChild(root: root, relativePath: relPath)
                if FileManager.default.fileExists(atPath: fileURL.path) {
                    try self.coordinatedRemove(fileURL)
                }

                var result: [String: Any] = [:]
                if let staleBookmark = staleBookmark { result["staleBookmark"] = staleBookmark }
                call.resolve(result)
            } catch {
                call.reject("Failed to delete file: \(error.localizedDescription)", "DELETE_FAILED")
            }
        }
    }

    private func coordinatedRemove(_ url: URL) throws {
        var coordError: NSError?
        var removeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forDeleting, error: &coordError) { newURL in
            do { try FileManager.default.removeItem(at: newURL) }
            catch { removeError = error }
        }
        if let coordError = coordError { throw coordError }
        if let removeError = removeError { throw removeError }
    }
}

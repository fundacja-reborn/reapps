package eu.reapps.notes;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * FolderFs - app-local Capacitor plugin: persistent read access to a user-picked
 * directory OUTSIDE the app sandbox, for the one-way native folder sync (disk ->
 * app). Android counterpart of FolderFsPlugin.swift; both satisfy the same
 * 4-method JS contract (native-folder-fs.ts), so the FolderSource abstraction,
 * sync runner, manifest, watermark and import engine are shared verbatim across
 * platforms. See planning/native-folder-sync-plan.md (Android section).
 *
 * Android model (Storage Access Framework):
 *  - Pick a folder with ACTION_OPEN_DOCUMENT_TREE. The grant is recursive over
 *    the whole subtree - no per-file picking.
 *  - Persist access with takePersistableUriPermission(READ): survives relaunch
 *    AND reboot. It dies when the folder is deleted/moved or the user revokes it
 *    (the SAF analogue of a stale iOS bookmark) - surfaced as a thrown listFiles
 *    (SecurityException), which the runner treats as a failed sync until the user
 *    re-links (a fresh pick). There is no silent "recreate", so staleBookmark is
 *    never returned (unlike iOS).
 *  - The "bookmark" is simply the tree Uri string (e.g.
 *    content://com.android.externalstorage.documents/tree/primary%3ANotes).
 *  - SAF document URIs are NOT path-addressable (only opaque documentIds are).
 *    listFiles therefore carries each file's documentId back as `id`, and readFile
 *    resolves it O(1) via buildDocumentUriUsingTree(id) - falling back to a path
 *    re-walk only when no `id` is supplied. iOS, whose URLs are path-addressable,
 *    omits `id` and resolves from `path` alone.
 *
 * Registered app-local (not an npm package) via MainActivity.registerPlugin().
 * No manifest permission is required - SAF grants per-URI access at runtime.
 */
@CapacitorPlugin(name = "FolderFs")
public class FolderFsPlugin extends Plugin {

    private static final String[] LIST_PROJECTION = new String[] {
        Document.COLUMN_DOCUMENT_ID,
        Document.COLUMN_DISPLAY_NAME,
        Document.COLUMN_MIME_TYPE,
        Document.COLUMN_LAST_MODIFIED,
        Document.COLUMN_SIZE
    };

    // MARK: - pickDirectory

    @PluginMethod
    public void pickDirectory(PluginCall call) {
        // Least privilege: read-only sync picks (write=false/absent) request only a
        // persistable READ grant; the automated-backup folder pick (write=true) also
        // requests WRITE so the engine can create and rotate backup files. The
        // original `call` is handed back to the callback, which re-reads `write`.
        boolean write = Boolean.TRUE.equals(call.getBoolean("write", false));
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        // FLAG_GRANT_PERSISTABLE lets takePersistableUriPermission below survive
        // process death and reboot.
        int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION;
        if (write) {
            flags |= Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        }
        intent.addFlags(flags);
        startActivityForResult(call, intent, "handlePickResult");
    }

    @ActivityCallback
    private void handlePickResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }
        Uri treeUri = data.getData();
        boolean write = Boolean.TRUE.equals(call.getBoolean("write", false));
        int grantFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
        if (write) {
            grantFlags |= Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        }
        try {
            // Persist exactly the modes this pick asked for: READ for sync, READ|WRITE
            // for backups. Hardcoding our intent (rather than data.getFlags()) keeps
            // sync folders read-only even though SAF grants write on any tree pick.
            // This grant is what makes the tree Uri usable after a relaunch/reboot.
            getContext()
                .getContentResolver()
                .takePersistableUriPermission(treeUri, grantFlags);
        } catch (Exception e) {
            call.reject("Failed to persist folder access: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("bookmark", treeUri.toString());
        ret.put("name", displayNameOfTree(treeUri));
        call.resolve(ret);
    }

    // MARK: - listFiles

    @PluginMethod
    public void listFiles(PluginCall call) {
        String bookmark = call.getString("bookmark");
        if (bookmark == null) {
            call.reject("Missing or invalid bookmark");
            return;
        }
        Set<String> extensions = parseExtensions(call.getArray("extensions"));

        Uri treeUri;
        try {
            treeUri = Uri.parse(bookmark);
        } catch (Exception e) {
            call.reject("Missing or invalid bookmark");
            return;
        }

        try {
            String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
            String rootLeaf = displayNameOfTree(treeUri);
            ContentResolver resolver = getContext().getContentResolver();
            JSArray files = new JSArray();

            // Iterative DFS (an explicit stack, not recursion) over the document
            // tree: one children query per directory. Deliberately NOT
            // DocumentFile.listFiles(), which is ~100x slower (it re-queries per
            // child). Relative paths are rooted at the directory leaf name
            // (<leaf>/<sub>/<file>), matching the web/iOS walk shape so the shared
            // importFolder engine is blind to which platform produced them.
            Deque<Frame> stack = new ArrayDeque<>();
            stack.push(new Frame(rootDocId, rootLeaf));

            while (!stack.isEmpty()) {
                Frame frame = stack.pop();
                Uri childrenUri =
                    DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, frame.docId);
                Cursor cursor = resolver.query(childrenUri, LIST_PROJECTION, null, null, null);
                if (cursor == null) {
                    continue;
                }
                try {
                    int idIdx = cursor.getColumnIndexOrThrow(Document.COLUMN_DOCUMENT_ID);
                    int nameIdx = cursor.getColumnIndexOrThrow(Document.COLUMN_DISPLAY_NAME);
                    int mimeIdx = cursor.getColumnIndexOrThrow(Document.COLUMN_MIME_TYPE);
                    // mtime/size are optional columns for some providers - tolerate absence.
                    int mtimeIdx = cursor.getColumnIndex(Document.COLUMN_LAST_MODIFIED);
                    int sizeIdx = cursor.getColumnIndex(Document.COLUMN_SIZE);

                    while (cursor.moveToNext()) {
                        String name = cursor.getString(nameIdx);
                        if (name == null) {
                            continue;
                        }
                        // Prune hidden (dot) segments - .obsidian/, .trash/ - whole
                        // subtree for dirs. (No iCloud-placeholder analogue here.)
                        if (name.startsWith(".")) {
                            continue;
                        }

                        String childId = cursor.getString(idIdx);
                        String mime = cursor.getString(mimeIdx);
                        String childRel = frame.relPath + "/" + name;

                        if (Document.MIME_TYPE_DIR.equals(mime)) {
                            stack.push(new Frame(childId, childRel));
                            continue;
                        }

                        if (!extensions.contains(extensionOf(name))) {
                            continue;
                        }

                        long mtime = (mtimeIdx >= 0 && !cursor.isNull(mtimeIdx))
                            ? cursor.getLong(mtimeIdx)
                            : 0L;
                        long size = (sizeIdx >= 0 && !cursor.isNull(sizeIdx))
                            ? cursor.getLong(sizeIdx)
                            : 0L;

                        JSObject entry = new JSObject();
                        entry.put("path", childRel);
                        entry.put("mtime", mtime);
                        entry.put("size", size);
                        // Opaque SAF documentId - readFile resolves O(1) from it,
                        // avoiding a per-file path re-walk on the first full sync.
                        entry.put("id", childId);
                        files.put(entry);
                    }
                } finally {
                    cursor.close();
                }
            }

            JSObject ret = new JSObject();
            ret.put("files", files);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Access denied to bookmarked folder", "ACCESS_DENIED");
        } catch (Exception e) {
            call.reject("Failed to list folder: " + e.getMessage(), "RESOLVE_FAILED");
        }
    }

    // MARK: - readFile

    @PluginMethod
    public void readFile(PluginCall call) {
        String bookmark = call.getString("bookmark");
        String path = call.getString("path");
        if (bookmark == null || path == null) {
            call.reject("Missing bookmark or path");
            return;
        }

        try {
            Uri treeUri = Uri.parse(bookmark);
            String docId = call.getString("id");
            Uri fileUri = (docId != null)
                ? DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)
                : resolveByPath(treeUri, path);
            if (fileUri == null) {
                call.reject("File not found: " + path, "READ_FAILED");
                return;
            }
            String content = readUtf8(fileUri);
            long mtime = lastModifiedOf(fileUri);
            JSObject ret = new JSObject();
            ret.put("content", content);
            ret.put("mtime", mtime);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Access denied to bookmarked folder", "ACCESS_DENIED");
        } catch (Exception e) {
            call.reject("Failed to read file: " + e.getMessage(), "READ_FAILED");
        }
    }

    // MARK: - isSameDirectory

    @PluginMethod
    public void isSameDirectory(PluginCall call) {
        String a = call.getString("a");
        String b = call.getString("b");
        if (a == null || b == null) {
            call.reject("Missing bookmarks");
            return;
        }
        try {
            Uri ua = Uri.parse(a);
            Uri ub = Uri.parse(b);
            boolean same =
                stringsEqual(ua.getAuthority(), ub.getAuthority())
                    && stringsEqual(
                        DocumentsContract.getTreeDocumentId(ua),
                        DocumentsContract.getTreeDocumentId(ub)
                    );
            JSObject ret = new JSObject();
            ret.put("same", same);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to compare bookmarks: " + e.getMessage());
        }
    }

    // MARK: - writeFile

    /**
     * Create-or-overwrite one UTF-8 file at the bookmarked folder root - the
     * automated backup engine drops an encrypted envelope here. Requires a folder
     * picked with write=true (a persisted WRITE grant). Our backups are flat, so
     * `path` is just the file's display name.
     */
    @PluginMethod
    public void writeFile(PluginCall call) {
        String bookmark = call.getString("bookmark");
        String path = call.getString("path");
        String content = call.getString("content");
        if (bookmark == null || path == null || content == null) {
            call.reject("Missing bookmark, path or content");
            return;
        }
        try {
            Uri treeUri = Uri.parse(bookmark);
            String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
            String fileName = leafName(path);

            // Reuse an existing same-named file (overwrite) rather than creating a
            // duplicate - createDocument would otherwise mint "name (1).json".
            Uri fileUri = findChildByName(treeUri, rootDocId, fileName);
            if (fileUri == null) {
                Uri parentDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocId);
                fileUri = DocumentsContract.createDocument(
                    getContext().getContentResolver(), parentDocUri, "application/json", fileName);
                if (fileUri == null) {
                    call.reject("Failed to create file: " + fileName, "WRITE_FAILED");
                    return;
                }
            }
            writeUtf8(fileUri, content);

            // SAF grants never go silently stale (unlike iOS bookmarks), so there is
            // no staleBookmark to return - an empty result matches the JS contract.
            call.resolve(new JSObject());
        } catch (SecurityException e) {
            call.reject("Access denied to bookmarked folder", "ACCESS_DENIED");
        } catch (Exception e) {
            call.reject("Failed to write file: " + e.getMessage(), "WRITE_FAILED");
        }
    }

    // MARK: - deleteFile

    /**
     * Remove one file from the bookmarked folder root (backup rotation). Idempotent:
     * an already-absent file is the desired end state, so missing is not an error.
     */
    @PluginMethod
    public void deleteFile(PluginCall call) {
        String bookmark = call.getString("bookmark");
        String path = call.getString("path");
        if (bookmark == null || path == null) {
            call.reject("Missing bookmark or path");
            return;
        }
        try {
            Uri treeUri = Uri.parse(bookmark);
            String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri fileUri = findChildByName(treeUri, rootDocId, leafName(path));
            if (fileUri != null) {
                DocumentsContract.deleteDocument(getContext().getContentResolver(), fileUri);
            }
            call.resolve(new JSObject());
        } catch (SecurityException e) {
            call.reject("Access denied to bookmarked folder", "ACCESS_DENIED");
        } catch (Exception e) {
            call.reject("Failed to delete file: " + e.getMessage(), "DELETE_FAILED");
        }
    }

    // MARK: - releaseDirectory

    /**
     * Relinquish the persisted SAF grant for a bookmarked tree - the mirror of the
     * take in handlePickResult, called when the app forgets the bookmark (the
     * auto-backup wipe on logout / local reset). Without this the OS keeps the
     * grant alive even though the Uri is gone from our storage and can never be
     * used again. `write` must echo the mode the folder was picked with, so the
     * released modes match the persisted ones. Releasing a grant the OS no longer
     * holds is a silent no-op, which keeps the wipe path idempotent.
     */
    @PluginMethod
    public void releaseDirectory(PluginCall call) {
        String bookmark = call.getString("bookmark");
        if (bookmark == null) {
            call.reject("Missing or invalid bookmark");
            return;
        }
        boolean write = Boolean.TRUE.equals(call.getBoolean("write", false));
        int grantFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
        if (write) {
            grantFlags |= Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        }
        try {
            getContext()
                .getContentResolver()
                .releasePersistableUriPermission(Uri.parse(bookmark), grantFlags);
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject("Failed to release folder access: " + e.getMessage(), "RELEASE_FAILED");
        }
    }

    // MARK: - helpers

    /** Walk frame: a directory's documentId plus its accumulated <leaf>/<sub> path. */
    private static final class Frame {
        final String docId;
        final String relPath;

        Frame(String docId, String relPath) {
            this.docId = docId;
            this.relPath = relPath;
        }
    }

    /** Lower-cased extension set; defaults to {"md"} when none supplied. */
    private Set<String> parseExtensions(JSArray raw) {
        Set<String> extensions = new HashSet<>();
        if (raw != null) {
            try {
                List<Object> list = raw.toList();
                for (Object item : list) {
                    if (item instanceof String) {
                        String ext = ((String) item).toLowerCase(Locale.ROOT);
                        if (!ext.isEmpty()) {
                            extensions.add(ext);
                        }
                    }
                }
            } catch (Exception ignored) {
                // Malformed array -> fall through to the default below.
            }
        }
        if (extensions.isEmpty()) {
            extensions.add("md");
        }
        return extensions;
    }

    private static String extensionOf(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) {
            return "";
        }
        return name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static boolean stringsEqual(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }

    /** Display name (leaf) of the tree root; falls back to the doc-id tail. */
    private String displayNameOfTree(Uri treeUri) {
        String docId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri rootDoc = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
        String name = queryDisplayName(rootDoc);
        if (name != null && !name.isEmpty()) {
            return name;
        }
        // Fallback: tail of "primary:Some/Folder" (provider-dependent doc ids).
        String tail = docId;
        int colon = tail.lastIndexOf(':');
        if (colon >= 0) {
            tail = tail.substring(colon + 1);
        }
        int slash = tail.lastIndexOf('/');
        if (slash >= 0) {
            tail = tail.substring(slash + 1);
        }
        return tail.isEmpty() ? "Folder" : tail;
    }

    private String queryDisplayName(Uri docUri) {
        Cursor cursor = getContext()
            .getContentResolver()
            .query(docUri, new String[] { Document.COLUMN_DISPLAY_NAME }, null, null, null);
        if (cursor == null) {
            return null;
        }
        try {
            if (cursor.moveToFirst() && !cursor.isNull(0)) {
                return cursor.getString(0);
            }
        } finally {
            cursor.close();
        }
        return null;
    }

    private long lastModifiedOf(Uri docUri) {
        Cursor cursor = getContext()
            .getContentResolver()
            .query(docUri, new String[] { Document.COLUMN_LAST_MODIFIED }, null, null, null);
        if (cursor == null) {
            return 0L;
        }
        try {
            if (cursor.moveToFirst() && !cursor.isNull(0)) {
                return cursor.getLong(0);
            }
        } finally {
            cursor.close();
        }
        return 0L;
    }

    /**
     * Fallback resolver: map a <leaf>/<sub>/<file> path to a document Uri by
     * walking the tree and matching display names. Only used when readFile is
     * called without an `id` (normally listFiles supplies one, making reads O(1)).
     */
    private Uri resolveByPath(Uri treeUri, String relPath) {
        ContentResolver resolver = getContext().getContentResolver();
        String currentDocId = DocumentsContract.getTreeDocumentId(treeUri);
        String[] segments = relPath.split("/");
        // Drop the leading leaf segment (it names the tree root itself).
        int start = 0;
        if (segments.length > 0 && segments[0].equals(displayNameOfTree(treeUri))) {
            start = 1;
        }

        for (int i = start; i < segments.length; i++) {
            String seg = segments[i];
            if (seg.isEmpty()) {
                continue;
            }
            Uri childrenUri =
                DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, currentDocId);
            Cursor cursor = resolver.query(
                childrenUri,
                new String[] { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME },
                null,
                null,
                null
            );
            if (cursor == null) {
                return null;
            }
            String matchId = null;
            try {
                while (cursor.moveToNext()) {
                    if (seg.equals(cursor.getString(1))) {
                        matchId = cursor.getString(0);
                        break;
                    }
                }
            } finally {
                cursor.close();
            }
            if (matchId == null) {
                return null;
            }
            currentDocId = matchId;
        }
        return DocumentsContract.buildDocumentUriUsingTree(treeUri, currentDocId);
    }

    private String readUtf8(Uri fileUri) throws IOException {
        InputStream input = getContext().getContentResolver().openInputStream(fileUri);
        if (input == null) {
            throw new IOException("openInputStream returned null");
        }
        try {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = input.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            input.close();
        }
    }

    /**
     * Find a direct child of `parentDocId` by display name, returning its document
     * Uri or null. Used to overwrite-in-place and to locate a file for deletion
     * (our backups are flat at the folder root).
     */
    private Uri findChildByName(Uri treeUri, String parentDocId, String name) {
        ContentResolver resolver = getContext().getContentResolver();
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        Cursor cursor = resolver.query(
            childrenUri,
            new String[] { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME },
            null,
            null,
            null
        );
        if (cursor == null) {
            return null;
        }
        try {
            while (cursor.moveToNext()) {
                if (name.equals(cursor.getString(1))) {
                    return DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(0));
                }
            }
        } finally {
            cursor.close();
        }
        return null;
    }

    /** Basename of a (possibly leaf-rooted) relative path; backups are flat. */
    private static String leafName(String path) {
        int slash = path.lastIndexOf('/');
        return slash >= 0 ? path.substring(slash + 1) : path;
    }

    private void writeUtf8(Uri fileUri, String content) throws IOException {
        // "wt" = write + truncate, so an overwrite fully replaces the previous bytes.
        OutputStream output = getContext().getContentResolver().openOutputStream(fileUri, "wt");
        if (output == null) {
            throw new IOException("openOutputStream returned null");
        }
        try {
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.flush();
        } finally {
            output.close();
        }
    }
}

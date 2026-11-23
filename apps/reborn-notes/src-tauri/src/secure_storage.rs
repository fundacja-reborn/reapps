//! OS credential store access for the webview, the desktop counterpart of the
//! Capacitor secure-storage plugin.
//!
//! Holds the rotating refresh token and the master key. Zero Knowledge rules
//! for this module:
//! - values never appear in logs or in error messages (errors are fixed
//!   strings, the underlying OS status is dropped on purpose);
//! - nothing here talks to the network;
//! - entries are namespaced by the bundle identifier, so a development build
//!   and a store build never read each other's secrets.
//!
//! # macOS: the data protection keychain, this Mac only
//!
//! Both entries go to the data protection keychain
//! (`kSecUseDataProtectionKeychain`) with the access class
//! `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` - the class the iOS shell
//! gives the same two entries. Items of that class stay on this Mac: they are
//! not in Time Machine backups, Migration Assistant does not move them to a new
//! Mac, and iCloud Keychain does not sync them. The file-based login keychain
//! (`~/Library/Keychains/login.keychain-db`, what `keyring` 3 wrote to until
//! D4) has no such class: Time Machine copies it, protected by the account
//! password only.
//!
//! The data protection keychain needs a keychain access group, that is the
//! `keychain-access-groups` entitlement, which macOS only honours in an app
//! signed with a provisioning profile (Mac App Store build, development build
//! with a profile). No access group attribute is set on the items: the system
//! uses the first group of the entitlement (`<team id>.<bundle id>`).
//!
//! Which keychain a process uses is decided once, from its own signature:
//! with a keychain access group the data protection keychain, without one a
//! debug build (`cargo tauri dev`, an `.app` built without a profile) uses the
//! login keychain, so development keeps a session across launches. A release
//! build without the group makes no keychain call and reports the store as
//! unavailable; the login keychain path is not compiled into it at all.
//!
//! Not from a failed call: without the group `SecItemAdd` and `SecItemDelete`
//! fail with `errSecMissingEntitlement`, but `SecItemCopyMatching` answers
//! `errSecItemNotFound`, so a read would never fall back (the session was
//! gone after every restart of the first D4 development build).
//!
//! No migration from the login keychain: the store build has its own bundle
//! identifier and runs in the sandbox, so it never sees entries that earlier
//! development builds left there.
//!
//! # Other systems
//!
//! Windows Credential Manager through the `keyring` crate (D5).

use std::sync::{Mutex, PoisonError};

use tauri::AppHandle;

/// Longest key the webview may address. The app uses a handful of short,
/// fixed names; the cap only bounds what a compromised page could create.
const MAX_KEY_LEN: usize = 64;

/// One keychain operation at a time. A write is an add followed, for an
/// existing item, by an update; serializing the commands keeps a concurrent
/// remove from slipping in between.
static SERIAL: Mutex<()> = Mutex::new(());

const INVALID_KEY: &str = "secure storage: invalid key";
const UNAVAILABLE: &str = "secure storage: store unavailable";
const READ_FAILED: &str = "secure storage: read failed";
const WRITE_FAILED: &str = "secure storage: write failed";
const DELETE_FAILED: &str = "secure storage: delete failed";

fn validate_key(key: &str) -> Result<(), String> {
    let valid = !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.');
    if valid {
        Ok(())
    } else {
        Err(INVALID_KEY.into())
    }
}

/// Runs `op` for `key` in this app's namespace, one call at a time.
fn with_entry<T>(
    app: &AppHandle,
    key: &str,
    op: impl FnOnce(&str, &str) -> Result<T, String>,
) -> Result<T, String> {
    validate_key(key)?;
    let _serial = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
    op(&app.config().identifier, key)
}

/// Read an entry. `None` when it does not exist.
#[tauri::command(async)]
pub fn secure_storage_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    with_entry(&app, &key, store::get)
}

/// Create or replace an entry.
#[tauri::command(async)]
pub fn secure_storage_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    with_entry(&app, &key, |service, account| {
        store::set(service, account, &value)
    })
}

/// Delete an entry. Deleting a missing entry is a success (idempotent logout).
#[tauri::command(async)]
pub fn secure_storage_remove(app: AppHandle, key: String) -> Result<(), String> {
    with_entry(&app, &key, store::remove)
}

#[cfg(target_os = "macos")]
mod store {
    use super::{DELETE_FAILED, READ_FAILED, UNAVAILABLE, WRITE_FAILED};

    /// `errSecSuccess`.
    const OK: i32 = 0;
    /// `errSecItemNotFound`.
    const ITEM_NOT_FOUND: i32 = -25300;
    /// `errSecDuplicateItem`.
    const DUPLICATE_ITEM: i32 = -25299;
    /// `errSecMissingEntitlement`: the binary has no keychain access group.
    const MISSING_ENTITLEMENT: i32 = -34018;

    /// Which keychain an item lives in.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(super) enum Keychain {
        /// The data protection keychain, items of this Mac only.
        DataProtection,
        /// The file-based login keychain: debug builds without an
        /// entitlement only.
        #[cfg(debug_assertions)]
        Login,
    }

    /// One attribute of a keychain query, kept as plain data so the queries
    /// can be checked without touching the keychain.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(super) enum Attr<'a> {
        ClassGenericPassword,
        Service(&'a str),
        Account(&'a str),
        UseDataProtectionKeychain,
        AccessibleWhenUnlockedThisDeviceOnly,
        Data(&'a [u8]),
        ReturnData,
    }

    /// The attributes that identify an item.
    pub(super) fn identity<'a>(
        keychain: Keychain,
        service: &'a str,
        account: &'a str,
    ) -> Vec<Attr<'a>> {
        let mut attrs = vec![
            Attr::ClassGenericPassword,
            Attr::Service(service),
            Attr::Account(account),
        ];
        if keychain == Keychain::DataProtection {
            attrs.push(Attr::UseDataProtectionKeychain);
        }
        attrs
    }

    /// The content of an item: its data and, in the data protection keychain,
    /// its access class. Used for a new item and for the update of an
    /// existing one, so an update also restores the class.
    pub(super) fn content(keychain: Keychain, data: &[u8]) -> Vec<Attr<'_>> {
        let mut attrs = vec![Attr::Data(data)];
        if keychain == Keychain::DataProtection {
            attrs.push(Attr::AccessibleWhenUnlockedThisDeviceOnly);
        }
        attrs
    }

    /// The keychain calls, as `OSStatus` results, and the one fact about the
    /// process they depend on.
    pub(super) trait Keychains {
        /// Whether the process's signature carries `keychain-access-groups`.
        fn has_access_group(&self) -> bool;
        fn add(&self, attrs: &[Attr]) -> i32;
        fn update(&self, query: &[Attr], changes: &[Attr]) -> i32;
        fn copy_data(&self, query: &[Attr]) -> Result<Vec<u8>, i32>;
        fn delete(&self, query: &[Attr]) -> i32;
    }

    /// The keychain this process keeps its items in (see the module docs).
    pub(super) fn keychain(system: &impl Keychains) -> Result<Keychain, i32> {
        if system.has_access_group() {
            Ok(Keychain::DataProtection)
        } else {
            without_access_group()
        }
    }

    #[cfg(debug_assertions)]
    fn without_access_group() -> Result<Keychain, i32> {
        Ok(Keychain::Login)
    }

    #[cfg(not(debug_assertions))]
    fn without_access_group() -> Result<Keychain, i32> {
        Err(MISSING_ENTITLEMENT)
    }

    pub(super) fn read(
        system: &impl Keychains,
        service: &str,
        account: &str,
    ) -> Result<Option<Vec<u8>>, i32> {
        let mut query = identity(keychain(system)?, service, account);
        query.push(Attr::ReturnData);
        match system.copy_data(&query) {
            Ok(data) => Ok(Some(data)),
            Err(ITEM_NOT_FOUND) => Ok(None),
            Err(status) => Err(status),
        }
    }

    pub(super) fn write(
        system: &impl Keychains,
        service: &str,
        account: &str,
        data: &[u8],
    ) -> Result<(), i32> {
        let keychain = keychain(system)?;
        let query = identity(keychain, service, account);
        let changes = content(keychain, data);
        let mut item = query.clone();
        item.extend_from_slice(&changes);
        match system.add(&item) {
            OK => Ok(()),
            DUPLICATE_ITEM => match system.update(&query, &changes) {
                OK => Ok(()),
                status => Err(status),
            },
            status => Err(status),
        }
    }

    pub(super) fn delete(system: &impl Keychains, service: &str, account: &str) -> Result<(), i32> {
        match system.delete(&identity(keychain(system)?, service, account)) {
            OK | ITEM_NOT_FOUND => Ok(()),
            status => Err(status),
        }
    }

    /// A fixed message for a failed call: "unavailable" when the binary has
    /// no keychain access group (a release build without its provisioning
    /// profile).
    fn message(status: i32, failed: &str) -> String {
        if status == MISSING_ENTITLEMENT {
            UNAVAILABLE.into()
        } else {
            failed.into()
        }
    }

    pub fn get(service: &str, account: &str) -> Result<Option<String>, String> {
        match read(&ffi::System, service, account) {
            Ok(Some(bytes)) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| READ_FAILED.into()),
            Ok(None) => Ok(None),
            Err(status) => Err(message(status, READ_FAILED)),
        }
    }

    pub fn set(service: &str, account: &str, value: &str) -> Result<(), String> {
        write(&ffi::System, service, account, value.as_bytes())
            .map_err(|status| message(status, WRITE_FAILED))
    }

    pub fn remove(service: &str, account: &str) -> Result<(), String> {
        delete(&ffi::System, service, account).map_err(|status| message(status, DELETE_FAILED))
    }

    /// The Security framework calls. `security-framework`'s `passwords` module
    /// is not used: on an update it matches the item with the full set of
    /// attributes it was created with, access control included, and it has no
    /// setter for `kSecAttrAccessible`.
    mod ffi {
        use super::{Attr, Keychains};
        use core_foundation::array::{CFArray, CFArrayRef};
        use core_foundation::base::{CFAllocatorRef, CFGetTypeID, CFRelease, CFTypeRef};
        use core_foundation::base::{CFType, TCFType};
        use core_foundation::boolean::CFBoolean;
        use core_foundation::data::{CFData, CFDataRef};
        use core_foundation::dictionary::CFDictionary;
        use core_foundation::string::{CFString, CFStringRef};
        use security_framework_sys::access_control::kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
        use security_framework_sys::item::{
            kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword, kSecReturnData,
            kSecUseDataProtectionKeychain, kSecValueData,
        };
        use security_framework_sys::keychain_item::{
            SecItemAdd, SecItemCopyMatching, SecItemDelete, SecItemUpdate,
        };
        use std::sync::OnceLock;

        #[link(name = "Security", kind = "framework")]
        extern "C" {
            // Not declared by security-framework-sys.
            static kSecAttrAccessible: CFStringRef;
            // `SecTaskRef` is a CF object; the error out pointer may be null.
            fn SecTaskCreateFromSelf(allocator: CFAllocatorRef) -> CFTypeRef;
            fn SecTaskCopyValueForEntitlement(
                task: CFTypeRef,
                entitlement: CFStringRef,
                error: *mut CFTypeRef,
            ) -> CFTypeRef;
        }

        /// Whether this process's signature carries a non-empty
        /// `keychain-access-groups`. Read once: a signature does not change
        /// while the process runs.
        fn signed_with_access_group() -> bool {
            static ACCESS_GROUP: OnceLock<bool> = OnceLock::new();
            *ACCESS_GROUP.get_or_init(|| {
                let name = CFString::from_static_string("keychain-access-groups");
                // SAFETY: both calls follow the create rule; every non-null
                // result is released exactly once (by the wrappers or by
                // CFRelease).
                unsafe {
                    let task = SecTaskCreateFromSelf(std::ptr::null());
                    if task.is_null() {
                        return false;
                    }
                    let value = SecTaskCopyValueForEntitlement(
                        task,
                        name.as_concrete_TypeRef(),
                        std::ptr::null_mut(),
                    );
                    CFRelease(task);
                    if value.is_null() {
                        return false;
                    }
                    if CFGetTypeID(value) == CFArray::<CFType>::type_id() {
                        let groups = CFArray::<CFType>::wrap_under_create_rule(value as CFArrayRef);
                        !groups.is_empty()
                    } else {
                        CFRelease(value);
                        false
                    }
                }
            })
        }

        /// `errSecDecode`: the keychain returned something other than data.
        const DECODE: i32 = -26275;

        fn constant(name: CFStringRef) -> CFString {
            // SAFETY: the Security framework's constants are valid,
            // immutable CFStrings for the life of the process.
            unsafe { CFString::wrap_under_get_rule(name) }
        }

        fn pair(attr: &Attr) -> (CFString, CFType) {
            // SAFETY: reading the framework's immutable constants.
            unsafe {
                match *attr {
                    Attr::ClassGenericPassword => (
                        constant(kSecClass),
                        constant(kSecClassGenericPassword).into_CFType(),
                    ),
                    Attr::Service(service) => (
                        constant(kSecAttrService),
                        CFString::new(service).into_CFType(),
                    ),
                    Attr::Account(account) => (
                        constant(kSecAttrAccount),
                        CFString::new(account).into_CFType(),
                    ),
                    Attr::UseDataProtectionKeychain => (
                        constant(kSecUseDataProtectionKeychain),
                        CFBoolean::true_value().into_CFType(),
                    ),
                    Attr::AccessibleWhenUnlockedThisDeviceOnly => (
                        constant(kSecAttrAccessible),
                        constant(kSecAttrAccessibleWhenUnlockedThisDeviceOnly).into_CFType(),
                    ),
                    Attr::Data(data) => (
                        constant(kSecValueData),
                        CFData::from_buffer(data).into_CFType(),
                    ),
                    Attr::ReturnData => (
                        constant(kSecReturnData),
                        CFBoolean::true_value().into_CFType(),
                    ),
                }
            }
        }

        fn dictionary(attrs: &[Attr]) -> CFDictionary<CFString, CFType> {
            let pairs: Vec<(CFString, CFType)> = attrs.iter().map(pair).collect();
            CFDictionary::from_CFType_pairs(&pairs)
        }

        pub struct System;

        impl Keychains for System {
            fn has_access_group(&self) -> bool {
                signed_with_access_group()
            }

            fn add(&self, attrs: &[Attr]) -> i32 {
                let attrs = dictionary(attrs);
                // SAFETY: a valid dictionary; no result is requested.
                unsafe { SecItemAdd(attrs.as_concrete_TypeRef(), std::ptr::null_mut()) }
            }

            fn update(&self, query: &[Attr], changes: &[Attr]) -> i32 {
                let query = dictionary(query);
                let changes = dictionary(changes);
                // SAFETY: two valid dictionaries.
                unsafe { SecItemUpdate(query.as_concrete_TypeRef(), changes.as_concrete_TypeRef()) }
            }

            fn copy_data(&self, query: &[Attr]) -> Result<Vec<u8>, i32> {
                let query = dictionary(query);
                let mut result: CFTypeRef = std::ptr::null();
                // SAFETY: a valid dictionary and a valid out pointer; on
                // success the result is ours to release (create rule).
                let status =
                    unsafe { SecItemCopyMatching(query.as_concrete_TypeRef(), &mut result) };
                if status != super::OK {
                    return Err(status);
                }
                if result.is_null() {
                    return Err(DECODE);
                }
                // SAFETY: `result` is a non-null object we own.
                unsafe {
                    if CFGetTypeID(result) == CFData::type_id() {
                        let data = CFData::wrap_under_create_rule(result as CFDataRef);
                        Ok(data.bytes().to_vec())
                    } else {
                        CFRelease(result);
                        Err(DECODE)
                    }
                }
            }

            fn delete(&self, query: &[Attr]) -> i32 {
                let query = dictionary(query);
                // SAFETY: a valid dictionary.
                unsafe { SecItemDelete(query.as_concrete_TypeRef()) }
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::cell::RefCell;

        /// Records the calls and answers with scripted statuses. Signed with
        /// a keychain access group unless `unsigned` is set.
        #[derive(Default)]
        struct Fake {
            unsigned: bool,
            calls: RefCell<Vec<String>>,
            add: RefCell<Vec<i32>>,
            update: RefCell<Vec<i32>>,
            copy: RefCell<Vec<Result<Vec<u8>, i32>>>,
            delete: RefCell<Vec<i32>>,
        }

        fn next<T>(queue: &RefCell<Vec<T>>) -> T {
            queue.borrow_mut().remove(0)
        }

        fn keychain_of(attrs: &[Attr]) -> &'static str {
            if attrs.contains(&Attr::UseDataProtectionKeychain) {
                "dp"
            } else {
                "login"
            }
        }

        impl Keychains for Fake {
            fn has_access_group(&self) -> bool {
                !self.unsigned
            }
            fn add(&self, attrs: &[Attr]) -> i32 {
                self.calls
                    .borrow_mut()
                    .push(format!("add:{}", keychain_of(attrs)));
                next(&self.add)
            }
            fn update(&self, query: &[Attr], _changes: &[Attr]) -> i32 {
                self.calls
                    .borrow_mut()
                    .push(format!("update:{}", keychain_of(query)));
                next(&self.update)
            }
            fn copy_data(&self, query: &[Attr]) -> Result<Vec<u8>, i32> {
                self.calls
                    .borrow_mut()
                    .push(format!("copy:{}", keychain_of(query)));
                next(&self.copy)
            }
            fn delete(&self, query: &[Attr]) -> i32 {
                self.calls
                    .borrow_mut()
                    .push(format!("delete:{}", keychain_of(query)));
                next(&self.delete)
            }
        }

        fn calls(fake: &Fake) -> Vec<String> {
            fake.calls.borrow().clone()
        }

        #[test]
        fn new_items_are_this_device_only_in_the_data_protection_keychain() {
            let mut item = identity(Keychain::DataProtection, "eu.reapps.notes", "master_key");
            item.extend(content(Keychain::DataProtection, b"secret"));
            assert_eq!(
                item,
                [
                    Attr::ClassGenericPassword,
                    Attr::Service("eu.reapps.notes"),
                    Attr::Account("master_key"),
                    Attr::UseDataProtectionKeychain,
                    Attr::Data(b"secret"),
                    Attr::AccessibleWhenUnlockedThisDeviceOnly,
                ]
            );
        }

        #[test]
        fn an_update_matches_by_identity_and_rewrites_data_and_class() {
            let fake = Fake::default();
            fake.add.borrow_mut().push(DUPLICATE_ITEM);
            fake.update.borrow_mut().push(OK);

            assert_eq!(write(&fake, "s", "a", b"new"), Ok(()));
            assert_eq!(calls(&fake), ["add:dp", "update:dp"]);
            // The query of the update holds no content attribute, so it
            // matches the item whatever class it was created with.
            let query = identity(Keychain::DataProtection, "s", "a");
            assert!(!query.contains(&Attr::AccessibleWhenUnlockedThisDeviceOnly));
            assert!(content(Keychain::DataProtection, b"new")
                .contains(&Attr::AccessibleWhenUnlockedThisDeviceOnly));
        }

        #[test]
        fn a_missing_item_reads_as_none_and_deletes_as_done() {
            let fake = Fake::default();
            fake.copy.borrow_mut().push(Err(ITEM_NOT_FOUND));
            fake.delete.borrow_mut().push(ITEM_NOT_FOUND);

            assert_eq!(read(&fake, "s", "a"), Ok(None));
            assert_eq!(delete(&fake, "s", "a"), Ok(()));
        }

        #[test]
        fn other_failures_are_reported_without_a_retry() {
            let fake = Fake::default();
            fake.add.borrow_mut().push(-25308); // errSecInteractionNotAllowed
            fake.copy.borrow_mut().push(Err(-25308));

            assert_eq!(write(&fake, "s", "a", b"x"), Err(-25308));
            assert_eq!(read(&fake, "s", "a"), Err(-25308));
            assert_eq!(calls(&fake), ["add:dp", "copy:dp"]);
        }

        #[test]
        fn a_failed_update_is_reported() {
            let fake = Fake::default();
            fake.add.borrow_mut().push(DUPLICATE_ITEM);
            fake.update.borrow_mut().push(-50);

            assert_eq!(write(&fake, "s", "a", b"x"), Err(-50));
        }

        #[cfg(debug_assertions)]
        #[test]
        fn without_an_access_group_a_debug_build_uses_the_login_keychain() {
            let fake = Fake {
                unsigned: true,
                ..Fake::default()
            };
            fake.add.borrow_mut().push(OK);
            // What SecItemCopyMatching answers in the data protection
            // keychain without the group: it must not be asked there at all.
            fake.copy.borrow_mut().push(Ok(b"v".to_vec()));
            fake.delete.borrow_mut().push(OK);

            assert_eq!(write(&fake, "s", "a", b"v"), Ok(()));
            assert_eq!(read(&fake, "s", "a"), Ok(Some(b"v".to_vec())));
            assert_eq!(delete(&fake, "s", "a"), Ok(()));
            assert_eq!(calls(&fake), ["add:login", "copy:login", "delete:login"]);
        }

        #[cfg(not(debug_assertions))]
        #[test]
        fn without_an_access_group_a_release_build_makes_no_call() {
            let fake = Fake {
                unsigned: true,
                ..Fake::default()
            };

            assert_eq!(write(&fake, "s", "a", b"v"), Err(MISSING_ENTITLEMENT));
            assert_eq!(read(&fake, "s", "a"), Err(MISSING_ENTITLEMENT));
            assert_eq!(delete(&fake, "s", "a"), Err(MISSING_ENTITLEMENT));
            assert!(calls(&fake).is_empty());
        }

        #[test]
        fn a_process_without_a_profile_has_no_access_group() {
            // The test binary is not signed with a provisioning profile; the
            // call itself must work and say so.
            assert!(!ffi::System.has_access_group());
        }

        #[cfg(debug_assertions)]
        #[test]
        fn login_keychain_items_carry_no_data_protection_attributes() {
            let mut item = identity(Keychain::Login, "s", "a");
            item.extend(content(Keychain::Login, b"x"));
            assert!(!item.contains(&Attr::UseDataProtectionKeychain));
            assert!(!item.contains(&Attr::AccessibleWhenUnlockedThisDeviceOnly));
        }

        #[test]
        fn a_missing_entitlement_is_reported_as_unavailable() {
            assert_eq!(message(MISSING_ENTITLEMENT, READ_FAILED), UNAVAILABLE);
            assert_eq!(message(-25308, READ_FAILED), READ_FAILED);
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod store {
    use super::{DELETE_FAILED, READ_FAILED, UNAVAILABLE, WRITE_FAILED};
    use keyring::{Entry, Error};

    fn entry(service: &str, account: &str) -> Result<Entry, String> {
        Entry::new(service, account).map_err(|_| UNAVAILABLE.to_string())
    }

    pub fn get(service: &str, account: &str) -> Result<Option<String>, String> {
        match entry(service, account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(Error::NoEntry) => Ok(None),
            Err(_) => Err(READ_FAILED.into()),
        }
    }

    pub fn set(service: &str, account: &str, value: &str) -> Result<(), String> {
        entry(service, account)?
            .set_password(value)
            .map_err(|_| WRITE_FAILED.to_string())
    }

    pub fn remove(service: &str, account: &str) -> Result<(), String> {
        match entry(service, account)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(_) => Err(DELETE_FAILED.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::validate_key;

    #[test]
    fn keys_are_short_plain_names() {
        for key in ["master_key", "refresh_token", "a.b-c_1"] {
            assert!(validate_key(key).is_ok(), "{key}");
        }
        for key in ["", "a/b", "a b", "ż", &"k".repeat(65)] {
            assert!(validate_key(key).is_err(), "{key:?}");
        }
    }
}

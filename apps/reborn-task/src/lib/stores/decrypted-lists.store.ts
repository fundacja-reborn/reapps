/**
 * Decrypted Lists Store
 *
 * This store provides reactive views of decrypted list data for UI components.
 * It subscribes to the encrypted listStore from @reborn/storage and automatically
 * decrypts the data using cryptoManager.
 *
 * Components should use this store instead of directly accessing the encrypted listStore.
 *
 * Data flow:
 * IndexedDB (encrypted) → listStore (@reborn/storage) → THIS STORE (decrypted) → UI Components
 */

import { writable, get } from 'svelte/store';
import { listStore } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import type { ListDecrypted } from '@reborn/types';
import { createLogger } from '@reborn/utils';

const logger = createLogger('DecryptedListsStore');

interface ListEncrypted {
	id: string;
	name_encrypted: string;
	order_index: number;
	is_default?: boolean;
	created_at: string;
	updated_at: string;
	deleted_at?: string | null;
	metadata_encrypted?: string;
}

interface ListMetadata {
	color?: string;
	icon?: string;
}

export const lists = writable<ListDecrypted[]>([]);

// --- LOKALNY DEBOUNCE ---
function debounce<T extends (...args: unknown[]) => void>(
	fn: T,
	delay: number
): (...args: Parameters<T>) => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return (...args: Parameters<T>) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	};
}
// --- KONIEC ---

// --- AUTOMATYCZNA SYNCHRONIZACJA ---
// Debounce, by nie wywoływać decryptów zbyt często przy batchach
const debouncedRefresh = debounce(refreshDecryptedLists, 50);
listStore.items.subscribe(() => {
	// Tylko jeśli cryptoManager jest zainicjalizowany
	if (cryptoManager.isInitialized()) {
		debouncedRefresh();
	}
});
// --- KONIEC ---

export async function refreshDecryptedLists() {
	if (!cryptoManager.isInitialized()) {
		logger.debug('CryptoManager not initialized, returning empty array');
		lists.set([]);
		return;
	}
	const $encryptedLists = get(listStore.items) as ListEncrypted[];
	const decrypted = await Promise.all(
		($encryptedLists || [])
			.filter((list: ListEncrypted) => !list.deleted_at)
			.map(async (list: ListEncrypted) => {
				try {
					const decrypted: ListDecrypted = {
						id: list.id,
						name: await cryptoManager.decryptText(list.name_encrypted),
						order_index: list.order_index,
						is_default: list.is_default ?? false,
						created_at: list.created_at,
						updated_at: list.updated_at,
						deleted_at: list.deleted_at || undefined
					};
					if (list.metadata_encrypted) {
						const metadata = (await cryptoManager.decryptObject(
							list.metadata_encrypted
						)) as ListMetadata;
						decrypted.color = metadata.color;
						decrypted.icon = metadata.icon;
					}
					return decrypted;
				} catch (error: unknown) {
					logger.error(`Failed to decrypt list ${list.id}:`, error);
					return null;
				}
			})
	);
	const validLists = (decrypted || [])
		.filter((list: ListDecrypted | null): list is ListDecrypted => list !== null)
		.sort((a: ListDecrypted, b: ListDecrypted) => a.order_index - b.order_index);
	lists.set(validLists);
}

export const activeLists = writable<ListDecrypted[]>([]);
lists.subscribe(($lists) => {
	activeLists.set($lists);
});

export const defaultList = writable<ListDecrypted | null>(null);
lists.subscribe(($lists) => {
	defaultList.set($lists.find((list) => list.is_default) || null);
});

export function listById(id: string) {
	const { subscribe, set } = writable<ListDecrypted | null>(null);
	lists.subscribe(($lists) => {
		set($lists.find((list) => list.id === id) || null);
	});
	return { subscribe };
}

export const taskListStore = {
	async loadLists() {
		logger.info('Triggering list store refresh');
		await listStore.refreshItems();
		await refreshDecryptedLists();
	}
};

export const decryptedLists = lists;
export const decryptedDefaultList = defaultList;
export const decryptedActiveLists = activeLists;

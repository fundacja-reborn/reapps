/**
 * Build a SearchContext for the operator-based search evaluator.
 *
 * Reads from the in-memory `lists` store synchronously — it already holds
 * decrypted ListDecrypted[] after unlock. No IndexedDB hit, no decryption:
 * the context is rebuilt per query and is cheap (linear in list count).
 *
 * Tasks have neither tags nor folders in this app, so the corresponding
 * resolvers stay empty — operators like `tag:` or `folder:` will resolve to
 * "no matches" (which negation can flip to "all"), matching the documented
 * graceful-degradation behavior.
 */
import { get } from 'svelte/store';
import type { SearchContext } from '@reborn/utils';
import { lists } from '$lib/stores/decrypted-lists.store';

export function buildTaskSearchContext(now: Date = new Date()): SearchContext {
	const listIdByName = new Map<string, string>();
	for (const list of get(lists)) {
		if (list.name) listIdByName.set(list.name.toLowerCase(), list.id);
	}

	return {
		tagIdByName: new Map(),
		folderIdByPath: new Map(),
		listIdByName,
		now
	};
}

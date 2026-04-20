/// <reference types="svelte" />
/// <reference types="vite/client" />

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	const __APP_VERSION__: string;

	namespace App {
		interface Error {
			isOffline?: boolean;
		}
		interface Locals {
			userId?: string;
			sessionId?: string;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window {
		__authInitialized?: boolean;
	}
}

// Module declarations for Svelte files
declare module '*.svelte' {
	import type { Component } from 'svelte';
	const component: Component;
	export default component;
}

declare module '*.svelte.ts';

export {};

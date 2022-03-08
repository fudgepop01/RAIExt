import * as vscode from 'vscode';
import { CacheManager } from './cacheManager';

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(new CacheManager());
	// context.subscriptions.push();
}

export function deactivate() {}

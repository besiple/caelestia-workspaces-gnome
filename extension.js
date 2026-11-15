'use strict';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class CaelestiaWorkspacesExtension extends Extension {
    async enable() {
        try {
            const cacheBuster = Date.now();
            const mod = await import(`file://${this.path}/caelestia_impl.js?v=${cacheBuster}`);
            this._impl = new mod.default(this);
            this._impl.enable();
            console.log('[Caelestia Workspaces] Extension enabled');
        } catch (e) {
            console.error('[Caelestia Workspaces] Failed to enable implementation:', e);
        }
    }

    disable() {
        if (this._impl) {
            try {
                this._impl.disable();
            } catch (e) {
                console.error('[Caelestia Workspaces] Error in disable:', e);
            }
            this._impl = null;
        }
        console.log('[Caelestia Workspaces] Extension disabled');
    }
}

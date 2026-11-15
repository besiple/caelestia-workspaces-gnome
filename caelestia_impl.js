'use strict';

import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import Clutter from 'gi://Clutter';

export default class CaelestiaImpl {
    constructor(extension) {
        this._extension = extension;
        this._origBaseDistanceDesc = null;
        this._origEaseProperty = null;
    }

    enable() {
        if (this._origBaseDistanceDesc)
            return;

        // 1. macOS Spaces: Zero gap between desktops (seamless edge-to-edge transition)
        this._origBaseDistanceDesc = Object.getOwnPropertyDescriptor(
            WorkspaceAnimation.MonitorGroup.prototype,
            'baseDistance'
        );

        Object.defineProperty(WorkspaceAnimation.MonitorGroup.prototype, 'baseDistance', {
            get() {
                const isVertical = global.workspace_manager.layout_rows === -1;
                // Seamless: full monitor dimension with 0px spacing (unlike GNOME's default 100px gap)
                return isVertical ? this._monitor.height : this._monitor.width;
            },
            configurable: true,
            enumerable: true,
        });

        // 2. macOS Spaces: Snappy, liquid-smooth Apple spring curve (EASE_OUT_QUAD, 280ms on 120Hz)
        // Eliminates the gummy ease-in start and dead-zone crawl at the end
        this._origEaseProperty = WorkspaceAnimation.MonitorGroup.prototype.ease_property;
        const origEaseProperty = this._origEaseProperty;

        WorkspaceAnimation.MonitorGroup.prototype.ease_property = function(property, value, params = {}) {
            if (property === 'progress') {
                const isKeyboardSwitch = params.duration === WorkspaceAnimation.WINDOW_ANIMATION_TIME;
                params = {
                    ...params,
                    duration: isKeyboardSwitch ? 280 : Math.max(220, Math.min(300, params.duration || 280)),
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                };
            }
            return origEaseProperty.call(this, property, value, params);
        };

        console.log('[macOS Spaces Workspaces] Liquid-smooth EASE_OUT_QUAD (280ms) active');
    }

    disable() {
        if (this._origBaseDistanceDesc) {
            Object.defineProperty(
                WorkspaceAnimation.MonitorGroup.prototype,
                'baseDistance',
                this._origBaseDistanceDesc
            );
            this._origBaseDistanceDesc = null;
        }

        if (this._origEaseProperty) {
            WorkspaceAnimation.MonitorGroup.prototype.ease_property = this._origEaseProperty;
            this._origEaseProperty = null;
        }

        console.log('[macOS Spaces Workspaces] Restored default GNOME animations');
    }
}

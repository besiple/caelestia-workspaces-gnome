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

        // 2. macOS Spaces: Apple fluid Ease-In-Ease-Out curve (~350ms)
        this._origEaseProperty = WorkspaceAnimation.MonitorGroup.prototype.ease_property;
        const origEaseProperty = this._origEaseProperty;

        WorkspaceAnimation.MonitorGroup.prototype.ease_property = function(property, value, params = {}) {
            if (property === 'progress') {
                const isKeyboardSwitch = params.duration === WorkspaceAnimation.WINDOW_ANIMATION_TIME;
                params = {
                    ...params,
                    duration: isKeyboardSwitch ? 350 : Math.max(280, params.duration || 350),
                    mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
                };
            }
            return origEaseProperty.call(this, property, value, params);
        };

        console.log('[macOS Spaces Workspaces] macOS Tahoe style seamless transition active');
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

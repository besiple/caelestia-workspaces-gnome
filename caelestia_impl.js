'use strict';

import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import Clutter from 'gi://Clutter';

const OVERSHOOT_PX = 18;
const SLIDE_MS = 220;
const RETURN_MS = 140;

function getBounceTranslation(group, delta) {
    const isVertical = global.workspace_manager.layout_rows === -1;
    const overshoot = Math.sign(delta) * OVERSHOOT_PX;

    if (isVertical)
        return { x: 0, y: -overshoot };

    if (group.get_text_direction() === Clutter.TextDirection.RTL)
        return { x: overshoot, y: 0 };

    return { x: -overshoot, y: 0 };
}

export default class CaelestiaImpl {
    constructor(extension) {
        this._extension = extension;
        this._origBaseDistanceDesc = null;
        this._origEaseProperty = null;
    }

    enable() {
        if (this._origBaseDistanceDesc)
            return;

        // 1. Seamless 0px gap between desktops
        this._origBaseDistanceDesc = Object.getOwnPropertyDescriptor(
            WorkspaceAnimation.MonitorGroup.prototype,
            'baseDistance'
        );

        Object.defineProperty(WorkspaceAnimation.MonitorGroup.prototype, 'baseDistance', {
            get() {
                const isVertical = global.workspace_manager.layout_rows === -1;
                return isVertical ? this._monitor.height : this._monitor.width;
            },
            configurable: true,
            enumerable: true,
        });

        // 2. Spring Overshoot: Slides briskly and bounces back with elastic momentum
        this._origEaseProperty = WorkspaceAnimation.MonitorGroup.prototype.ease_property;
        const origEaseProperty = this._origEaseProperty;

        WorkspaceAnimation.MonitorGroup.prototype.ease_property = function(property, value, params = {}) {
            if (property === 'progress') {
                const current = this.progress;
                const delta = value - current;

                // Reset any existing translation before starting a new transition
                if (this._container) {
                    this._container.remove_transition('translation_x');
                    this._container.remove_transition('translation_y');
                    this._container.translation_x = 0;
                    this._container.translation_y = 0;
                }

                // If delta is noticeable, perform physical spring overshoot
                if (Math.abs(delta) > 0.05 && this._container) {
                    const origOnComplete = params.onComplete;

                    origEaseProperty.call(this, property, value, {
                        ...params,
                        duration: SLIDE_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            if (!this._container || this.get_stage() === null) {
                                if (origOnComplete) origOnComplete();
                                return;
                            }

                            // Apply inertia overshoot
                            const { x, y } = getBounceTranslation(this, delta);
                            this._container.translation_x = x;
                            this._container.translation_y = y;

                            // Spring back into perfect resting position
                            this._container.ease({
                                translation_x: 0,
                                translation_y: 0,
                                duration: RETURN_MS,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                onComplete: () => {
                                    if (origOnComplete) origOnComplete();
                                },
                            });
                        },
                    });
                    return;
                }
            }

            return origEaseProperty.call(this, property, value, params);
        };

        console.log('[macOS Spaces Workspaces] Spring Overshoot animation active');
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

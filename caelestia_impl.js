'use strict';

import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

const OVERSHOOT_PX = 12;
const SLIDE_MS = 220;
const OVERSHOOT_MS = 75;
const RETURN_MS = 125;

function createStaticBackground(monitor) {
    const container = new Meta.BackgroundGroup({
        x: 0,
        y: 0,
        width: monitor.width,
        height: monitor.height,
    });
    const bgManager = new Background.BackgroundManager({
        container,
        monitorIndex: monitor.index,
        controlPosition: false,
    });
    container.connect('destroy', () => {
        bgManager.destroy();
    });
    return container;
}

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
        this._origMonitorInit = null;
        this._origBaseDistanceDesc = null;
        this._origEaseProperty = null;
    }

    enable() {
        if (this._origBaseDistanceDesc)
            return;

        const self = this;

        // 1. Shield layer: Insert background behind container to block underlying real windows from peeking through
        this._origMonitorInit = WorkspaceAnimation.MonitorGroup.prototype._init;
        WorkspaceAnimation.MonitorGroup.prototype._init = function(monitor, workspaceIndices, movingWindow) {
            self._origMonitorInit.call(this, monitor, workspaceIndices, movingWindow);
            this.insert_child_below(createStaticBackground(monitor), null);
        };

        // 2. Seamless 0px gap between desktops
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

        // 3. Continuous Spring Overshoot: Smooth glide into overshoot + smooth return (ZERO teleportation)
        this._origEaseProperty = WorkspaceAnimation.MonitorGroup.prototype.ease_property;
        const origEaseProperty = this._origEaseProperty;

        WorkspaceAnimation.MonitorGroup.prototype.ease_property = function(property, value, params = {}) {
            if (property === 'progress') {
                const current = this.progress;
                const delta = value - current;

                // Reset any existing translations before new transition
                if (this._container) {
                    this._container.remove_transition('translation_x');
                    this._container.remove_transition('translation_y');
                    this._container.translation_x = 0;
                    this._container.translation_y = 0;
                }

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

                            const { x, y } = getBounceTranslation(this, delta);

                            // Smooth continuous glide into overshoot (no instant frame jump)
                            this._container.ease({
                                translation_x: x,
                                translation_y: y,
                                duration: OVERSHOOT_MS,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                onComplete: () => {
                                    if (!this._container || this.get_stage() === null) {
                                        if (origOnComplete) origOnComplete();
                                        return;
                                    }

                                    // Smooth harmonic return to rest
                                    this._container.ease({
                                        translation_x: 0,
                                        translation_y: 0,
                                        duration: RETURN_MS,
                                        mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
                                        onComplete: () => {
                                            if (origOnComplete) origOnComplete();
                                        },
                                    });
                                },
                            });
                        },
                    });
                    return;
                }
            }

            return origEaseProperty.call(this, property, value, params);
        };

        console.log('[macOS Spaces Workspaces] Continuous Spring Overshoot active (zero artifacts)');
    }

    disable() {
        if (this._origMonitorInit) {
            WorkspaceAnimation.MonitorGroup.prototype._init = this._origMonitorInit;
            this._origMonitorInit = null;
        }

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

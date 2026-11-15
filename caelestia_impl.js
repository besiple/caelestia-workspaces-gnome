'use strict';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import Clutter from 'gi://Clutter';

const OVERSHOOT_PX = 10;
const SLIDE_MS = 220;
const OVERSHOOT_MS = 70;
const RETURN_MS = 120;

function getDocks() {
    const docks = [];
    try {
        const ext = Main.extensionManager?.lookup('dash2dock-lite@icedman.github.com');
        const stateObj = ext?.stateObj;
        if (stateObj?.docks && Array.isArray(stateObj.docks)) {
            for (const d of stateObj.docks) {
                if (d && typeof d.slideOut === 'function') {
                    docks.push(d);
                }
            }
        } else if (stateObj?.dock && typeof stateObj.dock.slideOut === 'function') {
            docks.push(stateObj.dock);
        }
    } catch (e) {
        console.error('[Caelestia Workspaces] Error getting docks:', e);
    }

    return docks;
}

function hideDocks() {
    const docks = getDocks();
    for (const dock of docks) {
        dock._switchingWorkspace = true;

        // Ensure slideIn is guarded during workspace switch
        if (!dock._caelestiaHooked) {
            dock._caelestiaHooked = true;
            const origSlideIn = dock.slideIn.bind(dock);
            dock.slideIn = function() {
                if (this._switchingWorkspace)
                    return;
                origSlideIn();
            };
        }

        dock.slideOut();
    }
}

function showDocks() {
    const docks = getDocks();
    for (const dock of docks) {
        dock._switchingWorkspace = false;
        if (dock.autohider && dock.extension?.autohide_dash) {
            dock.autohider._checkHide();
        } else if (typeof dock.slideIn === 'function') {
            dock.slideIn();
        }
    }
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
        this._origBaseDistanceDesc = null;
        this._origEaseProperty = null;
        this._origAnimateSwitch = null;
        this._origFinishWorkspaceSwitch = null;
        this._swipeTrackerBeginId = null;
        this._activeWsChangedId = null;
    }

    enable() {
        if (this._origBaseDistanceDesc)
            return;

        // 1. Seamless 0px gap between desktops (macOS Spaces style)
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

        // 2. Dock slideOut on keyboard shortcut switch
        const wsAnim = Main.wm?._workspaceAnimation;
        if (wsAnim) {
            this._origAnimateSwitch = wsAnim.animateSwitch;
            const origAnimateSwitch = this._origAnimateSwitch;
            wsAnim.animateSwitch = function(from, to, direction, onComplete) {
                hideDocks();
                return origAnimateSwitch.call(this, from, to, direction, onComplete);
            };

            // 3. Dock slideIn when switch finishes
            this._origFinishWorkspaceSwitch = wsAnim._finishWorkspaceSwitch;
            const origFinishWorkspaceSwitch = this._origFinishWorkspaceSwitch;
            wsAnim._finishWorkspaceSwitch = function(switchData) {
                const res = origFinishWorkspaceSwitch.call(this, switchData);
                showDocks();
                return res;
            };

            // 4. Touchpad gesture support via _swipeTracker 'begin'
            if (wsAnim._swipeTracker) {
                this._swipeTrackerBeginId = wsAnim._swipeTracker.connect('begin', () => {
                    hideDocks();
                });
            }
        }

        // 5. Fallback workspace change listener to ensure dock is never stuck hidden
        if (global.workspace_manager) {
            this._activeWsChangedId = global.workspace_manager.connect('active-workspace-changed', () => {
                // If not currently inside an active animation controller switch, ensure docks are shown
                if (!Main.wm?._workspaceAnimation?._switchData) {
                    showDocks();
                }
            });
        }

        // 6. Continuous Spring Overshoot: Smooth glide into overshoot + smooth return
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

        console.log('[Caelestia Workspaces] Connected macOS Spaces transition with Rust MacDock slideOut/slideIn');
    }

    disable() {
        showDocks();

        const wsAnim = Main.wm?._workspaceAnimation;
        if (wsAnim) {
            if (this._origAnimateSwitch) {
                wsAnim.animateSwitch = this._origAnimateSwitch;
                this._origAnimateSwitch = null;
            }

            if (this._origFinishWorkspaceSwitch) {
                wsAnim._finishWorkspaceSwitch = this._origFinishWorkspaceSwitch;
                this._origFinishWorkspaceSwitch = null;
            }

            if (this._swipeTrackerBeginId && wsAnim._swipeTracker) {
                wsAnim._swipeTracker.disconnect(this._swipeTrackerBeginId);
                this._swipeTrackerBeginId = null;
            }
        }

        if (this._activeWsChangedId && global.workspace_manager) {
            global.workspace_manager.disconnect(this._activeWsChangedId);
            this._activeWsChangedId = null;
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

        console.log('[Caelestia Workspaces] Restored default GNOME animations');
    }
}

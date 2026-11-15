'use strict';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import Clutter from 'gi://Clutter';

const OVERSHOOT_PX = 10;
const SLIDE_MS = 220;
const OVERSHOOT_MS = 70;
const RETURN_MS = 120;

let _dockHiddenBySwitch = false;

function getDocks() {
    const docks = [];
    try {
        const ext = Main.extensionManager?.lookup('dash2dock-lite@icedman.github.com');
        const stateObj = ext?.stateObj;
        if (stateObj?.docks) {
            for (const d of stateObj.docks) {
                if (d && d instanceof Clutter.Actor) {
                    docks.push(d);
                }
            }
        }
    } catch (e) {}

    // Fallback: search Main.layoutManager._chrome
    if (docks.length === 0 && Main.layoutManager?._chrome) {
        for (const actorData of Main.layoutManager._chrome) {
            const actor = actorData.actor;
            if (actor && (actor.has_style_class_name?.('dash') || actor.constructor?.name?.toLowerCase().includes('dock'))) {
                docks.push(actor);
            }
        }
    }
    return docks;
}

function hideDocks(duration = 180) {
    const docks = getDocks();
    if (docks.length === 0)
        return;

    _dockHiddenBySwitch = true;

    for (const dock of docks) {
        dock.remove_transition('translation_y');
        dock.remove_transition('opacity');

        const dist = (dock.height || 70) + 30;
        dock.ease({
            translation_y: dist,
            opacity: 0,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }
}

function showDocks(duration = 240) {
    if (!_dockHiddenBySwitch)
        return;

    _dockHiddenBySwitch = false;
    const docks = getDocks();

    for (const dock of docks) {
        dock.remove_transition('translation_y');
        dock.remove_transition('opacity');

        const shouldBeVisible = !dock._hidden;

        dock.ease({
            translation_y: 0,
            opacity: shouldBeVisible ? 255 : 0,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (dock.extension?.checkHide) {
                    dock.extension.checkHide();
                }
            },
        });
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
        this._origSwitchWorkspaceBegin = null;
        this._origFinishWorkspaceSwitch = null;
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

        // 2. Dock Ducking on keyboard switch
        this._origAnimateSwitch = WorkspaceAnimation.WorkspaceAnimationController.prototype.animateSwitch;
        const origAnimateSwitch = this._origAnimateSwitch;
        WorkspaceAnimation.WorkspaceAnimationController.prototype.animateSwitch = function(from, to, direction, onComplete) {
            hideDocks(180);
            return origAnimateSwitch.call(this, from, to, direction, onComplete);
        };

        // 3. Dock Ducking on touchpad gesture swipe
        this._origSwitchWorkspaceBegin = WorkspaceAnimation.WorkspaceAnimationController.prototype._switchWorkspaceBegin;
        const origSwitchWorkspaceBegin = this._origSwitchWorkspaceBegin;
        WorkspaceAnimation.WorkspaceAnimationController.prototype._switchWorkspaceBegin = function(tracker, monitor) {
            hideDocks(180);
            return origSwitchWorkspaceBegin.call(this, tracker, monitor);
        };

        // 4. Dock Return when switch finishes
        this._origFinishWorkspaceSwitch = WorkspaceAnimation.WorkspaceAnimationController.prototype._finishWorkspaceSwitch;
        const origFinishWorkspaceSwitch = this._origFinishWorkspaceSwitch;
        WorkspaceAnimation.WorkspaceAnimationController.prototype._finishWorkspaceSwitch = function(switchData) {
            showDocks(240);
            return origFinishWorkspaceSwitch.call(this, switchData);
        };

        // 5. Continuous Spring Overshoot: Smooth glide into overshoot + smooth return
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

        console.log('[macOS Spaces Workspaces] Connected with Dock ducking & Spring Overshoot');
    }

    disable() {
        showDocks(100);

        if (this._origBaseDistanceDesc) {
            Object.defineProperty(
                WorkspaceAnimation.MonitorGroup.prototype,
                'baseDistance',
                this._origBaseDistanceDesc
            );
            this._origBaseDistanceDesc = null;
        }

        if (this._origAnimateSwitch) {
            WorkspaceAnimation.WorkspaceAnimationController.prototype.animateSwitch = this._origAnimateSwitch;
            this._origAnimateSwitch = null;
        }

        if (this._origSwitchWorkspaceBegin) {
            WorkspaceAnimation.WorkspaceAnimationController.prototype._switchWorkspaceBegin = this._origSwitchWorkspaceBegin;
            this._origSwitchWorkspaceBegin = null;
        }

        if (this._origFinishWorkspaceSwitch) {
            WorkspaceAnimation.WorkspaceAnimationController.prototype._finishWorkspaceSwitch = this._origFinishWorkspaceSwitch;
            this._origFinishWorkspaceSwitch = null;
        }

        if (this._origEaseProperty) {
            WorkspaceAnimation.MonitorGroup.prototype.ease_property = this._origEaseProperty;
            this._origEaseProperty = null;
        }

        console.log('[macOS Spaces Workspaces] Restored default GNOME animations');
    }
}

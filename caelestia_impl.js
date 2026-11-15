'use strict';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

export default class CaelestiaImpl {
    constructor(extension) {
        this._extension = extension;
        this._origProgressDesc = null;
        this._origAnimateSwitch = null;
        this._origSwitchWorkspaceEnd = null;
    }

    enable() {
        this._origProgressDesc = Object.getOwnPropertyDescriptor(
            WorkspaceAnimation.MonitorGroup.prototype,
            'progress'
        );
        this._origAnimateSwitch = WorkspaceAnimation.WorkspaceAnimationController.prototype.animateSwitch;
        this._origSwitchWorkspaceEnd = WorkspaceAnimation.WorkspaceAnimationController.prototype._switchWorkspaceEnd;

        // 1. Caelestia Slidefade 20% Progress Logic
        Object.defineProperty(WorkspaceAnimation.MonitorGroup.prototype, 'progress', {
            get() {
                return this._caelestiaProgress !== undefined ? this._caelestiaProgress : 0;
            },
            set(p) {
                this._caelestiaProgress = p;

                this._container.x = 0;
                this._container.y = 0;

                const isVertical = global.workspace_manager.layout_rows === -1;
                const baseDim = isVertical
                    ? (this._monitor.height || 1080)
                    : (this._monitor.width || 1920);

                // Caelestia slidefade ratio: 20% slide offset
                const slideDistance = baseDim * 0.20;

                if (this._workspaceGroups) {
                    for (const group of this._workspaceGroups) {
                        if (!group || !group.workspace) continue;

                        // Static wallpaper: hide the clone so desktop wallpaper stays fixed
                        if (group._background) {
                            group._background.opacity = 0;
                        }

                        const targetProgress = this._getWorkspaceGroupProgress(group);
                        const delta = p - targetProgress;
                        const absDelta = Math.abs(delta);

                        if (absDelta >= 1.0) {
                            group.visible = false;
                            group.opacity = 0;
                        } else {
                            group.visible = true;
                            // Smooth crossfade
                            const alpha = 1.0 - absDelta;
                            group.opacity = Math.max(0, Math.min(255, Math.round(255 * alpha)));

                            // 20% slide offset
                            const offset = -Math.round(delta * slideDistance);
                            if (isVertical) {
                                group.set_position(0, offset);
                            } else if (this.get_text_direction() === Clutter.TextDirection.RTL) {
                                group.set_position(-offset, 0);
                            } else {
                                group.set_position(offset, 0);
                            }
                        }
                    }
                }

                this.notify('progress');
            },
            configurable: true,
            enumerable: true,
        });

        // 2. Custom animateSwitch with Caelestia smooth deceleration easing
        WorkspaceAnimation.WorkspaceAnimationController.prototype.animateSwitch = function(from, to, direction, onComplete) {
            this._swipeTracker.enabled = false;

            let workspaceIndices = [];

            switch (direction) {
            case Meta.MotionDirection.UP:
            case Meta.MotionDirection.LEFT:
            case Meta.MotionDirection.UP_LEFT:
            case Meta.MotionDirection.UP_RIGHT:
                workspaceIndices = [to, from];
                break;

            case Meta.MotionDirection.DOWN:
            case Meta.MotionDirection.RIGHT:
            case Meta.MotionDirection.DOWN_LEFT:
            case Meta.MotionDirection.DOWN_RIGHT:
                workspaceIndices = [from, to];
                break;
            }

            if (Clutter.get_default_text_direction() === Clutter.TextDirection.RTL &&
                direction !== Meta.MotionDirection.UP &&
                direction !== Meta.MotionDirection.DOWN)
                workspaceIndices.reverse();

            this._prepareWorkspaceSwitch(workspaceIndices);
            this._switchData.inProgress = true;

            const fromWs = global.workspace_manager.get_workspace_by_index(from);
            const toWs = global.workspace_manager.get_workspace_by_index(to);

            for (const monitorGroup of this._switchData.monitors) {
                monitorGroup.progress = monitorGroup.getWorkspaceProgress(fromWs);
                const progress = monitorGroup.getWorkspaceProgress(toWs);

                // Caelestia fluid curve & duration (~380ms decel)
                const params = {
                    duration: 380,
                    mode: Clutter.AnimationMode.EASE_OUT_EXPO,
                };

                if (monitorGroup.index === Main.layoutManager.primaryIndex) {
                    params.onComplete = () => {
                        this._finishWorkspaceSwitch(this._switchData);
                        onComplete();
                        this._swipeTracker.enabled = true;
                    };
                }

                monitorGroup.ease_property('progress', progress, params);
            }
        };

        // 3. Touchpad swipe completion with Caelestia curve
        WorkspaceAnimation.WorkspaceAnimationController.prototype._switchWorkspaceEnd = function(tracker, duration, endProgress) {
            if (!this._switchData)
                return;

            const switchData = this._switchData;
            switchData.gestureActivated = true;

            const newWs = switchData.baseMonitorGroup.findClosestWorkspace(endProgress);
            const endTime = Clutter.get_current_event_time();

            for (const monitorGroup of this._switchData.monitors) {
                const progress = monitorGroup.getWorkspaceProgress(newWs);

                const params = {
                    duration: Math.max(320, duration),
                    mode: Clutter.AnimationMode.EASE_OUT_EXPO,
                };

                if (monitorGroup.index === Main.layoutManager.primaryIndex) {
                    params.onComplete = () => {
                        if (!newWs.active)
                            newWs.activate(endTime);
                        this._finishWorkspaceSwitch(switchData);
                    };
                }

                monitorGroup.ease_property('progress', progress, params);
            }
        };

        console.log('[Caelestia Workspaces] Implementation active (Slidefade 20%)');
    }

    disable() {
        if (this._origProgressDesc) {
            Object.defineProperty(
                WorkspaceAnimation.MonitorGroup.prototype,
                'progress',
                this._origProgressDesc
            );
            this._origProgressDesc = null;
        }

        if (this._origAnimateSwitch) {
            WorkspaceAnimation.WorkspaceAnimationController.prototype.animateSwitch = this._origAnimateSwitch;
            this._origAnimateSwitch = null;
        }

        if (this._origSwitchWorkspaceEnd) {
            WorkspaceAnimation.WorkspaceAnimationController.prototype._switchWorkspaceEnd = this._origSwitchWorkspaceEnd;
            this._origSwitchWorkspaceEnd = null;
        }

        console.log('[Caelestia Workspaces] Implementation disabled (default GNOME animation restored)');
    }
}

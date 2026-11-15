'use strict';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

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

export default class CaelestiaImpl {
    constructor(extension) {
        this._extension = extension;
        this._origMonitorInit = null;
        this._origProgressDesc = null;
        this._origEaseProperty = null;
    }

    enable() {
        if (this._origMonitorInit)
            return;

        const self = this;

        // 1. MonitorGroup._init: Static wallpaper & transparent container
        this._origMonitorInit = WorkspaceAnimation.MonitorGroup.prototype._init;
        WorkspaceAnimation.MonitorGroup.prototype._init = function(monitor, workspaceIndices, movingWindow) {
            self._origMonitorInit.call(this, monitor, workspaceIndices, movingWindow);

            // Transparent background for MonitorGroup widget (overrides black CSS background)
            this.set_style('background-color: transparent;');

            // Hide moving wallpaper clones on each workspace
            if (this._workspaceGroups) {
                for (const group of this._workspaceGroups) {
                    if (group._background) {
                        group._background.opacity = 0;
                        group._background.visible = false;
                    }
                }
            }

            // Insert single stationary wallpaper below all windows
            this.insert_child_below(createStaticBackground(monitor), null);
        };

        // 2. MonitorGroup.progress: Authentic Caelestia slide over static wallpaper
        this._origProgressDesc = Object.getOwnPropertyDescriptor(
            WorkspaceAnimation.MonitorGroup.prototype,
            'progress'
        );

        const origProgressDesc = this._origProgressDesc;

        Object.defineProperty(WorkspaceAnimation.MonitorGroup.prototype, 'progress', {
            get() {
                return origProgressDesc.get.call(this);
            },
            set(p) {
                // Keep stock progress setter intact (slides _container across screen)
                origProgressDesc.set.call(this, p);

                if (!this._workspaceGroups)
                    return;

                for (const group of this._workspaceGroups) {
                    if (!group || !group.workspace)
                        continue;

                    // Ensure wallpaper clone stays hidden so only static wallpaper shows
                    if (group._background && group._background.visible) {
                        group._background.visible = false;
                        group._background.opacity = 0;
                    }

                    // Windows stay solid and visible throughout the slide transition
                    group.visible = true;
                    group.opacity = 255;
                    group.translation_x = 0;
                    group.translation_y = 0;
                }
            },
            configurable: true,
            enumerable: true,
        });

        // 3. MonitorGroup.ease_property: Caelestia smooth deceleration curve (EASE_OUT_EXPO, 380ms)
        this._origEaseProperty = WorkspaceAnimation.MonitorGroup.prototype.ease_property;
        const origEaseProperty = this._origEaseProperty;

        WorkspaceAnimation.MonitorGroup.prototype.ease_property = function(property, value, params = {}) {
            if (property === 'progress') {
                const isShortAnimation = params.duration === WorkspaceAnimation.WINDOW_ANIMATION_TIME;
                params = {
                    ...params,
                    duration: isShortAnimation ? 380 : Math.max(300, params.duration || 380),
                    mode: Clutter.AnimationMode.EASE_OUT_EXPO,
                };
            }
            return origEaseProperty.call(this, property, value, params);
        };

        console.log('[Caelestia Workspaces] Authentic Caelestia Slide (static wallpaper + expo decel) active');
    }

    disable() {
        if (this._origMonitorInit) {
            WorkspaceAnimation.MonitorGroup.prototype._init = this._origMonitorInit;
            this._origMonitorInit = null;
        }

        if (this._origProgressDesc) {
            Object.defineProperty(
                WorkspaceAnimation.MonitorGroup.prototype,
                'progress',
                this._origProgressDesc
            );
            this._origProgressDesc = null;
        }

        if (this._origEaseProperty) {
            WorkspaceAnimation.MonitorGroup.prototype.ease_property = this._origEaseProperty;
            this._origEaseProperty = null;
        }

        console.log('[Caelestia Workspaces] Restored default GNOME animations');
    }
}

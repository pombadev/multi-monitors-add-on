/*
Copyright (C) 2014  spin83

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, visit https://www.gnu.org/licenses/.
*/

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Convenience from './convenience.js';
import * as MMLayout from './mmlayout.js';
import * as MMOverview from './mmoverview.js';
import * as MMIndicator from './indicator.js';

const OVERRIDE_SCHEMA = 'org.gnome.shell.overrides';
const MUTTER_SCHEMA = 'org.gnome.mutter';
const WORKSPACES_ONLY_ON_PRIMARY_ID = 'workspaces-only-on-primary';

const SHOW_INDICATOR_ID = 'show-indicator';
const THUMBNAILS_SLIDER_POSITION_ID = 'thumbnails-slider-position';

// Animation time used when syncing workspace geometry across monitors (ms).
const ANIMATION_TIME = 250;

/**
 * copyClass – copy prototype methods from source class s into destination d.
 * Used to inherit behaviour from GNOME Shell internal classes without ES class
 * `extends` (which would require GObject registration of the base class).
 */
export function copyClass(s, d) {
    let propertyNames = Reflect.ownKeys(s.prototype);
    for (let pName of propertyNames.values()) {
        if (typeof pName === 'symbol') continue;
        if (d.prototype.hasOwnProperty(pName)) continue;
        if (pName === 'prototype') continue;
        if (pName === 'constructor') continue;
        let pDesc = Reflect.getOwnPropertyDescriptor(s.prototype, pName);
        if (typeof pDesc !== 'object') continue;
        Reflect.defineProperty(d.prototype, pName, pDesc);
    }
}

class MultiMonitorsAddOn {

    constructor() {
        this._settings = Convenience.getSettings();
        this._mu_settings = new Gio.Settings({ schema: MUTTER_SCHEMA });

        // Legacy overrides schema – may not exist on newer GNOME versions.
        try {
            this._ov_settings = new Gio.Settings({ schema: OVERRIDE_SCHEMA });
        } catch (_e) {
            this._ov_settings = null;
        }

        this.mmIndicator = null;
        Main.mmOverview = null;
        Main.mmLayoutManager = null;

        this._mmMonitors = 0;
        this.syncWorkspacesActualGeometry = null;
    }

    _showIndicator() {
        if (this._settings.get_boolean(SHOW_INDICATOR_ID)) {
            if (!this.mmIndicator) {
                this.mmIndicator = Main.panel.addToStatusArea(
                    'MultiMonitorsAddOn',
                    new MMIndicator.MultiMonitorsIndicator());
            }
        } else {
            this._hideIndicator();
        }
    }

    _hideIndicator() {
        if (this.mmIndicator) {
            this.mmIndicator.destroy();
            this.mmIndicator = null;
        }
    }

    _showThumbnailsSlider() {
        if (this._settings.get_string(THUMBNAILS_SLIDER_POSITION_ID) === 'none') {
            this._hideThumbnailsSlider();
            return;
        }

        const muOnly = this._mu_settings.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID);
        const ovOnly = this._ov_settings?.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID) ?? false;
        if (muOnly)
            this._mu_settings.set_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID, false);
        if (ovOnly)
            this._ov_settings.set_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID, false);

        if (Main.mmOverview)
            return;

        Main.mmOverview = [];
        for (let idx = 0; idx < Main.layoutManager.monitors.length; idx++) {
            if (idx !== Main.layoutManager.primaryIndex) {
                Main.mmOverview[idx] = new MMOverview.MultiMonitorsOverview(idx);
            }
        }

        // Monkey-patch WorkspacesDisplay._syncWorkspacesActualGeometry so that
        // secondary-monitor workspace views are repositioned to make room for
        // the thumbnails slider.
        const controls = Main.overview._overview?._controls;
        const workspacesDisplay = controls?._workspacesDisplay;
        if (workspacesDisplay?._syncWorkspacesActualGeometry) {
            this.syncWorkspacesActualGeometry =
                workspacesDisplay._syncWorkspacesActualGeometry.bind(workspacesDisplay);
            workspacesDisplay._syncWorkspacesActualGeometry = function () {
                if (this._inWindowFade)
                    return;

                const primaryView = this._getPrimaryView?.();
                if (primaryView) {
                    primaryView.ease({
                        ...this._actualGeometry,
                        duration: Main.overview.animationInProgress ? ANIMATION_TIME : 0,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }

                for (let idx = 0; idx < Main.mmOverview.length; idx++) {
                    if (!Main.mmOverview[idx])
                        continue;
                    if (!Main.mmOverview[idx]._overview)
                        continue;
                    const mmView =
                        Main.mmOverview[idx]._overview._controls?._workspacesViews ?? null;
                    if (!mmView)
                        continue;

                    const mmGeometry =
                        Main.mmOverview[idx].getWorkspacesActualGeometry();
                    if (!mmGeometry)
                        continue;
                    mmView.ease({
                        ...mmGeometry,
                        duration: Main.overview.animationInProgress ? ANIMATION_TIME : 0,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
            };
        }
    }

    _hideThumbnailsSlider() {
        if (!Main.mmOverview)
            return;

        for (let idx = 0; idx < Main.mmOverview.length; idx++) {
            if (Main.mmOverview[idx])
                Main.mmOverview[idx].destroy();
        }
        Main.mmOverview = null;

        // Restore the original _syncWorkspacesActualGeometry if we patched it.
        const controls = Main.overview._overview?._controls;
        const workspacesDisplay = controls?._workspacesDisplay;
        if (workspacesDisplay && this.syncWorkspacesActualGeometry) {
            workspacesDisplay._syncWorkspacesActualGeometry =
                this.syncWorkspacesActualGeometry;
            this.syncWorkspacesActualGeometry = null;
        }
    }

    _relayout() {
        if (this._mmMonitors !== Main.layoutManager.monitors.length) {
            this._mmMonitors = Main.layoutManager.monitors.length;
            global.log('pi:' + Main.layoutManager.primaryIndex);
            for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
                let monitor = Main.layoutManager.monitors[i];
                global.log('i:' + i + ' x:' + monitor.x + ' y:' + monitor.y +
                           ' w:' + monitor.width + ' h:' + monitor.height);
            }
            this._hideThumbnailsSlider();
            this._showThumbnailsSlider();
        }
    }

    _switchOffThumbnails() {
        const muOnly = this._mu_settings.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID);
        const ovOnly = this._ov_settings?.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID) ?? false;
        if (muOnly || ovOnly)
            this._settings.set_string(THUMBNAILS_SLIDER_POSITION_ID, 'none');
    }

    enable(version) {
        global.log('Enable Multi Monitors Add-On (' + version + ')...');

        if (Main.panel.statusArea.MultiMonitorsAddOn)
            this.disable();

        this._mmMonitors = 0;

        if (this._ov_settings) {
            this._switchOffThumbnailsOvId = this._ov_settings.connect(
                'changed::' + WORKSPACES_ONLY_ON_PRIMARY_ID,
                this._switchOffThumbnails.bind(this));
        }
        this._switchOffThumbnailsMuId = this._mu_settings.connect(
            'changed::' + WORKSPACES_ONLY_ON_PRIMARY_ID,
            this._switchOffThumbnails.bind(this));

        this._showIndicatorId = this._settings.connect(
            'changed::' + SHOW_INDICATOR_ID,
            this._showIndicator.bind(this));
        this._showIndicator();

        Main.mmLayoutManager = new MMLayout.MultiMonitorsLayoutManager();
        this._showPanelId = this._settings.connect(
            'changed::' + MMLayout.SHOW_PANEL_ID,
            Main.mmLayoutManager.showPanel.bind(Main.mmLayoutManager));
        Main.mmLayoutManager.showPanel();

        this._thumbnailsSliderPositionId = this._settings.connect(
            'changed::' + THUMBNAILS_SLIDER_POSITION_ID,
            this._showThumbnailsSlider.bind(this));
        this._relayoutId = Main.layoutManager.connect(
            'monitors-changed',
            this._relayout.bind(this));
        this._relayout();
    }

    disable() {
        Main.layoutManager.disconnect(this._relayoutId);
        if (this._switchOffThumbnailsOvId)
            this._ov_settings?.disconnect(this._switchOffThumbnailsOvId);
        this._mu_settings.disconnect(this._switchOffThumbnailsMuId);

        this._settings.disconnect(this._showPanelId);
        this._settings.disconnect(this._thumbnailsSliderPositionId);
        this._settings.disconnect(this._showIndicatorId);

        this._hideIndicator();

        Main.mmLayoutManager.hidePanel();
        Main.mmLayoutManager = null;

        this._hideThumbnailsSlider();
        this._mmMonitors = 0;

        global.log('Disable Multi Monitors Add-On ...');
    }
}

export default class MultiMonitorsExtension extends Extension {
    enable() {
        Convenience.init(this);
        this.initTranslations();

        const metaVersion = this.metadata['version'];
        let version;
        if (Number.isFinite(metaVersion)) {
            version = 'v' + Math.trunc(metaVersion);
            switch (Math.round((metaVersion % 1) * 10)) {
            case 0:
                break;
            case 1:
                version += '+bugfix';
                break;
            case 2:
                version += '+develop';
                break;
            default:
                version += '+modified';
                break;
            }
        } else {
            version = String(metaVersion);
        }

        this._multiMonitorsAddOn = new MultiMonitorsAddOn();
        this._multiMonitorsAddOn.enable(version);
    }

    disable() {
        if (this._multiMonitorsAddOn) {
            this._multiMonitorsAddOn.disable();
            this._multiMonitorsAddOn = null;
        }
        Convenience.init(null);
    }
}

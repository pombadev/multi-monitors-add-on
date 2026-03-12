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

// Note: In GNOME 43+, EventsSection and NotificationSection were removed from
// the date menu. This module provides a simplified date menu button for
// secondary monitors showing clock and calendar only.

import Clutter from 'gi://Clutter';
import GnomeDesktop from 'gi://GnomeDesktop';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as DateMenu from 'resource:///org/gnome/shell/ui/dateMenu.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Extension from './extension.js';

// Helper: convert a GLib.DateTime to a JS Date.
function _GDateTimeToDate(datetime) {
    return new Date(datetime.to_unix() * 1000);
}

export const MultiMonitorsCalendar = (() => {
    let MultiMonitorsCalendar = class MultiMonitorsCalendar extends St.Widget {
        _init() {
            this._weekStart = Shell.util_get_week_start();
            this._settings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.calendar',
            });

            this._showWeekdateKeyId = this._settings.connect(
                'changed::' + Calendar.SHOW_WEEKDATE_KEY,
                this._onSettingsChange.bind(this));
            this._useWeekdate =
                this._settings.get_boolean(Calendar.SHOW_WEEKDATE_KEY);

            this._headerFormatWithoutYear = _('%OB');
            this._headerFormat = _('%OB %Y');

            // Start off with the current date
            this._selectedDate = new Date();

            this._shouldDateGrabFocus = false;

            super._init({
                style_class: 'calendar',
                layout_manager: new Clutter.GridLayout(),
                reactive: true,
            });

            this._buildHeader();
            this.connect('destroy', this._onDestroy.bind(this));
        }

        _onDestroy() {
            this._settings.disconnect(this._showWeekdateKeyId);
        }
    };

    Extension.copyClass(Calendar.Calendar, MultiMonitorsCalendar);
    return GObject.registerClass({
        Signals: {
            'selected-date-changed': {
                param_types: [GLib.DateTime.$gtype],
            },
        },
    }, MultiMonitorsCalendar);
})();

export const MultiMonitorsDateMenuButton = (() => {
    let MultiMonitorsDateMenuButton =
        class MultiMonitorsDateMenuButton extends PanelMenu.Button {
        _init() {
            super._init(0.5);

            this._clockDisplay = new St.Label({ style_class: 'clock' });
            this._clockDisplay.clutter_text.y_align = Clutter.ActorAlign.CENTER;
            this._clockDisplay.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

            let box = new St.BoxLayout({ style_class: 'clock-display-box' });
            box.add_child(this._clockDisplay);

            this.label_actor = this._clockDisplay;
            this.add_child(box);
            this.add_style_class_name('clock-display');

            // Menu contents
            let bin = new St.Widget({ x_expand: true, y_expand: true });
            // Minimal PopupMenuItem compatibility
            bin._delegate = this;
            this.menu.box.add_child(bin);

            let hbox = new St.BoxLayout({
                name: 'calendarArea',
                x_expand: true,
            });
            bin.add_child(hbox);

            // Calendar column
            let vbox = new St.BoxLayout({
                style_class: 'datemenu-calendar-column',
                vertical: true,
                x_expand: true,
            });
            hbox.add_child(vbox);

            this._calendar = new MultiMonitorsCalendar();
            this._calendar.connect('selected-date-changed', (_cal, datetime) => {
                let date = _GDateTimeToDate(datetime);
                this._date?.setDate(date);
            });

            // TodayButton may not exist in all GNOME 45+ builds.
            try {
                this._date = new DateMenu.TodayButton(this._calendar);
                vbox.add_child(this._date);
            } catch (_e) {
                this._date = null;
            }

            vbox.add_child(this._calendar);

            this.menu.connect('open-state-changed', (_menu, isOpen) => {
                if (isOpen) {
                    let now = new Date();
                    this._calendar.setDate(now);
                    this._date?.setDate(now);
                }
            });

            this._clock = new GnomeDesktop.WallClock();
            this._clock.bind_property(
                'clock',
                this._clockDisplay,
                'text',
                GObject.BindingFlags.SYNC_CREATE);
            this._clockNotifyTimezoneId = this._clock.connect(
                'notify::timezone',
                this._updateTimeZone.bind(this));

            this._sessionModeUpdatedId = Main.sessionMode.connect(
                'updated',
                this._sessionUpdated.bind(this));
            this._sessionUpdated();
        }

        _onDestroy() {
            Main.sessionMode.disconnect(this._sessionModeUpdatedId);
            this._clock.disconnect(this._clockNotifyTimezoneId);
            super._onDestroy();
        }
    };

    Extension.copyClass(DateMenu.DateMenuButton, MultiMonitorsDateMenuButton);
    return GObject.registerClass(MultiMonitorsDateMenuButton);
})();

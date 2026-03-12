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

// Preferences UI for GNOME 45+ (GTK4 + libadwaita).
// GTK3-specific APIs (Gtk.HBox, Gtk.Toolbar, Gtk.ToolButton, Gtk.STOCK_*)
// and the old buildPrefsWidget() / init() pattern are replaced.

import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/shell/extensions/prefs.js';

const SHOW_INDICATOR_ID = 'show-indicator';
const SHOW_PANEL_ID = 'show-panel';
const SHOW_ACTIVITIES_ID = 'show-activities';
const SHOW_DATE_TIME_ID = 'show-date-time';
const THUMBNAILS_SLIDER_POSITION_ID = 'thumbnails-slider-position';
const AVAILABLE_INDICATORS_ID = 'available-indicators';
const TRANSFER_INDICATORS_ID = 'transfer-indicators';
const ENABLE_HOT_CORNERS = 'enable-hot-corners';

const Columns = {
    INDICATOR_NAME: 0,
    MONITOR_NUMBER: 1,
};

// ---------------------------------------------------------------------------
// IndicatorsTransferWidget – shows the list of transferred indicators with
// add / remove buttons. Uses Gtk.TreeView (deprecated but functional in GTK4).
// ---------------------------------------------------------------------------
const IndicatorsTransferWidget = GObject.registerClass(
class IndicatorsTransferWidget extends Gtk.Box {
    _init(settings) {
        super._init({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 0,
        });

        this._settings = settings;

        this._store = new Gtk.ListStore();
        this._store.set_column_types([GObject.TYPE_STRING, GObject.TYPE_INT]);

        this._treeView = new Gtk.TreeView({
            model: this._store,
            hexpand: true,
            vexpand: true,
            height_request: 160,
        });
        this._treeView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);

        let appColumn = new Gtk.TreeViewColumn({
            expand: true,
            sort_column_id: Columns.INDICATOR_NAME,
            title: _('A list of indicators for transfer to additional monitors.'),
        });

        let nameRenderer = new Gtk.CellRendererText();
        appColumn.pack_start(nameRenderer, true);
        appColumn.add_attribute(nameRenderer, 'text', Columns.INDICATOR_NAME);

        let monitorRenderer = new Gtk.CellRendererText();
        appColumn.pack_start(monitorRenderer, true);
        appColumn.add_attribute(monitorRenderer, 'text', Columns.MONITOR_NUMBER);

        this._treeView.append_column(appColumn);
        this.append(this._treeView);

        // Toolbar row with add / remove buttons (GTK4: use Gtk.Box + Gtk.Button)
        let toolbar = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 0,
        });
        toolbar.add_css_class('toolbar');

        let addTButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            has_frame: false,
        });
        addTButton.connect('clicked', this._addIndicator.bind(this));
        toolbar.append(addTButton);

        let removeTButton = new Gtk.Button({
            icon_name: 'list-remove-symbolic',
            has_frame: false,
        });
        removeTButton.connect('clicked', this._removeIndicator.bind(this));
        toolbar.append(removeTButton);

        this.append(toolbar);

        this._changedTransferId = this._settings.connect(
            'changed::' + TRANSFER_INDICATORS_ID,
            this._updateIndicators.bind(this));
        this._updateIndicators();

        this.connect('destroy', this._onDestroy.bind(this));
    }

    _onDestroy() {
        if (this._changedTransferId) {
            this._settings.disconnect(this._changedTransferId);
            this._changedTransferId = 0;
        }
    }

    _updateIndicators() {
        this._store.clear();
        let transfers =
            this._settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
        for (let indicator in transfers) {
            if (transfers.hasOwnProperty(indicator)) {
                let monitor = transfers[indicator];
                let iter = this._store.append();
                this._store.set(
                    iter,
                    [Columns.INDICATOR_NAME, Columns.MONITOR_NUMBER],
                    [indicator, monitor]);
            }
        }
    }

    _addIndicator() {
        let dialog = new Gtk.Dialog({
            title: _('Select indicator'),
            transient_for: this.get_root(),
            modal: true,
            use_header_bar: 1,
        });
        dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        dialog.add_button(_('Add'), Gtk.ResponseType.OK);
        dialog.set_default_response(Gtk.ResponseType.OK);

        let grid = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
            spacing: 10,
        });

        dialog._store = new Gtk.ListStore();
        dialog._store.set_column_types([GObject.TYPE_STRING]);

        dialog._treeView = new Gtk.TreeView({
            model: dialog._store,
            hexpand: true,
            vexpand: true,
        });
        dialog._treeView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);

        let appColumn = new Gtk.TreeViewColumn({
            expand: true,
            sort_column_id: Columns.INDICATOR_NAME,
            title: _('Indicators on Top Panel'),
        });

        let nameRenderer = new Gtk.CellRendererText();
        appColumn.pack_start(nameRenderer, true);
        appColumn.add_attribute(nameRenderer, 'text', Columns.INDICATOR_NAME);

        dialog._treeView.append_column(appColumn);

        let availableIndicators = () => {
            let transfers =
                this._settings.get_value(TRANSFER_INDICATORS_ID).unpack();
            dialog._store.clear();
            this._settings.get_strv(AVAILABLE_INDICATORS_ID).forEach(
                indicator => {
                    if (!transfers.hasOwnProperty(indicator)) {
                        let iter = dialog._store.append();
                        dialog._store.set(
                            iter,
                            [Columns.INDICATOR_NAME],
                            [indicator]);
                    }
                });
        };

        let availableIndicatorsId = this._settings.connect(
            'changed::' + AVAILABLE_INDICATORS_ID, availableIndicators);
        let transferIndicatorsId = this._settings.connect(
            'changed::' + TRANSFER_INDICATORS_ID, availableIndicators);

        availableIndicators();
        grid.append(dialog._treeView);

        // Monitor index spinner
        let monitorRow = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            margin_top: 10,
            spacing: 20,
            hexpand: true,
        });
        let gLabel = new Gtk.Label({
            label: _('Monitor index:'),
            halign: Gtk.Align.START,
        });
        monitorRow.append(gLabel);

        // Determine number of monitors for the upper bound.
        const display = Gdk.Display.get_default();
        const nMonitors = display ? display.get_monitors().get_n_items() : 1;
        dialog._adjustment = new Gtk.Adjustment({
            lower: 0.0,
            upper: Math.max(0, nMonitors - 1),
            step_increment: 1.0,
        });

        let spinButton = new Gtk.SpinButton({
            halign: Gtk.Align.END,
            adjustment: dialog._adjustment,
            numeric: true,
        });
        spinButton.set_value(Math.max(0, nMonitors - 1));
        monitorRow.append(spinButton);

        // Update spinner when monitors change (GTK4 display monitors model).
        let monitorsChangedId = 0;
        if (display) {
            const monitorsModel = display.get_monitors();
            monitorsChangedId = monitorsModel.connect(
                'items-changed', () => {
                    const n = monitorsModel.get_n_items();
                    dialog._adjustment.set_upper(Math.max(0, n - 1));
                    dialog._adjustment.set_value(Math.max(0, n - 1));
                });
        }

        grid.append(monitorRow);
        dialog.get_content_area().append(grid);

        dialog.connect('response', (_dialog, id) => {
            if (monitorsChangedId && display) {
                display.get_monitors().disconnect(monitorsChangedId);
            }
            this._settings.disconnect(availableIndicatorsId);
            this._settings.disconnect(transferIndicatorsId);

            if (id !== Gtk.ResponseType.OK) {
                dialog.destroy();
                return;
            }

            let [any, model, iter] =
                dialog._treeView.get_selection().get_selected();
            if (any) {
                let indicator =
                    model.get_value(iter, Columns.INDICATOR_NAME);
                let transfers =
                    this._settings.get_value(
                        TRANSFER_INDICATORS_ID).deep_unpack();
                if (!transfers.hasOwnProperty(indicator)) {
                    transfers[indicator] = dialog._adjustment.get_value();
                    this._settings.set_value(
                        TRANSFER_INDICATORS_ID,
                        new GLib.Variant('a{si}', transfers));
                }
            }

            dialog.destroy();
        });

        dialog.present();
    }

    _removeIndicator() {
        let [any, model, iter] =
            this._treeView.get_selection().get_selected();
        if (any) {
            let indicator = model.get_value(iter, Columns.INDICATOR_NAME);
            let transfers =
                this._settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
            if (transfers.hasOwnProperty(indicator)) {
                delete transfers[indicator];
                this._settings.set_value(
                    TRANSFER_INDICATORS_ID,
                    new GLib.Variant('a{si}', transfers));
            }
        }
    }
});

// ---------------------------------------------------------------------------
// MultiMonitorsPreferences – the ExtensionPreferences subclass
// ---------------------------------------------------------------------------
export default class MultiMonitorsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(640, 600);

        const settings = this.getSettings();
        const desktopSettings = this.getSettings('org.gnome.desktop.interface');

        // ── General page ──────────────────────────────────────────────────
        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(generalPage);

        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel'),
        });
        generalPage.add(panelGroup);

        this._addSwitchRow(panelGroup, settings,
            _('Show Multi Monitors indicator on Top Panel.'),
            SHOW_INDICATOR_ID);
        this._addSwitchRow(panelGroup, settings,
            _('Show Panel on additional monitors.'),
            SHOW_PANEL_ID);
        this._addSwitchRow(panelGroup, settings,
            _('Show Activities-Button on additional monitors.'),
            SHOW_ACTIVITIES_ID);
        this._addSwitchRow(panelGroup, settings,
            _('Show DateTime-Button on additional monitors.'),
            SHOW_DATE_TIME_ID);
        this._addSwitchRow(panelGroup, desktopSettings,
            _('Enable hot corners.'),
            ENABLE_HOT_CORNERS);

        // ── Overview / thumbnails page ────────────────────────────────────
        const overviewGroup = new Adw.PreferencesGroup({
            title: _('Overview'),
        });
        generalPage.add(overviewGroup);

        this._addComboRow(overviewGroup, settings,
            _('Show Thumbnails-Slider on additional monitors.'),
            THUMBNAILS_SLIDER_POSITION_ID, {
                none: _('No'),
                right: _('On the right'),
                left: _('On the left'),
                auto: _('Auto'),
            });

        // ── Indicator transfer page ───────────────────────────────────────
        const indicatorsPage = new Adw.PreferencesPage({
            title: _('Indicators'),
            icon_name: 'view-grid-symbolic',
        });
        window.add(indicatorsPage);

        const indicatorsGroup = new Adw.PreferencesGroup({
            title: _('Transfer Indicators to Additional Monitors'),
        });
        indicatorsPage.add(indicatorsGroup);

        const transferWidget = new IndicatorsTransferWidget(settings);
        indicatorsGroup.add(transferWidget);
    }

    _addSwitchRow(group, settings, label, schemaId) {
        const row = new Adw.SwitchRow({ title: label });
        group.add(row);
        settings.bind(schemaId, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    }

    _addComboRow(group, settings, label, schemaId, options) {
        const keys = Object.keys(options);
        const values = keys.map(k => options[k]);

        const model = new Gtk.StringList({ strings: values });
        const row = new Adw.ComboRow({
            title: label,
            model,
        });
        group.add(row);

        // Synchronise combo selection ↔ string GSettings key.
        const syncFromSettings = () => {
            const current = settings.get_string(schemaId);
            const idx = keys.indexOf(current);
            if (idx >= 0)
                row.selected = idx;
        };
        syncFromSettings();

        row.connect('notify::selected', () => {
            const key = keys[row.selected];
            if (key !== undefined)
                settings.set_string(schemaId, key);
        });

        settings.connect('changed::' + schemaId, syncFromSettings);
    }
}

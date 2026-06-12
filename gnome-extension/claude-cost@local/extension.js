import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const COST_FILE = GLib.build_filenamev([GLib.get_home_dir(), '.claude_cost']);
const REFRESH_INTERVAL = 5;

/*
 * Expected ~/.claude_cost format:
 * {
 *   "session_pct":    16,           // claude.ai current session % used
 *   "session_reset":  "in 50 min",  // when session resets
 *   "weekly_pct":     21,           // claude.ai weekly % used
 *   "weekly_reset":   "Sat 3:59 AM",
 *   "code_cost":      0.0123,       // Claude Code accumulated cost (optional)
 *   "input_tokens":   5000,
 *   "output_tokens":  1200,
 *   "last_updated":   "2026-06-08T20:30:00Z"
 * }
 */

const ClaudeCostIndicator = GObject.registerClass(
class ClaudeCostIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Claude Usage Monitor');
        this._buildUI();
        this._startPolling();
    }

    _buildUI() {
        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });

        this._icon = new St.Icon({
            icon_name: 'dialog-information-symbolic',
            style_class: 'system-status-icon',
            icon_size: 14,
        });

        this._label = new St.Label({
            text: 'Claude: –',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-left: 4px;',
        });

        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);
        this._buildMenu();
    }

    _buildMenu() {
        // Title
        const titleItem = new PopupMenu.PopupMenuItem('Claude Usage Monitor', { reactive: false });
        titleItem.label.set_style('font-weight: bold; font-size: 1.1em;');
        this.menu.addMenuItem(titleItem);

        // claude.ai section
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const webTitle = new PopupMenu.PopupMenuItem('🌐  claude.ai', { reactive: false });
        webTitle.label.set_style('font-weight: bold;');
        this.menu.addMenuItem(webTitle);

        this._sessionPctItem  = this._addRow('  Session',  '–');
        this._sessionRstItem  = this._addRow('  Resets',   '–');
        this._weeklyPctItem   = this._addRow('  Weekly',   '–');
        this._weeklyRstItem   = this._addRow('  Resets',   '–');

        // Claude Code section
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const codeTitle = new PopupMenu.PopupMenuItem('⌨️  Claude Code', { reactive: false });
        codeTitle.label.set_style('font-weight: bold;');
        this.menu.addMenuItem(codeTitle);

        this._costItem    = this._addRow('  Session cost',  '–');
        this._inputItem   = this._addRow('  Input tokens',  '–');
        this._outputItem  = this._addRow('  Output tokens', '–');

        // Footer
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._updatedItem = this._addRow('🔄 Last updated', '–');

        const resetItem = new PopupMenu.PopupMenuItem('🗑️  Reset all data');
        resetItem.connect('activate', () => this._resetFile());
        this.menu.addMenuItem(resetItem);
    }

    _addRow(label, value) {
        const item = new PopupMenu.PopupMenuItem('', { reactive: false });
        item.label.set_text(`${label}:   ${value}`);
        item.label.set_style('font-family: monospace;');
        this.menu.addMenuItem(item);
        return item;
    }

    _updateRow(item, label, value) {
        item.label.set_text(`${label}:   ${value}`);
    }

    _startPolling() {
        this._refresh();
        this._timer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL,
            () => { this._refresh(); return GLib.SOURCE_CONTINUE; }
        );
    }

    _minsUntil(isoStr) {
        if (!isoStr) return null;
        const ms = new Date(isoStr).getTime() - Date.now();
        return Math.max(0, Math.ceil(ms / 60000));
    }

    _refresh() {
        try {
            const file = Gio.File.new_for_path(COST_FILE);
            const [, contents] = file.load_contents(null);
            const d = JSON.parse(new TextDecoder().decode(contents));

            // Build top bar label — prefer web usage if available
            let topLabel = 'Claude: ';
            if (d.session_pct != null) {
                const pct = d.session_pct;
                if (pct >= 100 && d.session_reset_at) {
                    const mins = this._minsUntil(d.session_reset_at);
                    topLabel += `FULL – reset in ${mins}m`;
                    this._label.set_style('margin-left: 4px; color: #FF6B6B;');
                } else {
                    const color = pct >= 80 ? '#FF6B6B' : pct >= 50 ? '#FFD93D' : '#8BC4F9';
                    topLabel += `${pct}%`;
                    this._label.set_style(`margin-left: 4px; color: ${color};`);
                }
            } else if (d.code_cost != null) {
                topLabel += `$${Number(d.code_cost).toFixed(4)}`;
                this._label.set_style('margin-left: 4px; color: #8BC4F9;');
            } else {
                topLabel += '–';
                this._label.set_style('margin-left: 4px; color: #888;');
            }
            this._label.set_text(topLabel);

            // claude.ai rows
            const sessionFull = d.session_pct != null && d.session_pct >= 100;
            const sessionResetLabel = sessionFull && d.session_reset_at
                ? `in ${this._minsUntil(d.session_reset_at)}m (FULL)`
                : d.session_reset || '–';
            this._updateRow(this._sessionPctItem, '  Session',
                d.session_pct != null ? `${d.session_pct}% used` : '–');
            this._updateRow(this._sessionRstItem, '  Resets',
                sessionResetLabel);
            this._updateRow(this._weeklyPctItem,  '  Weekly',
                d.weekly_pct != null ? `${d.weekly_pct}% used` : '–');
            this._updateRow(this._weeklyRstItem,  '  Resets',
                d.weekly_reset || '–');

            // Claude Code rows
            this._updateRow(this._costItem,   '  Session cost',
                d.code_cost != null ? `$${Number(d.code_cost).toFixed(4)}` : '–');
            this._updateRow(this._inputItem,  '  Input tokens',
                d.input_tokens != null ? d.input_tokens.toLocaleString() : '–');
            this._updateRow(this._outputItem, '  Output tokens',
                d.output_tokens != null ? d.output_tokens.toLocaleString() : '–');

            // Footer
            this._updateRow(this._updatedItem, '🔄 Last updated',
                d.last_updated ? this._fmtTime(d.last_updated) : '–');

        } catch (_) {
            this._label.set_text('Claude: no data');
            this._label.set_style('margin-left: 4px; color: #888;');
        }
    }

    _fmtTime(isoStr) {
        try {
            return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (_) { return isoStr; }
    }

    _resetFile() {
        try { Gio.File.new_for_path(COST_FILE).delete(null); } catch (_) {}
        this._refresh();
        this.menu.close();
    }

    destroy() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = null; }
        super.destroy();
    }
});

export default class ClaudeMonitorExtension extends Extension {
    enable() {
        this._indicator = new ClaudeCostIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }
    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}

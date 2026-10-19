// Side Panel widget for Ambient Sounds. It controls the running applet
// through applet.remote rather than playing anything itself, so the panel
// menu and this widget always show the same mix.

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Slider = imports.ui.slider;
const AppletManager = imports.ui.appletManager;

const UUID = 'ambient-sounds@PhillipMwaniki';
const TILE_COLUMNS = 3;
const REBIND_DELAY_MS = 1000;
const PRESETS_PER_ROW = 2;
const SLEEP_OPTIONS_PER_ROW = 4;

function formatMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (!hours)
        return `${rest} min`;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function chip(text, callback) {
    const button = new St.Button({ label: text, style_class: 'ambient-widget-chip', can_focus: true });
    button.connect('clicked', callback);
    return button;
}

// Fixed rows rather than Clutter.FlowLayout, which gives St children no
// height here.
function chipRows(buttons, perRow) {
    const rows = new St.BoxLayout({ vertical: true, style_class: 'ambient-widget-chip-rows' });
    for (let i = 0; i < buttons.length; i += perRow) {
        const row = new St.BoxLayout({ style_class: 'ambient-widget-chip-row' });
        buttons.slice(i, i + perRow).forEach(button => row.add_child(button));
        rows.add_child(row);
    }
    return rows;
}

var Widget = class Widget {
    constructor(ctx) {
        this._remote = null;
        this._remoteIds = [];
        this._rebindId = 0;

        this.actor = new St.BoxLayout({ vertical: true, style_class: 'ambient-widget' });
        this._missing = new St.Label({
            text: _('Add the Ambient Sounds applet to a panel to use this widget.'),
            style_class: 'sidepanel-empty',
        });
        this._missing.clutter_text.line_wrap = true;
        this._body = new St.BoxLayout({ vertical: true, style_class: 'ambient-widget-body' });
        this.actor.add_child(this._missing);
        this.actor.add_child(this._body);

        this._bind();
    }

    // The applet may have been added, removed or reloaded since last time.
    onShown() {
        this._bind();
    }

    destroy() {
        if (this._rebindId)
            GLib.source_remove(this._rebindId);
        this._unbind();
    }

    _bind() {
        const applet = AppletManager.getRunningInstancesForUuid(UUID)[0];
        const remote = (applet && applet.remote) || null;
        if (remote !== this._remote) {
            this._unbind();
            this._remote = remote;
            if (remote) {
                this._remoteIds = [
                    remote.connect('changed', () => this._refresh()),
                    remote.connect('destroyed', () => this._onRemoteDestroyed()),
                ];
                this._build();
            }
        }
        this._missing.visible = !this._remote;
        this._body.visible = Boolean(this._remote);
        this._refresh();
    }

    // The applet is going away, maybe only to reload. It drops every
    // handler itself, and is still registered right now, so forget it and
    // look for its replacement a little later.
    _onRemoteDestroyed() {
        this._remote = null;
        this._remoteIds = [];
        this._body.destroy_all_children();
        this._missing.visible = true;
        this._body.visible = false;
        if (this._rebindId)
            GLib.source_remove(this._rebindId);
        this._rebindId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REBIND_DELAY_MS, () => {
            this._rebindId = 0;
            this._bind();
            return GLib.SOURCE_REMOVE;
        });
    }

    _unbind() {
        if (this._remote)
            this._remoteIds.forEach(id => this._remote.disconnect(id));
        this._remote = null;
        this._remoteIds = [];
        this._body.destroy_all_children();
    }

    _build() {
        const remote = this._remote;

        // Play/pause and the mix volume.
        const top = new St.BoxLayout({ style_class: 'ambient-widget-top' });
        this._play = new St.Button({ style_class: 'ambient-widget-play', can_focus: true });
        this._playIcon = new St.Icon({ icon_type: St.IconType.SYMBOLIC, icon_size: 16 });
        this._play.set_child(this._playIcon);
        this._play.connect('clicked', () => remote.setPlaying(!remote.getState().playing));
        this._master = new Slider.Slider(0);
        this._master.actor.x_expand = true;
        this._master.actor.y_align = Clutter.ActorAlign.CENTER;
        this._master.connect('value-changed', (slider, value) => remote.setMaster(value));
        top.add_child(this._play);
        top.add_child(this._master.actor);
        this._body.add_child(top);

        // A tile per sound toggles it; enabled sounds get a level slider below.
        const grid = new Clutter.GridLayout({ column_homogeneous: true, column_spacing: 6, row_spacing: 6 });
        const tiles = new St.Widget({ layout_manager: grid, x_expand: true });
        this._tiles = {};
        this._levels = {};
        const levels = new St.BoxLayout({ vertical: true, style_class: 'ambient-widget-levels' });
        remote.sounds.forEach((sound, index) => {
            const tile = new St.Button({ style_class: 'ambient-widget-tile', can_focus: true, accessible_name: sound.title });
            const box = new St.BoxLayout({ vertical: true, x_align: Clutter.ActorAlign.CENTER });
            box.add_child(new St.Icon({ icon_name: sound.icon, icon_type: St.IconType.SYMBOLIC, icon_size: 20, x_align: Clutter.ActorAlign.CENTER }));
            box.add_child(new St.Label({ text: sound.title, style_class: 'ambient-widget-tile-label', x_align: Clutter.ActorAlign.CENTER }));
            tile.set_child(box);
            tile.connect('clicked', () => remote.setEnabled(sound.id, !remote.getState().mix[sound.id].enabled));
            grid.attach(tile, index % TILE_COLUMNS, Math.floor(index / TILE_COLUMNS), 1, 1);
            this._tiles[sound.id] = tile;

            const row = new St.BoxLayout({ style_class: 'ambient-widget-level' });
            row.add_child(new St.Label({ text: sound.title, style_class: 'ambient-widget-level-label', y_align: Clutter.ActorAlign.CENTER }));
            const slider = new Slider.Slider(0);
            slider.actor.x_expand = true;
            slider.actor.y_align = Clutter.ActorAlign.CENTER;
            slider.connect('value-changed', (s, value) => remote.setLevel(sound.id, value));
            row.add_child(slider.actor);
            levels.add_child(row);
            this._levels[sound.id] = { row, slider };
        });
        this._body.add_child(tiles);
        this._body.add_child(levels);

        this._body.add_child(new St.Label({ text: _('Presets'), style_class: 'ambient-widget-heading' }));
        const presets = remote.presets.map((preset, index) => chip(preset.title, () => remote.applyPreset(index)));
        this._body.add_child(chipRows(presets, PRESETS_PER_ROW));

        this._sleepHeading = new St.Label({ style_class: 'ambient-widget-heading' });
        this._body.add_child(this._sleepHeading);
        this._sleepChips = [[0, chip(_('Off'), () => remote.setSleepTimer(0))]];
        for (const minutes of remote.sleepOptions)
            this._sleepChips.push([minutes, chip(formatMinutes(minutes), () => remote.setSleepTimer(minutes))]);
        this._body.add_child(chipRows(this._sleepChips.map(([, button]) => button), SLEEP_OPTIONS_PER_ROW));
    }

    _refresh() {
        if (!this._remote)
            return;
        const state = this._remote.getState();

        this._playIcon.icon_name = state.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._play.accessible_name = state.playing ? _('Pause') : _('Play');
        this._master.setValue(state.master);

        for (const sound of this._remote.sounds) {
            const { enabled, level } = state.mix[sound.id];
            this._tiles[sound.id].checked = enabled;
            this._levels[sound.id].row.visible = enabled;
            this._levels[sound.id].slider.setValue(level);
        }

        const remaining = Math.ceil(state.sleepRemainingMs / 60000);
        this._sleepHeading.text = state.sleepMinutes
            ? `${_('Sleep timer')}: ${formatMinutes(remaining)} ${_('left')}`
            : _('Sleep timer');
        for (const [minutes, button] of this._sleepChips)
            button.checked = minutes === state.sleepMinutes;
    }
};

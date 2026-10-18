const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gst = imports.gi.Gst;
const St = imports.gi.St;

const UUID = 'ambient-sounds@PhillipMwaniki';
const AppletDir = imports.ui.appletManager.applets[UUID];
const { Track } = AppletDir.player;
const { SOUNDS, PRESETS, DEFAULT_LEVEL } = AppletDir.library;

const FADE_IN_MS = 1500;
const FADE_OUT_MS = 1000;
const SCROLL_STEP = 0.05;
const SAVE_DELAY_MS = 500;

// One menu row per sound: icon, name, level slider and on/off switch.
class SoundItem extends PopupMenu.PopupBaseMenuItem {
    _init(sound, enabled, level) {
        super._init();
        this.sound = sound;

        const box = new St.BoxLayout({ style_class: 'ambient-sound-row', x_expand: true });
        this._icon = new St.Icon({ icon_name: sound.icon, icon_type: St.IconType.SYMBOLIC, style_class: 'popup-menu-icon' });
        this._label = new St.Label({ text: sound.title, style_class: 'ambient-sound-label', y_align: Clutter.ActorAlign.CENTER });
        this.slider = new Slider.Slider(level);
        this.slider.actor.add_style_class_name('ambient-sound-slider');
        this.slider.actor.x_expand = true;
        this.slider.actor.y_align = Clutter.ActorAlign.CENTER;
        this._switch = new PopupMenu.Switch(enabled);
        const switchBin = new St.Bin({ child: this._switch.actor, y_align: Clutter.ActorAlign.CENTER });

        box.add_child(this._icon);
        box.add_child(this._label);
        box.add_child(this.slider.actor);
        box.add_child(switchBin);
        this.addActor(box, { expand: true, span: -1 });
        this.actor.label_actor = this._label;

        this._updateDim();
    }

    get enabled() {
        return this._switch.state;
    }

    setEnabled(enabled) {
        this._switch.setToggleState(enabled);
        this._updateDim();
    }

    // Clicking anywhere on the row (except the slider) toggles the sound and
    // keeps the menu open.
    activate(event) {
        this.setEnabled(!this.enabled);
        this.emit('toggled', this.enabled);
        super.activate(event, true);
    }

    _updateDim() {
        const opacity = this.enabled ? 255 : 128;
        this._icon.opacity = opacity;
        this._label.opacity = opacity;
    }
}

class AmbientSoundsApplet extends Applet.IconApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);
        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        this.set_applet_icon_symbolic_name('audio-headphones-symbolic');

        if (!Gst.is_initialized())
            Gst.init(null);

        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bind('fade', 'fadeEnabled');
        this.settings.bind('resume-on-start', 'resumeOnStart');

        this._playing = false;
        this._saveId = 0;
        this._master = this.settings.getValue('master-volume');
        this._mix = this._loadMix();
        this._tracks = {};
        for (const sound of SOUNDS)
            this._tracks[sound.id] = new Track(sound, metadata.path, (track, message) => this._onTrackError(track, message));

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this._buildMenu();

        this.actor.connect('scroll-event', (actor, event) => this._onScroll(event));

        if (this.resumeOnStart && this.settings.getValue('was-playing'))
            this._setPlaying(true);
        else
            this._updateStatus();
    }

    // Saved state merged over defaults, so sounds added later still appear.
    _loadMix() {
        const saved = this.settings.getValue('mix') || {};
        const mix = {};
        for (const sound of SOUNDS) {
            const entry = saved[sound.id] || {};
            mix[sound.id] = {
                enabled: entry.enabled === true,
                level: typeof entry.level === 'number' ? entry.level : DEFAULT_LEVEL,
            };
        }
        return mix;
    }

    _buildMenu() {
        this._playItem = new PopupMenu.PopupSwitchIconMenuItem(_('Play mix'), false, 'media-playback-start-symbolic', St.IconType.SYMBOLIC);
        this._playItem.connect('toggled', (item, state) => this._setPlaying(state));
        this.menu.addMenuItem(this._playItem);

        const masterItem = new PopupMenu.PopupBaseMenuItem({ activate: false });
        const masterBox = new St.BoxLayout({ style_class: 'ambient-sound-row', x_expand: true });
        this._masterIcon = new St.Icon({ icon_type: St.IconType.SYMBOLIC, style_class: 'popup-menu-icon' });
        this._masterSlider = new Slider.Slider(this._master);
        this._masterSlider.actor.add_style_class_name('ambient-sound-slider');
        this._masterSlider.actor.x_expand = true;
        this._masterSlider.actor.y_align = Clutter.ActorAlign.CENTER;
        this._masterSlider.connect('value-changed', (slider, value) => this._setMaster(value));
        masterBox.add_child(this._masterIcon);
        masterBox.add_child(this._masterSlider.actor);
        masterItem.addActor(masterBox, { expand: true, span: -1 });
        this.menu.addMenuItem(masterItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._items = {};
        for (const sound of SOUNDS) {
            const state = this._mix[sound.id];
            const item = new SoundItem(sound, state.enabled, state.level);
            item.connect('toggled', (item, enabled) => this._setEnabled(sound.id, enabled));
            item.slider.connect('value-changed', (slider, value) => this._setLevel(sound.id, value));
            this._items[sound.id] = item;
            this.menu.addMenuItem(item);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const presets = new PopupMenu.PopupSubMenuMenuItem(_('Presets'));
        for (const preset of PRESETS)
            presets.menu.addAction(preset.title, () => this._applyPreset(preset));
        this.menu.addMenuItem(presets);
    }

    on_applet_clicked() {
        this.menu.toggle();
    }

    on_applet_middle_clicked() {
        this._setPlaying(!this._playing);
    }

    on_applet_removed_from_panel() {
        if (this._saveId) {
            GLib.source_remove(this._saveId);
            this._saveId = 0;
            this._save();
        }
        for (const id in this._tracks)
            this._tracks[id].destroy();
        this.settings.finalize();
    }

    _onScroll(event) {
        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP)
            this._setMaster(this._master + SCROLL_STEP);
        else if (direction === Clutter.ScrollDirection.DOWN)
            this._setMaster(this._master - SCROLL_STEP);
        else
            return Clutter.EVENT_PROPAGATE;
        this._masterSlider.setValue(this._master);
        return Clutter.EVENT_STOP;
    }

    _enabledSounds() {
        return SOUNDS.filter(sound => this._mix[sound.id].enabled);
    }

    _setPlaying(playing) {
        // Starting with nothing switched on would look broken; turn on the
        // first sound so the button always makes a noise.
        if (playing && this._enabledSounds().length === 0) {
            this._mix[SOUNDS[0].id].enabled = true;
            this._items[SOUNDS[0].id].setEnabled(true);
        }
        this._playing = playing;
        this._sync();
        this.settings.setValue('was-playing', playing);
        this._scheduleSave();
    }

    _setEnabled(id, enabled) {
        this._mix[id].enabled = enabled;
        // Switching a sound on is a request to hear it.
        if (enabled && !this._playing)
            this._playing = true;
        else if (this._enabledSounds().length === 0)
            this._playing = false;
        this.settings.setValue('was-playing', this._playing);
        this._sync();
        this._scheduleSave();
    }

    _setLevel(id, level) {
        this._mix[id].level = level;
        this._tracks[id].setVolume(this._volumeFor(id));
        this._scheduleSave();
    }

    _setMaster(value) {
        this._master = Math.max(0, Math.min(1, value));
        for (const id in this._tracks)
            this._tracks[id].setVolume(this._volumeFor(id));
        this._updateStatus();
        this._scheduleSave();
    }

    _applyPreset(preset) {
        for (const sound of SOUNDS) {
            const level = preset.mix[sound.id];
            const state = this._mix[sound.id];
            state.enabled = level !== undefined;
            if (state.enabled)
                state.level = level;
            this._items[sound.id].setEnabled(state.enabled);
            this._items[sound.id].slider.setValue(state.level);
        }
        this._playing = true;
        this.settings.setValue('was-playing', true);
        this._sync();
        this._scheduleSave();
    }

    // Sliders are cubic, like the system volume, so the low end has room.
    _volumeFor(id) {
        const sound = this._tracks[id].sound;
        return Math.pow(this._mix[id].level * this._master, 3) * sound.gain;
    }

    _sync() {
        const fadeIn = this.fadeEnabled ? FADE_IN_MS : 0;
        const fadeOut = this.fadeEnabled ? FADE_OUT_MS : 0;
        for (const sound of SOUNDS) {
            const track = this._tracks[sound.id];
            track.setVolume(this._volumeFor(sound.id));
            if (this._playing && this._mix[sound.id].enabled)
                track.play(fadeIn);
            else
                track.stop(fadeOut);
        }
        this._updateStatus();
    }

    _updateStatus() {
        this._playItem.setToggleState(this._playing);
        this._playItem.setIconSymbolicName(this._playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic');
        this._playItem.label.text = this._playing ? _('Playing') : _('Play mix');

        let volumeIcon = 'audio-volume-high-symbolic';
        if (this._master === 0)
            volumeIcon = 'audio-volume-muted-symbolic';
        else if (this._master < 0.34)
            volumeIcon = 'audio-volume-low-symbolic';
        else if (this._master < 0.67)
            volumeIcon = 'audio-volume-medium-symbolic';
        this._masterIcon.icon_name = volumeIcon;

        this._applet_icon.opacity = this._playing ? 255 : 140;

        const volume = Math.round(this._master * 100);
        if (this._playing) {
            const names = this._enabledSounds().map(sound => sound.title).join(', ');
            this.set_applet_tooltip(`${_('Ambient Sounds')}: ${names}  (${volume}%)`);
        } else {
            this.set_applet_tooltip(_('Ambient Sounds (paused)'));
        }
    }

    _onTrackError(track, message) {
        global.logError(`${UUID}: ${track.sound.title}: ${message}`);
        Main.notifyError(_('Ambient Sounds'), `${_('Could not play')} ${track.sound.title}: ${message}`);
        this._mix[track.sound.id].enabled = false;
        this._items[track.sound.id].setEnabled(false);
        if (this._enabledSounds().length === 0)
            this._playing = false;
        this._updateStatus();
        this._scheduleSave();
    }

    // Sliders fire on every pixel of a drag; write settings once they settle.
    _scheduleSave() {
        if (this._saveId)
            GLib.source_remove(this._saveId);
        this._saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DELAY_MS, () => {
            this._saveId = 0;
            this._save();
            return GLib.SOURCE_REMOVE;
        });
    }

    _save() {
        this.settings.setValue('mix', JSON.parse(JSON.stringify(this._mix)));
        this.settings.setValue('master-volume', this._master);
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new AmbientSoundsApplet(metadata, orientation, panelHeight, instanceId);
}

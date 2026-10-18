// One looping GStreamer playbin per sound, with volume fades.

const Gst = imports.gi.Gst;
const GLib = imports.gi.GLib;

const PLAY_FLAG_AUDIO = 1 << 1;
const PLAY_FLAG_SOFT_VOLUME = 1 << 4;
const FADE_STEP_MS = 40;

var Track = class Track {
    constructor(sound, dir, onError) {
        this.sound = sound;
        this.playing = false;
        this._uri = GLib.filename_to_uri(dir + '/sounds/' + sound.file, null);
        this._onError = onError;
        this._pipeline = null;
        this._volume = 0;     // target linear volume
        this._fade = 1;       // fade multiplier, 0..1
        this._fadeId = 0;
    }

    setVolume(volume) {
        this._volume = volume;
        this._apply();
    }

    play(fadeMs) {
        if (this.playing)
            return;
        this.playing = true;

        if (!this._pipeline) {
            this._build();
            this._fade = fadeMs ? 0 : 1;
            this._apply();
            this._pipeline.set_state(Gst.State.PLAYING);
        }
        // If a fade-out was in progress the pipeline is still alive; fading
        // back in from wherever it got to avoids a jump.
        this._fadeTo(1, fadeMs);
    }

    stop(fadeMs) {
        if (!this.playing)
            return;
        this.playing = false;
        this._fadeTo(0, fadeMs, () => this._teardown());
    }

    destroy() {
        this.playing = false;
        this._teardown();
    }

    _build() {
        const pipeline = Gst.ElementFactory.make('playbin', null);
        pipeline.uri = this._uri;
        pipeline.flags = PLAY_FLAG_AUDIO | PLAY_FLAG_SOFT_VOLUME;

        // Name the stream so it shows up as "Ambient Sounds" in the sound
        // settings. pulsesink defaults to media.role=music, and WirePlumber
        // restores one volume for every stream with that role, so a quiet
        // music player would make us quiet too. Our own role gets our own.
        const sink = Gst.ElementFactory.make('pulsesink', null);
        if (sink) {
            sink.client_name = 'Ambient Sounds';
            sink.stream_properties = Gst.Structure.new_from_string(
                'props, media.role=ambient, application.icon_name=audio-headphones');
            pipeline.audio_sink = sink;
        }

        const bus = pipeline.get_bus();
        bus.add_signal_watch();
        this._busId = bus.connect('message', (bus, message) => this._onMessage(message));
        this._looping = false;
        this._pipeline = pipeline;
    }

    _teardown() {
        this._cancelFade();
        if (!this._pipeline)
            return;
        this._pipeline.set_state(Gst.State.NULL);
        const bus = this._pipeline.get_bus();
        bus.disconnect(this._busId);
        bus.remove_signal_watch();
        this._pipeline = null;
    }

    _onMessage(message) {
        const pipeline = this._pipeline;
        if (!pipeline)
            return;

        switch (message.type) {
        case Gst.MessageType.ASYNC_DONE:
            // Segment seeks loop without the gap that a seek after EOS
            // leaves: the pipeline posts SEGMENT_DONE instead of EOS and
            // keeps streaming while we queue the next pass.
            if (!this._looping) {
                this._looping = true;
                pipeline.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.SEGMENT, 0);
            }
            break;
        case Gst.MessageType.SEGMENT_DONE:
            pipeline.seek_simple(Gst.Format.TIME, Gst.SeekFlags.SEGMENT, 0);
            break;
        case Gst.MessageType.EOS:
            pipeline.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH, 0);
            break;
        case Gst.MessageType.ERROR: {
            const [error] = message.parse_error();
            this.destroy();
            this._onError(this, error.message);
            break;
        }
        }
    }

    // Cubic, like the sliders: a linear fade sounds flat for most of its
    // length and then drops away at the end, which a minute-long fade makes
    // obvious.
    _apply() {
        if (this._pipeline)
            this._pipeline.volume = this._volume * Math.pow(this._fade, 3);
    }

    _fadeTo(target, durationMs, onDone) {
        this._cancelFade();
        if (!durationMs || this._fade === target) {
            this._fade = target;
            this._apply();
            if (onDone)
                onDone();
            return;
        }

        const step = FADE_STEP_MS / durationMs * (target > this._fade ? 1 : -1);
        this._fadeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FADE_STEP_MS, () => {
            this._fade += step;
            const finished = step > 0 ? this._fade >= target : this._fade <= target;
            if (finished)
                this._fade = target;
            this._apply();
            if (!finished)
                return GLib.SOURCE_CONTINUE;
            this._fadeId = 0;
            if (onDone)
                onDone();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelFade() {
        if (this._fadeId) {
            GLib.source_remove(this._fadeId);
            this._fadeId = 0;
        }
    }
};

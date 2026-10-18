# Ambient Sounds

A Cinnamon panel applet for mixing looping ambient sounds: rain, thunder,
birds, crickets, fireplace and café.

## Features

- Switch each sound on or off and set its level from the panel menu.
- A master volume slider; scroll on the panel icon to change it.
- Presets: Rainy café, Thunderstorm, Campfire night, Cosy cabin, Morning forest.
- Sounds fade in and out (can be turned off in settings).
- Your mix and volume are saved, and can resume automatically at login.
- Middle-click the panel icon to play or pause.

Playback uses GStreamer inside Cinnamon itself, so there is nothing extra to
install and no helper processes. Each sound loops seamlessly using segment
seeks, and per-sound gains even out the loudness of the recordings.

## Install

```sh
ln -s "$PWD/ambient-sounds@PhillipMwaniki" ~/.local/share/cinnamon/applets/
```

Then add **Ambient Sounds** from *System Settings → Applets*.

## Adding sounds

Drop the file into `ambient-sounds@PhillipMwaniki/sounds/` and add an entry to
`library.js` with an id, title, symbolic icon name, filename and gain. Custom
icons go in `icons/` and must end in `-symbolic.svg`.

## Development

Reload the applet after editing:

```sh
gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon \
  --method org.Cinnamon.Eval \
  "imports.ui.extension.reloadExtension('ambient-sounds@PhillipMwaniki', imports.ui.extension.Type.APPLET)"
```

Modules are loaded with `require()`, which picks up changes on reload.

## Credits

See [ATTRIBUTION.md](ATTRIBUTION.md).

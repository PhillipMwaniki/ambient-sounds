// Bundled sounds and presets. To add a sound, drop the file in sounds/ and add
// an entry here.
//
// `gain` evens out loudness between recordings: it lifts each clip's mean level
// towards -22 dB while keeping its peaks at least 1 dB below clipping.

var SOUNDS = [
    { id: 'rain',      title: 'Rain',      icon: 'weather-showers-symbolic',     file: 'rain.mp3',         gain: 0.77 },
    { id: 'thunder',   title: 'Thunder',   icon: 'weather-storm-symbolic',       file: 'dry-thunder.opus', gain: 0.91 },
    { id: 'birds',     title: 'Birds',     icon: 'emoji-nature-symbolic',        file: 'birds.ogg',        gain: 3.70 },
    { id: 'crickets',  title: 'Crickets',  icon: 'weather-clear-night-symbolic', file: 'crickets.mp3',     gain: 10.4 },
    { id: 'fireplace', title: 'Fireplace', icon: 'ambient-fire-symbolic',        file: 'fireplace.opus',   gain: 1.27 },
    { id: 'cafe',      title: 'Café',      icon: 'ambient-cafe-symbolic',        file: 'cafe.mp3',         gain: 1.76 },
];

var DEFAULT_LEVEL = 0.6;

// Each preset lists the sounds to switch on and their levels; all others are
// switched off.
var PRESETS = [
    { title: 'Rainy café',     mix: { rain: 0.6, cafe: 0.55 } },
    { title: 'Thunderstorm',   mix: { rain: 0.8, thunder: 0.65 } },
    { title: 'Campfire night', mix: { fireplace: 0.7, crickets: 0.5 } },
    { title: 'Cosy cabin',     mix: { fireplace: 0.6, rain: 0.5, thunder: 0.35 } },
    { title: 'Morning forest', mix: { birds: 0.7, crickets: 0.25 } },
];

# Star Dash

Star Dash is a self-contained iCreator arcade module. Pilot a cyan ship, collect stars, dodge meteors, and survive a 60-second round.

## Install

Place the complete `star-dash/` folder under `<project>/modules/`, or package/import it as a ZIP whose root contains `star-dash/module.json` and `star-dash/index.html`.

No npm install, development server, CDN, external API, device connection, or Bluetooth permission is required.

## Controls

- Keyboard: Left/Right arrows or A/D
- Mouse: click/drag horizontally in the playfield
- Touch: drag horizontally
- Escape: Pause/Resume
- HUD Pause button: Pause

The game automatically pauses if its window loses focus or becomes hidden. Hidden/paused time does not consume the 60-second timer. Returning requires Resume.

## Scoring

- Star: 10 points
- Three consecutive stars without damage activate a visible 2x combo
- Damage resets the combo
- Start with 3 lives
- Meteor hit consumes one life unless a shield is active
- Shield pickup absorbs one meteor hit
- After any hit, the ship is briefly invulnerable so one overlap cannot consume all lives

Difficulty increases gradually through falling speed and spawn frequency, with capped values.

## Saved progress

The module requests only the `storage` permission.

When opened inside iCreator, it stores:

- sound/mute setting
- best five completed rounds for the current project
- score, stars collected, duration, and completion date for each stored round

Project storage keeps different projects independent. If storage fails, the game continues and displays a short notice instead of claiming the result was saved.

When opened in an ordinary browser, the game runs as a clearly labeled preview without persistent progress.

## Visual/audio behavior

- Original geometric Canvas artwork only
- Deep navy background, cyan ship, gold stars, coral meteors
- Subtle starfield, trails, particles, score feedback
- Reduced-motion preference lowers decorative motion/particles
- Optional synthesized sound starts only after user interaction and can be muted
- Gameplay information never depends on sound

## Checks performed for this release

Performed without iCreator hardware because this module has no device features:

- manifest JSON parse
- JavaScript syntax check with Node
- expected release files present
- no network/CDN/device API references
- responsive Canvas uses a fixed 800x600 logical coordinate system scaled by CSS, so pointer coordinates are converted back into logical space after resizing

Not claimed here:

- full automated browser gameplay simulation
- iCreator host storage integration test in a running host session

Those should be verified by importing the module and exercising the acceptance flow in the actual iCreator host.

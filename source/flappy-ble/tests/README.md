# Browser interaction checks

Run `npm run test:browser` and `npm run test:media` after building.

The course test executes the production ES modules and real bundled Blockly with an explicitly mocked iCreator SDK. Its pilot calls the real flap input only: it does not alter scores, collision outcomes, hearts or stage goals.

The media test drags the solid title bar of the empty C-shaped program block. Its empty statement socket is intentionally transparent and is not a draggable hit target. The test asserts that the real block transform changes after dragging.

Custom cursor checks cover both the original upstream files and native CSS fallbacks. Blockly dynamically inserts drag rules with higher specificity; the release stylesheet must preserve grabbing/no-drop fallbacks after those rules are inserted.

Neither browser test certifies the actual iCreator module importer, Blob URL mapping, GPU driver or physical robot.

/** This renderer is a route illustration and a record of user observations, never telemetry. */
export function renderBoard(host, m, options = {}) {
    host.replaceChildren();
    host.classList.add('routeBoard');
    host.style.setProperty('--cols', String(m.width));
    host.style.setProperty('--rows', String(m.height));
    host.setAttribute('role', 'img');
    host.setAttribute('aria-label', `${m.title}. Start column ${m.start.x + 1}, row ${m.start.y + 1}. This is a plan, not live tracking.`);
    const confirmed = options.position ?? m.start;
    for (let y = 0; y < m.height; y++)
        for (let x = 0; x < m.width; x++) {
            const el = document.createElement('div');
            el.className = 'tile';
            const pond = m.blocked.some(([bx, by]) => bx === x && by === y);
            if (pond)
                el.classList.add('pond');
            const h = m.houses.findIndex(h => h.x === x && h.y === y);
            if (pond) {
                const water = document.createElement('span');
                water.className = 'water';
                water.textContent = '≈';
                el.append(water);
            }
            if (x === m.start.x && y === m.start.y) {
                const label = document.createElement('small');
                label.className = 'startMarker';
                label.textContent = 'START →';
                el.append(label);
            }
            if (options.trace?.some(t => t.position.x === x && t.position.y === y) && !pond)
                el.classList.add('onRoute');
            if (h >= 0) {
                const home = document.createElement('div');
                home.className = 'house';
                const animal = document.createElement('span');
                animal.textContent = m.houses[h].emoji;
                const name = document.createElement('small');
                name.textContent = m.houses[h].name;
                home.append(animal, name);
                el.append(home);
                if (h < (options.delivered ?? 0)) {
                    const tick = document.createElement('b');
                    tick.className = 'deliveryTick';
                    tick.textContent = '✓';
                    el.append(tick);
                }
            }
            if (x === confirmed.x && y === confirmed.y) {
                const robot = document.createElement('div');
                robot.className = 'mapRobot';
                robot.textContent = '🚙';
                const arrow = document.createElement('span');
                arrow.className = 'robotArrow';
                arrow.textContent = ['↑', '→', '↓', '←'][confirmed.direction];
                robot.append(arrow);
                el.append(robot);
                el.classList.add('occupied');
            }
            if (options.ghost && x === options.ghost.x && y === options.ghost.y) {
                const ghost = document.createElement('div');
                ghost.className = 'ghostRobot';
                ghost.textContent = ['↑', '→', '↓', '←'][options.ghost.direction];
                el.append(ghost);
            }
            const coord = document.createElement('small');
            coord.className = 'coord';
            coord.textContent = String.fromCharCode(65 + x) + (y + 1);
            el.append(coord);
            host.append(el);
        }
}

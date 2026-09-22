function describe(a) {
    switch (a.kind) {
        case 'light': return `light ${a.state.toLowerCase()}`;
        case 'motor': return `${a.side.toLowerCase()} motor ${a.direction.toLowerCase()} at speed ${a.speed}`;
        case 'stop': return `stop ${a.side.toLowerCase()} motor`;
        case 'delay': return `wait ${a.ms} ms`;
        case 'repeat': return `repeat ${a.count} times`;
    }
}
/** Teaching feedback only; lesson validation and Python generation remain independent. */
export function explainDifference(expected, actual, path = '') {
    for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
        const want = expected[i], got = actual[i], location = `${path}action ${i + 1}`;
        if (!want)
            return `${location}: remove the extra ${describe(got)} block.`;
        if (!got)
            return `${location}: add ${describe(want)}.`;
        if (want.kind === 'repeat' && got.kind === 'repeat' && want.count === got.count) {
            const child = explainDifference(want.actions, got.actions, `${location} → inside repeat → `);
            if (child)
                return child;
        }
        else if (JSON.stringify(want) !== JSON.stringify(got)) {
            return `${location}: expected ${describe(want)}; found ${describe(got)}.`;
        }
    }
    return '';
}

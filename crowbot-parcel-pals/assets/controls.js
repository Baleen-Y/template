export function keyInput(key) {
    if (key === 'ArrowUp')
        return 'forward';
    if (key === 'ArrowLeft')
        return 'left';
    if (key === 'ArrowRight')
        return 'right';
    if (key === 'ArrowDown' || key === 'Escape')
        return 'stop';
    if (key === ' ' || key === 'Enter')
        return 'next';
    return null;
}
export const keyLabel = (action) => action === 'forward' ? '↑ or Space' : action === 'left' ? '← or Space' : action === 'right' ? '→ or Space' : 'Space or Enter';
export function acceptsInput(input, next) {
    return !!next && (input === 'next' || input === next);
}

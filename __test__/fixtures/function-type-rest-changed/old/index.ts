// function-type variable with rest param — should be MINOR (rest = optional), not MAJOR
export const logger: (...args: string[]) => void = () => {};

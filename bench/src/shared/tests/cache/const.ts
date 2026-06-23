// Case 2: the exact reported repro. The intermediate optional-chaining temp
// must stay mutable; the final aliased const must be promoted.
export function getAccountAge(localPlayer: Player | undefined): number | undefined {
    const accountAge = localPlayer?.AccountAge;
    return accountAge;
}

// Case 2: a local genuinely mutated in a loop -- must NEVER be promoted to
// const, regardless of what passes 1/3 do elsewhere in the file.
export function mutatesLocal(values: number[]): number {
    let total = 0;
    for (const v of values) {
        total += v;
    }
    return total;
}

// Case 3: a DIFFERENT function with a same-named local (`total`) that is
// never reassigned. This is the adversarial case: a name-only, file-wide
// regex with no scope boundary could incorrectly match THIS declaration
// when looking for the mutated `total` above, or vice versa.
export function safeLocal(values: number[]): number {
    const total = values.size();
    return total;
}

// Case 4: nested optional chaining two levels deep, to exercise more than
// one intermediate temp in the same statement.
export function getDisplayNameLength(player: Player | undefined): number | undefined {
    const length = player?.DisplayName?.size();
    return length;
}

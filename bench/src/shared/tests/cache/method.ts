// Reproduces TS2448 "Block-scoped variable used before its declaration".
//
// `Root` is re-assigned inside the for-loop body.  The transformer must NOT
// hoist `Root.IsA` to a top-of-block `const _cacheN` — that would reference
// `Root` before it is initialised and cause a compile error.

export function findSound(path: string): Instance | undefined {
    const Splits = string.split(path, "/");
    let Root: Instance | undefined = game.GetService("Workspace");

    for (const [, Next] of pairs(Splits)) {
        if (!Root) break;
        Root = Root.FindFirstChild(Next) as Instance | undefined;

        if (!Root || Root.IsA("Sound")) break; // Root.IsA read #1
    }

    if (Root !== undefined && Root.IsA("Sound")) { // Root.IsA read #2
        print(Root.Name);
    }

    return Root;
}

// Sanity-check: hoisting IS safe here because `part` is never reassigned.
export function cameraLookup(part: BasePart): number {
    return part.CFrame.Position.X
        + part.CFrame.Position.Y  // part.CFrame.Position appears 3× → safe to hoist
        + part.CFrame.Position.Z;
}

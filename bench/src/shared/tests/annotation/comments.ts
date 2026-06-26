// Scenario: a JSDoc block comment (`/** ... */`) immediately preceding a
// class declaration. roblox-ts compiles this into a Luau block comment
// (`--[[ ... ]]`) immediately preceding the `local ButtonState`
// declaration.
// EXPECT: the emitted `--[[` opener and `]]` closer both survive intact,
// matched to each other, with the comment body between them — NOT a
// dangling `]]` with no opener (the original reported bug), and NOT the
// comment body leaking out as unclassified "real code".
/**
 * @class
 */
export class ButtonState {
  public DidPress = false;
  public IsDown = false;
  public CanBeUpdated = true;
}

const state = new ButtonState();
print(state.DidPress);

// Scenario: a multi-line JSDoc comment with several tag lines, immediately
// before a function declaration (not a class). Exercises a block comment
// with more than one body line before the closer.
// EXPECT: the entire `--[[ ... ]]` span survives intact as one unit, in
// its original position directly above `local function`, with every body
// line (each `@param`/`@returns` tag) preserved.
/**
 * Computes the distance between two points.
 * @param a First point
 * @param b Second point
 * @returns The distance between a and b
 */
export function distance(a: Vector3, b: Vector3): number {
  return a.sub(b).Magnitude;
}

print(distance(new Vector3(0, 0, 0), new Vector3(1, 1, 1)));

// Scenario: ordinary single-line `//` comments (which compile to Luau
// single-line `--` comments), NOT block comments. This is a regression
// guard — the original (pre-fix) classifier already handled single-line
// comments correctly by dropping them, and the block-comment fix must not
// change that behavior.
// EXPECT: these comment lines are simply dropped (the pass always
// regenerates its own section labels), and the real code below is
// classified into a normal "-- Services" section as before.
import { Players } from "@rbxts/services";

// Just a plain note about why this exists.
print(Players.LocalPlayer);

// Scenario: two SEPARATE JSDoc/block comments in the same file's preamble
// area, each preceding its own declaration.
// EXPECT: both `--[[ ... ]]` spans survive intact and independently —
// neither merges into the other, and neither loses its opener/closer.
/**
 * @class
 */
export class Foo {
  public value = 1;
}

/**
 * @class
 */
export class Bar {
  public value = 2;
}

print(new Foo().value, new Bar().value);

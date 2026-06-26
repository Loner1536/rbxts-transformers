// Scenario: a single named import from @rbxts/services.
// EXPECT: hoisted into `local _Players = game:GetService("Players")`,
// with NO `_services` barrel local and NO `TS.import(...)` call anywhere
// in the output for this module.
import { Players, RunService as RS, Workspace } from "@rbxts/services";

const directPlayers = game.GetService("Players");

export function greet(name: string): string {
  return `Hello, ${name}`;
}

print(Players.LocalPlayer);
print(directPlayers.LocalPlayer);
print(greet(Players.LocalPlayer.Name));

function tick() {
  print(Players.LocalPlayer);
  print(RS.IsRunning());
  print(Workspace.Name);
}

tick();

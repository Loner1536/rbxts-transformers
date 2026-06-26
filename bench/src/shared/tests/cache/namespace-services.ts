// Scenario: a NAMESPACE import (`import * as X from "@rbxts/services"`)
// rather than a named import.
// EXPECT (documented limitation): this is NOT detected or hoisted by the
// transformer. It will still compile correctly via roblox-ts's normal
// barrel-import emission (the original `_services` shape), just without
// the hoisting optimization. This fixture exists to make the limitation
// explicit — if this ever starts getting hoisted too, great, but the
// reviewer should consciously update this comment when that happens
// rather than being surprised by a silent behavior change.
import * as Services from "@rbxts/services";

print(Services.Players.LocalPlayer);

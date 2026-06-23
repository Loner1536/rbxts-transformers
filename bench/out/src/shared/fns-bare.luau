--!native
-- Compiled with rotor v2.2.0
-- ── Vector3 / physics ────────────────────────────────────────────────────────
local function integrate(pos, vel, acc, dt)
	local _vel = vel
	local _acc = acc
	local _dt = dt
	local newVel = _vel + (_acc * _dt)
	local _pos = pos
	local _dt_1 = dt
	local _arg0 = newVel * _dt_1
	local newPos = _pos + _arg0
	return { newPos, newVel }
end
local function dot(a, b)
	return a.X * b.X + a.Y * b.Y + a.Z * b.Z
end
local function cross(a, b)
	return Vector3.new(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X)
end
local function lerpVec3(a, b, t)
	return Vector3.new(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t)
end
-- ── Buffer / encoding ────────────────────────────────────────────────────────
local function encodeFixed(buf, offset, value, scale)
	local fixed = math.floor(value * scale)
	local clamped = math.clamp(fixed, -32768, 32767)
	buffer.writei16(buf, offset, clamped)
	return offset + 2
end
local function encodePacket(buf, x, y, z, scale)
	local off = 0
	off = encodeFixed(buf, off, x, scale)
	off = encodeFixed(buf, off, y, scale)
	encodeFixed(buf, off, z, scale)
end
-- ── Math / arithmetic ────────────────────────────────────────────────────────
local function sumWeighted(values, weights)
	local total = 0
	for i = 0, #values - 1 do
		total += values[i + 1] * weights[i + 1]
	end
	return total
end
local function dotProduct(a, b)
	local sum = 0
	for i = 0, #a - 1 do
		sum += a[i + 1] * b[i + 1]
	end
	return sum
end
local function norm(values)
	local sq = 0
	for i = 0, #values - 1 do
		sq += values[i + 1] * values[i + 1]
	end
	return math.sqrt(sq)
end
local function mathHeavy(x, y)
	return math.sin(x) * math.cos(y) + math.sqrt(x * x + y * y) + math.atan2(y, x)
end
local function fib(n)
	if n <= 1 then
		return n
	end
	local a = 0
	local b = 1
	do
		local i = 2
		local _shouldIncrement = false
		while true do
			if _shouldIncrement then
				i += 1
			else
				_shouldIncrement = true
			end
			if not (i <= n) then
				break
			end
			local tmp = a + b
			a = b
			b = tmp
		end
	end
	return b
end
-- ── CFrame ───────────────────────────────────────────────────────────────────
local function cfLookAt(eye, target)
	return CFrame.lookAt(eye, target)
end
local function cfChain(cf, dt)
	local _cf = cf
	local _arg0 = CFrame.Angles(0, dt, 0)
	return _cf * _arg0
end
-- ── Services / instance ──────────────────────────────────────────────────────
local function serviceWork()
	local count = #game:GetService("Players"):GetPlayers()
	local running = game:GetService("RunService"):IsRunning()
	return `{count}-{running}`
end
local function multiService()
	local players = game:GetService("Players")
	local rs = game:GetService("RunService")
	local ws = game:GetService("Workspace")
	return rs:IsRunning() and players.MaxPlayers > 0 and ws.Gravity > 0
end
local function cameraWork(camera)
	local pos = camera.CFrame.Position
	local look = camera.CFrame.LookVector
	local fov = camera.FieldOfView
	return pos.Magnitude + look.X + fov
end
-- ── String ───────────────────────────────────────────────────────────────────
local function formatStats(label, value, unit)
	return `{label}: {string.format("%.4f", value)} {unit}`
end
local function buildKey(prefix, id, suffix)
	return `{prefix}_{id}_{suffix}`
end
return {
	integrate = integrate,
	dot = dot,
	cross = cross,
	lerpVec3 = lerpVec3,
	encodeFixed = encodeFixed,
	encodePacket = encodePacket,
	sumWeighted = sumWeighted,
	dotProduct = dotProduct,
	norm = norm,
	mathHeavy = mathHeavy,
	fib = fib,
	cfLookAt = cfLookAt,
	cfChain = cfChain,
	serviceWork = serviceWork,
	multiService = multiService,
	cameraWork = cameraWork,
	formatStats = formatStats,
	buildKey = buildKey,
}

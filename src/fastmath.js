// V8's Math.hypot takes a variable number of arguments and allocates on every call (and is slow); the game calls
// it a few thousand times a frame (328 places), which showed up as ~26 KB of garbage a frame and collection pauses
// on phones. Two- and three-argument calls (all of ours) become a plain square root; anything else falls back.
const hypot = Math.hypot;
Math.hypot = function (a, b, c, d) {
  if (d !== undefined) return hypot(a, b, c, d);
  if (c === undefined) return b === undefined ? Math.abs(a) : Math.sqrt(a * a + b * b);
  return Math.sqrt(a * a + b * b + c * c);
};
